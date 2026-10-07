import { QuizAuthError, quizApi } from '@/lib/quizApi';
import { routeForStatus } from '@/lib/sessionFlow';

/**
 * 写入守卫回 session_changed 之后:按 cookie **当前**所属的 session 重新分流。
 *
 * 【整页 replace,不是 SPA 内跳转】旧页面里还留着上一个人的答案与进度;
 * 整页重载才能保证新的那一页从零开始、只看得到 cookie 当前那个人的东西。
 * 语言用快照里的(那个人自己的 `entitlement.lang`),与登录时的规矩一致。
 */
export async function rerouteToCurrentSession(fallbackLocale: 'zh' | 'en'): Promise<void> {
  try {
    const s = await quizApi.bootstrap();
    window.location.replace(routeForStatus(s.status, s.locale ?? fallbackLocale));
  } catch (err) {
    window.location.replace(err instanceof QuizAuthError ? `/expired?lang=${fallbackLocale}` : `/?lang=${fallbackLocale}`);
  }
}
