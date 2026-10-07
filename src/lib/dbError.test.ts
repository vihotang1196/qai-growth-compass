import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DbError, dbFail, dbLogLine, describeError, REDACTED } from '../../api/_lib/dbError';

/**
 * 日志脱敏 + 上下文。
 *
 * 【错误由真的 supabase-js 产生,只换掉 fetch】与 adminAuthMessages.test 同一做法 ——
 * 形状由库决定(普通对象,不是 Error),不由我猜。那正是 errorKind 的 fixture 栽过的地方。
 */
function client(body: Record<string, unknown>, status = 409) {
  return createClient('https://example.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (() =>
        Promise.resolve(
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
        )) as typeof fetch,
    },
  });
}

async function pgError(code: string, message: string, details: string | null = null, hint: string | null = null) {
  const { error } = await client({ code, message, details, hint }).from('t').select('*');
  return error as unknown;
}

/** 与我们 access_token 同形:32 字节 base64url = 43 字符 */
const TOKEN = 'Zq3V9xK_7mPz-Lr2Tb8Wc4Ny6Hd1Fg0Js5Ae9Uo3Ik7';
const EMAIL = 'alice.wong@example.com';
const PHONE_E164 = '+8613812345678';
const PHONE_SPACED = '+86 138 1234 5678';
const PHONE_BARE = '13912345678';
const HEX64 = 'a3f1c9e07b2d4f8a9c6e1b0d7f2a5c8e3b9d1f4a7c0e6b2d8f5a1c4e9b7d3f06';

const CTX = { fn: 'assessment-quiz', op: 'assessment_entitlements.update', session: '2b1f0c8e-4d5a-4e7b-9c3d-1a2b3c4d5e6f' };

function thrownBy(err: unknown): DbError {
  try {
    dbFail(CTX, err);
  } catch (e) {
    return e as DbError;
  }
  throw new Error('dbFail did not throw');
}

/** 三个日志出口 —— 「不泄露」与「该留的留着」都在这三处断言 */
function logs(err: unknown): string[] {
  return [describeError(err).log, dbLogLine(CTX, err), thrownBy(err).message];
}

/**
 * 再加第四处:DbError 被整个 JSON.stringify(比如有人把它塞进响应体)。
 * 它只断言「不泄露」—— Error 的 message 不可枚举,JSON 里本来就没有,所以不断言「留着」。
 */
function everywhere(err: unknown): string[] {
  return [...logs(err), JSON.stringify(thrownBy(err))];
}

/**
 * 「不含原始值」按**任意 10 字符片段**判,而不是整串 ——
 * 先截断后脱敏会留下 token 的一段残片,整串比对看不出来。
 */
function expectNoFragment(out: string, secret: string, window = 10) {
  for (let i = 0; i + window <= secret.length; i++) {
    expect(out, `leaked "${secret.slice(i, i + window)}"`).not.toContain(secret.slice(i, i + window));
  }
}

describe('dbError redaction', () => {
  // fixture 前提:token 是 43 字符、错误是普通对象
  it('fixture premise: token is 43 chars and the error is a plain object', async () => {
    expect(TOKEN).toHaveLength(43);
    expect(await pgError('23505', 'x')).not.toBeInstanceOf(Error);
  });

  // 23505 撞到 access_token:details 里的值被换掉,列名 / 错误码 / 约束名留着
  it('23505 on access_token: value redacted; column, code and constraint kept', async () => {
    const err = await pgError(
      '23505',
      'duplicate key value violates unique constraint "assessment_entitlements_access_token_key"',
      `Key (access_token)=(${TOKEN}) already exists.`,
    );
    for (const out of everywhere(err)) expectNoFragment(out, TOKEN);
    for (const out of logs(err)) {
      expect(out).toContain(`Key (access_token)=(${REDACTED})`);
      expect(out).toContain('23505');
      expect(out).toContain('assessment_entitlements_access_token_key');
    }
  });

  // 22P02:message 里带一个 token
  it('22P02: a token inside the message', async () => {
    const err = await pgError('22P02', `invalid input syntax for type uuid: "${TOKEN}"`);
    for (const out of everywhere(err)) expectNoFragment(out, TOKEN);
    for (const out of logs(err)) {
      expect(out).toContain('22P02');
      expect(out).toContain('invalid input syntax for type uuid');
    }
  });

  // 邮箱与手机号:Key()=() 之内与之外都换掉;函数式索引的列名(带括号)留着
  it('email and phone: redacted inside and outside Key()=(); a functional-index column is kept', async () => {
    const err = await pgError(
      '23505',
      'duplicate key value violates unique constraint "assessment_entitlements_email_lower_key"',
      `Key (lower(email))=(${EMAIL}) already exists.`,
      `contact ${EMAIL} or ${PHONE_SPACED}; legacy ${PHONE_E164}, bare ${PHONE_BARE}`,
    );
    for (const out of everywhere(err)) {
      for (const secret of [EMAIL, PHONE_E164, PHONE_BARE]) expectNoFragment(out, secret, 8);
      expect(out).not.toContain('138 1234 5678');
    }
    for (const out of logs(err)) {
      expect(out).toContain(`Key (lower(email))=(${REDACTED})`);
      expect(out).toContain('assessment_entitlements_email_lower_key');
    }
  });

  // 23514 的 Failing row contains (...):整行值换掉,带数字的约束名留着
  it('23514 Failing row contains (...): row redacted; a constraint name with digits is kept', async () => {
    const err = await pgError(
      '23514',
      'new row for relation "assessment_entitlements" violates check constraint "assessment_entitlements_phone_e164_check"',
      `Failing row contains (${CTX.session}, ${EMAIL}, ${PHONE_E164}, ${TOKEN}, zh).`,
    );
    for (const out of everywhere(err)) {
      for (const secret of [EMAIL, PHONE_E164, TOKEN]) expectNoFragment(out, secret, 8);
    }
    for (const out of logs(err)) {
      expect(out).toContain('assessment_entitlements_phone_e164_check');
      expect(out).toContain('23514');
    }
  });

  // 64 位十六进制(identifier_hash 那种)也换掉
  it('64-char hex (identifier_hash style) is redacted', async () => {
    const err = await pgError('23505', 'duplicate key', null, `hash ${HEX64} seen twice`);
    for (const out of everywhere(err)) expectNoFragment(out, HEX64);
  });

  // 先脱敏后截断:token 跨在 300 字符截断点上,也不留残片
  it('redact before clipping: a token across the 300-char cut leaves no fragment', async () => {
    const err = await pgError('XX000', `${'x'.repeat(280)} ${TOKEN}`);
    for (const out of everywhere(err)) expectNoFragment(out, TOKEN, 8);
  });
});

describe('dbError context and message', () => {
  // 普通对象的 message 进日志,不是 [object Object]
  it('a plain object\'s message reaches the log, not [object Object]', async () => {
    const err = await pgError('PGRST200', "Could not find a relationship between 'a' and 'b'");
    const c = describeError(err);
    expect(c.kind).toBe('query_failed');
    expect(c.code).toBe('PGRST200');
    expect(c.log).toContain('Could not find a relationship');
    expect(c.log).not.toContain('[object Object]');
  });

  // dbFail 抛真 Error,message 带函数 / 操作 / session;describeError 认得它
  it('dbFail throws a real Error carrying fn / op / session; describeError recognises it', async () => {
    const err = await pgError('42501', 'permission denied for table assessment_answers');
    let thrown: unknown;
    try {
      dbFail(CTX, err);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toBeInstanceOf(DbError);
    const msg = (thrown as Error).message;
    expect(msg).toContain('[assessment-quiz]');
    expect(msg).toContain('op=assessment_entitlements.update');
    expect(msg).toContain(`session=${CTX.session}`);
    expect(msg).toContain('permission denied for table assessment_answers');
    expect(describeError(thrown)).toEqual({ kind: 'query_failed', code: '42501', log: msg });
  });

  // ctx 里塞了不像 id 的东西(比如 token)→ 被换掉
  it('a ctx value that is not an id (e.g. a token) is redacted', async () => {
    const line = dbLogLine({ fn: 'f', op: 'o', entitlement: TOKEN, lang: 'zh' }, await pgError('23505', 'dup'));
    expectNoFragment(line, TOKEN);
    expect(line).toContain(`entitlement=${REDACTED}`);
    expect(line).toContain('lang=zh');
  });

  // 网络层失败(code 为空)→ upstream_failed,不是 query_failed
  it('network-level failure (empty code) → upstream_failed, not query_failed', async () => {
    const supa = createClient('https://example.supabase.co', 'sb_publishable_test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch },
    });
    // insert = POST:postgrest-js 只对 GET/HEAD/OPTIONS 做网络重试(带退避),用 GET 会等好几秒
    const { error } = await supa.from('t').insert({ a: 1 });
    const c = describeError(error);
    expect(c.kind).toBe('upstream_failed');
    expect(c.code).toBeNull();
  });
});
