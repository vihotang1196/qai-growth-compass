/**
 * 后台的密码登录与「设置密码」—— 两个纯判定,外加把它们接到 supabase-js 上的薄接缝。
 * 与 `adminAuthMessages.ts`(magic link)同一个做法:**接缝从不抛,只返回一个文案 key**,
 * 组件手里根本拿不到错误对象,也就没有原始报错可以被渲染出来。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么加密码登录】(Viho 2026-10-14)平时进后台不想每次等邮件。magic link 保留为备用入口:
 * 忘了密码、或还没设置过密码时用它,进后台之后在「设置密码」里改 —— 所以**没有单独的重置密码页**,
 * 也就没有「重置邮件里的链接」这条新的、要单独守的路径。
 *
 * 【管理员判定不变】密码只决定「你是谁」;能不能进后台仍由 `assessment-admin` 每次请求验 JWT +
 * 查 `admin_users`。不在名单的人用密码登录成功之后,照样拿到 403(与 magic link 一样)。
 *
 * 【登录失败只有一句】需求原文:不区分「邮箱不存在」与「密码错误」。GoTrue 对这两种本来就回同一个
 * 400 `invalid_credentials`;但 `email_not_confirmed` 只会对**存在的**邮箱出现,限流、5xx 也各有各的
 * 样子 —— 所以规则与 magic link 那边相同:**只要拿到了 HTTP 响应,不管是什么,都显示同一句**。
 * 与那边一样,这只修了文案层:Network 面板与耗时上的差别前端修不了(PROGRESS「线上 Auth 配置」)。
 *
 * 【「设置密码」的报错可以分开说】那时人已经登录、改的是自己的密码,说清楚「太弱」「和原来一样」
 * 「要重新登录」不泄露任何别人的东西,而且每一句都指向一个能做的动作。
 *
 * 【长度】下限 12 是我们自己的规则(Dashboard 的最短长度建议设成同一个数,见 PROGRESS);
 * 上限 72 **字节**是 bcrypt 的:超出的部分会被静默截断,按字符数数会放过一个 25 个汉字的密码。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { classifyAuthError } from './adminAuthMessages';

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_BYTES = 72;

export type AdminPasswordSignInResult =
  | 'ok'
  | 'admin.login.passwordFailed'
  | 'admin.login.networkError'
  | 'admin.login.unexpected';

/** 输入是 `signInWithPassword` 返回的 `error`(成功时为 null),或者它抛出来的东西 */
export function passwordSignInResult(error: unknown): AdminPasswordSignInResult {
  const kind = classifyAuthError(error);
  if (kind === 'none') return 'ok';
  if (kind === 'response') return 'admin.login.passwordFailed';
  if (kind === 'network') return 'admin.login.networkError';
  return 'admin.login.unexpected';
}

/**
 * 发请求 + 判定。邮箱去掉首尾空格;**密码原样** —— 密码里的空格是密码的一部分。
 * 任一项为空时不发请求(按钮本来就是灰的;这一层不依赖那个)。
 * `log` 只写 DevTools Console,给排查的人看。
 */
export async function signInAdminWithPassword(
  signIn: (credentials: { email: string; password: string }) => Promise<{ error: unknown }>,
  email: string,
  password: string,
  log: (...args: unknown[]) => void = (...args) => console.warn(...args),
): Promise<AdminPasswordSignInResult> {
  const trimmed = email.trim();
  if (!trimmed || !password) return 'admin.login.passwordFailed';
  let error: unknown = null;
  try {
    ({ error } = await signIn({ email: trimmed, password }));
  } catch (thrown) {
    error = thrown;
  }
  const result = passwordSignInResult(error);
  if (error !== null && error !== undefined) log('[admin-password-login]', result, error);
  return result;
}

export type AdminPasswordUpdateNotice =
  | 'admin.password.saved'
  | 'admin.password.mismatch'
  | 'admin.password.tooShort'
  | 'admin.password.tooLong'
  | 'admin.password.weak'
  | 'admin.password.same'
  | 'admin.password.reauth'
  | 'admin.password.sessionLost'
  | 'admin.password.failed'
  | 'admin.login.networkError';

/** 本地先查一遍:不一致 / 太短 / 超过 bcrypt 的字节上限。返回 null = 可以发 */
export function checkNewPassword(
  password: string,
  confirm: string,
): 'admin.password.mismatch' | 'admin.password.tooShort' | 'admin.password.tooLong' | null {
  if (password !== confirm) return 'admin.password.mismatch';
  if ([...password].length < ADMIN_PASSWORD_MIN_LENGTH) return 'admin.password.tooShort';
  if (new TextEncoder().encode(password).length > ADMIN_PASSWORD_MAX_BYTES) return 'admin.password.tooLong';
  return null;
}

/** GoTrue 的 `error_code` → 哪一句。auth-js 把它放在错误对象的 `code` 上 */
const UPDATE_CODES: Readonly<Record<string, AdminPasswordUpdateNotice>> = {
  same_password: 'admin.password.same',
  // Dashboard 的「Secure password change」开着、而这次登录超过 24 小时
  reauthentication_needed: 'admin.password.reauth',
  reauthentication_not_valid: 'admin.password.reauth',
};

/** 输入是 `updateUser({ password })` 返回的 `error`,或者它抛出来的东西 */
export function passwordUpdateNotice(error: unknown): AdminPasswordUpdateNotice {
  if (error === null || error === undefined) return 'admin.password.saved';
  if (typeof error === 'object') {
    const { name, code, status } = error as { name?: unknown; code?: unknown; status?: unknown };
    // 没有 session 时 auth-js 在本地就抛这个(一个请求都没发);GoTrue 回 session_not_found 时也包成它
    if (name === 'AuthSessionMissingError') return 'admin.password.sessionLost';
    // 服务端的密码规则(长度、字符种类)或泄露密码检测
    if (name === 'AuthWeakPasswordError') return 'admin.password.weak';
    if (name === 'AuthApiError') {
      if (typeof code === 'string' && code in UPDATE_CODES) return UPDATE_CODES[code];
      if (status === 401 || status === 403) return 'admin.password.sessionLost';
    }
  }
  return classifyAuthError(error) === 'network' ? 'admin.login.networkError' : 'admin.password.failed';
}

export async function updateAdminPassword(
  update: (attributes: { password: string }) => Promise<{ error: unknown }>,
  password: string,
  confirm: string,
  log: (...args: unknown[]) => void = (...args) => console.warn(...args),
): Promise<AdminPasswordUpdateNotice> {
  const local = checkNewPassword(password, confirm);
  if (local) return local;
  let error: unknown = null;
  try {
    ({ error } = await update({ password }));
  } catch (thrown) {
    error = thrown;
  }
  const notice = passwordUpdateNotice(error);
  if (error !== null && error !== undefined) log('[admin-password-update]', notice, error);
  return notice;
}
