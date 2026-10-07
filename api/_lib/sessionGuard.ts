/**
 * 答题 / 问卷 / 出分的写入守卫 —— 纯函数;Node 与 Deno 共用(Deno 侧 `_shared/sessionGuard.ts` 再导出)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么有它】2026-10-07 第三次彩排(第一遍):手机上一个旧的答题分页在 cookie 已经换成
 * 另一条 entitlement 之后被继续使用,15 题、问卷、出分全部写进了那条**已经完成**的 session ——
 * 结果被改写、PDF 被重渲。对真实学员还会重写 GHL 字段、增删标签(可能触发 GHL 工作流)。
 * 两个洞:
 *   ① completed 的 session 照样接受写入(08-12 就看到过这条路是通的,只修了它带出来的标签问题);
 *   ② 页面不知道自己属于哪个 session —— 点下去的每一次都写进 cookie **当前**那一个。
 *
 * 【规矩(Viho 2026-10-07 定)】写入(答题的背景题与题目、问卷、出分)之前:
 *   1. 页面带来的 `session_id` 与 cookie 所属的 session 不一致、或者没带 → `session_changed`
 *      —— 先判这一条:一个属于别人的页面,不该因为对方已完成就得到「已完成」这个信息
 *      (也不该被当成「完成了就去看报告」);没带的是这次之前加载的旧页面,它不知道自己属于谁
 *   2. session 已经 completed → `already_completed`
 * 两种都回 409、什么都不写。读(答题页的 bootstrap)不经过这里 —— 页面正是靠它拿到 session_id。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type GuardError = 'already_completed' | 'session_changed';
export type WriteGuard = { ok: true } | { ok: false; error: GuardError };

export function guardSessionWrite(cookieSession: { id: string; status: string }, pageSessionId: unknown): WriteGuard {
  if (typeof pageSessionId !== 'string' || pageSessionId === '' || pageSessionId !== cookieSession.id) {
    return { ok: false, error: 'session_changed' };
  }
  if (cookieSession.status === 'completed') return { ok: false, error: 'already_completed' };
  return { ok: true };
}
