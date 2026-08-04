import { adminAccessToken } from '@/lib/supabase';

/**
 * 后台请求 —— 走 `/api/assessment-admin`,带上 Supabase Auth 的 access token。
 *
 * 【为什么用 X-Admin-Token 而不是 Authorization】代理会把 Authorization 换成
 * anon key(Edge Functions 网关要求它),所以后台的 JWT 必须走另一个头,
 * 否则会被覆盖掉。
 */
export class AdminAuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'unauthorized' : 'forbidden');
  }
}

export async function adminPost<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = await adminAccessToken();
  const res = await fetch('/api/assessment-admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Admin-Token': token } : {}),
    },
    body: JSON.stringify({ action, ...args }),
  });

  if (res.status === 401 || res.status === 403) {
    /**
     * 【401 与 403 必须分开处理】401 该跳登录页;403 不该 ——
     * 一个不在允许名单里的账号再登一百次也是 403,把它当 401 会造成
     * 「登录成功 → 被弹回 → 再登录」的死循环,而那种循环极难自查。
     */
    throw new AdminAuthError(res.status);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`non-JSON response from admin (${res.status})`);
  }
  if (!res.ok) {
    throw new Error((parsed as { error?: string } | null)?.error ?? `admin failed (${res.status})`);
  }
  return parsed as T;
}
