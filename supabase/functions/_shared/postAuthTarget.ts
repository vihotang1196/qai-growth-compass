/**
 * 登录后的跳转目标 —— 纯函数,可测。
 *
 * 两层保护,缺一不可(PROGRESS.md Stage 4 约束 1 与 2):
 *
 *   1. 白名单落到类型层。PostAuthTarget 是四个字面量的联合,跳转函数只接受它。
 *      传任意字符串进不去,编译期就挡住。防的是【外部注入】——
 *      react-router 6.x 有一个未修复的开放重定向(反斜杠绕过),而
 *      6.30.4 已是 6.x 最后一版,首个修复版是 7.18.0(major)。
 *      所以这一层不是可选的加固,是那个漏洞在本项目里唯一的封堵。
 *
 *   2. 目标由 session 状态【推导】,不由调用方传入。防的是【内部逻辑错】——
 *      已完成的 session 跳 /quiz 会让人重答 24 题,未完成的跳 /report 会看到
 *      空报告。白名单拦不住这类错,因为那些值都在白名单里。
 *
 * 【为什么是四个值而不是三个】assessment_sessions.status 的 check 约束里有
 * 'survey' 这一态 —— 24 题答完、7 题问卷未交的人停在这儿。三值白名单
 * (/quiz /report /expired)会把他们推回 /quiz,24 题全部重答。
 */

export type PostAuthTarget = '/quiz' | '/survey' | '/report' | '/expired';

/** 与 assessment_sessions.status 的 check 约束一致 */
export type SessionStatus = 'in_progress' | 'survey' | 'completed';

export interface AuthState {
  /** token 是否对应到一条 entitlement */
  entitlementFound: boolean;
  /** access_revoked_at 是否非 null */
  revoked: boolean;
  /** 该 entitlement 的 session 状态;还没建过 session 时为 null */
  sessionStatus: SessionStatus | null;
}

export function postAuthTarget(state: AuthState): PostAuthTarget {
  if (!state.entitlementFound) return '/expired';
  // 作废优先于一切:即使这个人已经答完题,作废之后也不该再看到报告
  if (state.revoked) return '/expired';

  switch (state.sessionStatus) {
    case 'completed':
      return '/report';
    case 'survey':
      return '/survey';
    case 'in_progress':
      return '/quiz';
    case null:
      // 还没建 session —— 首次登录,建完就是 in_progress
      return '/quiz';
  }
}

/**
 * 拼跳转 URL,显式带上 lang。
 *
 * 【为什么 lang 要单独处理】白名单约束的是【路径】,不是 query。跳转时若整个
 * query 被丢掉,英文用户登录后会掉回中文 —— 而这个 bug 只有英文用户会遇到,
 * 我们自己测大概率测不到。
 *
 * lang 不是重定向目标,不受白名单约束,但必须显式拼上,不能指望它自己活下来。
 */
export function targetWithLang(target: PostAuthTarget, lang: 'zh' | 'en'): string {
  return `${target}?lang=${lang}`;
}
