/**
 * assessment-report —— 报告页取数。GET,cookie 鉴权。
 *
 * 【只读,不重算分数、不触发渲染】读 assessment_results 里已经算好的分数/档位/最弱最强;
 * 徽章需要的每题归一化分从 answers 重算(用同一个 perQuestionScore,不会与 finalize 分叉);
 * 基准线 / 分位从同批次 + 全库结果算。分数本身不重跑 —— finalize 已经定过了。
 *
 * 返回九个板块要的全部数据,前端只做渲染不做判断:baselineSource / cohort 是否够样本
 * 都在这里定好,前端不猜(PROGRESS 0.9)。
 */
import { serviceClient } from '../_shared/supa.ts';
import { readSessionCookie, verifySession } from '../_shared/session.ts';
import { verifyRenderToken } from '../_shared/renderToken.ts';
import { missingKeys } from '../_shared/env.ts';
import { perQuestionScore } from '../_shared/scoring.ts';
import {
  cohortStanding,
  dimensionDiffs,
  selectBaseline,
  type ResultRow,
} from '../../../src/lib/reportStats.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const DIM_KEYS = config.dimensions.map((d) => d.key);
const SCALE = config.meta.score_scale;
const MIN_N = config.cohorts.min_n_for_baseline;
const QUESTIONS = config.questions;
const P2 = config.profile_questions.find((p) => p.id === 'P2');
const P3 = config.profile_questions.find((p) => p.id === 'P3');

/** value_map 解析:下标越界 / 缺失 → null(报告里代价换算那块据此隐藏,不硬凑) */
function fromValueMap(profile: Record<string, unknown>, id: string, map: number[] | undefined): number | null {
  const idx = profile[id];
  if (typeof idx !== 'number' || !map || idx < 0 || idx >= map.length) return null;
  return map[idx];
}

/** ready 且有路径时现签一条 signed URL;其余情况回 null(前端据此显示静态兜底文案) */
async function signedPdfUrl(
  supa: ReturnType<typeof serviceClient>,
  status: string,
  path: string | null,
): Promise<string | null> {
  if (status !== 'ready' || !path) return null;
  const { data, error } = await supa.storage.from('reports').createSignedUrl(path, 3600);
  if (error) {
    // 签不出来不该让整份报告失败 —— 报告本身能看,只是少一个下载按钮
    console.error(`failed to sign pdf url for ${path}: ${error.message}`);
    return null;
  }
  return data?.signedUrl ?? null;
}

Deno.serve(async (req: Request) => {
  // 报告是只读,GET;cookie 鉴权(render token / admin JWT 留给 Stage 9 / 后台)
  if (req.method !== 'GET') return json({ error: 'method_not_allowed', expected: 'GET' }, 405);

  const env = {
    SESSION_SECRET: Deno.env.get('SESSION_SECRET'),
    INTERNAL_FN_SECRET: Deno.env.get('INTERNAL_FN_SECRET'),
  };
  const missing = missingKeys(env);
  if (missing.length) {
    console.error(`server_misconfigured: missing ${missing.join(', ')}`);
    return json({ error: 'server_misconfigured' }, 500);
  }

  const supa = serviceClient();

  /**
   * 两条入口:客户的 session cookie,或 PDF 渲染器的渲染令牌(?rt=)。
   * 渲染令牌用【另一个密钥】且只活几分钟 —— 它不能当登录态用,见 _shared/renderToken.ts。
   */
  const rt = new URL(req.url).searchParams.get('rt');
  const renderSessionId = rt ? await verifyRenderToken(rt, env.INTERNAL_FN_SECRET!, Date.now()) : null;
  const verified = renderSessionId
    ? null
    : await verifySession(readSessionCookie(req), env.SESSION_SECRET!, Date.now());
  if (!renderSessionId && !verified) {
    /**
     * 【401 要说清是哪一种,但不泄露任何值】
     * 「有令牌但验不过」与「压根没凭证」的排查方向完全不同:前者查两侧 secret 是否同值、
     * 是否过期;后者查 rt 有没有真的传到这一层(比如代理丢了 query、页面没透传)。
     * 只回类别,不回令牌内容、不回期望值 —— 那些对排查没用,对攻击者有用。
     */
    const reason = rt
      ? 'render token present but failed verification (wrong INTERNAL_FN_SECRET on one side, or expired)'
      : 'no render token and no valid session cookie';
    console.warn(`report unauthorized: ${reason}`);
    return json({ error: 'unauthorized', reason }, 401);
  }

  try {
    // 渲染令牌直接指定 session;cookie 那条要先由 entitlement 找 session
    const { data: session, error: sErr } = renderSessionId
      ? await supa
          .from('assessment_sessions')
          .select('id, locale, profile, status, entitlement_id')
          .eq('id', renderSessionId)
          .maybeSingle()
      : await supa
          .from('assessment_sessions')
          .select('id, locale, profile, status, entitlement_id')
          .eq('entitlement_id', verified!.entitlementId)
          .maybeSingle();
    if (sErr) throw sErr;
    if (!session) return json({ error: 'no_session' }, 409);

    const { data: ent, error: entErr } = await supa
      .from('assessment_entitlements')
      .select('id, cohort_id, access_revoked_at')
      .eq('id', session.entitlement_id)
      .maybeSingle();
    if (entErr) throw entErr;
    // 渲染令牌也要过这一关 —— 被停用的人不该还能被渲出报告
    if (!ent || ent.access_revoked_at) return json({ error: 'revoked' }, 403);

    const { data: result, error: rErr } = await supa
      .from('assessment_results')
      .select('dim_scores, total, tier, weakest, strongest, pdf_status, pdf_path')
      .eq('session_id', session.id)
      .maybeSingle();
    if (rErr) throw rErr;
    // 结果还没算出来 —— 报告没准备好(还没走完 finalize)
    if (!result) return json({ error: 'not_ready' }, 404);

    // ── 徽章:每题归一化分,按维度 + submodule_index 归位 ──
    const { data: answerRows, error: aErr } = await supa
      .from('assessment_answers')
      .select('question_id, option_index')
      .eq('session_id', session.id);
    if (aErr) throw aErr;
    const answers = new Map((answerRows ?? []).map((r) => [r.question_id as string, r.option_index as number]));

    /**
     * 每个子模块位(维度 × submodule_index)带上:归一化分 + 题号 + 客户选的下标。
     *
     * 【为什么要带题号和下标】报告要给「为什么是这个分」的依据 —— 展示客户【自己选的】
     * 那个选项,以及顶格那一档,做成「现在 → 目标」。选项文案在 config 里,前端按题号取,
     * 所以这里只回 id 与 index,不回文案(省带宽,也避免文案在两处各存一份)。
     * 依据是他自己填的,比任何解释性文案都有说服力。
     */
    const submodules: Record<string, (number | null)[]> = {};
    const evidence: Record<string, ({ questionId: string; optionIndex: number } | null)[]> = {};
    for (const k of DIM_KEYS) {
      submodules[k] = [null, null, null];
      evidence[k] = [null, null, null];
    }
    for (const q of QUESTIONS) {
      const idx = answers.get(q.id);
      if (idx === undefined) continue;
      const s = perQuestionScore(idx, q.option_count, SCALE);
      if (s !== null) submodules[q.dimension][q.submodule_index] = s;
      evidence[q.dimension][q.submodule_index] = { questionId: q.id, optionIndex: idx };
    }
    /** 题号 → 客户选的下标。行动清单的「现在 → 目标」按 related_question 查这张表 */
    const answersByQuestion: Record<string, number> = {};
    for (const [qid, idx] of answers) answersByQuestion[qid] = idx;

    // ── 问卷(mismatch 高亮、goal_90d 展示要用)──
    const { data: surveyRow } = await supa
      .from('assessment_survey')
      .select('responses')
      .eq('session_id', session.id)
      .maybeSingle();
    const survey = (surveyRow?.responses ?? {}) as Record<string, unknown>;

    // ── 基准线 / 分位:同批次 + 全库结果 ──
    /**
     * 【必须用 !inner】PostgREST 对嵌套资源的过滤【不会过滤父行】—— 不加 !inner 的话
     * .eq('session.status','completed') 只作用于嵌套那一层,父行照样全都回来
     * (只是 session 变 null)。那会让基准线把未完成的结果也算进均值 ——
     * 症状是「库里只有我一条,基准线却和我不重合」,而没有任何报错。
     */
    const { data: allRows, error: allErr } = await supa
      .from('assessment_results')
      .select(
        'dim_scores, total, tier, session:assessment_sessions!inner(id, status, entitlement:assessment_entitlements!inner(cohort_id))',
      )
      .eq('session.status', 'completed');
    if (allErr) throw allErr;

    const norm = (r: { dim_scores: unknown; total: number; tier: string }): ResultRow => ({
      dimensions: (r.dim_scores ?? {}) as Record<string, number>,
      total: r.total,
      tier: r.tier,
    });
    const globalRows: ResultRow[] = (allRows ?? []).map(norm);
    const cohortRows: ResultRow[] = (allRows ?? [])
      .filter((r) => {
        // deno-lint-ignore no-explicit-any
        const cid = (r as any).session?.entitlement?.cohort_id;
        return ent.cohort_id !== null && cid === ent.cohort_id;
      })
      .map(norm);

    const baseline = selectBaseline(cohortRows, globalRows, DIM_KEYS, MIN_N);

    /**
     * 【诊断:基准池里到底有没有本人】n=1 却与本人分数不符,唯一的解释是那 1 条不是本人 ——
     * 而这只可能因为本人的 session 不是 'completed'(被 !inner 过滤掉了)。
     * finalize 里把 status 标 completed 那步失败时【只记日志不失败】,所以它是会发生的。
     * 与其让人从「n=1 但不重合」去反推,不如让端点直说。
     */
    const selfInPool = (allRows ?? []).some((r) => {
      // deno-lint-ignore no-explicit-any
      return (r as any).session?.id === session.id;
    });

    const myDims = (result.dim_scores ?? {}) as Record<string, number>;
    // cohort_rank 板块:样本够才给;不足则 null,前端整块隐藏(跨期分位没意义,B1)
    const cohort = cohortRows.length >= MIN_N
      ? {
        standing: cohortStanding(result.total, result.tier, cohortRows),
        diffs: dimensionDiffs(myDims, baseline.means, DIM_KEYS),
      }
      : null;

    const profile = (session.profile ?? {}) as Record<string, unknown>;

    return json({
      locale: session.locale,
      result: {
        dimensions: myDims,
        total: result.total,
        tier: result.tier,
        weakest: result.weakest,
        strongest: result.strongest,
      },
      submodules,
      evidence,
      answersByQuestion,
      leadsPerMonth: fromValueMap(profile, 'P2', P2?.value_map),
      dealValue: fromValueMap(profile, 'P3', P3?.value_map),
      survey,
      baseline,
      // 诊断:本人是否在基准池里、本人 session 的实际状态
      diagnostics: { baselineIncludesSelf: selfInPool, sessionStatus: session.status },
      cohort,
      pdfStatus: result.pdf_status,
      /**
       * 【每次请求现签,不缓存】ready 时签一条 1 小时有效的 signed URL。
       *
       * 客户问「过期后再点会怎样」—— 答案是:**不会遇到过期**。前端在【点击那一刻】重新
       * 取一次报告数据、拿一条新签的 URL 再打开,而不是把页面加载时那条存着用。
       * 那样把「URL 会过期」这件事从错误处理变成了不存在的问题;否则页面开着超过一小时
       * 再点,拿到的是 Storage 的 403,而那对客户完全无法解释。
       */
      pdfUrl: await signedPdfUrl(supa, result.pdf_status as string, result.pdf_path as string | null),
    });
  } catch (err) {
    console.error(`report failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});
