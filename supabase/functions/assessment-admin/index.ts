/**
 * assessment-admin —— 后台的唯一入口,按 action 分发。
 *
 * POST { action, ...args }  Authorization: Bearer <Supabase Auth access token>
 *
 * 【单函数多 action 而不是每功能一个函数】JWT + 允许名单的校验只写一遍。
 * Stage 10 还要加四个模块(漏斗、批次看板、问卷洞察、现场模式),
 * 每个都单独一个函数就意味着那段校验要复制五次 —— 复制五次的东西迟早有一份写歪。
 * 代价是这个文件会长;真长到难维护时再拆,那时拆的依据也更清楚。
 *
 * 【每次请求都验 JWT 且查名单,不信任前端】前端的路由守卫只是 UX。
 * 那一层刻意写得很薄,薄到不会让人误以为它在保护什么 —— 真正的拦阻在这里。
 */
import { serviceClient } from '../_shared/supa.ts';
import { adminVerdict, normalizeAdminEmail } from '../_shared/adminAuth.ts';
import { missingKeys } from '../_shared/env.ts';
import { generateAccessToken } from '../_shared/token.ts';
import { sendMagicLink, type SendTarget } from '../_shared/resendLink.ts';
import { toCsv } from '../_shared/csv.ts';
import { aggregateCohort } from '../_shared/cohortAggregate.ts';
import { buildFunnel, type FunnelRowInput } from '../_shared/funnel.ts';
import { isHighIntent, priorityAlignment } from '../_shared/surveySignals.ts';
import { isTestCohort } from '../_shared/testCohort.ts';
import { RENDER_TOKEN_TTL_SEC, signRenderToken } from '../_shared/renderToken.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// access_revoked_at 必须在里面 —— resend 分支要读它来拒绝已停用的记录。
// 第一版漏了,deno check 抓到:漏 select 的话运行时是 undefined,那个检查会静默失效
const SEND_COLS =
  'id, ghl_contact_id, access_token, name, phone_e164, email_lower, status, access_revoked_at';

interface RosterRow {
  id: string;
  name: string | null;
  phone_e164: string | null;
  phone_raw: string | null;
  email_lower: string | null;
  status: string;
  first_login_at: string | null;
  completed_at: string | null;
  link_sent_at: string | null;
  access_revoked_at: string | null;
  cohort: { id: string; name: string; is_test: boolean } | null;
  session: {
    id: string;
    status: string;
    result: {
      total: number;
      tier: string;
      weakest: string[];
      pdf_status: string;
      pdf_last_error: string | null;
      /** 分享卡失败原因。【非空不代表 PDF 失败】—— 两者分开,CSV 里也是两列 */
      share_card_error: string | null;
    } | null;
  } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', expected: 'POST' }, 405);
  }

  const env = {
    GHL_RESEND_WEBHOOK_URL: Deno.env.get('GHL_RESEND_WEBHOOK_URL'),
    APP_BASE_URL: Deno.env.get('APP_BASE_URL'),
  };
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

  const supa = serviceClient();

  // ── 授权:验 JWT → 查名单 → 判定 ─────────────────────────────
  // 代理会把浏览器的 Authorization 换成 anon key,所以后台的 JWT 走
  // 单独的 X-Admin-Token 头,避免两者互相覆盖
  const jwt = req.headers.get('X-Admin-Token')?.trim() ?? '';
  let jwtEmail: string | null = null;
  if (jwt) {
    const { data, error } = await supa.auth.getUser(jwt);
    if (error) console.warn(`admin jwt rejected: ${error.message}`);
    jwtEmail = normalizeAdminEmail(data?.user?.email ?? null);
  }

  let inAllowlist = false;
  if (jwtEmail) {
    const { data, error } = await supa
      .from('admin_users')
      .select('email')
      .eq('email', jwtEmail)
      .maybeSingle();
    if (error) {
      console.error(`allowlist lookup failed: ${error.message}`);
      return json({ error: 'internal_error' }, 500);
    }
    inAllowlist = data !== null;
  }

  const verdict = adminVerdict({ jwtEmail, inAllowlist });
  if (!verdict.ok) {
    // 403 与 401 分开:不在名单的人再登录一百次也还是 403,
    // 合成一个会让他被无限弹回登录页
    if (verdict.status === 403) console.warn(`admin denied: ${jwtEmail} is not on the allowlist`);
    return json({ error: verdict.status === 401 ? 'unauthorized' : 'forbidden' }, verdict.status);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const lang = body.lang === 'en' ? 'en' : 'zh';

  try {
    switch (action) {
      case 'roster':
        return json(await roster(supa));

      case 'cohort_dashboard': {
        /**
         * 批次聚合看板(Stage 10)。
         *
         * 【`cohort_id` 是必填参数,没有「默认全部」】
         * 一个聚合数字的正确性取决于「它涵盖了哪些人」,所以那个范围必须由调用方说出来 ——
         * 默认值出错时结果**看起来仍然正确**(判断标准 15)。
         * 允许的值:某个 cohort 的 uuid,或字面量 `'all'`。缺参数直接 400。
         */
        const scope = typeof body.cohort_id === 'string' ? body.cohort_id : '';
        if (!scope) {
          return json(
            {
              error: 'missing cohort_id',
              detail: "expected a cohort uuid or the literal 'all' —— 聚合范围必须显式给出",
            },
            400,
          );
        }
        return json(await cohortDashboard(supa, scope));
      }

      case 'report_link': {
        /**
         * Admin 看学员报告 —— **签一条短命的渲染令牌,不碰学员自己的凭证**。
         *
         * 【为什么不用学员的 access_token】那是他的长期凭证、不自动过期、可以被转发。
         * 把它交到 Admin 手上就等于多了一份可以四处流转的报告链接,
         * 而它和学员手里那条**完全等价** —— 没法区分谁看过。
         *
         * 【为什么用 renderToken】它本来就是给 PDF 渲染器用的:HMAC 签名、
         * 绑定单个 session、TTL 180 秒。一条只活三分钟的链接**存不住** ——
         * 复制出去也几乎立刻失效,而这正是「Admin 能看任何人的报告」这件事
         * 该有的形状:能看,但看的是一次性的,而且这一次被记下来了。
         *
         * 【必须留痕】这条 console.log 是这个能力唯一的审计痕迹。
         * 没有它就是「Admin 能静默看任何人的报告」—— 那种能力不该没有记录。
         */
        const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
        if (!sessionId) return json({ error: 'missing session_id' }, 400);

        const internal = Deno.env.get('INTERNAL_FN_SECRET');
        if (!internal) {
          console.error('report_link: INTERNAL_FN_SECRET is not configured');
          return json({ error: 'server_misconfigured' }, 500);
        }

        /**
         * 【报告只在算完之后存在】没有 result 的 session 打开只会看到「还没准备好」。
         * 与其让人点开一个空页面,不如在这里就说清 —— 而前端那个按钮同样按这个条件禁用。
         */
        const { data: res, error: resErr } = await supa
          .from('assessment_results')
          .select('session_id')
          .eq('session_id', sessionId)
          .maybeSingle();
        if (resErr) throw resErr;
        if (!res) return json({ error: 'no_result', detail: '这个 session 还没算出结果' }, 409);

        const rt = await signRenderToken(sessionId, internal, Date.now());
        console.log(
          `admin ${verdict.email} opened the report for session ${sessionId} ` +
            `(render token, ttl ${RENDER_TOKEN_TTL_SEC}s)`,
        );
        return json({
          url: `${env.APP_BASE_URL!.replace(/\/$/, '')}/report?rt=${encodeURIComponent(rt)}&lang=${lang}`,
          expiresInSec: RENDER_TOKEN_TTL_SEC,
        });
      }

      case 'funnel': {
        // 范围约束与看板一致(cohort_id 必填、'all' 服务端展开)—— 但取数起点不同,见 funnelData
        const scope = typeof body.cohort_id === 'string' ? body.cohort_id : '';
        if (!scope) {
          return json(
            { error: 'missing cohort_id', detail: "expected a cohort uuid or the literal 'all'" },
            400,
          );
        }
        return json(await funnelData(supa, scope));
      }

      case 'survey_insights': {
        const scope = typeof body.cohort_id === 'string' ? body.cohort_id : '';
        if (!scope) {
          return json({ error: 'missing cohort_id', detail: "expected a cohort uuid or 'all'" }, 400);
        }
        return json(await surveyInsights(supa, scope));
      }

      case 'high_intent_export': {
        /**
         * 高意向名单导出。
         *
         * 【与 roster 导出同一条:无条件剔测试行,不看任何参数】
         * 这份 CSV 是拿去做 GHL 分群的 —— 测试行混进去就是给假联系人发消息。
         */
        const scope = typeof body.cohort_id === 'string' ? body.cohort_id : '';
        if (!scope) {
          return json({ error: 'missing cohort_id', detail: "expected a cohort uuid or 'all'" }, 400);
        }
        const data = await surveyInsights(supa, scope);
        const real = data.rows.filter((r) => !r.isTest && r.highIntent);
        const dropped = data.rows.filter((r) => r.isTest && r.highIntent).length;
        if (dropped > 0) {
          console.log(
            `admin ${verdict.email} exported ${real.length} high-intent row(s), excluded ${dropped} test row(s)`,
          );
        }
        return json({
          filename: 'compass-high-intent.csv',
          csv: toCsv(
            ['姓名', '手机', '邮箱', '批次', '意向', '90 天目标', '最大阻碍', '想修的', '该修的'],
            real.map((r) => [
              r.name,
              r.phoneE164,
              r.emailLower,
              r.cohortName,
              r.consultInterest,
              r.goal90d,
              r.biggestBlocker,
              r.priorityDimension,
              r.weakestPrimary,
            ]),
          ),
          excludedTestRows: dropped,
        });
      }

      case 'export': {
        /**
         * 【导出一律剔掉测试行,而且不接受任何参数来改这件事】
         * 导出的 CSV 会被拿去做 GHL 分群 —— 测试行混进去就是**给假联系人发消息**。
         * 名单页那个「显示测试数据」开关是前端的显示偏好,它【不能】影响这里:
         * 让一个开关的状态决定要不要给假联系人发消息,那种耦合太危险,
         * 而且出错时没有任何迹象(导出成功、行数看起来也合理)。
         * 所以过滤放在服务端、无条件、不看 body。
         */
        const data = await roster(supa);
        const real = data.rows.filter((r) => r.cohort?.is_test !== true);
        const dropped = data.rows.length - real.length;
        if (dropped > 0) {
          // 说出来 —— 「导了 20 行」和「导了 20 行、另有 5 行是测试数据被剔掉」不是一回事
          console.log(`admin ${verdict.email} exported ${real.length} row(s), excluded ${dropped} test row(s)`);
        }
        return json({ filename: 'compass-roster.csv', csv: rosterCsv(real), excludedTestRows: dropped });
      }

      case 'resend':
      case 'rotate': {
        const id = typeof body.entitlement_id === 'string' ? body.entitlement_id : '';
        if (!id) return json({ error: 'missing entitlement_id' }, 400);

        const { data: ent, error } = await supa
          .from('assessment_entitlements')
          .select(SEND_COLS)
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!ent) return json({ error: 'not_found' }, 404);

        let target = ent as SendTarget;

        if (action === 'rotate') {
          /**
           * 【rotate = 轮换 token,并清空 access_revoked_at】
           *
           * S4-C 原本写的是「置 access_revoked_at = now()、生成新 token、触发重发」,
           * 那两件事放在一起是自相矛盾的:校验时 access_revoked_at 非 null 一律拒绝,
           * 所以新发的链接也会被拒。
           *
           * 达成意图(旧链接失效、新链接可用)只需要换 token —— 旧 token 不再匹配
           * 任何行,自然就死了,不需要那个标记。所以这里【清空】它:
           * 一个之前被停用的人,rotate 之后应该能重新进来。
           */
          const token = generateAccessToken();
          const { error: rotErr } = await supa
            .from('assessment_entitlements')
            .update({ access_token: token, access_revoked_at: null })
            .eq('id', id);
          if (rotErr) throw rotErr;
          target = { ...target, access_token: token };
          console.log(`admin ${verdict.email} rotated the token for entitlement ${id}`);
        } else if (ent.access_revoked_at) {
          // resend 不给已停用的人发 —— 那会把一条本该死的链接又送出去
          return json({ error: 'revoked', detail: 'use rotate to issue a new link' }, 409);
        }

        const outcome = await sendMagicLink(
          supa,
          target,
          lang,
          env.GHL_RESEND_WEBHOOK_URL!,
          env.APP_BASE_URL!,
        );
        console.log(`admin ${verdict.email} ${action} for entitlement ${id}`);
        return json({ ok: outcome.ok, queued: outcome.ok ? outcome.queued : false, outcome });
      }

      case 'render_pdf': {
        /**
         * 【对任何非 ready 状态都可用,不只 failed_permanent】
         * finalize 那次异步触发是尽力而为的(EdgeRuntime.waitUntil 拿不到时可能丢),
         * 丢了的话状态会一直停在 pending —— 只允许重置 failed_permanent 的话,
         * 那种「卡住的 pending」就没有任何出路。这个按钮是那条路的兜底。
         *
         * 【不加确认框】重置只是重渲一次,代价是几十秒和一次 Chromium 冷启动,
         * 误点成本很低。加确认框反而让人形成「点确认」的肌肉记忆,
         * 而那个习惯会在真正危险的操作上害人。
         */
        const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
        if (!sessionId) return json({ error: 'missing session_id' }, 400);

        // 先把计数与错误清掉,否则 render-pdf 会因为 attempts >= 3 直接拒。
        // pdf_status_at 一并盖上 —— 定时 sweep 用它算「这个状态放了多久」,
        // 不写的话这条刚重置的 pending 会带着旧时间戳,下一次 sweep 立刻又抢着重跑一遍
        const { error: resetErr } = await supa
          .from('assessment_results')
          .update({
            pdf_status: 'pending',
            pdf_attempts: 0,
            pdf_last_error: null,
            pdf_status_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);
        if (resetErr) throw resetErr;

        const base = Deno.env.get('APP_BASE_URL');
        const secret = Deno.env.get('INTERNAL_FN_SECRET');
        if (!base || !secret) {
          console.error('CONFIG: cannot trigger PDF render: missing APP_BASE_URL or INTERNAL_FN_SECRET');
          return json({ error: 'server_misconfigured' }, 500);
        }

        // Admin 是人在等,所以这里【等】渲染结果 —— 与 finalize 不同:
        // 那边客户在等分数,不该被 PDF 拖住;这边人主动点了「重新生成」,要的就是结果
        const res = await fetch(`${base.replace(/\/$/, '')}/api/render-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
          body: JSON.stringify({ session_id: sessionId }),
        }).catch((e) => e as Error);

        if (res instanceof Error) return json({ ok: false, detail: res.message }, 502);
        const text = await res.text().catch(() => '');
        console.log(`admin ${verdict.email} re-rendered PDF for session ${sessionId}: ${res.status}`);
        return json({ ok: res.ok, status: res.status, detail: text.slice(0, 300) });
      }

      case 'revoke': {
        const id = typeof body.entitlement_id === 'string' ? body.entitlement_id : '';
        if (!id) return json({ error: 'missing entitlement_id' }, 400);
        const { error } = await supa
          .from('assessment_entitlements')
          .update({ access_revoked_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        // 不发新链接。这是「彻底停用」,不是「换一条」
        console.log(`admin ${verdict.email} revoked entitlement ${id}`);
        return json({ ok: true });
      }

      default:
        return json({ error: 'unknown_action', action }, 400);
    }
  } catch (err) {
    console.error(`admin ${action} failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});

/**
 * 问卷洞察的取数。判断在 _shared/surveySignals.ts(纯函数,有用例)。
 *
 * 【只取已完成的人】问卷是答完 15 题之后才填的,没完成的人没有 S1/S5/S6/S7。
 * 这一条与看板同向、与漏斗相反 —— **漏斗要看没完成的人掉在哪,洞察要看填过问卷的人说了什么**。
 * (判断标准 16:该照抄的是范围约束,不是过滤条件。)
 *
 * 【开放题原文原样返回】S5/S6 是学员自己写的话,后端销售最有用的就是那两栏。
 * ⚠️ **但它们绝不进现场模式** —— 那是会被投影给一屋子人的界面,
 * 而一个学员写「我们现在现金流很紧」被投在屏幕上,他会知道那是自己写的。
 * 与分享卡不放维度分数是同一条理由。
 */
async function surveyInsights(supa: ReturnType<typeof serviceClient>, scope: string) {
  const { data: cohortRows, error: cErr } = await supa
    .from('assessment_cohorts')
    .select('id, name, is_test, event_date')
    .order('created_at', { ascending: false });
  if (cErr) throw cErr;

  const { data: rowsRaw, error: rErr } = await supa
    .from('assessment_survey')
    .select(
      'session_id, responses, ' +
        'session:assessment_sessions!inner(id, status, entitlement:assessment_entitlements!inner(' +
        'id, name, phone_e164, email_lower, cohort_id, cohort:assessment_cohorts(name, is_test))), ' +
        'result:assessment_results!inner(weakest)',
    )
    .eq('session.status', 'completed');
  if (rErr) throw rErr;

  // deno-lint-ignore no-explicit-any
  const all = (rowsRaw ?? []) as any[];
  const inScope = all.filter((r) => {
    const ent = r.session?.entitlement;
    return scope === 'all' ? !isTestCohort(ent?.cohort) : ent?.cohort_id === scope;
  });

  const rows = inScope.map((r) => {
    const ent = r.session?.entitlement ?? {};
    const resp = (r.responses ?? {}) as Record<string, unknown>;
    const weakest = (r.result?.weakest ?? null) as string[] | null;
    const priority = resp.priority_dimension;
    return {
      entitlementId: ent.id as string,
      sessionId: r.session_id as string,
      name: (ent.name ?? null) as string | null,
      phoneE164: (ent.phone_e164 ?? null) as string | null,
      emailLower: (ent.email_lower ?? null) as string | null,
      cohortName: (ent.cohort?.name ?? null) as string | null,
      isTest: isTestCohort(ent.cohort),
      goal90d: (typeof resp.goal_90d === 'string' ? resp.goal_90d : null),
      biggestBlocker: (typeof resp.biggest_blocker === 'string' ? resp.biggest_blocker : null),
      consultInterest: (typeof resp.consult_interest === 'string' ? resp.consult_interest : null),
      priorityDimension: (typeof priority === 'string' ? priority : null),
      weakestPrimary: weakest?.[0] ?? null,
      alignment: priorityAlignment(priority, weakest),
      highIntent: isHighIntent(resp.consult_interest),
    };
  });

  const selected = (cohortRows ?? []).find((c) => c.id === scope) ?? null;
  return {
    scope,
    selectedIsTest: scope === 'all' ? false : isTestCohort(selected),
    cohorts: cohortRows ?? [],
    rows,
    counts: {
      total: rows.length,
      highIntent: rows.filter((r) => r.highIntent).length,
      aligned: rows.filter((r) => r.alignment === 'aligned').length,
      secondWeakest: rows.filter((r) => r.alignment === 'second_weakest').length,
      mismatched: rows.filter((r) => r.alignment === 'mismatched').length,
    },
  };
}

/**
 * 漏斗的取数。算法在 _shared/funnel.ts(纯函数,有用例)。
 *
 * ⚠️⚠️ 【取数起点是 assessment_entitlements,**不是** assessment_results】
 * 这是这个模块唯一容易写错的地方,而写错的症状是**每一段都 100%**:
 * 漏斗必须包含连 session 都还没有的人(`pending` / `link_sent` —— 他们没登录过,
 * `assessment_sessions` 里根本没有行)。从 results 起查只能看到已完成的人。
 *
 * **看板那条 `.eq('session.status', 'completed')` 绝对不能照抄过来。**
 * 该照抄的是范围约束(cohort_id 必填、'all' 展开成「不是测试批次」),
 * 不是过滤条件 —— 见判断标准 16。
 *
 * 【为什么单独查一次 answers】「已开始答题」的判据之一是「有 ≥1 条 answer」,
 * 而 PostgREST 做不了「存在性聚合」。所以取一次 `assessment_answers` 的 session_id
 * 建 Set。当前批次规模(几十到一两百人 × 15 题)完全够用;
 * **上到几千人时要把这一步推回 SQL**(与 roster 那条同一个限制,同一个理由)。
 */
async function funnelData(supa: ReturnType<typeof serviceClient>, scope: string) {
  const { data: cohortRows, error: cErr } = await supa
    .from('assessment_cohorts')
    .select('id, name, is_test, event_date')
    .order('created_at', { ascending: false });
  if (cErr) throw cErr;

  const { data: entRows, error: eErr } = await supa
    .from('assessment_entitlements')
    .select(
      'id, cohort_id, link_sent_at, first_login_at, ' +
        'cohort:assessment_cohorts(is_test), ' +
        'session:assessment_sessions(id, status, profile)',
    );
  if (eErr) throw eErr;

  // deno-lint-ignore no-explicit-any
  const all = (entRows ?? []) as any[];
  const inScope = all.filter((r) =>
    scope === 'all' ? !isTestCohort(r.cohort) : r.cohort_id === scope,
  );

  const sessionIds = inScope.map((r) => r.session?.id).filter((x): x is string => typeof x === 'string');
  const answered = new Set<string>();
  if (sessionIds.length) {
    const { data: ansRows, error: aErr } = await supa
      .from('assessment_answers')
      .select('session_id')
      .in('session_id', sessionIds);
    if (aErr) throw aErr;
    for (const a of (ansRows ?? []) as { session_id: string }[]) answered.add(a.session_id);
  }

  const rows: FunnelRowInput[] = inScope.map((r) => ({
    linkSentAt: r.link_sent_at ?? null,
    firstLoginAt: r.first_login_at ?? null,
    sessionStatus: r.session?.status ?? null,
    /**
     * profile 是 jsonb。**空对象要算「没填」** —— quiz 是逐题 merge 写进去的,
     * 所以中途可能是 `{}`;把 `{}` 当成填过会把「登录了什么都没做」误判成「已开始答题」。
     */
    profileFilled: !!r.session?.profile && Object.keys(r.session.profile).length > 0,
    hasAnswer: r.session?.id ? answered.has(r.session.id) : false,
  }));

  const selected = (cohortRows ?? []).find((c) => c.id === scope) ?? null;
  return {
    scope,
    selectedIsTest: scope === 'all' ? false : isTestCohort(selected),
    selectedName: scope === 'all' ? null : (selected?.name ?? null),
    cohorts: cohortRows ?? [],
    funnel: buildFunnel(rows),
  };
}

/**
 * 批次聚合看板的取数 + 分池。算法在 _shared/cohortAggregate.ts(纯函数,有用例)。
 *
 * 【`'all'` 展开成「排除测试批次」,不是「不加过滤」】这两者的差别就是这个模块存在的理由:
 * 不加过滤会把演示数据混进投影出去的聚合数字里,而那个数字看起来完全正常。
 *
 * ⚠️ **`cohort_id` 为 null 的行算真实数据,要留在 `'all'` 里。**
 * 那是「批次被删了的真实学员」(cohort_id 是 on delete set null)。
 * 按「所有 is_test = false 的批次」的字面意思去列 id 会把他们**静默丢掉** ——
 * 所以判据写成「不是测试批次」,而不是「在这批 id 里」。
 * 少算一个真实学员和多算一个测试学员一样糟,只是更不容易被发现。
 */
async function cohortDashboard(supa: ReturnType<typeof serviceClient>, scope: string) {
  const { data: cohortRows, error: cErr } = await supa
    .from('assessment_cohorts')
    .select('id, name, is_test, event_date')
    .order('created_at', { ascending: false });
  if (cErr) throw cErr;

  const { data: resultRows, error: rErr } = await supa
    .from('assessment_results')
    .select(
      'session_id, dim_scores, total, tier, weakest, ' +
        'session:assessment_sessions!inner(id, status, entitlement:assessment_entitlements!inner(cohort_id, cohort:assessment_cohorts(is_test)))',
    )
    .eq('session.status', 'completed');
  if (rErr) throw rErr;

  // deno-lint-ignore no-explicit-any
  const rows = (resultRows ?? []) as any[];
  const inScope = rows.filter((r) => {
    const ent = r.session?.entitlement;
    if (scope === 'all') return !isTestCohort(ent?.cohort);
    return ent?.cohort_id === scope;
  });

  const sessionIds = inScope.map((r) => r.session_id as string);
  let answers: { question_id: string; option_index: number }[] = [];
  if (sessionIds.length) {
    const { data: ansRows, error: aErr } = await supa
      .from('assessment_answers')
      .select('question_id, option_index')
      .in('session_id', sessionIds);
    if (aErr) throw aErr;
    answers = (ansRows ?? []) as { question_id: string; option_index: number }[];
  }

  const aggregate = aggregateCohort(
    inScope.map((r) => ({
      dim_scores: r.dim_scores,
      total: r.total,
      tier: r.tier,
      weakest: r.weakest,
    })),
    answers,
    config.dimensions.map((d) => d.key),
    config.tiers.map((t) => t.key),
    config.questions.map((q) => ({ id: q.id, option_count: q.option_count })),
    config.cohorts.min_n_for_baseline,
  );

  const selected = (cohortRows ?? []).find((c) => c.id === scope) ?? null;
  return {
    scope,
    /** 选中的是测试批次时前端要显著标出来 —— 否则会忘了自己在看假数据 */
    selectedIsTest: scope === 'all' ? false : isTestCohort(selected),
    selectedName: scope === 'all' ? null : (selected?.name ?? null),
    cohorts: cohortRows ?? [],
    aggregate,
  };
}

/**
 * 名单 + 统计。
 *
 * 【筛选放前端做,不放 SQL】分数区间的筛选要跨到 assessment_results,
 * 而 PostgREST 对嵌套表的过滤很别扭。当前批次规模是几十到一两百人,
 * 一次全取再在前端筛是够的,而且省一张视图(视图要走 migration)。
 * **这条在批次上到几千人时要改** —— 到那时应该建视图并把筛选推回 SQL。
 */
async function roster(supa: ReturnType<typeof serviceClient>) {
  const { data, error } = await supa
    .from('assessment_entitlements')
    .select(
      `id, name, phone_e164, phone_raw, email_lower, status,
       first_login_at, completed_at, link_sent_at, access_revoked_at,
       cohort:assessment_cohorts(id, name, is_test),
       session:assessment_sessions(
         id,
         status,
         result:assessment_results(total, tier, weakest, pdf_status, pdf_last_error, share_card_error)
       )`,
    )
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RosterRow[];
  /**
   * 【统计只看真实行】号码解析失败率是一条运营阈值(>2% 就说明 GHL 里号码质量比预期差),
   * 而测试数据的号码是我们自己造的、必然干净 —— 混进去只会把比例稀释,
   * 让一个真实的数据质量问题看起来不到阈值。
   */
  const realRows = rows.filter((r) => r.cohort?.is_test !== true);
  const total = realRows.length;
  const unparseablePhones = realRows.filter((r) => r.phone_e164 === null).length;

  return {
    rows,
    /** 测试行照常返回 —— 前端那个开关要能把它们显示出来;统计与导出各自剔除 */
    testRows: rows.length - realRows.length,
    stats: {
      total,
      unparseablePhones,
      /**
       * 号码解析失败的占比。阈值 2%:超过就说明 GHL 里的号码质量比预期差,
       * 那时才回来讨论要不要加 ext 预处理。见 PROGRESS.md Stage 2 的 ext 用例记录。
       */
      unparseableRatio: total ? unparseablePhones / total : 0,
      thresholdExceeded: total > 0 && unparseablePhones / total > 0.02,
    },
  };
}

function rosterCsv(rows: RosterRow[]): string {
  return toCsv(
    ['姓名', '手机', '手机原值', '邮箱', '批次', '状态', '登录时间', '完成时间', '总分', '档位', '最弱维度', '已停用', 'PDF 状态', 'PDF 最后错误', '分享卡错误'],
    rows.map((r) => [
      r.name,
      r.phone_e164,
      // 解析失败时原值才是唯一线索,导出必须带上
      r.phone_e164 ? null : r.phone_raw,
      r.email_lower,
      r.cohort?.name ?? null,
      r.status,
      r.first_login_at,
      r.completed_at,
      r.session?.result?.total ?? null,
      r.session?.result?.tier ?? null,
      r.session?.result?.weakest?.join(' / ') ?? null,
      r.access_revoked_at ? 'yes' : null,
      r.session?.result?.pdf_status ?? null,
      r.session?.result?.pdf_last_error ?? null,
      // 分享卡失败不影响 PDF,所以它必须单独一列 —— 混进 PDF 那列会让人以为 PDF 也坏了
      r.session?.result?.share_card_error ?? null,
    ]),
  );
}
