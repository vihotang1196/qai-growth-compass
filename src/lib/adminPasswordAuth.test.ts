import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { UI_STRINGS } from '../config/ui-strings';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  ADMIN_PASSWORD_MAX_BYTES,
  checkNewPassword,
  signInAdminWithPassword,
  updateAdminPassword,
} from './adminPasswordAuth';

/**
 * 与 adminAuthMessages.test.ts 同一个做法:真的 supabase-js 客户端,只把 fetch 换掉。
 * 判定依赖的是 auth-js 怎么把响应包成错误(类名 + code + status),手搓错误对象的话,
 * 测试验的只是「判定与我对 auth-js 的理解一致」。
 *
 * SENTINEL 塞进每个假响应 —— 页面只拿文案 key,所以它不可能出现在页面上;
 * 这里断言的是返回值里没有它(返回值就是页面能拿到的全部)。
 */
const SENTINEL = 'RAW-GOTRUE-MESSAGE-91c2';

interface Call {
  url: string;
  method: string;
  body: string;
}
type Respond = (url: string, init: RequestInit) => Promise<Response>;

function realClient(respond: Respond, calls: Call[] = []) {
  return createClient('https://example.supabase.co', 'sb_publishable_test', {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: ((url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') });
        return respond(String(url), init ?? {});
      }) as typeof fetch,
    },
  });
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const gotrue = (status: number, errorCode: string, extra: Record<string, unknown> = {}) =>
  json(status, { code: status, error_code: errorCode, msg: SENTINEL, ...extra });

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'admin@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-14T00:00:00Z',
};

/** 语法上合法、签名无所谓的 JWT —— setSession 只解码 exp,不验签 */
function fakeJwt(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.sig`;
}

const PASSWORD_OK = 'correct-horse-9';
const signInVia = (client: ReturnType<typeof realClient>) => (c: { email: string; password: string }) =>
  client.auth.signInWithPassword(c);

describe('signInAdminWithPassword', () => {
  it('signs in on 200 and sends email + password to the password grant', async () => {
    const calls: Call[] = [];
    const client = realClient(
      () =>
        json(200, {
          access_token: fakeJwt(),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'r1',
          user: USER,
        }),
      calls,
    );
    expect(await signInAdminWithPassword(signInVia(client), ' admin@example.com ', PASSWORD_OK)).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/auth/v1/token?grant_type=password');
    // 邮箱去掉首尾空格;密码原样(密码里的空格是密码的一部分)
    expect(JSON.parse(calls[0].body)).toMatchObject({ email: 'admin@example.com', password: PASSWORD_OK });
  });

  /**
   * 需求原文:「登录失败一律显示同一句中性提示,不区分『邮箱不存在』和『密码错误』」。
   * GoTrue 对这两种本来就回同一个 400 invalid_credentials;这里再把所有「拿到了响应」的失败
   * 都钉在同一句上 —— 包括会泄露「这个邮箱存在」的 email_not_confirmed。
   */
  const FAILURES: [string, Respond][] = [
    ['400 invalid_credentials (wrong password)', () => gotrue(400, 'invalid_credentials')],
    ['400 invalid_credentials (no such email)', () => gotrue(400, 'invalid_credentials')],
    ['400 email_not_confirmed (would reveal the email exists)', () => gotrue(400, 'email_not_confirmed')],
    ['422 validation_failed', () => gotrue(422, 'validation_failed')],
    ['429 over_request_rate_limit', () => gotrue(429, 'over_request_rate_limit')],
    ['500 server error', () => json(500, { msg: SENTINEL })],
    ['404 non-JSON body', () => Promise.resolve(new Response(`<html>${SENTINEL}</html>`, { status: 404 }))],
  ];

  it.each(FAILURES)('maps %s to the one neutral failure notice', async (_label, respond) => {
    const log = vi.fn();
    const result = await signInAdminWithPassword(signInVia(realClient(respond)), 'a@example.com', 'whatever-123', log);
    expect(result).toBe('admin.login.passwordFailed');
    expect(String(result)).not.toContain(SENTINEL);
    // 错误对象只进 console(给排查的人)
    expect(log).toHaveBeenCalledOnce();
    expect(typeof log.mock.calls[0][2]).toBe('object');
  });

  it('the raw GoTrue message really is in the error (so "not on the page" has something to hide)', async () => {
    const log = vi.fn();
    await signInAdminWithPassword(signInVia(realClient(() => gotrue(400, 'invalid_credentials'))), 'a@example.com', 'x-123456789', log);
    expect((log.mock.calls[0][2] as Error).message).toContain(SENTINEL);
  });

  it('gives every HTTP failure exactly the same notice', async () => {
    const results = new Set<string>();
    for (const [, respond] of FAILURES) {
      results.add(await signInAdminWithPassword(signInVia(realClient(respond)), 'a@example.com', 'x-123456789', () => {}));
    }
    expect([...results]).toEqual(['admin.login.passwordFailed']);
  });

  it('reports a network failure separately (the request never got an answer)', async () => {
    const client = realClient(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await signInAdminWithPassword(signInVia(client), 'a@example.com', 'x-123456789', () => {})).toBe(
      'admin.login.networkError',
    );
  });

  it('falls on the failure side with its own words when the call itself throws', async () => {
    const boom = () => Promise.reject(new Error('missing VITE_SUPABASE_URL'));
    expect(await signInAdminWithPassword(boom, 'a@example.com', 'x-123456789', () => {})).toBe('admin.login.unexpected');
  });

  it('sends nothing when email or password is empty', async () => {
    const calls: Call[] = [];
    const client = realClient(() => json(200, {}), calls);
    expect(await signInAdminWithPassword(signInVia(client), '   ', 'x-123456789', () => {})).toBe(
      'admin.login.passwordFailed',
    );
    expect(await signInAdminWithPassword(signInVia(client), 'a@example.com', '', () => {})).toBe(
      'admin.login.passwordFailed',
    );
    expect(calls).toHaveLength(0);
  });
});

describe('checkNewPassword', () => {
  it('rejects a mismatch, a short one and one over the bcrypt limit; accepts the minimum', () => {
    const min = 'a'.repeat(ADMIN_PASSWORD_MIN_LENGTH);
    expect(checkNewPassword(min, min)).toBeNull();
    expect(checkNewPassword(min, `${min}x`)).toBe('admin.password.mismatch');
    expect(checkNewPassword(min.slice(1), min.slice(1))).toBe('admin.password.tooShort');
    // 72 是 bcrypt 的字节上限:超过的部分会被静默截断,所以按 UTF-8 字节数算,不按字符数
    const cjk = String.fromCharCode(0x5bc6).repeat(25); // 25 个字符、75 个字节
    expect(new TextEncoder().encode(cjk).length).toBeGreaterThan(ADMIN_PASSWORD_MAX_BYTES);
    expect(checkNewPassword(cjk, cjk)).toBe('admin.password.tooLong');
    const max = 'b'.repeat(ADMIN_PASSWORD_MAX_BYTES);
    expect(checkNewPassword(max, max)).toBeNull();
  });
});

describe('updateAdminPassword', () => {
  /** 先 setSession(GET /user 回 200),再看 PUT /user 回什么 */
  async function signedInClient(onPut: Respond, calls: Call[] = []) {
    const client = realClient((url, init) => {
      if (url.endsWith('/auth/v1/user') && (init.method ?? 'GET') === 'GET') return json(200, USER);
      return onPut(url, init);
    }, calls);
    const { error } = await client.auth.setSession({ access_token: fakeJwt(), refresh_token: 'r1' });
    expect(error).toBeNull();
    return client;
  }
  const updateVia = (client: ReturnType<typeof realClient>) => (attrs: { password: string }) =>
    client.auth.updateUser(attrs);

  it('saves on 200 and sends the new password', async () => {
    const calls: Call[] = [];
    const client = await signedInClient(() => json(200, USER), calls);
    expect(await updateAdminPassword(updateVia(client), PASSWORD_OK, PASSWORD_OK)).toBe('admin.password.saved');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain('/auth/v1/user');
    expect(JSON.parse(put!.body)).toMatchObject({ password: PASSWORD_OK });
  });

  it('checks locally first and sends nothing on a mismatch or a short password', async () => {
    const calls: Call[] = [];
    const client = await signedInClient(() => json(200, USER), calls);
    const before = calls.length;
    expect(await updateAdminPassword(updateVia(client), PASSWORD_OK, `${PASSWORD_OK}x`)).toBe('admin.password.mismatch');
    expect(await updateAdminPassword(updateVia(client), 'short', 'short')).toBe('admin.password.tooShort');
    expect(calls.length).toBe(before);
  });

  const SERVER_CASES: [string, Respond, string][] = [
    ['422 weak_password (policy or leaked)', () => gotrue(422, 'weak_password', { weak_password: { reasons: ['pwned'] } }), 'admin.password.weak'],
    ['422 same_password', () => gotrue(422, 'same_password'), 'admin.password.same'],
    ['400 reauthentication_needed (secure password change)', () => gotrue(400, 'reauthentication_needed'), 'admin.password.reauth'],
    ['403 session_not_found', () => gotrue(403, 'session_not_found'), 'admin.password.sessionLost'],
    ['401 bad_jwt', () => gotrue(401, 'bad_jwt'), 'admin.password.sessionLost'],
    ['500 server error', () => json(500, { msg: SENTINEL }), 'admin.password.failed'],
  ];

  it.each(SERVER_CASES)('maps %s', async (_label, respond, expected) => {
    const client = await signedInClient(respond);
    const result = await updateAdminPassword(updateVia(client), PASSWORD_OK, PASSWORD_OK, () => {});
    expect(result).toBe(expected);
    expect(String(result)).not.toContain(SENTINEL);
  });

  it('says the session is gone, without a request, when nobody is signed in', async () => {
    const calls: Call[] = [];
    const client = realClient(() => json(200, USER), calls);
    expect(await updateAdminPassword(updateVia(client), PASSWORD_OK, PASSWORD_OK, () => {})).toBe(
      'admin.password.sessionLost',
    );
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('reports a network failure separately', async () => {
    const client = await signedInClient(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await updateAdminPassword(updateVia(client), PASSWORD_OK, PASSWORD_OK, () => {})).toBe(
      'admin.login.networkError',
    );
  });
});

describe('notice keys', () => {
  it('every key these functions can return has zh and en text', () => {
    const keys = [
      'admin.login.passwordFailed',
      'admin.login.networkError',
      'admin.login.unexpected',
      'admin.password.saved',
      'admin.password.mismatch',
      'admin.password.tooShort',
      'admin.password.tooLong',
      'admin.password.weak',
      'admin.password.same',
      'admin.password.reauth',
      'admin.password.sessionLost',
      'admin.password.failed',
    ];
    for (const k of keys) {
      const s = (UI_STRINGS as Record<string, { zh: string; en?: string }>)[k];
      expect(s?.zh, k).toBeTruthy();
      expect(s?.en, k).toBeTruthy();
    }
  });
});
