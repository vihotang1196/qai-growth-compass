import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * `/api/*` → Supabase Edge Functions 的代理(PROGRESS.md D1)。
 *
 * 【为什么必须有这一跳】客户的 session 是 httpOnly cookie。Edge Function 在
 * <ref>.supabase.co,前端在 compass.qiai.tech —— 直连的话那个 cookie 是跨站的,
 * Safari 与 Chrome 的第三方 cookie 拦截会时不时吃掉它。症状是登录态随机丢失,
 * 而且极难复现。经过这一跳之后,Set-Cookie 是从 compass.qiai.tech 发出的,
 * 浏览器当它第一方,永远不会被拦。
 *
 * 顺带两个好处:service role key 完全不出现在浏览器;Edge Function 全部
 * verify_jwt = false,鉴权各自在函数内部做。
 *
 * 【不代理 GHL webhook】那是服务器到服务器,没有 cookie 参与,GHL 直连
 * Supabase 就好 —— 走代理只是多一跳、多一个故障点。见 docs/ghl-setup.md。
 */

/**
 * 只允许代理到明确列出的函数。开放式转发等于把整个 Supabase 项目暴露出去。
 *
 * 【只放浏览器会直接调的函数】assessment-ghl-webhook 不在这里(GHL 直连 Supabase,
 * 服务器到服务器没有 cookie 参与);assessment-maintenance 也不在(它由
 * api/cron/retention.ts 用 INTERNAL_FN_SECRET 调,不该从浏览器可达)。
 */
const ALLOWED = new Set(['assessment-auth', 'assessment-login-request', 'assessment-admin']);

/**
 * 允许透传给浏览器的 cookie 名 —— 白名单,只放我们自己签发的。
 *
 * 【为什么要过滤】上游是 Supabase,它的边缘层(Cloudflare)会带自己的 cookie,
 * 实测见到过 `__cf_bm; Domain=supabase.co`。那一条其实无害:浏览器收到它是从
 * compass.qiai.tech 发出的,而 RFC 6265 不允许给自己不属于的域设 cookie,
 * 浏览器会直接丢弃。
 *
 * 真正要防的是另一种:**上游设一个不带 Domain 属性的 cookie** —— 那是 host-only,
 * 浏览器会把它记在 compass.qiai.tech 上,等于我们替第三方在自己的第一方域上
 * 种了一个 cookie。那是不可控的面。
 *
 * 而且不过滤已经产生过一次假信号:smoke 里「无效 token 不该下 cookie」那条断言
 * 被 __cf_bm 撞红。以后有人在 DevTools 里看到不认识的 cookie 也会花同样的时间。
 *
 * 【这是一条手写清单,代价是自觉的】新加我们自己的 cookie 时要记得加进来。
 * 但这条清单的失败形态是「我新加的 cookie 没到浏览器」——开发时立刻会撞到,是响的;
 * 而不过滤的失败形态是静默的。所以这个方向的取舍值得。
 * 漏加时看 `proxy dropped upstream cookies` 那条日志,它会直接点名。
 *
 * 名字必须与 supabase/functions/_shared/session.ts 的 SESSION_COOKIE 一致。
 * 不 import 是因为那是 Deno 侧的模块,跨运行时引一个常量会把
 * check:dep-sync 的扫描范围搅乱,不值得。
 */
const FORWARDED_COOKIES = new Set(['compass_session']);

/** 从 Set-Cookie 那一整行里取出 cookie 名 */
function cookieName(setCookie: string): string {
  const eq = setCookie.indexOf('=');
  return (eq > 0 ? setCookie.slice(0, eq) : setCookie).trim();
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'host',
  'content-length',
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 变量名以字面量出现,check:env 才扫得到;missing 从键推导,
  // 所以日志里只列真正缺的那些 —— 两个一起列的话排查时还得逐个比对
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`server_misconfigured: missing ${missing.join(', ')} (Vercel env)`);
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  const base = env.SUPABASE_URL!;
  const anonKey = env.SUPABASE_ANON_KEY!;

  /**
   * 【不依赖 req.query.path 的形状】
   *
   * 第一版用的是 req.query.path,结果生产上 assessment-auth 明明在 ALLOWED 里却 404 ——
   * 解析出来的 name 不对。Vercel 对非 Next.js 项目的 [...slug] 到底怎么填 req.query
   * (数组?斜杠拼接的字符串?键名一定是 path 吗?)我没有把握,而照着 Next.js 的模型
   * 去推正是上一次判断 GHL 响应映射时犯的错。
   *
   * 所以改成从 pathname 解析 —— 那是请求里实打实的东西,不依赖平台怎么填 query。
   * 并且对「带不带 /api 前缀」两种形态都成立,因为这一点我同样没有把握。
   */
  const parsed = new URL(req.url ?? '/', 'http://proxy.invalid');
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'api') parts.shift();
  const name = parts[0] ?? '';

  // 函数名之后不接受子路径:目前没有函数需要它,允许它只会扩大转发面
  if (!ALLOWED.has(name) || parts.length > 1) {
    // 响应体不回显 ALLOWED 的内容(那是内部路由表),但日志里必须够诊断 ——
    // 第一版这里只回一个 not_found,导致只能靠猜。把实际收到的东西都记下来。
    console.error(
      `proxy 404: url=${req.url} pathname=${parsed.pathname} ` +
        `parsedName=${JSON.stringify(name)} parts=${JSON.stringify(parts)} ` +
        `queryKeys=${JSON.stringify(Object.keys(req.query ?? {}))} ` +
        `queryPath=${JSON.stringify(req.query?.path)}`,
    );
    return res.status(404).json({ error: 'not_found' });
  }

  const query = parsed.search;
  const upstream = `${base.replace(/\/$/, '')}/functions/v1/${name}${query}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  // Edge Functions 网关要求 apikey;anon key 是公开凭证,但由代理注入而不是
  // 让浏览器带上 —— 少一个前端需要知道的东西
  headers.set('apikey', anonKey);
  headers.set('Authorization', `Bearer ${anonKey}`);

  // 真实客户 IP 透传给函数用于限流。Vercel 的 x-forwarded-for 已经在 headers 里,
  // 这里显式再钉一次,避免上游改写
  const clientIp =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? '';
  if (clientIp) headers.set('X-Client-Ip', clientIp);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody
    ? typeof req.body === 'string'
      ? req.body
      : req.body
        ? JSON.stringify(req.body)
        : undefined
    : undefined;
  if (hasBody && body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  try {
    const upstreamRes = await fetch(upstream, { method: req.method, headers, body });

    // Set-Cookie 可能有多条,必须逐条透传 —— 合并成一条会让浏览器整条丢弃。
    // 但只透传【我们自己签发的】那些,见 FORWARDED_COOKIES。
    const setCookies = upstreamRes.headers.getSetCookie?.() ?? [];
    const kept = setCookies.filter((c) => FORWARDED_COOKIES.has(cookieName(c)));
    const dropped = setCookies.filter((c) => !FORWARDED_COOKIES.has(cookieName(c)));
    if (kept.length) res.setHeader('Set-Cookie', kept);
    if (dropped.length) {
      // 只记名字不记值 —— 值可能是敏感的。
      // 这条日志的用途:哪天我们自己新加了一个 cookie 却忘了加进白名单,
      // 症状会是「cookie 没到浏览器」,而这里会直接说出被丢掉的是谁
      console.log(`proxy dropped upstream cookies: ${dropped.map(cookieName).join(', ')}`);
    }

    upstreamRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'set-cookie' || HOP_BY_HOP.has(lower) || lower === 'content-encoding') return;
      res.setHeader(key, value);
    });

    const buffer = Buffer.from(await upstreamRes.arrayBuffer());
    return res.status(upstreamRes.status).send(buffer);
  } catch (err) {
    console.error(`proxy to ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
}
