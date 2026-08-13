/**
 * GHL 写回 —— finalize(assessment-score)与重试 sweep(assessment-ghl-resync)共用的一份。
 *
 * 【为什么抽出来】两个地方都要:组装 payload → 按 domain 校验 → PUT → 用响应体判成败 →
 * 记 ghl_synced / attempts / next_retry_at。各写一份的话改一处就是静默的半修。
 *
 * 【成功判据:不信 200,验响应体】实证发现 GHL 的 contact 更新会回显整个 contact 的
 * customFields 数组,写进去的字段【会出现】、被静默丢弃的【不出现】—— 上一轮字段还不存在时
 * 返回 200 但数组里没有那些条目,我们却标了 synced=true。所以现在:PUT 之后用字段映射
 * (D8,key→id)在响应里逐个核对我们写的字段确实在、且值相符,全部命中才标 synced=true。
 * 响应回显的是 UUID,所以必须先有 key→id 映射 —— 见 ghlFieldMap。
 *
 * 【错误三分类(D9)】CONFIG(字段没建 / 值不符)不自动重试;AUTH(401/403)不重试;
 * TRANSIENT(网络 / 5xx / 429 / 拿不到映射)进指数退避。ghl_last_error 带前缀,sweep 据此
 * 跳过 CONFIG/AUTH 行。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkFields, type FieldSpec } from './ghlDomain.ts';
import { classifyGhlError, verifyWrittenFields, type GhlErrorClass } from './ghlVerify.ts';
import { getFieldMap } from './ghlFieldMap.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };
import { isTestSessionCohort } from './testCohort.ts';

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

export async function syncToGhl(
  supa: SupabaseClient,
  sessionId: string,
  ghlContactId: string,
  payload: Record<string, unknown>,
  logTag: string,
): Promise<WritebackOutcome> {
  /**
   * ── 测试 / 演示批次一律不外发 ──
   *
   * 【为什么收在这里,而不是在 resync 的选行处加过滤】这个函数是**所有 GHL 流量的唯一出口**
   * (resync 与 finalize 两个调用点)。在 resync 那边加过滤只挡住 resync,所以收在这里。
   *
   * ⚠️ **更正一句我原本写在这里的话。** 原文说「将来 Stage 11 的 tags 一写出来
   * 就自动被覆盖」—— **那是假的**。这个函数是**字段写回专用**:它 PUT `{customFields}`、
   * 按字段映射核对响应、把成败记进 `ghl_synced`。而 D9 要求标签独立于字段写入,
   * 所以标签必然走**另一条出站路径**,那条路径上没有这道收口。
   *
   * 收口是按**函数**收的,不是按**出站传输**收的 ——
   * 而绕过它的方式是「什么都不做」,不是「做错什么」。
   * Stage 11 的做法:把这个判断挪到一个所有 contact 级调用都必经的传输函数里。
   * 在那之前**标签的外发代码一行都不该写**:给假 contact 打标签会污染
   * GHL 的**全局**标签选择器,比清一条失败记录难得多。
   * 实测代价:seed 那 15 条曾让 resync 对 GHL 发了 15 次请求,查的是不存在的 contact。
   *
   * 【为什么归 CONFIG,而不是置 ghl_synced = true】
   * `ghl_synced = true` 表示「同步成功了」—— 那是在数据里说谎。
   * CONFIG 的语义本来就是「重试一万次也没用」,而 sweep 已经会跳过 CONFIG
   * (这一点在真实数据上验过:第二次调用回 `nothing due for retry`)。
   * 所以既跳过了,又留下了原因,而且没有新增状态。
   */
  if (await isTestSessionCohort(supa, sessionId)) {
    await recordFailure(supa, sessionId, 'CONFIG', 'test cohort — writeback intentionally skipped', logTag);
    return { attempted: false, ok: false, detail: 'skipped: test cohort' };
  }

  // 写回前按 domain 校验(值域)。不在域内是 CONFIG —— 同样的 payload 重试无意义
  const specs = config.ghl_writeback.custom_fields as unknown as FieldSpec[];
  const domainFailures = checkFields(payload, specs);
  if (domainFailures.length) {
    const detail = domainFailures.map((f) => `${f.key}: ${f.reason}`).join('; ');
    await recordFailure(supa, sessionId, 'CONFIG', `domain check failed — ${detail}`, logTag);
    return { attempted: false, ok: false, detail };
  }

  const ghlEnv = {
    GHL_PRIVATE_TOKEN: Deno.env.get('GHL_PRIVATE_TOKEN'),
    GHL_LOCATION_ID: Deno.env.get('GHL_LOCATION_ID'),
  };
  const missing = Object.entries(ghlEnv).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    // 缺凭证是配置问题,但重发 token 后重试有意义 —— 归 TRANSIENT,别永久放弃
    await recordFailure(supa, sessionId, 'TRANSIENT', `GHL credentials missing (${missing.join(', ')})`, logTag);
    return { attempted: false, ok: false, detail: `missing ${missing.join(', ')}` };
  }

  const url = `https://services.leadconnectorhq.com/contacts/${ghlContactId}`;
  const customFields = Object.entries(payload).map(([key, value]) => ({ key, field_value: value }));

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghlEnv.GHL_PRIVATE_TOKEN}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify({ customFields }),
    });
    text = await res.text().catch(() => '');
  } catch (err) {
    // 网络层失败 —— TRANSIENT
    const detail = err instanceof Error ? err.message : String(err);
    await recordFailure(supa, sessionId, 'TRANSIENT', `fetch threw — ${detail}`, logTag);
    return { attempted: true, ok: false, detail };
  }

  if (!res.ok) {
    const klass = classifyGhlError(res.status);
    // 错误响应体是 GHL 的报错文本,PII 风险低,但仍截断
    await recordFailure(supa, sessionId, klass, `HTTP ${res.status} — ${text.slice(0, 300)}`, logTag);
    return { attempted: true, ok: false, detail: `${klass} ${res.status}` };
  }

  // ── 200:不信状态码,验响应体 ──
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await recordFailure(supa, sessionId, 'TRANSIENT', 'contact update returned non-JSON', logTag);
    return { attempted: true, ok: false, detail: 'non-JSON response' };
  }
  const responseFields = (body as { contact?: { customFields?: unknown } })?.contact?.customFields ??
    (body as { customFields?: unknown })?.customFields;

  // 拿字段映射验证。拿不到(网络/凭证)→ 无法判定,归 TRANSIENT,绝不因此标 synced
  let fieldMap;
  try {
    fieldMap = await getFieldMap(supa);
  } catch (err) {
    await recordFailure(supa, sessionId, 'TRANSIENT', `field map fetch failed — ${err instanceof Error ? err.message : String(err)}`, logTag);
    return { attempted: true, ok: false, detail: 'field map unavailable' };
  }

  let verdict = verifyWrittenFields(payload, fieldMap, responseFields);
  // 自愈:若有 key 不在映射里(可能是刚在 GHL 加的字段、缓存旧了),强制刷新一次再验
  if (!verdict.ok && verdict.missing.some((m) => m.reason.includes('field map'))) {
    try {
      fieldMap = await getFieldMap(supa, { force: true });
      verdict = verifyWrittenFields(payload, fieldMap, responseFields);
    } catch (err) {
      await recordFailure(supa, sessionId, 'TRANSIENT', `field map refresh failed — ${err instanceof Error ? err.message : String(err)}`, logTag);
      return { attempted: true, ok: false, detail: 'field map refresh failed' };
    }
  }

  if (!verdict.ok) {
    // 字段没被接受 —— CONFIG,列出具体缺哪些 key(D9:错误具体到字段名,不报「部分失败」)
    const detail = verdict.missing.map((m) => `${m.key} (${m.reason})`).join('; ');
    await recordFailure(supa, sessionId, 'CONFIG', `fields not accepted by GHL — ${detail}`, logTag);
    return { attempted: true, ok: false, detail };
  }

  // 全部命中才标 synced。日志只记我们的 key,不再 dump 整个 contact(含 PII)
  console.log(`[${logTag}] GHL writeback verified for session ${sessionId}: ${Object.keys(payload).join(',')}`);
  const { error } = await supa
    .from('assessment_results')
    .update({ ghl_synced: true, ghl_last_error: null, ghl_next_retry_at: null })
    .eq('session_id', sessionId);
  if (error) console.error(`[${logTag}] failed to mark ghl_synced for ${sessionId}: ${error.message}`);
  return { attempted: true, ok: true };
}

/**
 * 记一次写回失败,按 D9 的三分类决定要不要排重试。
 *   TRANSIENT → 设 ghl_next_retry_at(指数退避 2^attempts 分钟,上限 6 小时),sweep 会重试
 *   CONFIG / AUTH → ghl_next_retry_at 置 null,不自动重试;sweep 靠 ghl_last_error 的前缀跳过
 * ghl_last_error 以 `TRANSIENT: ` / `CONFIG: ` / `AUTH: ` 开头,Admin 据此分组过滤。
 */
async function recordFailure(
  supa: SupabaseClient,
  sessionId: string,
  klass: GhlErrorClass,
  detail: string,
  logTag: string,
): Promise<void> {
  console.error(`${klass}: [${logTag}] session ${sessionId}: ${detail}`);
  const { data } = await supa
    .from('assessment_results')
    .select('ghl_sync_attempts')
    .eq('session_id', sessionId)
    .maybeSingle();
  const attempts = ((data?.ghl_sync_attempts as number) ?? 0) + 1;

  const patch: Record<string, unknown> = {
    ghl_sync_attempts: attempts,
    ghl_last_error: `${klass}: ${detail}`.slice(0, 1000),
    // CONFIG / AUTH 不排重试;只有 TRANSIENT 设下次重试时间
    ghl_next_retry_at:
      klass === 'TRANSIENT'
        ? new Date(Date.now() + Math.min(2 ** attempts, 360) * 60_000).toISOString()
        : null,
  };
  const { error } = await supa.from('assessment_results').update(patch).eq('session_id', sessionId);
  if (error) console.error(`failed to record sync failure for ${sessionId}: ${error.message}`);
}
