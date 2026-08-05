/**
 * assessment-ghl-resync —— GHL 写回的重试 sweep(D2 的消费端)。
 *
 * 挑 ghl_synced=false 且 ghl_next_retry_at 已过(或为 null)的结果,重新走一次写回。
 * 内部接口,鉴权走 X-Internal-Secret(与 assessment-maintenance 同一套),不对外、不进
 * /api 代理白名单。由 Vercel Cron 定时调,也可手动 curl 触发一次。
 *
 * 【为什么现在才建】上一轮只建了三列 + 记录失败(markSyncFailure 设 ghl_next_retry_at),
 * 但没有任何东西读它们 —— 把 ghl_synced 重置成 false 本身什么都不会发生。这个函数就是
 * 那个缺失的消费端。写回实现与 finalize 共用 _shared/ghlWriteback,不造第二份。
 *
 * ⚠️ 成功判据仍是「HTTP 200 → synced」,已知不可靠(见 _shared/ghlWriteback 文件头)。
 * 这次重跑的目的正是采集「字段存在时」GHL 的响应体,据此再定判据。
 */
import { serviceClient } from '../_shared/supa.ts';
import { secretMatches } from '../_shared/secret.ts';
import { buildWritebackPayload, syncToGhl, type WritebackResult } from '../_shared/ghlWriteback.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** 一次最多处理多少条 —— 防止一次 sweep 打爆 GHL 限流。到上限会在返回里说明,不静默截断 */
const BATCH_CAP = 50;

interface Candidate {
  session_id: string;
  total: number;
  tier: string;
  weakest: string[];
  session: { entitlement: { ghl_contact_id: string } | null } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', expected: 'POST' }, 405);

  const expected = Deno.env.get('INTERNAL_FN_SECRET');
  if (!expected) {
    console.error('INTERNAL_FN_SECRET is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }
  if (!(await secretMatches(req.headers.get('X-Internal-Secret'), expected))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supa = serviceClient();
  const nowIso = new Date().toISOString();

  try {
    // 待重试:未同步 + (从没排过重试 或 重试时间已到)。CONFIG 类失败不设 next_retry_at,
    // 所以那些 ghl_last_error 以 CONFIG: 开头的行不会被这里捞到 —— 重试同样的 payload 无意义
    const { data, error } = await supa
      .from('assessment_results')
      .select(
        `session_id, total, tier, weakest,
         session:assessment_sessions(entitlement:assessment_entitlements(ghl_contact_id))`,
      )
      .eq('ghl_synced', false)
      .or(`ghl_next_retry_at.is.null,ghl_next_retry_at.lte.${nowIso}`)
      .limit(BATCH_CAP + 1);
    if (error) throw error;

    const rows = (data ?? []) as unknown as Candidate[];
    const capped = rows.length > BATCH_CAP;
    const batch = rows.slice(0, BATCH_CAP);

    if (batch.length === 0) {
      return json({ ok: true, swept: 0, note: 'nothing due for retry' });
    }

    // 一次拉齐这批 session 的问卷,避免逐条查库
    const sessionIds = batch.map((r) => r.session_id);
    const { data: surveys, error: svErr } = await supa
      .from('assessment_survey')
      .select('session_id, responses')
      .in('session_id', sessionIds);
    if (svErr) throw svErr;
    const surveyBy = new Map(
      (surveys ?? []).map((s) => [s.session_id as string, (s.responses ?? {}) as Record<string, unknown>]),
    );

    const results: Array<{ session_id: string; ok: boolean; detail?: string }> = [];
    for (const row of batch) {
      const contactId = row.session?.entitlement?.ghl_contact_id;
      if (!contactId) {
        // 结果在,但连不回 contact —— 数据不一致,记下来跳过,不静默
        console.error(`resync: session ${row.session_id} has no ghl_contact_id, skipped`);
        results.push({ session_id: row.session_id, ok: false, detail: 'no ghl_contact_id' });
        continue;
      }
      const result: WritebackResult = {
        total: row.total,
        tier: row.tier,
        weakest: [row.weakest?.[0], row.weakest?.[1]] as [string, string],
      };
      const payload = buildWritebackPayload(result, surveyBy.get(row.session_id) ?? {});
      const outcome = await syncToGhl(supa, row.session_id, contactId, payload, 'resync');
      results.push({ session_id: row.session_id, ok: outcome.ok, detail: outcome.detail });
    }

    const okCount = results.filter((r) => r.ok).length;
    // 到批上限时明说还有剩,别让「swept 50」被误读成「全清了」
    if (capped) console.log(`resync: hit batch cap ${BATCH_CAP}, more remain — run again`);
    return json({ ok: true, swept: batch.length, synced: okCount, capped, results });
  } catch (err) {
    console.error(`resync failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});
