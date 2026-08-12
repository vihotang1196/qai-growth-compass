import { assertEquals } from '@std/assert';
import { classifyError } from './errorKind.ts';

/** 造一个 PostgrestError 形状的东西(它 extends Error,带 code/details/hint) */
function pgError(code: string, message: string, details = '', hint = ''): Error {
  const e = new Error(message) as Error & { code: string; details: string; hint: string };
  e.code = code;
  e.details = details;
  e.hint = hint;
  return e;
}

Deno.test('PostgREST 找不到关系 → query_failed,且回公开错误码', () => {
  /**
   * 这正是问卷洞察那次的形状:survey 与 results 之间没有 FK,
   * PostgREST 回 PGRST200。有了 kind + code,响应体自己就说了「去看那条查询」。
   */
  const c = classifyError(pgError('PGRST200', "Could not find a relationship between 'a' and 'b'"));
  assertEquals(c.kind, 'query_failed');
  assertEquals(c.code, 'PGRST200');
});

Deno.test('Postgres 的 5 位 SQLSTATE 也算 query_failed', () => {
  assertEquals(classifyError(pgError('42501', 'permission denied')).kind, 'query_failed');
  assertEquals(classifyError(pgError('23505', 'duplicate key')).code, '23505');
});

Deno.test('hint 与 details 进日志,【不】进 code —— hint 里可能是可执行 SQL', () => {
  /**
   * 权限类错误(42501)的 hint 常常是一句可以直接跑的 GRANT,含表名与角色名。
   * 那种东西回给浏览器就是在教对方怎么绕过。所以它只出现在 log 字段里。
   */
  const c = classifyError(
    pgError('42501', 'permission denied', 'for table x', 'GRANT SELECT ON public.users TO anon;'),
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
