/**
 * 后端调用的统一入口。
 *
 * 所有请求都走 `/api/*` —— 同源,所以 httpOnly session cookie 会自动带上,
 * 也不需要 CORS。绝不直连 <ref>.supabase.co:那样 cookie 就是跨站的,
 * 会被 Safari / Chrome 的第三方 cookie 拦截随机吃掉。见 PROGRESS.md D1。
 */

export interface ApiError {
  error: string;
  detail?: string;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 同源本来就会带 cookie,写出来是为了让「这个请求依赖 cookie」显式可见
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`non-JSON response from /api/${path} (${res.status})`);
  }

  if (!res.ok) {
    const err = parsed as ApiError | null;
    throw new Error(err?.error ?? `request to /api/${path} failed (${res.status})`);
  }
  return parsed as T;
}
