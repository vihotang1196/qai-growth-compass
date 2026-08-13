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
import { statusesBefore } from '../_shared/entitlementStatus.ts';
import { isComplete } from '../_shared/quizFlow.ts';
import { computeResult } from '../_shared/scoring.ts';
import { mapOption, mapOptions } from '../_shared/optionMap.ts';
import { buildWritebackPayload, syncToGhl } from '../_shared/ghlWriteback.ts';
import { syncTagsToGhl } from '../_shared/ghlTagsWriteback.ts';
import { effectiveLang } from '../_shared/lang.ts';
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
      .select('id, ghl_contact_id, access_revoked_at, lang')
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
        return await finalize(
          supa,
          session,
          ent.id as string,
          ent.ghl_contact_id as string,
          ent.lang as string | null,
        );
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
 * 题的答案,那样计数会凑够而覆盖没够。答不满就算分会让某维少一道题,
 * 那一维的平均分被静默拉偏。
 */
async function finalize(
  supa: ReturnType<typeof serviceClient>,
  session: SessionRow,
  entitlementId: string,
  ghlContactId: string,
  /**
   * `assessment_entitlements.lang` —— 语言跟着人走。
   *
   * ⚠️ **不用 `session.locale`**。那一列是「这次会话是从哪种语言的页面进来的」,
   * 属于跟着链接走的旧模型;两者会分叉(学员用中文链接进来、切成英文、然后交卷)。
   * 真相源只有 entitlement 那一列 —— 而 `session.locale` 现在没有任何一处读它,
   * 那正是「名字像入口但没人引用」的形状,已记进未完成清单。
   */
  entLang: string | null,
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

  /**
   * ── entitlement 也要跟着推到 completed ──
   *
   * 【为什么是两张表两次写】session.status 是答题流程的位置(决定登录后跳哪),
   * entitlement.status 是运营视角的进度(Admin 名单页那一列、CSV 的「状态」与
   * 「完成时间」)。漏掉这一句的失败形态是**安静地错**:分数、报告、PDF 全对,
   * 只有名单页永远显示 started —— 而名单页正是运营判断「谁答完了」的唯一依据。
   *
   * 【不许倒退,而且由这条 UPDATE 自己保证】`.in('status', statusesBefore(...))`
   * 让「只往前走」落在数据库那一次原子写上,不是先读后写 ——
   * 客户连点两次提交是真实存在的,先读后写在那种情况下会互相覆盖 completed_at。
   * 阶梯与 assessment-auth 推 started 用的是同一份(_shared/entitlementStatus.ts)。
   *
   * 【失败只记日志】与上面那句 session 一样:分数已经算出来了,
   * 不能因为一个时间戳没写上就让客户看不到报告。
   */
  const { error: entErr } = await supa
    .from('assessment_entitlements')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', entitlementId)
    .in('status', statusesBefore('completed'));
  if (entErr) {
    console.error(`failed to mark entitlement ${entitlementId} completed: ${entErr.message}`);
  }

  // ── GHL 写回(共用 _shared/ghlWriteback,与重试 sweep 同一份实现)──
  const payload = buildWritebackPayload(result, survey);
  const writeback = await syncToGhl(supa, session.id, ghlContactId, payload, 'finalize');

  /**
   * ── GHL 标签(D9:**独立于**字段写入)──
   *
   * 【为什么不看 writeback 的成败就打标签】D9 定的就是这一条:标签驱动 workflow 分支,
   * 字段只是给人看的。字段炸了(比如某个自定义字段还没在 GHL 里建)不该连带
   * 「这个人答完了、他是 semi_auto 档」这件事也传不过去 ——
   * 那会让整条自动化停在原地,而原因只是一个展示字段。
   *
   * 反向也一样:标签失败不碰 `ghl_synced`。两组状态列因此是分开的
   * (见 20260812000000_ghl_tags_status.sql)。
   *
   * ⚠️ **上一版这里传的是 `null`,理由写着「首次写回时 applied 必然是空」——那个假设是错的。**
   *
   * finalize 用的是 `upsert(onConflict: session_id)`,而它只拦「题没答齐」和「没交问卷」;
   * 两者在第一次 finalize 之后**仍然成立**,而 `assessment-quiz` 也不拦 completed 之后改答案。
   * 所以「重答 → 再 finalize」这条路是通的,而那时:
   *   - `applied` 传 null → 差集算出 `toRemove = []` → **旧档位标签永远不会被移除**
   *   - 紧接着 `ghl_tags_applied` 被覆盖成新的一套 → **那个残留标签的记录被销毁**,
   *     以后任何一次 sweep 都不可能知道要去移除它
   * 也就是说,`ghl_tags_applied` 这整个设计要防的那件事,会被这一行悄悄绕过。
   *
   * 那句「必然」是一个没有任何东西验证的断言 —— 与判断标准 20 同族,
   * 只是这次不是「将来会怎样」,而是「这里不可能发生」。
   * 改成**读当前值**,于是这条路径不再依赖任何关于调用次数的假设。
   *
   * 【为什么读得到】上面那次 upsert 不写 `ghl_tags_applied`,所以它保持原值。
   */
  const tagInput = {
    tier: result.tier,
    weakestPrimary: result.weakest?.[0] ?? null,
    total: result.total,
    responses: survey,
  };
  const { data: appliedRow, error: appliedErr } = await supa
    .from('assessment_results')
    .select('ghl_tags_applied')
    .eq('session_id', session.id)
    .maybeSingle();
  if (appliedErr) {
    // 读不到就当作没有上次记录 —— 但要说出来:那意味着这一次不会移除任何旧标签
    console.error(
      `failed to read ghl_tags_applied for ${session.id}: ${appliedErr.message} ` +
        `— stale tags (if any) will not be removed this round`,
    );
  }
  const tagSync = await syncTagsToGhl(
    supa,
    session.id,
    ghlContactId,
    tagInput,
    appliedRow?.ghl_tags_applied ?? null,
    'finalize',
  );

  // ── PDF 渲染:异步触发,不阻塞返回 ──
  const pdfTriggered = triggerPdfRender(session.id, effectiveLang(entLang));

  return json({ ok: true, result, writeback, tagSync, pdfTriggered });
}


/**
 * 异步触发 PDF 渲染 —— **刻意不 await、失败不影响 finalize 的返回值**。
 *
 * 【为什么异步】同步会把附属品的失败绑到主交付上:分数已经算好、报告页本来就能看,
 * 用一次 PDF 渲染失败(字体 / 超时 / Chromium 起不来)去毁掉「客户拿到分数」这件事,
 * 方向错了。异步之后 PDF 是**增量**:轮询到就多一个下载按钮,渲染失败也只是少个按钮 +
 * Admin 看得见。这与「有方块的报告好过没有报告」是同一个取向 —— 主交付不受附属品拖累。
 *
 * 【为什么用 EdgeRuntime.waitUntil】Edge Function 在响应返回后可能立刻终止,
 * 裸 fetch 不 await 会被取消 —— 那样触发是「有时成功」,而那种不确定比同步等待更糟。
 * waitUntil 让运行时把这个 promise 保留到完成。拿不到那个 API 时退回 fire-and-forget
 * 并记日志:退化路径下触发可能丢,而**兜底是 Admin 的「重新生成」按钮**
 * (它对任何非 ready 状态都可用,正是为了接住这种丢失)。
 *
 * 【渲染耗时约 16 秒,远超响应时间】所以这里只发出请求,不等结果;
 * pdf_status 由 render-pdf 自己写(rendering → ready / failed)。
 */
function triggerPdfRender(sessionId: string, lang: string): boolean {
  const base = Deno.env.get('APP_BASE_URL');
  const secret = Deno.env.get('INTERNAL_FN_SECRET');
  if (!base || !secret) {
    console.error(`CONFIG: cannot trigger PDF render for ${sessionId}: missing APP_BASE_URL or INTERNAL_FN_SECRET`);
    return false;
  }

  const task = fetch(`${base.replace(/\/$/, '')}/api/render-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
    /**
     * 【lang 必须传,而且传的是「这个人的语言」】第一次生成时那一份就该是他能读的那种。
     * render-pdf 那边没有默认值 —— 忘了传会 400,而不是静默渲成中文。
     */
    body: JSON.stringify({ session_id: sessionId, lang }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`PDF render trigger for ${sessionId} returned ${res.status}: ${body.slice(0, 300)}`);
      } else {
        console.log(`PDF render finished for ${sessionId}`);
      }
    })
    .catch((err) => {
      console.error(`PDF render trigger for ${sessionId} threw: ${err instanceof Error ? err.message : String(err)}`);
    });

  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof runtime?.waitUntil === 'function') {
    runtime.waitUntil(task);
    return true;
  }
  console.warn(
    `EdgeRuntime.waitUntil unavailable — PDF render trigger for ${sessionId} is fire-and-forget ` +
      'and may be cancelled when this function returns. 兜底:Admin 名单页的「重新生成 PDF」。',
  );
  return false;
}
