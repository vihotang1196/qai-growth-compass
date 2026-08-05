/**
 * GHL 写回 —— finalize(assessment-score)与重试 sweep(assessment-ghl-resync)共用的一份。
 *
 * 【为什么抽出来】两个地方都要:组装 payload → 按 domain 校验 → PUT 给 GHL → 判成败、
 * 记 ghl_synced / ghl_sync_attempts / ghl_next_retry_at。各写一份的话,以后改 payload
 * 字段或改判据只改一处就成了静默的半修 —— 而这正是我们在追的那类静默失败。
 *
 * ⚠️【成功判据待定,故意留在这一轮之外】当前仍是「HTTP 200 → ghl_synced=true」。
 * 已经证实这是错的:上一轮字段在 GHL 里还不存在时,PUT 也返回了 200,我们照样标了
 * synced=true。200 不证明字段被接受。但「改成什么判据」取决于 GHL 在字段【存在】时
 * 返回什么 —— 那是这次重跑要采集的数据。所以这里把响应体【完整】记下来(不截断),
 * 先看信号,再决定判据(响应体里的 accepted/skipped 字段,还是写回后回读 contact)。
 * 这与当初区分真假 Inbound Webhook trigger 是同一个方法:先看响应体差异,再下判据。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkFields, type FieldSpec } from './ghlDomain.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

export interface WritebackResult {
  total: number;
  tier: string;
  weakest: [string, string];
}

export interface WritebackOutcome {
  attempted: boolean;
  ok: boolean;
  detail?: string;
}

/**
 * 从结果 + 问卷组装写回 payload。
 * 【问卷里有的才写,不静默补默认值】report_url 要等 PDF 好了才有(Stage 9);
 * 缺字段的行为见 D9,不在这里编造。
 */
export function buildWritebackPayload(
  result: WritebackResult,
  survey: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    qai_assessment_status: 'completed',
    qai_assessment_total: result.total,
    qai_assessment_tier: result.tier,
    qai_assessment_weakest_1: result.weakest[0],
    qai_assessment_weakest_2: result.weakest[1],
  };
  if (typeof survey.priority_dimension === 'string') {
    payload.qai_assessment_priority = survey.priority_dimension;
  }
  if (typeof survey.goal_90d === 'string') payload.qai_assessment_goal_90d = survey.goal_90d;
  if (typeof survey.consult_interest === 'string') {
    payload.qai_assessment_consult_interest = survey.consult_interest;
  }
  return payload;
}

/**
 * 校验并写回。写 ghl_synced / 失败计数由这里负责,调用方拿返回值决定日志。
 *
 * @param logTag 调用来源标记(finalize / resync),让日志能区分是哪条路触发的
 */
export async function syncToGhl(
  supa: SupabaseClient,
  sessionId: string,
  ghlContactId: string,
  payload: Record<string, unknown>,
  logTag: string,
): Promise<WritebackOutcome> {
  const specs = config.ghl_writeback.custom_fields as unknown as FieldSpec[];
  const failures = checkFields(payload, specs);
  if (failures.length) {
    const detail = failures.map((f) => `${f.key}: ${f.reason}`).join('; ');
    // CONFIG 类错误不排重试 —— 同样的 payload 重试一百次还是同样的结果
    console.error(`CONFIG: [${logTag}] payload rejected for session ${sessionId}: ${detail}`);
    await supa
      .from('assessment_results')
      .update({ ghl_last_error: `CONFIG: ${detail}`.slice(0, 1000) })
      .eq('session_id', sessionId);
    return { attempted: false, ok: false, detail };
  }

  const ghlEnv = {
    GHL_PRIVATE_TOKEN: Deno.env.get('GHL_PRIVATE_TOKEN'),
    GHL_LOCATION_ID: Deno.env.get('GHL_LOCATION_ID'),
  };
  const missing = Object.entries(ghlEnv).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`CONFIG: [${logTag}] GHL credentials missing (${missing.join(', ')}) for session ${sessionId}`);
    await markSyncFailure(supa, sessionId, `CONFIG: missing ${missing.join(', ')}`);
    return { attempted: false, ok: false, detail: `missing ${missing.join(', ')}` };
  }

  const url = `https://services.leadconnectorhq.com/contacts/${ghlContactId}`;
  const customFields = Object.entries(payload).map(([key, value]) => ({ key, field_value: value }));

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghlEnv.GHL_PRIVATE_TOKEN}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({ customFields }),
    });
    const text = await res.text().catch(() => '');

    if (!res.ok) {
      const detail = `GHL ${res.status}: ${text.slice(0, 800)}`;
      console.error(`[${logTag}] GHL writeback failed for session ${sessionId}: ${detail}`);
      await markSyncFailure(supa, sessionId, detail);
      return { attempted: true, ok: false, detail };
    }

    /**
     * 【响应体完整记下来 —— 这是判据的原材料】上一轮截断在 400 字,可能切掉信号。
     * 这次要看:字段【存在】时 GHL 返回的 contact 对象里,customFields 有没有出现我们写的
     * 那几个 key/值;有没有 skipped/rejected 之类的字段级反馈。对比上一轮字段不存在时的响应,
     * 就知道 200 之外有没有可用的成功信号。
     */
    console.log(
      `[${logTag}] GHL 200 for contact ${ghlContactId}, session ${sessionId}. ` +
        `Wrote keys: ${Object.keys(payload).join(',')}.\n` +
        `FULL RESPONSE BODY (判据待定,200 不证明字段被接受):\n${text.slice(0, 4000)}`,
    );
    // ⚠️ 仍按 200 标 synced —— 判据待这次响应体出来再改,见文件头注释
    const { error } = await supa
      .from('assessment_results')
      .update({ ghl_synced: true, ghl_last_error: null })
      .eq('session_id', sessionId);
    if (error) console.error(`[${logTag}] failed to mark ghl_synced for ${sessionId}: ${error.message}`);
    return { attempted: true, ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[${logTag}] GHL writeback threw for session ${sessionId}: ${detail}`);
    await markSyncFailure(supa, sessionId, detail);
    return { attempted: true, ok: false, detail };
  }
}

/**
 * 记一次写回失败并推进重试计数(D2)。退避 2^attempts 分钟,上限 6 小时。
 * sweep 只挑 ghl_synced=false 且 ghl_next_retry_at 已过(或为 null)的行。
 */
export async function markSyncFailure(
  supa: SupabaseClient,
  sessionId: string,
  detail: string,
): Promise<void> {
  const { data } = await supa
    .from('assessment_results')
    .select('ghl_sync_attempts')
    .eq('session_id', sessionId)
    .maybeSingle();
  const attempts = ((data?.ghl_sync_attempts as number) ?? 0) + 1;
  const backoffMin = Math.min(2 ** attempts, 360);
  const { error } = await supa
    .from('assessment_results')
    .update({
      ghl_sync_attempts: attempts,
      ghl_last_error: detail.slice(0, 1000),
      ghl_next_retry_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
    })
    .eq('session_id', sessionId);
  if (error) console.error(`failed to record sync failure for ${sessionId}: ${error.message}`);
}
