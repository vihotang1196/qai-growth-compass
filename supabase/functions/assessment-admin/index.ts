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
  cohort: { id: string; name: string } | null;
  session: {
    id: string;
    status: string;
    result: {
      total: number;
      tier: string;
      weakest: string[];
      pdf_status: string;
      pdf_last_error: string | null;
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

      case 'export': {
        const data = await roster(supa);
        return json({ filename: 'compass-roster.csv', csv: rosterCsv(data.rows) });
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
       cohort:assessment_cohorts(id, name),
       session:assessment_sessions(
         id,
         status,
         result:assessment_results(total, tier, weakest, pdf_status, pdf_last_error)
       )`,
    )
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RosterRow[];
  const total = rows.length;
  const unparseablePhones = rows.filter((r) => r.phone_e164 === null).length;

  return {
    rows,
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
    ['姓名', '手机', '手机原值', '邮箱', '批次', '状态', '登录时间', '完成时间', '总分', '档位', '最弱维度', '已停用', 'PDF 状态', 'PDF 最后错误'],
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
    ]),
  );
}
