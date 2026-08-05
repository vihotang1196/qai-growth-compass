/**
 * assessment-score —— 问卷提交 + 计分 + 写结果 + GHL 写回。cookie 鉴权。
 *
 * POST { action }  Cookie: compass_session=<签名过的 session>
 *   survey  { responses }  存问卷 7 题,校验后落库
 *   finalize               算分 → 写 assessment_results → 尝试 GHL 写回
 *
 * 【为什么问卷和计分在同一个函数】计分需要问卷里的 S1(priority_dimension)做
 * assessment_mismatch 标签,而 GHL 写回需要两边的数据一起。拆开就要么多一次往返、
 * 要么在两个函数里各写一遍 payload 组装。
 *
 * 【分数一律服务端算】客户端不传任何分数,只传 option_index。见 _shared/scoring.ts。
 */
import { serviceClient } from '../_shared/supa.ts';
import { readSessionCookie, verifySession } from '../_shared/session.ts';
import { missingKeys } from '../_shared/env.ts';
import { isComplete } from '../_shared/quizFlow.ts';
import { computeResult } from '../_shared/scoring.ts';
import { mapOption, mapOptions } from '../_shared/optionMap.ts';
import { checkFields, type FieldSpec } from '../_shared/ghlDomain.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const QUESTIONS = config.questions;
const PROFILE_IDS = config.profile_questions.map((p) => p.id);
const QUESTION_IDS = QUESTIONS.map((q) => q.id);
const DIMENSIONS = config.dimensions.map((d) => ({ key: d.key, order: d.order }));
const TIERS = config.tiers.map((t) => ({ key: t.key, min: t.min, max: t.max }));
// v3:每题按 option_count 归一化,固定分母作废。只需要 scale
const SCALE = config.meta.score_scale;
/** 题 id → option_count,finalize 归一化要用 */
const OPTION_COUNT = new Map(config.questions.map((q) => [q.id, q.option_count]));

interface SessionRow {
  id: string;
  locale: string;
  status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', expected: 'POST' }, 405);

  const env = { SESSION_SECRET: Deno.env.get('SESSION_SECRET') };
  const missing = missingKeys(env);
  if (missing.length) {
    console.error(`server_misconfigured: missing ${missing.join(', ')}`);
    return json({ error: 'server_misconfigured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not object');
    body = raw as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const verified = await verifySession(readSessionCookie(req), env.SESSION_SECRET!, Date.now());
  if (!verified) return json({ error: 'unauthorized' }, 401);

  const supa = serviceClient();

  try {
    // 每次都重查准入 —— cookie 有 30 天,中途被 revoke 的人不该还能提交
    const { data: ent, error: entError } = await supa
      .from('assessment_entitlements')
      .select('id, ghl_contact_id, access_revoked_at')
      .eq('id', verified.entitlementId)
      .maybeSingle();
    if (entError) throw entError;
    if (!ent || ent.access_revoked_at) {
      console.warn(`score denied for entitlement ${verified.entitlementId}: revoked or missing`);
      return json({ error: 'revoked' }, 403);
    }

    const { data: sRow, error: sErr } = await supa
      .from('assessment_sessions')
      .select('id, locale, status')
      .eq('entitlement_id', ent.id)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!sRow) return json({ error: 'no_session' }, 409);
    const session = sRow as SessionRow;

    const action = typeof body.action === 'string' ? body.action : '';

    switch (action) {
      case 'survey':
        return await saveSurvey(supa, session, body.responses);
      case 'finalize':
        return await finalize(supa, session, ent.ghl_contact_id as string);
      default:
        return json({ error: 'unknown_action', action }, 400);
    }
  } catch (err) {
    console.error(`score failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});

/**
 * 存问卷。混合题型,每种的校验都不同。
 *
 * 【下标一律经 mapOption / mapOptions 转成语义值再存】存原始下标的话,
 * 以后调整选项顺序,库里的历史数据会静默指向不同的语义。存语义值是不可变的。
 */
async function saveSurvey(
  supa: ReturnType<typeof serviceClient>,
  session: SessionRow,
  rawResponses: unknown,
): Promise<Response> {
  if (rawResponses === null || typeof rawResponses !== 'object' || Array.isArray(rawResponses)) {
    return json({ error: 'invalid_responses' }, 400);
  }
  const incoming = rawResponses as Record<string, unknown>;
  const stored: Record<string, unknown> = {};

  for (const q of config.survey_questions) {
    const value = incoming[q.id];

    if (value === undefined || value === null || value === '') {
      // required 的必须有值。不满足直接 400 —— 缺 S1 会让 mismatch 标签算不出来,
      // 缺 S7 会让整个成交触发点消失
      if (q.required) return json({ error: 'missing_required', id: q.id }, 400);
      continue;
    }

    if (q.type === 'single_select') {
      if (typeof value !== 'number') return json({ error: 'expected_index', id: q.id }, 400);
      // S1 → 维度 key,S7 → asap/later/…,S2 → 数值。都是同一个 mapOption
      // 显式写成 (string|number)[] —— 三张表元素类型不同(维度 key / 意向值 / 数值),
      // 联合类型 string[]|number[] 会让泛型推不出来
      const table: readonly (string | number)[] | undefined =
        (q as { option_to_dimension?: string[] }).option_to_dimension ??
        (q as { option_to_value?: string[] }).option_to_value ??
        (q as { value_map?: number[] }).value_map;
      if (table) {
        const mapped = mapOption<string | number>(value, table);
        if (mapped === null) return json({ error: 'option_out_of_range', id: q.id }, 400);
        stored[q.field] = mapped;
      } else {
        // 没有映射表的单选(S3 人数)存下标 —— 但仍要按选项数校验范围
        if (mapOption(value, q.zh.options!) === null) {
          return json({ error: 'option_out_of_range', id: q.id }, 400);
        }
        stored[q.field] = value;
      }
      continue;
    }

    if (q.type === 'multi_select') {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'number')) {
        return json({ error: 'expected_index_array', id: q.id }, 400);
      }
      // 任一下标越界就整体拒绝,不跳过 —— 跳过会让客户勾 5 项存 4 项而不知情
      const mapped = mapOptions(value as number[], q.zh.options!);
      if (mapped === null) return json({ error: 'option_out_of_range', id: q.id }, 400);
      stored[q.field] = mapped;
      continue;
    }

    if (q.type === 'open_text') {
      if (typeof value !== 'string') return json({ error: 'expected_text', id: q.id }, 400);
      const text = value.trim();
      const max = (q as { max_length?: number }).max_length;
      // 超长报错而不是截断 —— S5 是销售最好用的一句话,截半句比拒绝更糟
      if (max !== undefined && text.length > max) {
        return json({ error: 'too_long', id: q.id, max }, 400);
      }
      if (q.required && text === '') return json({ error: 'missing_required', id: q.id }, 400);
      stored[q.field] = text;
      continue;
    }

    return json({ error: 'unsupported_question_type', id: q.id }, 400);
  }

  const { error } = await supa
    .from('assessment_survey')
    .upsert({ session_id: session.id, responses: stored }, { onConflict: 'session_id' });
  if (error) throw error;

  return json({ ok: true, stored });
}

/**
 * 算分并写结果。
 *
 * 【先确认答满再算】isComplete 用覆盖判断而不是计数 —— 库里可能留着改版前删掉的
 * 题的答案,那样计数会凑够而覆盖没够。答不满就算分会让某维 raw_sum 少题,
 * 而分母写死 12,那一维被静默低估。
 */
async function finalize(
  supa: ReturnType<typeof serviceClient>,
  session: SessionRow,
  ghlContactId: string,
): Promise<Response> {
  const { data: answerRows, error: aErr } = await supa
    .from('assessment_answers')
    .select('question_id, option_index')
    .eq('session_id', session.id);
  if (aErr) throw aErr;

  const { data: sessionRow, error: pErr } = await supa
    .from('assessment_sessions')
    .select('profile')
    .eq('id', session.id)
    .maybeSingle();
  if (pErr) throw pErr;

  const answers = new Map(
    (answerRows ?? []).map((r) => [r.question_id as string, r as { option_index: number }]),
  );
  const profileKeys = Object.keys((sessionRow?.profile ?? {}) as Record<string, unknown>);
  const answered = new Set([...profileKeys, ...answers.keys()]);

  if (!isComplete(PROFILE_IDS, QUESTION_IDS, answered)) {
    // 24 题不齐 submit 被拒 —— 这是 Stage 7 的验收标准之一
    return json({ error: 'incomplete', detail: 'not every question is answered' }, 409);
  }

  const { data: surveyRow, error: svErr } = await supa
    .from('assessment_survey')
    .select('responses')
    .eq('session_id', session.id)
    .maybeSingle();
  if (svErr) throw svErr;
  if (!surveyRow) return json({ error: 'survey_missing' }, 409);
  const survey = (surveyRow.responses ?? {}) as Record<string, unknown>;

  /**
   * ── 组装每道题的作答,交给 computeResult 归一化 ──
   *
   * 【以 option_index 为准,不信库里可能残留的 score】v3 计分按每题 option_count
   * 归一化。option_index 是不受标度影响的事实;computeResult 内部按 config 的
   * option_count 重新归一化,所以 config 改版之后同一批人不会新旧标度混着。
   *
   * option_count 从 config 取(不从答题时存的值),因为 config 是分数标度的唯一真相源。
   */
  const questionInputs = [];
  for (const q of QUESTIONS) {
    const row = answers.get(q.id);
    if (!row) continue; // isComplete 已经保证不会走到这里
    questionInputs.push({
      dimension: q.dimension,
      optionIndex: row.option_index,
      optionCount: OPTION_COUNT.get(q.id)!,
    });
  }

  let result;
  try {
    result = computeResult(questionInputs, DIMENSIONS, TIERS, { scale: SCALE });
  } catch (err) {
    // computeResult 对越界 option_index / 缺维度会抛 —— 那是数据损坏,不是客户的错
    console.error(`session ${session.id}: scoring failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'corrupt_answer' }, 500);
  }

  const { error: rErr } = await supa.from('assessment_results').upsert(
    {
      session_id: session.id,
      dim_scores: result.dimensions,
      total: result.total,
      tier: result.tier,
      weakest: result.weakest,
      strongest: result.strongest,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'session_id' },
  );
  if (rErr) throw rErr;

  const { error: stErr } = await supa
    .from('assessment_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', session.id);
  if (stErr) console.error(`failed to mark session ${session.id} completed: ${stErr.message}`);

  // ── GHL 写回 ──
  const writeback = await syncToGhl(supa, session.id, ghlContactId, result, survey);

  return json({ ok: true, result, writeback });
}

/**
 * 组装并校验 GHL payload。
 *
 * 【校验失败不写、且记 CONFIG 类错误】config 的 custom_fields_note 明确要求这一点。
 * 静默写入的后果是 GHL 那边字段值不在域内,而 workflow 只会静默不匹配 ——
 * 没有任何报警,只是这个人再也不会进任何自动化流程。
 *
 * 【写回失败不让 finalize 失败】分数已经落库了,报告能出。写回有 ghl_synced /
 * ghl_sync_attempts / ghl_next_retry_at 三列支撑重试(D2),这里只做第一次尝试。
 */
async function syncToGhl(
  supa: ReturnType<typeof serviceClient>,
  sessionId: string,
  ghlContactId: string,
  result: { total: number; tier: string; weakest: [string, string] },
  survey: Record<string, unknown>,
): Promise<{ attempted: boolean; ok: boolean; detail?: string }> {
  const payload: Record<string, unknown> = {
    qai_assessment_status: 'completed',
    qai_assessment_total: result.total,
    qai_assessment_tier: result.tier,
    qai_assessment_weakest_1: result.weakest[0],
    qai_assessment_weakest_2: result.weakest[1],
  };
  // 问卷里有的才写 —— 缺字段的行为见 D9,不在这里静默补默认值
  if (typeof survey.priority_dimension === 'string') {
    payload.qai_assessment_priority = survey.priority_dimension;
  }
  if (typeof survey.goal_90d === 'string') payload.qai_assessment_goal_90d = survey.goal_90d;
  if (typeof survey.consult_interest === 'string') {
    payload.qai_assessment_consult_interest = survey.consult_interest;
  }

  const specs = config.ghl_writeback.custom_fields as unknown as FieldSpec[];
  const failures = checkFields(payload, specs);
  if (failures.length) {
    const detail = failures.map((f) => `${f.key}: ${f.reason}`).join('; ');
    // CONFIG 类错误 —— 不写入,显式记下来。这不是网络问题,重试也不会好
    console.error(`CONFIG: GHL writeback payload rejected for session ${sessionId}: ${detail}`);
    // CONFIG 类错误不排重试 —— 重试一百次也还是同样的 payload。
    // 只记 ghl_last_error,不设 ghl_next_retry_at
    await supa
      .from('assessment_results')
      .update({ ghl_last_error: `CONFIG: ${detail}`.slice(0, 1000) })
      .eq('session_id', sessionId);
    return { attempted: false, ok: false, detail };
  }

  // 变量名以字面量出现在 Deno.env.get() 里,check:env 才扫得到。见 _shared/env.ts
  const ghlEnv = {
    GHL_PRIVATE_TOKEN: Deno.env.get('GHL_PRIVATE_TOKEN'),
    GHL_LOCATION_ID: Deno.env.get('GHL_LOCATION_ID'),
  };
  const missingGhl = missingKeys(ghlEnv);
  if (missingGhl.length) {
    // 缺凭证不让整个提交失败 —— 分数已经落库,报告能出。交给 D2 的重试
    console.error(
      `CONFIG: GHL writeback skipped for session ${sessionId}, missing ${missingGhl.join(', ')}`,
    );
    await markSyncFailure(supa, sessionId, `CONFIG: missing ${missingGhl.join(', ')}`);
    return { attempted: false, ok: false, detail: `missing ${missingGhl.join(', ')}` };
  }

  /**
   * 【customFields 用 key 还是 id —— 这一点我没有验证过】
   *
   * GHL v2 的 contact 更新接口接受 `customFields: [{ id, field_value }]`,
   * 而部分端点也接受 `key`。我们的 config 里存的是 key(qai_assessment_*),
   * 因为那是人能读懂的东西;但如果这个端点只认 UUID,这次调用会成功返回 200
   * 而字段没有被写进去 —— **静默失败**。
   *
   * 所以:第一次真实调用之后必须去 GHL contact 上肉眼确认字段有值。
   * 不匹配的话要么改成先查 custom field 列表拿 id 再写,要么改用
   * Inbound Webhook + workflow 那条路(那条路我们在重发链接上已经验过)。
   * 这里刻意把响应体记进日志,让那次确认有据可查,而不是靠猜。
   */
  const url = `https://services.leadconnectorhq.com/contacts/${ghlContactId}`;
  const customFields = Object.entries(payload).map(([key, value]) => ({ key, field_value: value }));

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghlEnv.GHL_PRIVATE_TOKEN}`,
        'Content-Type': 'application/json',
        // GHL v2 要求显式版本头,缺了会 4xx
        Version: '2021-07-28',
      },
      body: JSON.stringify({ customFields }),
    });
    const text = await res.text().catch(() => '');

    if (!res.ok) {
      const detail = `GHL returned ${res.status}: ${text.slice(0, 400)}`;
      console.error(`GHL writeback failed for session ${sessionId}: ${detail}`);
      await markSyncFailure(supa, sessionId, detail);
      return { attempted: true, ok: false, detail };
    }

    /**
     * 【200 不等于写进去了】见上面关于 key / id 的注释。所以把响应体记下来 ——
     * 那是判断「字段到底有没有被接受」的唯一线索。这与 Stage 3 学到的一样:
     * GHL 收下 POST 不代表它做了我们以为的事。
     */
    console.log(
      `GHL writeback 200 for contact ${ghlContactId}, session ${sessionId}. ` +
        `Wrote keys: ${Object.keys(payload).join(',')}. Response: ${text.slice(0, 400)}. ` +
        `VERIFY ON THE CONTACT — a 200 does not prove the custom fields were matched by key.`,
    );
    const { error } = await supa
      .from('assessment_results')
      .update({ ghl_synced: true, ghl_last_error: null })
      .eq('session_id', sessionId);
    if (error) console.error(`failed to mark ghl_synced for ${sessionId}: ${error.message}`);
    return { attempted: true, ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`GHL writeback threw for session ${sessionId}: ${detail}`);
    await markSyncFailure(supa, sessionId, detail);
    return { attempted: true, ok: false, detail };
  }
}

/**
 * 记一次写回失败,并推进重试计数(D2:3 列 + Vercel Cron 指数退避)。
 *
 * 退避:2^attempts 分钟,上限 6 小时。attempts 由这里自增,Cron 只管挑
 * ghl_synced = false 且 ghl_next_retry_at 已过的行。
 */
async function markSyncFailure(
  supa: ReturnType<typeof serviceClient>,
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
