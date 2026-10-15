import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_STRINGS, type UiKey } from '@/config/ui-strings';
import type { ConfirmOptions } from '@/components/ConfirmProvider';
import { QuizAuthError, RetakeRefusedError, quizApi, type QuizSnapshot } from '@/lib/quizApi';
import {
  abandonConfirmOptions,
  abandonRetakeFlow,
  continueRetakeFlow,
  retakeConfirmOptions,
  startRetakeFlow,
} from '@/lib/retakeFlow';

/**
 * 报告页上三个重填动作背后的顺序与结果 —— 抽成纯函数,确认框与请求都由调用方注入,所以能在 node 里测:
 *   - 「重填」「放弃」**先问、后发**:取消 = 一个请求都不发
 *   - 「正在准备…」只在请求路上出现,确认框开着的时候按钮不转圈
 *   - 每一种服务端回答落到哪一种结果(拒绝的原因、作废、登录失效、别的失败)
 */
const snap = (over: Partial<QuizSnapshot> = {}): QuizSnapshot => ({
  locale: 'zh',
  profile: {},
  answers: {},
  status: 'in_progress',
  complete: false,
  sessionId: 's2',
  attemptNo: 2,
  prefill: null,
  ...over,
});
const CONFIRM: ConfirmOptions = { title: 't' };

/** 记下发生的顺序:ask / request / busy:on / busy:off */
function harness(answer: boolean, request: () => Promise<unknown>) {
  const log: string[] = [];
  return {
    log,
    ask: async () => {
      log.push('ask');
      return answer;
    },
    request: async () => {
      log.push('request');
      return request();
    },
    onRequest: (on: boolean) => log.push(on ? 'busy:on' : 'busy:off'),
  };
}

describe('startRetakeFlow', () => {
  it('asks first; cancel sends nothing', async () => {
    const h = harness(false, async () => snap());
    const out = await startRetakeFlow({ ...h, confirm: CONFIRM, request: h.request as () => Promise<QuizSnapshot>, fallbackLocale: 'zh' });
    expect(out).toEqual({ kind: 'cancelled' });
    expect(h.log).toEqual(['ask']);
  });

  it('confirmed → one request, busy only while it is on the way → the page for the new attempt, in its own language', async () => {
    const h = harness(true, async () => snap({ locale: 'en' }));
    const out = await startRetakeFlow({ ...h, confirm: CONFIRM, request: h.request as () => Promise<QuizSnapshot>, fallbackLocale: 'zh' });
    expect(out).toEqual({ kind: 'started', route: '/quiz?lang=en' });
    expect(h.log).toEqual(['ask', 'busy:on', 'request', 'busy:off']);
  });

  it('the dialog is given exactly the options it was asked to show', async () => {
    let seen: ConfirmOptions | null = null;
    await startRetakeFlow({
      ask: async (o) => {
        seen = o;
        return false;
      },
      confirm: { title: 'T', description: 'D', confirmLabel: 'C' },
      request: async () => snap(),
      fallbackLocale: 'zh',
    });
    expect(seen).toEqual({ title: 'T', description: 'D', confirmLabel: 'C' });
  });

  it('refused by the server → its reason and the time, nothing else happens', async () => {
    const h = harness(true, async () => {
      throw new RetakeRefusedError('too_soon', '2026-10-16T06:32:29.472Z');
    });
    expect(await startRetakeFlow({ ...h, confirm: CONFIRM, request: h.request as () => Promise<QuizSnapshot>, fallbackLocale: 'zh' })).toEqual({
      kind: 'refused',
      reason: 'too_soon',
      nextAllowedAt: '2026-10-16T06:32:29.472Z',
    });
    expect(h.log.at(-1)).toBe('busy:off');
  });

  it('link revoked under the page (403) → revoked; signed out (401) → authLost; anything else → failed', async () => {
    const run = (err: unknown) =>
      startRetakeFlow({ ask: async () => true, confirm: CONFIRM, request: async () => Promise.reject(err), fallbackLocale: 'zh' });
    expect(await run(new QuizAuthError('revoked'))).toEqual({ kind: 'revoked' });
    expect(await run(new QuizAuthError('unauthorized'))).toEqual({ kind: 'authLost' });
    expect(await run(new Error('internal_error'))).toEqual({ kind: 'failed' });
  });
});

describe('abandonRetakeFlow', () => {
  it('asks first; cancel sends nothing', async () => {
    const h = harness(false, async () => ({ ok: true }));
    expect(await abandonRetakeFlow({ ...h, confirm: CONFIRM })).toEqual({ kind: 'cancelled' });
    expect(h.log).toEqual(['ask']);
  });

  it('confirmed → one request → abandoned', async () => {
    const h = harness(true, async () => ({ ok: true, abandonedAttemptNo: 2 }));
    expect(await abandonRetakeFlow({ ...h, confirm: CONFIRM })).toEqual({ kind: 'abandoned' });
    expect(h.log).toEqual(['ask', 'busy:on', 'request', 'busy:off']);
  });

  it('already gone (finished or discarded in another tab) → gone, so the page just refreshes', async () => {
    const run = (err: unknown) => abandonRetakeFlow({ ask: async () => true, confirm: CONFIRM, request: async () => Promise.reject(err) });
    expect(await run(new RetakeRefusedError('no_open_attempt'))).toEqual({ kind: 'gone' });
    expect(await run(new QuizAuthError('revoked'))).toEqual({ kind: 'revoked' });
    expect(await run(new QuizAuthError('unauthorized'))).toEqual({ kind: 'authLost' });
    expect(await run(new Error('boom'))).toEqual({ kind: 'failed' });
  });
});

describe('continueRetakeFlow', () => {
  it('goes where the unfinished attempt actually is (quiz or survey), in its own language', async () => {
    expect(await continueRetakeFlow({ bootstrap: async () => snap(), fallbackLocale: 'en' })).toEqual({ kind: 'go', route: '/quiz?lang=zh' });
    expect(await continueRetakeFlow({ bootstrap: async () => snap({ status: 'survey', locale: 'en' }), fallbackLocale: 'zh' })).toEqual({
      kind: 'go',
      route: '/survey?lang=en',
    });
    // 另一个标签页里刚好交卷了:去报告(新的那份)
    expect(await continueRetakeFlow({ bootstrap: async () => snap({ status: 'completed' }), fallbackLocale: 'zh' })).toEqual({
      kind: 'go',
      route: '/report?lang=zh',
    });
  });

  it('maps failures the same way as the other two', async () => {
    const run = (err: unknown) => continueRetakeFlow({ bootstrap: async () => Promise.reject(err), fallbackLocale: 'zh' });
    expect(await run(new QuizAuthError('revoked'))).toEqual({ kind: 'revoked' });
    expect(await run(new QuizAuthError('unauthorized'))).toEqual({ kind: 'authLost' });
    expect(await run(new Error('x'))).toEqual({ kind: 'failed' });
  });
});

describe('the confirmation copy', () => {
  const tk = (k: UiKey) => UI_STRINGS[k].zh;
  const tkEn = (k: UiKey) => (UI_STRINGS[k] as { en?: string }).en ?? '';

  it('retake: names the action on the button, fills in the rule numbers and which attempt this will be', () => {
    for (const t of [tk, tkEn]) {
      const o = retakeConfirmOptions(t, { kind: 'start', used: 2, max: 6, minHours: 24 });
      expect(o.title).toBe(t('report.retake.confirmTitle'));
      expect(o.confirmLabel).toBe(t('report.retake.confirmAction'));
      expect(o.description).not.toMatch(/\{\w+\}/);
      // 用了 2 份 → 这会是第 3 份;规则的数字来自服务端(24 小时 / 6 份),不是页面里写死的
      expect(o.description).toBe(t('report.retake.confirmBody').replace('{hours}', '24').replace('{max}', '6').replace('{next}', '3'));
      const other = retakeConfirmOptions(t, { kind: 'start', used: 1, max: 4, minHours: 48 });
      expect(other.description).toBe(t('report.retake.confirmBody').replace('{hours}', '48').replace('{max}', '4').replace('{next}', '2'));
    }
  });

  it('discard: its own title, body and an action-named button', () => {
    const o = abandonConfirmOptions(tk);
    expect(o).toEqual({
      title: tk('report.retake.abandonTitle'),
      description: tk('report.retake.abandonBody'),
      confirmLabel: tk('report.retake.abandonAction'),
    });
  });
});

describe('quizApi.startRetake / abandonRetake —— the server\'s refusal keeps its reason and time', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));

  it('409 too_soon → RetakeRefusedError with the time', async () => {
    reply(409, { error: 'too_soon', nextAllowedAt: '2026-10-16T06:32:29.472Z' });
    const err = await quizApi.startRetake().catch((e) => e);
    expect(err).toBeInstanceOf(RetakeRefusedError);
    expect(err).toMatchObject({ reason: 'too_soon', nextAllowedAt: '2026-10-16T06:32:29.472Z' });
  });

  it('409 limit_reached / open_attempt → RetakeRefusedError without a time', async () => {
    for (const reason of ['limit_reached', 'open_attempt', 'not_open']) {
      reply(409, { error: reason });
      const err = await quizApi.startRetake().catch((e) => e);
      expect(err).toBeInstanceOf(RetakeRefusedError);
      expect(err).toMatchObject({ reason, nextAllowedAt: null });
    }
  });

  it('403 → QuizAuthError revoked (not a refusal)', async () => {
    reply(403, { error: 'revoked' });
    const err = await quizApi.startRetake().catch((e) => e);
    expect(err).toBeInstanceOf(QuizAuthError);
    expect(err).toMatchObject({ kind: 'revoked' });
  });

  it('200 → the new attempt\'s snapshot; the request is start_retake and carries no session id', async () => {
    reply(200, snap({ attemptNo: 3 }));
    expect(await quizApi.startRetake()).toMatchObject({ attemptNo: 3, sessionId: 's2' });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assessment-quiz');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'start_retake' });
  });

  it('abandon: 409 no_open_attempt → RetakeRefusedError', async () => {
    reply(409, { error: 'no_open_attempt' });
    const err = await quizApi.abandonRetake().catch((e) => e);
    expect(err).toBeInstanceOf(RetakeRefusedError);
    expect(err).toMatchObject({ reason: 'no_open_attempt' });
  });

  it('other 409s on ordinary writes keep their old shape (a plain Error with the code as message)', async () => {
    reply(409, { error: 'survey_missing' });
    const err = await quizApi.saveAnswer('G1', 0, 's').catch((e) => e);
    expect(err).not.toBeInstanceOf(RetakeRefusedError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('survey_missing');
  });
});
