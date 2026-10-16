import { describe, expect, it } from 'vitest';
import type { AttemptSummary, RetakeInfo, ViewingAttempt } from '@/lib/reportApi';
import {
  formatMalaysiaTime,
  historyItems,
  historyNote,
  openRetakeBanner,
  parseAttemptParam,
  retakeAction,
  waitUntil,
} from '@/lib/retakeView';

/**
 * 报告页上「重填」那几块该不该出现、出现成什么样 —— 判定全在这里(纯函数),页面只照着画。
 * 数据形状照抄 2026-10-15 生产上那条测试 entitlement 走完第 2 份之后报告接口回的三个键
 * (scripts/e2e/retake-step2-walkthrough.mjs 的输出)。
 */
const info = (over: Partial<RetakeInfo> = {}): RetakeInfo => ({
  canStart: true,
  reason: null,
  nextAllowedAt: null,
  openAttempt: null,
  maxAttempts: 6,
  minHoursBetween: 24,
  ...over,
});
const att = (no: number, completedAt: string, total: number, tier: string): AttemptSummary => ({ no, completedAt, total, tier });
const FIRST = att(1, '2026-10-14T05:56:02.978+00:00', 2.5, 'spot');
const SECOND = att(2, '2026-10-15T06:32:29.472+00:00', 5, 'flywheel');
const viewing = (no: number, completedAt: string, isLatest: boolean): ViewingAttempt => ({ no, completedAt, isLatest });

const oneAttempt = (retake: RetakeInfo) => ({ attempt: viewing(1, FIRST.completedAt!, true), attempts: [FIRST], retake });
const twoAttempts = (retake: RetakeInfo, viewingNo = 2) => ({
  attempt: viewingNo === 2 ? viewing(2, SECOND.completedAt!, true) : viewing(1, FIRST.completedAt!, false),
  attempts: [SECOND, FIRST],
  retake,
});
const page = { renderMode: false };
const pdf = { renderMode: true };

/** 服务端会回的每一种状态 —— 「PDF 渲染模式下都不出现」要对每一种都成立 */
const EVERY_STATE: RetakeInfo[] = [
  info(),
  info({ canStart: false, reason: 'too_soon', nextAllowedAt: '2026-10-16T06:32:29.472Z' }),
  info({ canStart: false, reason: 'limit_reached' }),
  info({ canStart: false, reason: 'revoked' }),
  info({ canStart: false, reason: 'open_attempt', openAttempt: 3 }),
  info({ canStart: false, reason: 'not_open' }),
  info({ canStart: false, reason: 'not_open', openAttempt: 2 }),
];

describe('retakeAction —— what sits at the bottom of the report', () => {
  it('can retake → a start button that knows how many attempts are used', () => {
    expect(retakeAction(oneAttempt(info()), page)).toEqual({ kind: 'start', used: 1, max: 6, minHours: 24 });
    expect(retakeAction(twoAttempts(info()), page)).toEqual({ kind: 'start', used: 2, max: 6, minHours: 24 });
  });

  it('too soon → the reason carries the time it opens again', () => {
    const at = '2026-10-16T06:32:29.472Z';
    expect(retakeAction(twoAttempts(info({ canStart: false, reason: 'too_soon', nextAllowedAt: at })), page)).toEqual({
      kind: 'too_soon',
      nextAllowedAt: at,
      minHours: 24,
    });
  });

  it('all 6 used → limit_reached with the maximum', () => {
    expect(retakeAction(twoAttempts(info({ canStart: false, reason: 'limit_reached' })), page)).toEqual({ kind: 'limit_reached', max: 6 });
  });

  it('revoked link → revoked, whether the payload says so or a tap just got a 403', () => {
    expect(retakeAction(oneAttempt(info({ canStart: false, reason: 'revoked' })), page)).toEqual({ kind: 'revoked' });
    // 页面开着时链接被作废:payload 还说能重填,点下去拿到 403 —— 那一刻起按钮的位置说「已作废」
    expect(retakeAction(oneAttempt(info()), { renderMode: false, revokedNow: true })).toEqual({ kind: 'revoked' });
  });

  it('an unfinished retake → continue that attempt (not a second one)', () => {
    expect(retakeAction(oneAttempt(info({ canStart: false, reason: 'open_attempt', openAttempt: 2 })), page)).toEqual({
      kind: 'continue',
      attemptNo: 2,
    });
  });

  it('not open to this cohort (the retake switch is closed) → nothing at all, real students see no change', () => {
    expect(retakeAction(oneAttempt(info({ canStart: false, reason: 'not_open' })), page)).toEqual({ kind: 'hidden' });
  });

  it('switch closed while a retake is half done (the server says not_open AND names the open attempt) → continue it, not stuck', () => {
    const closedMidway = info({ canStart: false, reason: 'not_open', openAttempt: 2 });
    expect(retakeAction(oneAttempt(closedMidway), page)).toEqual({ kind: 'continue', attemptNo: 2 });
    expect(openRetakeBanner(oneAttempt(closedMidway), page)).toEqual({ attemptNo: 2 });
  });

  it('no completed attempt → nothing (the report page is not the place to start the first one)', () => {
    expect(retakeAction(oneAttempt(info({ canStart: false, reason: 'no_completed_attempt' })), page)).toEqual({ kind: 'hidden' });
  });

  it('PDF render mode → nothing, for every state', () => {
    for (const r of EVERY_STATE) {
      expect(retakeAction(twoAttempts(r), pdf), JSON.stringify(r)).toEqual({ kind: 'hidden' });
      expect(retakeAction(twoAttempts(r), { renderMode: true, revokedNow: true })).toEqual({ kind: 'hidden' });
    }
  });

  it('no retake key (the render-token response, or an older server) → nothing', () => {
    expect(retakeAction({ attempt: null, attempts: undefined, retake: undefined }, page)).toEqual({ kind: 'hidden' });
  });

  it('looking at an older attempt → no retake section there (it lives on the latest report)', () => {
    expect(retakeAction(twoAttempts(info(), 1), page)).toEqual({ kind: 'hidden' });
  });
});

describe('openRetakeBanner —— the continue / discard bar at the top', () => {
  it('shows only while a retake is unfinished, with its number', () => {
    expect(openRetakeBanner(oneAttempt(info({ canStart: false, reason: 'open_attempt', openAttempt: 2 })), page)).toEqual({ attemptNo: 2 });
    expect(openRetakeBanner(oneAttempt(info()), page)).toBeNull();
    expect(openRetakeBanner(twoAttempts(info({ canStart: false, reason: 'too_soon', nextAllowedAt: 'x' })), page)).toBeNull();
  });

  it('also on an older attempt\'s page (it is about the person, not the page)', () => {
    expect(openRetakeBanner(twoAttempts(info({ canStart: false, reason: 'open_attempt', openAttempt: 3 }), 1), page)).toEqual({ attemptNo: 3 });
  });

  it('never in PDF render mode, never after the link was revoked under the page', () => {
    for (const r of EVERY_STATE) expect(openRetakeBanner(twoAttempts(r), pdf)).toBeNull();
    expect(openRetakeBanner(oneAttempt(info({ canStart: false, reason: 'open_attempt', openAttempt: 2 })), { renderMode: false, revokedNow: true })).toBeNull();
  });
});

describe('historyItems —— the list of past results', () => {
  it('one attempt → no list', () => {
    expect(historyItems(oneAttempt(info()), page)).toBeNull();
  });

  it('two or more → newest first, each with its finish time, total and tier; the latest and the one on screen are marked', () => {
    expect(historyItems(twoAttempts(info()), page)).toEqual([
      { ...SECOND, viewing: true, latest: true },
      { ...FIRST, viewing: false, latest: false },
    ]);
    expect(historyItems(twoAttempts(info(), 1), page)).toEqual([
      { ...SECOND, viewing: false, latest: true },
      { ...FIRST, viewing: true, latest: false },
    ]);
  });

  it('orders by attempt number, not by the order the server happened to send', () => {
    const third = att(3, '2026-10-17T01:00:00+00:00', 4, 'systemic');
    const items = historyItems({ attempt: viewing(3, third.completedAt!, true), attempts: [FIRST, third, SECOND], retake: info() }, page)!;
    expect(items.map((i) => i.no)).toEqual([3, 2, 1]);
    expect(items.map((i) => i.latest)).toEqual([true, false, false]);
  });

  it('never in PDF render mode', () => {
    expect(historyItems(twoAttempts(info()), pdf)).toBeNull();
  });
});

describe('historyNote —— the line on top of an older attempt', () => {
  it('only when the page shows an attempt that is not the latest', () => {
    expect(historyNote(twoAttempts(info()), page)).toBeNull();
    expect(historyNote(twoAttempts(info(), 1), page)).toEqual({ no: 1, completedAt: FIRST.completedAt });
    expect(historyNote(twoAttempts(info(), 1), pdf)).toBeNull();
  });
});

describe('parseAttemptParam —— ?attempt= on the report URL', () => {
  it('accepts the same numbers the server accepts (1–999)', () => {
    expect(parseAttemptParam('1')).toBe(1);
    expect(parseAttemptParam('12')).toBe(12);
    expect(parseAttemptParam('999')).toBe(999);
  });
  it('anything else is "no attempt" (the latest), never a guess', () => {
    for (const raw of [null, '', '0', '-1', '1.5', 'abc', '1000', ' 1', '01']) expect(parseAttemptParam(raw), String(raw)).toBeNull();
  });
});

describe('formatMalaysiaTime —— times are shown in Malaysia time (UTC+8), whatever the phone is set to', () => {
  const at = '2026-10-16T06:32:29.472Z'; // 14:32 in Kuala Lumpur
  it('en', () => {
    expect(formatMalaysiaTime(at, 'en')).toBe('16 Oct 2026, 14:32');
  });
  it('zh carries the same date and the Malaysia hour, not the UTC one', () => {
    const s = formatMalaysiaTime(at, 'zh');
    expect(s).toContain('2026');
    expect(s).toContain('16');
    expect(s).toContain('14:32');
    expect(s).not.toContain('06:32');
  });
  it('crosses the date line correctly (UTC evening = next morning in Malaysia)', () => {
    expect(formatMalaysiaTime('2026-10-14T20:15:00Z', 'en')).toBe('15 Oct 2026, 04:15');
  });
  it('missing or broken → empty, never "Invalid Date"', () => {
    expect(formatMalaysiaTime(null, 'en')).toBe('');
    expect(formatMalaysiaTime('not a date', 'zh')).toBe('');
  });
});

describe('waitUntil —— how long until the next retake', () => {
  const now = Date.parse('2026-10-15T07:20:00Z');
  it('rounds up to the minute (never says 0 minutes while still closed)', () => {
    expect(waitUntil('2026-10-16T06:32:29.472Z', now)).toEqual({ hours: 23, minutes: 13 });
    expect(waitUntil('2026-10-15T08:20:00Z', now)).toEqual({ hours: 1, minutes: 0 });
    expect(waitUntil('2026-10-15T07:20:01Z', now)).toEqual({ hours: 0, minutes: 1 });
  });
  it('already past, or no time → null (the page then says "refresh and try again")', () => {
    expect(waitUntil('2026-10-15T07:19:59Z', now)).toBeNull();
    expect(waitUntil('2026-10-15T07:20:00Z', now)).toBeNull();
    expect(waitUntil(null, now)).toBeNull();
    expect(waitUntil('garbage', now)).toBeNull();
  });
});
