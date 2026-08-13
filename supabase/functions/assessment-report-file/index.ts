/**
 * assessment-report-file —— **学员自己**触发生成某种语言的报告文件。
 *
 * POST { lang: 'zh' | 'en' }   鉴权:session cookie
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么不复用 Admin 那个 `render_pdf` action】
 *
 * 那个 action 现在是 Admin 鉴权。复用意味着要在里面加「或者是本人」——
 * 而那一刻,一个原本只有管理员能碰的入口就多了一条学员能走的路。
 * 以后有人给它加功能(「重渲所有语言」「强制覆盖」),**不会想到它现在也对学员开放**。
 * 那是权限扩散最典型的方式:不是有人放宽了鉴权,是有人给一个已经放宽过的入口加了新能力。
 *
 * 留痕也不一样:Admin 触发要记「谁点的」,学员触发要记「哪个 session」——
 * 塞进同一条日志会让两种事件在事后分不开。
 *
 * 【鉴权用 session cookie,不是 renderToken —— 这一处与最初的设想不同】
 * 设想是「用 renderToken,跟报告页取数同一把」。查证之后:`assessment-report`
 * 接受**两条**入口(cookie 或 `?rt=`),而**学员在浏览器里能用的只有 cookie** ——
 * `rt` 只出现在 PDF 渲染器和 Admin 的 report_link 那两条路径上。
 * 若这里只认 rt,真实学员一次都点不动这个按钮。
 *
 * 而 renderToken 想要的那个保证(「只能触发自己那份」)cookie 同样给得出:
 * session 从 cookie 里来,而不是从参数里来。**下面第 2 条就是这个意思。**
 *
 * 【三条约定】
 *   1. 鉴权只认 cookie —— 且**刻意不接受 `?rt=`**:Admin 用自己的 action,
 *      两条路径的留痕与鉴权因此从一开始就分开
 *   2. 只接受 `lang`,**不接受 `session_id`** —— session 从 cookie 来。
 *      接受 session_id 就等于把「触发谁的渲染」变成一个可以传错的参数
 *   3. 幂等:`ready` 直接返回不重渲;`rendering` / `pending` 返回「正在生成」。
 *      前端据此显示状态,不需要自己记
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { serviceClient } from '../_shared/supa.ts';
import { readSessionCookie, verifySession } from '../_shared/session.ts';
import { missingKeys } from '../_shared/env.ts';
import { parseLang } from '../_shared/lang.ts';
import { availabilityOf } from '../_shared/reportFiles.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', expected: 'POST' }, 405);

  const env = {
    SESSION_SECRET: Deno.env.get('SESSION_SECRET'),
    INTERNAL_FN_SECRET: Deno.env.get('INTERNAL_FN_SECRET'),
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

  // ── 鉴权:只认 cookie ────────────────────────────────────────
  const verified = await verifySession(readSessionCookie(req), env.SESSION_SECRET!, Date.now());
  if (!verified) return json({ error: 'unauthorized' }, 401);

  /**
   * 【lang 缺失 / 不合法一律 400】这里与 webhook 那个决定**方向相反**,而且是有意的:
   * webhook 是付款入口,拒收的代价是「客户付了钱系统里没有他」;
   * 这个端点只被我们自己的报告页调用,一个不合法的 lang 意味着**我们自己的代码写错了**,
   * 静默回落成中文只会让那个 bug 活得更久。
   */
  const langParse = parseLang(body.lang);
  if (langParse.kind !== 'set') {
    return json(
      {
        error: 'invalid_lang',
        detail: langParse.kind === 'invalid' ? `received ${langParse.received}` : 'lang is required',
      },
      400,
    );
  }
  const lang = langParse.lang;

  const supa = serviceClient();

  try {
    // session 从 cookie 来 —— 而不是从参数来(约定 2)
    const { data: session, error: sErr } = await supa
      .from('assessment_sessions')
      .select('id, status')
      .eq('entitlement_id', verified.entitlementId)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!session) return json({ error: 'no_session' }, 404);

    const { data: row, error: rErr } = await supa
      .from('assessment_report_files')
      .select('lang, pdf_status, pdf_path, pdf_attempts, pdf_last_error')
      .eq('session_id', session.id)
      .eq('lang', lang)
      .maybeSingle();
    if (rErr) throw rErr;

    /**
     * ── 幂等(约定 3)──
     * `availabilityOf` 是那份共用判定,所以这里的分类与报告页按钮、Roster 那一格
     * 用的是同一套(五个库状态压成四个 + absent)。
     */
    const availability = availabilityOf(row ?? undefined);
    if (availability === 'ready') {
      // 已经有了就不重渲 —— 这正是按语言分行要换来的那件事
      return json({ status: 'ready', lang, alreadyThere: true });
    }
    if (availability === 'working') {
      return json({ status: 'working', lang, alreadyThere: true });
    }
    if (availability === 'exhausted') {
      /**
       * 次数用完 / 被标死 —— 学员再点也不会好,所以**不触发**,并明说要人介入。
       * 【为什么不悄悄再试一次】那会把一次「需要人看」变成一串失败记录,
       * 而每一次都是一次 Lambda。
       */
      return json({ status: 'exhausted', lang, detail: 'needs an operator to reset' }, 409);
    }

    // ── absent / failed:触发一次 ────────────────────────────
    console.log(`report-file: session ${session.id} requested ${lang} (was ${availability})`);

    const res = await fetch(`${env.APP_BASE_URL!.replace(/\/$/, '')}/api/render-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.INTERNAL_FN_SECRET! },
      // lang 必传:render-pdf 没有默认值(见那边的注释:一个 session 有两行)
      body: JSON.stringify({ session_id: session.id, lang }),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`report-file: render-pdf returned ${res.status} for ${session.id}/${lang}: ${text.slice(0, 300)}`);
      return json({ status: 'failed', lang, upstream: res.status }, 502);
    }
    /**
     * 【等 render-pdf 返回,不 fire-and-forget】渲染约 16 秒,而 Edge Function 的
     * 响应返回后可能立刻被终止 —— 不 await 的话触发变成「有时成功」。
     * 学员那边看到的是一个转圈的按钮,那 16 秒是可接受的;
     * 而「有时不生成」不可接受(与 finalize 那次同一个取向:不确定比等待更糟)。
     */
    return json({ status: 'ready', lang, alreadyThere: false });
  } catch (err) {
    console.error(`report-file failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});
