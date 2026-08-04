import { assertEquals, assertNotEquals } from '@std/assert';
import {
  clearedSessionCookieHeader,
  readSessionCookie,
  SESSION_COOKIE,
  sessionCookieHeader,
  signSession,
  verifySession,
} from './session.ts';

const SECRET = 'test-secret-do-not-use-in-production';
const OTHER_SECRET = 'a-different-secret';
const NOW = 1_800_000_000_000; // 固定时间,不用 Date.now —— 测试必须可复现
const ID = '11111111-2222-3333-4444-555555555555';

Deno.test('签出来的 session 能被同一个密钥验开', async () => {
  const value = await signSession(ID, SECRET, NOW);
  assertEquals(await verifySession(value, SECRET, NOW), { entitlementId: ID });
});

Deno.test('换密钥验不开', async () => {
  const value = await signSession(ID, SECRET, NOW);
  assertEquals(await verifySession(value, OTHER_SECRET, NOW), null);
});

Deno.test('改动 payload 会让签名失效', async () => {
  const value = await signSession(ID, SECRET, NOW);
  const [body, sig] = value.split('.');
  // 换一个 entitlement id 重新编码,签名保持原样
  const forged = btoa(JSON.stringify({ e: 'someone-else', x: 9999999999 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assertNotEquals(forged, body);
  assertEquals(await verifySession(`${forged}.${sig}`, SECRET, NOW), null);
});

Deno.test('过期即失效', async () => {
  const value = await signSession(ID, SECRET, NOW, 30);
  const justBefore = NOW + 30 * 86400 * 1000 - 1000;
  const justAfter = NOW + 30 * 86400 * 1000 + 1000;
  assertEquals(await verifySession(value, SECRET, justBefore), { entitlementId: ID });
  assertEquals(await verifySession(value, SECRET, justAfter), null);
});

Deno.test('畸形输入一律 null,不抛异常', async () => {
  for (const bad of [
    null,
    undefined,
    '',
    '.',
    'nodot',
    '.onlysig',
    'onlybody.',
    'not-base64!!.also-not!!',
    'eyJhIjoxfQ.',
    `${'x'.repeat(100)}.${'y'.repeat(100)}`,
  ]) {
    assertEquals(await verifySession(bad, SECRET, NOW), null, `input: ${String(bad)}`);
  }
});

Deno.test('Set-Cookie 带齐四个安全属性,且不写 Domain', () => {
  const header = sessionCookieHeader('abc.def');
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) {
    assertEquals(header.includes(attr), true, `missing ${attr}`);
  }
  // 不写 Domain —— host-only,不外泄到别的子域
  assertEquals(header.toLowerCase().includes('domain='), false);
});

Deno.test('清除 cookie 用 Max-Age=0 且保留同样的属性', () => {
  const header = clearedSessionCookieHeader();
  assertEquals(header.includes('Max-Age=0'), true);
  assertEquals(header.includes('HttpOnly'), true);
  assertEquals(header.includes('Secure'), true);
});

/**
 * cookie 名在三个运行时里各有一份字面量,跨运行时没法共享模块:
 *   supabase/functions/_shared/session.ts   ← 真相源(本文件测的这个)
 *   api/[...path].ts                        ← Vercel 代理的透传白名单
 *   scripts/smoke-deploy.mjs                ← 部署后断言
 *
 * 三者漂移的后果不对称:代理写错 → 登录立刻断(响的);
 * **smoke 写错 → 断言盯着一个不存在的 cookie 名,永远绿(静默的)**。
 * 有一处失败是静默的,就必须有守卫。
 *
 * 放在这里而不是 smoke 脚本里,是为了让它进 `npm run verify` —— 每次构建都跑,
 * 而不是等到部署那一刻。
 */
Deno.test('cookie 名在代理与 smoke 脚本里保持一致', async () => {
  for (const path of ['../../../api/[...path].ts', '../../../scripts/smoke-deploy.mjs']) {
    const src = await Deno.readTextFile(new URL(path, import.meta.url));
    assertEquals(
      src.includes(`'${SESSION_COOKIE}'`),
      true,
      `${path} 里没有 '${SESSION_COOKIE}' 这个字面量 —— 三处名字漂移了`,
    );
  }
});

Deno.test('从 Cookie 头里挑出自己那一个', () => {
  const mk = (cookie: string) => new Request('https://x.test', { headers: { Cookie: cookie } });
  assertEquals(readSessionCookie(mk(`${SESSION_COOKIE}=v1`)), 'v1');
  assertEquals(readSessionCookie(mk(`other=1; ${SESSION_COOKIE}=v2; another=3`)), 'v2');
  assertEquals(readSessionCookie(mk(`  ${SESSION_COOKIE}=v3  `)), 'v3');
  assertEquals(readSessionCookie(mk('other=1')), null);
  assertEquals(readSessionCookie(mk(`${SESSION_COOKIE}=`)), null);
  assertEquals(readSessionCookie(new Request('https://x.test')), null);
  // 名字前缀相同的别的 cookie 不能被误取
  assertEquals(readSessionCookie(mk(`${SESSION_COOKIE}_other=nope`)), null);
});
