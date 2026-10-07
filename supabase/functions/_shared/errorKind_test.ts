import { assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { classifyError } from './errorKind.ts';

/**
 * 一个 PostgREST 错误 —— **由真的 supabase-js 产生**,只把 fetch 换掉。
 *
 * 【为什么不手写】旧 fixture 是 `new Error(message)` 再挂上 code/details/hint,
 * 依据是「`PostgrestError extends Error`」。那个类确实存在,但 `{ data, error }` 里的
 * `error` 是 `JSON.parse(body)` 出来的**普通对象**(只有 `.throwOnError()` 才 new 那个类)。
 * 于是测试验的是一个生产上不存在的形状,而 `classifyError` 在生产上把 message 记成了
 * `[object Object]`(判断标准 5 + 8)。让库自己产出 fixture,形状就由库决定,不由我猜 ——
 * 将来升级 supabase-js 改了形状,这里跟着变。
 */
async function pgError(code: string, message: string, details: string | null = null, hint: string | null = null) {
  const client = createClient('https://example.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ code, message, details, hint }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    },
  });
  const { error } = await client.from('t').select('*');
  return error as unknown;
}

Deno.test('PostgREST 找不到关系 → query_failed,且回公开错误码', async () => {
  /**
   * 这正是问卷洞察那次的形状:survey 与 results 之间没有 FK,
   * PostgREST 回 PGRST200。有了 kind + code,响应体自己就说了「去看那条查询」。
   */
  const c = classifyError(await pgError('PGRST200', "Could not find a relationship between 'a' and 'b'"));
  assertEquals(c.kind, 'query_failed');
  assertEquals(c.code, 'PGRST200');
});

Deno.test('fixture 就是生产上的形状:普通对象,不是 Error 实例', async () => {
  /**
   * 下面那条「message 要进日志」只有在这一条成立时才有事可做(判断标准 1 推论三)——
   * fixture 若是 Error 实例,`err.message` 本来就拿得到,那条断言会对着一个不存在的 bug 绿着。
   * supabase-js 哪天改成回 Error 实例,这一条会先红,告诉人前提变了。
   */
  const e = await pgError('23505', 'duplicate key');
  assertEquals(e instanceof Error, false);
  assertEquals(typeof e, 'object');
});

Deno.test('数据库错误的 message 必须进日志 —— 生产上它曾是 [object Object]', async () => {
  /**
   * 旧 fixture 是 Error 实例,所以 `err instanceof Error ? err.message : String(err)` 一直拿得到;
   * 生产上是普通对象,走的是 `String(err)`。原来的用例只断言 kind / code / details / hint,
   * 没有一条看 message —— 所以 fixture 换成真形状之后它们照样全绿。
   */
  const c = classifyError(await pgError('PGRST200', "Could not find a relationship between 'a' and 'b'"));
  assertEquals(c.log.includes('Could not find a relationship'), true, c.log);
  assertEquals(c.log.includes('[object Object]'), false, c.log);
});

Deno.test('Deno 侧走的是同一份脱敏:23505 撞到 access_token,值换掉、约束名留着', async () => {
  /**
   * 完整的脱敏用例在 src/lib/dbError.test.ts(Node)。这一条只证明 Deno 经再导出
   * 拿到的是同一份实现 —— 不是一份会悄悄分叉的副本(判断标准 3)。
   */
  const token = 'Zq3V9xK_7mPz-Lr2Tb8Wc4Ny6Hd1Fg0Js5Ae9Uo3Ik7';
  const c = classifyError(
    await pgError(
      '23505',
      'duplicate key value violates unique constraint "assessment_entitlements_access_token_key"',
      `Key (access_token)=(${token}) already exists.`,
    ),
  );
  assertEquals(c.log.includes(token.slice(0, 10)), false, c.log);
  assertEquals(c.log.includes('Key (access_token)=(<redacted>)'), true, c.log);
  assertEquals(c.log.includes('assessment_entitlements_access_token_key'), true, c.log);
});

Deno.test('Postgres 的 5 位 SQLSTATE 也算 query_failed', async () => {
  assertEquals(classifyError(await pgError('42501', 'permission denied')).kind, 'query_failed');
  assertEquals(classifyError(await pgError('23505', 'duplicate key')).code, '23505');
});

Deno.test('hint 与 details 进日志,【不】进 code —— hint 里可能是可执行 SQL', async () => {
  /**
   * 权限类错误(42501)的 hint 常常是一句可以直接跑的 GRANT,含表名与角色名。
   * 那种东西回给浏览器就是在教对方怎么绕过。所以它只出现在 log 字段里。
   */
  const c = classifyError(
    await pgError('42501', 'permission denied', 'for table x', 'GRANT SELECT ON public.users TO anon;'),
  );
  assertEquals(c.log.includes('GRANT SELECT'), true);
  assertEquals(c.log.includes('for table x'), true);
  assertEquals(c.code, '42501'); // 只有码
});

Deno.test('配置缺失 → config_missing,排查动作完全不同', () => {
  for (const m of [
    'missing SUPABASE_URL',
    'INTERNAL_FN_SECRET is not configured',
    'server_misconfigured: missing CRON_SECRET',
    'missing SUPABASE_URL, or neither SUPABASE_SECRET_KEYS nor SUPABASE_SERVICE_ROLE_KEY is set',
  ]) {
    assertEquals(classifyError(new Error(m)).kind, 'config_missing', m);
  }
});

Deno.test('仓库里真实存在的两条 GHL 凭证消息都归 config_missing', () => {
  /**
   * 这两条是从 supabase/functions 与 api/_lib 里 grep 出来的**真实字面量**,
   * 不是我编的形状 —— 分类器最容易漏的就是它没见过的措辞。
   *
   * 【这条用例【不】钉「配置判断在上游判断之前」】原本的名字是「顺序不能反」,
   * 但把那两段对调后 168 条全绿:今天没有消息同时命中两套模式,那个断言是空的。
   * 它真正钉住的是「`credentials missing` 这种措辞要被认成配置问题」——
   * 注意第二条以 `fetch` 结尾,而它属于配置,不属于上游。
   */
  for (const m of ['GHL credentials missing (GHL_PRIVATE_TOKEN)', 'GHL credentials missing for field-map fetch']) {
    assertEquals(classifyError(new Error(m)).kind, 'config_missing', m);
  }
});

Deno.test('外部调用失败 → upstream_failed', () => {
  for (const m of ['fetch failed', 'ECONNRESET', 'GHL returned 502: ...', 'upstream unreachable']) {
    assertEquals(classifyError(new Error(m)).kind, 'upstream_failed', m);
  }
});

Deno.test('认不出的一律 unexpected —— 不猜', () => {
  /**
   * 猜错的分类比不分类更糟:它会把人送到错误的地方,而且送得很有信心。
   */
  for (const e of [new Error('boom'), 'a bare string', null, undefined, 42, {}]) {
    assertEquals(classifyError(e).kind, 'unexpected', String(e));
  }
});

Deno.test('裸字符串 / 非 Error 也能分类,不抛', () => {
  // chromium.font() 那次的教训:reject 的可能是裸字符串
  assertEquals(classifyError('Unexpected status code: 404.').kind, 'unexpected');
  assertEquals(classifyError('fetch failed').kind, 'upstream_failed');
  assertEquals(classifyError(null).log, 'null');
});

Deno.test('不像错误码的 code 不当成数据库错误', () => {
  // 别的库也可能有 code 字段(比如 Node 的 ENOENT),那不是 PostgREST/SQLSTATE
  const e = new Error('no such file') as Error & { code: string };
  e.code = 'ENOENT';
  assertEquals(classifyError(e).kind, 'unexpected');
  assertEquals(classifyError(e).code, null);
});
