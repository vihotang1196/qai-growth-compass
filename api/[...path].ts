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
const ALLOWED = new Set(['assessment-auth', 'assessment-login-request']);

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

  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const name = segments[0] ?? '';

  if (!ALLOWED.has(name)) {
    // 不回显 ALLOWED 的内容 —— 那是一份内部路由表
    return res.status(404).json({ error: 'not_found' });
  }
  if (segments.length > 1) {
    // 函数名之后不接受子路径:目前没有函数需要它,允许它只会扩大转发面
    return res.status(404).json({ error: 'not_found' });
  }

  const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
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

    // Set-Cookie 可能有多条,必须逐条透传 —— 合并成一条会让浏览器整条丢弃
    const setCookies = upstreamRes.headers.getSetCookie?.() ?? [];
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);

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
