/**
 * ⚠️ 【为什么这份实现在 api/_lib 而不是 src/lib】Vercel 的 Node runtime **只编译
 * `/api` 目录内**的 TypeScript(官方文档原话:"supports TypeScript files for server
 * entrypoints and files inside of the /api directory")。放在 src/ 的 .ts 不会被编译成
 * 函数可加载的 .js —— 实测就是 ERR_MODULE_NOT_FOUND,而 tsc / vite build / dep-sync
 * 四道门全绿。所以规范实现放这里,src 与 Deno 从这里导入,而不是反过来。
 *
 * 同一原因:import 必须带显式扩展名(package.json 是 "type": "module")。
 * tsconfig.api.json 用 moduleResolution: "bundler",它【允许】省略扩展名 ——
 * 那正是 tsc 放行这个 bug 的原因。scripts/check-api-imports.mjs 现在守这条。
 */

/**
 * 渲染令牌 —— PDF 渲染器打开报告页时用的身份。
 *
 * 【为什么不用 cookie】渲染器是服务端的 headless Chromium,没有客户的 cookie。
 * 给它一条独立的、只读的、短时效的入口比把 service role 塞进浏览器安全得多。
 *
 * 【为什么不复用 compass_session】那个 cookie 30 天有效、代表「客户本人」。渲染令牌
 * 只需要活几十秒、只用于读一份报告 —— 权限与时效都应该更窄。混用会让一个泄漏的
 * 渲染令牌等价于一个 30 天的登录态。
 *
 * 形状:`base64url(payload).base64url(hmac)`,payload = `${sessionId}.${expEpochSec}`。
 * 与 session cookie 同样用 HMAC-SHA256,但**用不同的密钥**(INTERNAL_FN_SECRET),
 * 所以两者不可互换 —— 拿渲染令牌当 session cookie 用会验签失败。
 */

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(v: string): Uint8Array<ArrayBuffer> {
  const padded = v.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** 默认时效:够一次渲染(冷启动 + 加载 + 出 PDF),不够被人捡去复用 */
export const RENDER_TOKEN_TTL_SEC = 180;

export async function signRenderToken(
  sessionId: string,
  secret: string,
  nowMs: number,
  ttlSec = RENDER_TOKEN_TTL_SEC,
): Promise<string> {
  const payload = `${sessionId}.${Math.floor(nowMs / 1000) + ttlSec}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)));
  return `${b64url(enc.encode(payload))}.${b64url(sig)}`;
}

/**
 * 验签 + 查过期。返回 sessionId,失败一律 null(不区分「签名错」与「过期」——
 * 那个区别对攻击者有用,对我们没用)。
 */
export async function verifyRenderToken(
  token: string | null | undefined,
  secret: string,
  nowMs: number,
): Promise<string | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!sigB64) return null;

  let payload: string;
  try {
    payload = new TextDecoder().decode(unb64url(payloadB64));
  } catch {
    return null;
  }

  let ok = false;
  try {
    // crypto.subtle.verify 内部是定长比较,不用自己写
    ok = await crypto.subtle.verify('HMAC', await key(secret), unb64url(sigB64), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;

  const sep = payload.lastIndexOf('.');
  if (sep <= 0) return null;
  const sessionId = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!Number.isFinite(exp) || Math.floor(nowMs / 1000) > exp) return null;
  return sessionId || null;
}
