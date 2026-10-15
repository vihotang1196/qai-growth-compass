import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS, type UiKey } from '@/config/ui-strings';
import type { AttemptSummary, ReportPayload, RetakeInfo } from '@/lib/reportApi';
import {
  formatMalaysiaTime,
  historyItems,
  historyNote,
  openRetakeBanner,
  retakeAction,
  type RetakeAction,
} from '@/lib/retakeView';
import { ReportHistory, ReportHistoryNote, ReportRetakeBanner, ReportRetakeSection } from '@/pages/ReportRetake';
import ReportFileActions from '@/pages/ReportFileActions';

/**
 * 报告页上重填的四块,渲到最终的 HTML 上断言(判断标准 4:断言停在最终产物,不停在中间层)。
 * 文案从 UI_STRINGS 取(src 里不写中文字面量);数字与时间按服务端回的那三个键。
 */
const zh = (k: UiKey) => UI_STRINGS[k].zh;
const en = (k: UiKey) => (UI_STRINGS[k] as { en?: string }).en ?? '';
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const wrap = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(LocaleProvider, null, el));
const noop = () => {};

const NOW = Date.parse('2026-10-15T07:20:00Z');
const AT = '2026-10-16T06:32:29.472Z';
const FIRST: AttemptSummary = { no: 1, completedAt: '2026-10-14T05:56:02.978+00:00', total: 2.5, tier: 'spot' };
const SECOND: AttemptSummary = { no: 2, completedAt: '2026-10-15T06:32:29.472+00:00', total: 5, tier: 'flywheel' };
const info = (over: Partial<RetakeInfo> = {}): RetakeInfo => ({
  canStart: true, reason: null, nextAllowedAt: null, openAttempt: null, maxAttempts: 6, minHoursBetween: 24, ...over,
});
const two = (retake: RetakeInfo, viewingNo = 2): Pick<ReportPayload, 'attempt' | 'attempts' | 'retake'> => ({
  attempt: { no: viewingNo, completedAt: viewingNo === 2 ? SECOND.completedAt : FIRST.completedAt, isLatest: viewingNo === 2 },
  attempts: [SECOND, FIRST],
  retake,
});

const section = (action: RetakeAction, over: Partial<{ busy: boolean; failed: boolean }> = {}) =>
  wrap(createElement(ReportRetakeSection, { action, nowMs: NOW, busy: false, failed: false, onStart: noop, onContinue: noop, ...over }));
/** 「重填」按钮那一个元素(找不到 → null) */
const retakeButton = (html: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${zh('report.retake.button')}(?:(?!</button>).)*</button>`))?.[0] ?? null;

describe('the retake section at the bottom of the report', () => {
  it('can retake → an enabled button and how many attempts are used', () => {
    const html = section({ kind: 'start', used: 1, max: 6, minHours: 24 });
    const btn = retakeButton(html);
    expect(btn).not.toBeNull();
    expect(btn).not.toMatch(/\sdisabled=""/);
    expect(visible(html)).toContain(zh('report.retake.used').replace('{used}', '1').replace('{max}', '6'));
    expect(visible(html)).toContain(zh('report.retake.title'));
  });

  it('too soon → the button is greyed and its place says how long and until when (Malaysia time)', () => {
    const html = section({ kind: 'too_soon', nextAllowedAt: AT, minHours: 24 });
    expect(retakeButton(html)).toMatch(/\sdisabled=""/);
    const wait = zh('report.retake.waitHm').replace('{h}', '23').replace('{m}', '13');
    const expected = zh('report.retake.tooSoon').replace('{hours}', '24').replace('{wait}', wait).replace('{time}', formatMalaysiaTime(AT, 'zh'));
    expect(visible(html)).toContain(expected);
    expect(visible(html)).toContain('14:32');
  });

  it('too soon, but less than an hour left → minutes only', () => {
    const html = wrap(createElement(ReportRetakeSection, {
      action: { kind: 'too_soon', nextAllowedAt: '2026-10-15T07:45:00Z', minHours: 24 }, nowMs: NOW, busy: false, failed: false, onStart: noop, onContinue: noop,
    }));
    expect(visible(html)).toContain(zh('report.retake.waitM').replace('{m}', '25'));
  });

  it('too soon according to the server, but the time has passed while the page was open → no negative wait, "refresh and try again"', () => {
    const html = wrap(createElement(ReportRetakeSection, {
      action: { kind: 'too_soon', nextAllowedAt: '2026-10-15T07:00:00Z', minHours: 24 }, nowMs: NOW, busy: false, failed: false, onStart: noop, onContinue: noop,
    }));
    expect(visible(html)).toContain(zh('report.retake.tooSoonAt').replace('{hours}', '24').replace('{time}', formatMalaysiaTime('2026-10-15T07:00:00Z', 'zh')));
  });

  it('all 6 used → greyed, and says so (first one + 5 retakes)', () => {
    const html = section({ kind: 'limit_reached', max: 6 });
    expect(retakeButton(html)).toMatch(/\sdisabled=""/);
    expect(visible(html)).toContain(zh('report.retake.limitReached').replace('{max}', '6').replace('{retakes}', '5'));
  });

  it('revoked link → greyed, and says the link is deactivated', () => {
    const html = section({ kind: 'revoked' });
    expect(retakeButton(html)).toMatch(/\sdisabled=""/);
    expect(visible(html)).toContain(zh('report.retake.revoked'));
  });

  it('the "you can take it again" line only where a retake is possible now or later — not above "all used" / "deactivated"', () => {
    expect(visible(section({ kind: 'start', used: 1, max: 6, minHours: 24 }))).toContain(zh('report.retake.body'));
    expect(visible(section({ kind: 'too_soon', nextAllowedAt: AT, minHours: 24 }))).toContain(zh('report.retake.body'));
    expect(visible(section({ kind: 'limit_reached', max: 6 }))).not.toContain(zh('report.retake.body'));
    expect(visible(section({ kind: 'revoked' }))).not.toContain(zh('report.retake.body'));
  });

  it('an unfinished retake → "continue the retake" instead of starting another', () => {
    const html = section({ kind: 'continue', attemptNo: 2 });
    expect(retakeButton(html)).toBeNull();
    expect(visible(html)).toContain(zh('report.retake.openBottom').replace('{n}', '2'));
    expect(visible(html)).toContain(zh('report.retake.continueLong'));
  });

  it('a failed start says so next to the button', () => {
    expect(visible(section({ kind: 'start', used: 1, max: 6, minHours: 24 }, { failed: true }))).toContain(zh('report.retake.failed'));
  });

  it('never goes to paper: the section is marked no-print', () => {
    expect(section({ kind: 'start', used: 1, max: 6, minHours: 24 })).toMatch(/class="[^"]*no-print/);
  });

  it('hidden (not open to this cohort / PDF render mode) → renders nothing at all', () => {
    expect(section({ kind: 'hidden' })).toBe('');
    expect(section(retakeAction(two(info({ canStart: false, reason: 'not_open' })), { renderMode: false }))).toBe('');
    expect(section(retakeAction(two(info()), { renderMode: true }))).toBe('');
  });
});

describe('the unfinished-retake bar at the top', () => {
  const banner = (b: { attemptNo: number } | null) =>
    wrap(createElement(ReportRetakeBanner, { banner: b, busy: null, failed: false, onContinue: noop, onAbandon: noop }));

  it('says which attempt is unfinished and offers continue and discard', () => {
    const html = banner({ attemptNo: 2 });
    const text = visible(html);
    expect(text).toContain(zh('report.retake.openTitle').replace('{n}', '2'));
    expect(text).toContain(zh('report.retake.openBody'));
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    expect(text).toContain(zh('report.retake.continue'));
    expect(text).toContain(zh('report.retake.abandon'));
    expect(html).toMatch(/class="[^"]*no-print/);
  });

  it('nothing when there is no unfinished retake, or in PDF render mode', () => {
    expect(banner(null)).toBe('');
    expect(banner(openRetakeBanner(two(info({ canStart: false, reason: 'open_attempt', openAttempt: 3 })), { renderMode: true }))).toBe('');
  });
});

describe('the list of past results', () => {
  const list = (items: ReturnType<typeof historyItems>) => wrap(createElement(ReportHistory, { items, onOpen: noop }));
  const tierZh = (k: string) => config.tiers.find((t) => t.key === k)!.zh;

  it('each attempt: its number, finish time (Malaysia), total and tier', () => {
    const text = visible(list(historyItems(two(info()), { renderMode: false })));
    expect(text).toContain(zh('report.history.title'));
    for (const a of [SECOND, FIRST]) {
      expect(text).toContain(zh('report.history.attempt').replace('{n}', String(a.no)));
      expect(text).toContain(formatMalaysiaTime(a.completedAt, 'zh'));
      expect(text).toContain(a.total.toFixed(1));
      expect(text).toContain(tierZh(a.tier));
    }
    // 最新的在前
    expect(text.indexOf(formatMalaysiaTime(SECOND.completedAt, 'zh'))).toBeLessThan(text.indexOf(formatMalaysiaTime(FIRST.completedAt, 'zh')));
  });

  it('the one on screen is marked and is not a link; every other one opens its own report', () => {
    const html = list(historyItems(two(info(), 1), { renderMode: false }));
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(visible(html)).toContain(zh('report.history.viewing'));
    expect(visible(html)).toContain(zh('report.history.latest'));
    expect(html).toMatch(/class="[^"]*no-print/);
  });

  it('nothing with a single attempt, or in PDF render mode', () => {
    expect(list(null)).toBe('');
    expect(list(historyItems(two(info()), { renderMode: true }))).toBe('');
  });
});

describe('the note on an older attempt', () => {
  const note = (n: ReturnType<typeof historyNote>) => wrap(createElement(ReportHistoryNote, { note: n, onBack: noop }));

  it('says which attempt and when, that the comparison uses today\'s numbers, and links back to the latest', () => {
    const html = note(historyNote(two(info(), 1), { renderMode: false }));
    const text = visible(html);
    expect(text).toContain(zh('report.history.viewingOld').replace('{n}', '1').replace('{time}', formatMalaysiaTime(FIRST.completedAt, 'zh')));
    expect(text).toContain(zh('report.history.baselineNote'));
    expect(text).toContain(zh('report.history.backToLatest'));
    expect(html).toMatch(/class="[^"]*no-print/);
  });

  it('nothing on the latest attempt, or in PDF render mode', () => {
    expect(note(historyNote(two(info()), { renderMode: false }))).toBe('');
    expect(note(historyNote(two(info(), 1), { renderMode: true }))).toBe('');
  });
});

describe('English', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('the same section reads in English when the page is English', () => {
    vi.stubGlobal('window', { location: { search: '?lang=en' }, localStorage: { getItem: () => null } });
    const text = visible(section({ kind: 'too_soon', nextAllowedAt: AT, minHours: 24 }));
    const wait = en('report.retake.waitHm').replace('{h}', '23').replace('{m}', '13');
    expect(text).toContain(en('report.retake.tooSoon').replace('{hours}', '24').replace('{wait}', wait).replace('{time}', '16 Oct 2026, 14:32'));
    expect(text).toContain(en('report.retake.button'));
  });
});

describe('downloads on an older attempt (Viho\'s decision 2: another language only for the latest)', () => {
  type Files = ReportPayload['files'];
  const f = (lang: 'zh' | 'en', availability: Files[number]['availability']): Files[number] => ({
    lang, availability, url: availability === 'ready' ? 'u' : null, cardUrl: null, cardTallUrl: null,
  });
  const actions = (files: Files, history: boolean) =>
    wrap(createElement(ReportFileActions, {
      files, current: 'zh', currentStatus: 'ready', pollDone: true, opening: null, generating: null, onOpen: noop, onGenerate: noop, history,
    }));
  const generateEn = zh('report.pdf.generateIn').replace('{lang}', zh('lang.name.en'));
  const downloadZh = zh('report.pdf.downloadIn').replace('{lang}', zh('lang.name.zh'));

  it('older attempt: what exists can be downloaded, no "generate the other language", and a line saying why', () => {
    const text = visible(actions([f('zh', 'ready'), f('en', 'absent')], true));
    expect(text).toContain(downloadZh);
    expect(text).not.toContain(generateEn);
    expect(text).toContain(zh('report.history.onlyExisting'));
  });

  it('older attempt with a failed file: still no generate button', () => {
    const text = visible(actions([f('zh', 'ready'), f('en', 'failed')], true));
    expect(text).not.toContain(generateEn);
  });

  it('older attempt with both languages ready: two downloads, no note', () => {
    const text = visible(actions([f('zh', 'ready'), f('en', 'ready')], true));
    expect(text).toContain(downloadZh);
    expect(text).not.toContain(zh('report.history.onlyExisting'));
  });

  it('the latest attempt is unchanged: the generate button is still there', () => {
    expect(visible(actions([f('zh', 'ready'), f('en', 'absent')], false))).toContain(generateEn);
  });
});
