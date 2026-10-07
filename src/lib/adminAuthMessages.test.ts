import { describe, expect, it, vi } from 'vitest';
import { AuthInvalidCredentialsError, createClient } from '@supabase/supabase-js';
import { UI_STRINGS } from '../config/ui-strings';
import {
  adminLoginNotice,
  requestAdminLink,
  type AdminLoginNotice,
  type AdminOtpRequest,
} from './adminAuthMessages';

/**
 * 一个绝不能出现在页面上的串。它被塞进每个假响应的 msg / body 里 ——
 * 下面先断言它**真的**进了 `error.message`(否则「页面上没有它」这条断言无事可做),
 * 再断言判定结果里没有它。
 */
const SENTINEL = 'RAW-GOTRUE-MESSAGE-7f3a';

type Respond = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 真的 supabase-js 客户端,只把 fetch 换掉。
 *
 * 【为什么不手搓错误对象】判定依赖的是 auth-js 怎么把一个响应**包**成错误
 * (类名 + status)。手搓的话,测试验的是「判定与我对 auth-js 的理解一致」,
 * 而不是「判定与 auth-js 一致」—— auth-js 哪天改了包法,手搓的测试照样绿。
 */
function realClient(respond: Respond) {
  return createClient('https://example.supabase.co', 'sb_publishable_test', {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: ((url: RequestInfo | URL, init?: RequestInit) => respond(String(url), init ?? {})) as typeof fetch,
    },
  });
}

const jsonResponse =
  (status: number, body: unknown): Respond =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );

/** GoTrue 的错误体形状:`error_code` + `msg` */
const gotrue = (status: number, errorCode: string) =>
  jsonResponse(status, { code: status, error_code: errorCode, msg: SENTINEL });

/** 每一种「拿到了 HTTP 响应」的情况 —— 它们必须全部落在同一句上 */
const HTTP_CASES: [string, Respond][] = [
  ['200 link sent', jsonResponse(200, {})],
  ['422 otp_disabled (email not registered)', gotrue(422, 'otp_disabled')],
  ['422 signup_disabled (signups closed)', gotrue(422, 'signup_disabled')],
  ['429 over_email_send_rate_limit (registered email asked twice)', gotrue(429, 'over_email_send_rate_limit')],
  ['400 email_address_invalid', gotrue(400, 'email_address_invalid')],
  ['403 email_address_not_authorized (built-in SMTP)', gotrue(403, 'email_address_not_authorized')],
  ['401 invalid api key (gateway, stale build)', jsonResponse(401, { message: SENTINEL })],
  ['500 server error', jsonResponse(500, { msg: SENTINEL })],
  ['503 upstream unavailable', jsonResponse(503, { msg: SENTINEL })],
  [
    '404 with a non-JSON body',
    () => Promise.resolve(new Response(`<html>${SENTINEL}</html>`, { status: 404 })),
  ],
];

const networkFailure: Respond = () => Promise.reject(new TypeError(`Failed to fetch ${SENTINEL}`));

const ALL_NOTICES: AdminLoginNotice[] = [
  'admin.login.neutral',
  'admin.login.networkError',
  'admin.login.unexpected',
];

async function otpErrorFrom(respond: Respond) {
  const { error } = await realClient(respond).auth.signInWithOtp({
    email: 'someone@example.com',
    options: { shouldCreateUser: false },
  });
  return error;
}

describe('adminLoginNotice: every HTTP response reads the same', () => {
  it('the sentinel really reaches error.message for the JSON error cases', async () => {
    /**
     * 前提断言:如果假响应里的串根本没进 error.message,
     * 「页面上没有它」就是一条无事可做的断言(判断标准 1 推论三)。
     */
    for (const [label, respond] of HTTP_CASES.slice(1, 7)) {
      const error = await otpErrorFrom(respond);
      expect(error?.message, label).toContain(SENTINEL);
    }
  });

  it.each(HTTP_CASES)('%s → neutral', async (_label, respond) => {
    expect(adminLoginNotice(await otpErrorFrom(respond))).toBe('admin.login.neutral');
  });

  it('all HTTP branches produce exactly one output', async () => {
    const outputs = new Set<AdminLoginNotice>();
    for (const [, respond] of HTTP_CASES) outputs.add(adminLoginNotice(await otpErrorFrom(respond)));
    expect([...outputs]).toEqual(['admin.login.neutral']);
  });
});

describe('adminLoginNotice: only a request that never got a response is a network error', () => {
  it('fetch rejecting → networkError', async () => {
    const error = await otpErrorFrom(networkFailure);
    // 前提:auth-js 把它包成 status 0 的 AuthRetryableFetchError —— 判定靠的就是这个
    expect(error?.name).toBe('AuthRetryableFetchError');
    expect(error?.status).toBe(0);
    expect(adminLoginNotice(error)).toBe('admin.login.networkError');
  });

  it('a client-side error with a 400 status is NOT treated as a response', () => {
    // 它在没发任何请求时就抛了;按 status 判会被当成「已发送」
    const clientSide = new AuthInvalidCredentialsError(SENTINEL);
    expect(clientSide.status).toBe(400);
    expect(adminLoginNotice(clientSide)).toBe('admin.login.unexpected');
  });

  it('anything else falls to unexpected, never to neutral', () => {
    expect(adminLoginNotice(new Error(SENTINEL))).toBe('admin.login.unexpected');
    expect(adminLoginNotice(SENTINEL)).toBe('admin.login.unexpected');
    expect(adminLoginNotice({ name: 'SomethingNew', status: 200 })).toBe('admin.login.unexpected');
  });
});

describe('requestAdminLink: the page only ever receives a message key', () => {
  it('sends create_user: false and the redirect on the wire', async () => {
    let seenUrl = '';
    let seenBody: Record<string, unknown> = {};
    const client = realClient((url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body));
      return jsonResponse(200, {})(url, init);
    });
    await requestAdminLink(
      (request: AdminOtpRequest) => client.auth.signInWithOtp(request),
      'someone@example.com',
      'https://compass.example/admin',
      vi.fn(),
    );
    // 断言的是 GoTrue 收到的东西,不是我们传给 auth-js 的参数
    expect(seenBody.create_user).toBe(false);
    expect(new URL(seenUrl).searchParams.get('redirect_to')).toBe('https://compass.example/admin');
  });

  it('never returns anything carrying the raw message, for every outcome', async () => {
    const outcomes: Respond[] = [...HTTP_CASES.map(([, r]) => r), networkFailure];
    for (const respond of outcomes) {
      const client = realClient(respond);
      const notice = await requestAdminLink(
        (request) => client.auth.signInWithOtp(request),
        'someone@example.com',
        'https://compass.example/admin',
        vi.fn(),
      );
      expect(ALL_NOTICES).toContain(notice);
      expect(String(notice)).not.toContain(SENTINEL);
    }
  });

  it('does not throw when building the client throws (missing env) → unexpected', async () => {
    const notice = await requestAdminLink(
      () => {
        throw new Error(`missing VITE_SUPABASE_URL ${SENTINEL}`);
      },
      'someone@example.com',
      'https://compass.example/admin',
      vi.fn(),
    );
    expect(notice).toBe('admin.login.unexpected');
  });

  it('logs the error to the console for the operator, and stays quiet on success', async () => {
    const log = vi.fn();
    await requestAdminLink(
      (request) => realClient(jsonResponse(200, {})).auth.signInWithOtp(request),
      'a@example.com',
      'https://compass.example/admin',
      log,
    );
    expect(log).not.toHaveBeenCalled();
    await requestAdminLink(
      (request) => realClient(gotrue(422, 'otp_disabled')).auth.signInWithOtp(request),
      'a@example.com',
      'https://compass.example/admin',
      log,
    );
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('the three notices exist in both languages', () => {
  it('every notice key has non-empty zh and en text, and the cooldown has its {n}', () => {
    for (const key of ALL_NOTICES) {
      expect(UI_STRINGS[key].zh.length, key).toBeGreaterThan(0);
      expect(UI_STRINGS[key].en?.length ?? 0, key).toBeGreaterThan(0);
    }
    expect(UI_STRINGS['admin.login.cooldown'].zh).toContain('{n}');
    expect(UI_STRINGS['admin.login.cooldown'].en).toContain('{n}');
  });
});
