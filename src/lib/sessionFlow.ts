/**
 * 前端那一半:认出服务端的写入守卫错误,以及按 session 状态该去哪一页。
 * 服务端那一半与成因在 api/_lib/sessionGuard.ts。
 */
export type GuardError = 'already_completed' | 'session_changed';

/** 只认 409 + 这两个错误码;其余 409(没答满、没交问卷)照旧走原来的分支 */
export function guardErrorOf(status: number, body: unknown): GuardError | null {
  if (status !== 409 || body === null || typeof body !== 'object') return null;
  const error = (body as { error?: unknown }).error;
  return error === 'already_completed' || error === 'session_changed' ? error : null;
}

/** 按 cookie 当前所属 session 的状态,该在哪一页 */
export function routeForStatus(status: string, locale: 'zh' | 'en'): string {
  if (status === 'completed') return `/report?lang=${locale}`;
  if (status === 'survey') return `/survey?lang=${locale}`;
  return `/quiz?lang=${locale}`;
}

/** 写入守卫拦下时抛的错误 —— 页面据此跳转,而不是当成「保存失败」让人重试 */
export class SessionGuardError extends Error {
  constructor(readonly kind: GuardError) {
    super(kind);
  }
}
