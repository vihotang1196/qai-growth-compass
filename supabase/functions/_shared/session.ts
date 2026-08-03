/**
 * 客户 session cookie。
 *
 * 【为什么是签名的无状态 cookie,而不是另建一张 session 表】
 * 每个受保护的请求本来就要读 entitlement(要查 access_revoked_at),所以
 * 「无状态 cookie + 每次校验时查库」并不比「session 表」多一次查询,却少一张表。
 *
 * 【撤销怎么生效】cookie 里只放 entitlement_id。每次校验都会读那条 entitlement
 * 并检查 access_revoked_at —— 所以 Admin 作废之后,已经发出去的 cookie 会在
 * 下一个请求就失效,不需要维护一份「已吊销 session」清单。
 *
 * 【为什么 cookie 能是第一方的】Edge Function 在 <ref>.supabase.co,前端在
 * compass.qiai.tech,直连的话这个 cookie 是跨站的,Safari 与 Chrome 的第三方
 * cookie 拦截会时不时吃掉它 —— 登录态随机掉,而且极难复现。所以客户端请求一律
 * 走 Vercel 的 /api/* 代理(D1),Set-Cookie 由代理透传,浏览器看到的是
 * compass.qiai.tech 自己的 cookie。
 */

export const SESSION_COOKIE = 'compass_session';
export const SESSION_DAYS = 30;

interface SessionPayload {
  /** entitlement id */
  e: string;
  /** 过期时间,epoch 秒 */
  x: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 返回类型显式写 Uint8Array<ArrayBuffer> 而不是 Uint8Array:
 * Uint8Array.from() 推出来的是 Uint8Array<ArrayBufferLike>,而 ArrayBufferLike
 * 包含 SharedArrayBuffer,不满足 crypto.subtle 要的 BufferSource。
 * 所以这里手写循环 —— new Uint8Array(n) 的 buffer 一定是 ArrayBuffer。
 */
function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** 签一个 30 天有效的 session。返回 cookie 的值(不含属性) */
export async function signSession(
  entitlementId: string,
  secret: string,
  nowMs: number,
  days = SESSION_DAYS,
): Promise<string> {
  const payload: SessionPayload = {
    e: entitlementId,
    x: Math.floor(nowMs / 1000) + days * 86400,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * 校验 session。任何一环不对都返回 null,不区分原因 ——
 * 区分「签名错」与「过期」对调用方没用,对攻击者有用。
 */
export async function verifySession(
  cookieValue: string | null | undefined,
  secret: string,
  nowMs: number,
): Promise<{ entitlementId: string } | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!sig) return null;

  let ok = false;
  try {
    // crypto.subtle.verify 内部是定长比较,不用自己写
    ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      b64urlDecode(sig),
      new TextEncoder().encode(body),
    );
  } catch {
    return null; // sig 不是合法 base64url
  }
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (typeof payload.e !== 'string' || !payload.e) return null;
    if (typeof payload.x !== 'number') return null;
    if (payload.x * 1000 <= nowMs) return null;
    return { entitlementId: payload.e };
  } catch {
    return null;
  }
}

/**
 * Set-Cookie 的属性。
 *   HttpOnly  —— JS 读不到,XSS 偷不走
 *   Secure    —— 只走 HTTPS
 *   SameSite=Lax —— 顶层导航带上(魔法链接是从 WhatsApp 点进来的),跨站 POST 不带
 *   不写 Domain —— host-only,只绑 compass.qiai.tech,不外泄到别的子域
 */
export function sessionCookieHeader(value: string, days = SESSION_DAYS): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${days * 86400}`,
  ].join('; ');
}

export function clearedSessionCookieHeader(): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=0'].join('; ');
}

/** 从请求头里取出 session cookie 的值 */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
