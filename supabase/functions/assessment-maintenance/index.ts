/**
 * assessment-maintenance —— 保留策略清理(PROGRESS.md S4-B)。
 *
 * 由 Vercel Cron 每天调一次,鉴权走 INTERNAL_FN_SECRET(header,不走 query ——
 * query string 会落进访问日志)。
 *
 * 【为什么需要清理】限流只查最近 75 分钟(窗口 15 + 锁定 60),但
 * assessment_login_attempts 没有任何自动清理。跑一年之后它是纯负担:
 * 索引变大、vacuum 变慢,而 99.99% 的行永远不会再被读。
 *
 * 【为什么保留 30 天而不是 75 分钟】30 天是排查窗口 —— 客户说「我上周试了好几次都
 * 没收到」时要查得到。限流本身只需要 75 分钟。
 *
 * 【为什么不用 pg_cron】那需要一条 migration 去 schedule,而 migration 要先批准;
 * 而且定时任务藏在数据库里、不在仓库的执行路径上,排查时最容易被忘掉。
 * 放 Vercel Cron 的好处是它和别的 cron(Stage 11 的写回重试)在同一处可见。
 */
import { serviceClient } from '../_shared/supa.ts';
import { secretMatches } from '../_shared/secret.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const RETENTION_DAYS = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', expected: 'POST' }, 405);
  }

  const expected = Deno.env.get('INTERNAL_FN_SECRET');
  if (!expected) {
    console.error('INTERNAL_FN_SECRET is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }
  if (!(await secretMatches(req.headers.get('X-Internal-Secret'), expected))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();

  try {
    const supa = serviceClient();
    // 用 count 拿到删除数量,便于在 Cron 日志里看出它真的在干活 ——
    // 一个「跑了但什么都没删」的清理任务和一个坏掉的清理任务看起来一样
    const { error, count } = await supa
      .from('assessment_login_attempts')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (error) throw error;

    console.log(`retention: deleted ${count ?? 0} login attempts older than ${cutoff}`);
    return json({ ok: true, deleted: count ?? 0, cutoff });
  } catch (err) {
    console.error(`retention failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});
