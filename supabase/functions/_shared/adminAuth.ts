/**
 * 后台授权判定 —— 纯函数部分。
 *
 * 【为什么拆出来】授权是两步:验 JWT(要网络,验签)+ 查允许名单(要数据库)。
 * 两步都拿到结果之后的【判定】是纯逻辑,而那正是最容易写错的地方 ——
 * 比如「JWT 有效就放行」漏掉名单、或者「名单查不到当成空」而不是拒绝。
 * 拆出来才测得到。
 */

export type AdminVerdict =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; reason: string };

export interface AdminAuthInput {
  /** JWT 验签通过后拿到的邮箱;验签失败或 token 缺失时为 null */
  jwtEmail: string | null;
  /** 该邮箱是否在 admin_users 里。jwtEmail 为 null 时这个值无意义 */
  inAllowlist: boolean;
}

/**
 * 【401 与 403 的区别是刻意的】
 *   401 —— 没有有效身份。前端应该跳登录页
 *   403 —— 身份有效但不在名单里。前端不该跳登录页(再登也是 403),
 *          应该显示「这个账号没有后台权限」
 *
 * 把两者合成一个会让「不在名单」的人被无限弹回登录页,而每次登录都成功、
 * 每次又被弹回 —— 那种循环极难自查。
 */
export function adminVerdict(input: AdminAuthInput): AdminVerdict {
  if (!input.jwtEmail) {
    return { ok: false, status: 401, reason: 'no valid session' };
  }
  if (!input.inAllowlist) {
    return { ok: false, status: 403, reason: 'not on the admin allowlist' };
  }
  return { ok: true, email: input.jwtEmail };
}

/**
 * 邮箱归一化 —— 与 webhook 入库时用的是同一条规则。
 *
 * 【为什么必须归一化再比】Supabase Auth 返回的邮箱大小写取决于用户注册时怎么打的,
 * 而 admin_users.email 是手动 insert 的。一边 `Foo@Bar.com` 一边 `foo@bar.com`
 * 就会永远 403 —— 而那看起来像「我明明插了记录」。
 */
export function normalizeAdminEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}
