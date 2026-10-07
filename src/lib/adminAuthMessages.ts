/**
 * Admin 登录页在请求 magic link 之后显示哪一句 —— 一个纯判定,
 * 外加一个把它接到 `signInWithOtp` 上的薄接缝。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么不能显示 GoTrue 的原始报错】
 * `shouldCreateUser: false` 下,不存在的邮箱拿到 422(`otp_disabled`;
 * 关掉自助注册之后也可能是 `signup_disabled`),存在的邮箱拿到 200;
 * 60 秒内对同一个**存在的**邮箱再请求一次会拿到 429 —— 不存在的邮箱永远不会被节流。
 * 原样显示 `error.message`,页面就成了「这个邮箱是不是管理员」的查询器。
 *
 * 所以规则是:**只要拿到了 HTTP 响应,不管状态码是什么,都显示同一句。**
 *
 * 【这只修了文案层 —— 这一句必须在】HTTP 层面的差别还在:
 * 打开 DevTools 的 Network,或者拿公开 key 直接调 `/auth/v1/otp`,
 * 照样看得到 200 与 422 的区别;耗时也不同(存在的邮箱要同步发信)。
 * 那两样前端修不了,已经接受(PROGRESS「线上 Auth 配置」)。
 * 这个模块挡的是「页面把答案告诉一个随手试的人」,不是「挡住一个会开 DevTools 的人」。
 *
 * 【三个结果,不是两个】
 *   neutral       拿到了 HTTP 响应(任何状态码)
 *   networkError  请求没发出去 / 没拿到响应 —— 让人检查网络、再点一次
 *   unexpected    兜底:既不是 HTTP 响应,也不是 auth-js 标记的网络失败。
 *                 例:前端缺环境变量时 `supabaseAuth()` 直接抛;
 *                 浏览器禁用存储时 PKCE 的 code verifier 存不进去
 *
 * 兜底必须落在**失败侧**,而且有**自己的字样**:落在 neutral 等于告诉管理员
 * 「已发送」而什么都没发生;借用 networkError 的字样会让人去查一个没坏的网络。
 * 它不泄露任何东西 —— 这些情况与输入的是哪个邮箱无关。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type AdminLoginNotice =
  | 'admin.login.neutral'
  | 'admin.login.networkError'
  | 'admin.login.unexpected';

/**
 * auth-js 把「拿到了 HTTP 响应」编码在错误的**类名**上,不只编码在 status 上
 * (auth-js `lib/fetch.js` 的 `_handleRequest` / `handleError`):
 *
 *   AuthApiError              非 2xx、响应体是 JSON —— status 是真实状态码
 *   AuthUnknownError          非 2xx、响应体不是 JSON —— **没有 status**,但确实拿到了响应
 *   AuthWeakPasswordError     服务端的弱密码拒绝(这个页面用不到,列出来是为了完整)
 *   AuthRetryableFetchError   见 `adminLoginNotice` 里那一支
 *
 * 【为什么不只看 `status` 是不是数字】客户端自己造的错误也带 status:
 * `AuthInvalidCredentialsError` 是 400,而它在**一个请求都没发**的时候就抛了。
 * 按 status 判,它会被当成「拿到了响应」—— 页面说「已发送」,实际什么都没发。
 */
const RESPONSE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'AuthApiError',
  'AuthUnknownError',
  'AuthWeakPasswordError',
]);

/** 输入是 `signInWithOtp` 返回的 `error`(成功时为 null),或者它抛出来的东西 */
export function adminLoginNotice(error: unknown): AdminLoginNotice {
  if (error === null || error === undefined) return 'admin.login.neutral';
  if (typeof error !== 'object') return 'admin.login.unexpected';

  const { name, status } = error as { name?: unknown; status?: unknown };
  if (name === 'AuthRetryableFetchError') {
    /**
     * 同一个类名装着两件事,靠 status 分:
     *   status > 0  —— 5xx(500–504、520–530),拿到了响应
     *   status = 0  —— fetch 自己抛了(断网、DNS、CORS、被中止)
     *
     * ⚠️ 还有一种也是 0:2xx 但响应体不是 JSON(auth-js 解析失败时同样包成它)。
     * 那多半是 `VITE_SUPABASE_URL` 指错了地方 —— 显示成「网络错误」不准确,
     * 但与输入的邮箱无关,不泄露任何东西。
     */
    return status === 0 ? 'admin.login.networkError' : 'admin.login.neutral';
  }
  if (typeof name === 'string' && RESPONSE_ERROR_NAMES.has(name)) return 'admin.login.neutral';
  return 'admin.login.unexpected';
}

export interface AdminOtpRequest {
  email: string;
  options: { shouldCreateUser: false; emailRedirectTo: string };
}

/**
 * 发请求 + 判定。**它从不抛,只返回一个文案 key** ——
 * 所以调用它的组件手里根本没有错误对象,也就没有东西可以被渲染出来。
 * 这是「页面上不得出现原始报错」的结构性做法:错误对象在这里就地终结。
 *
 * `log` 只写 DevTools Console(给排查的人看,例如轮换 key 之后忘了重新构建 ——
 * 那时页面只会显示中性句,而邮件永远不来)。它与 Network 面板里本来就看得到的东西
 * 同级,不是页面。
 */
export async function requestAdminLink(
  signIn: (request: AdminOtpRequest) => Promise<{ error: unknown }>,
  email: string,
  emailRedirectTo: string,
  log: (...args: unknown[]) => void = (...args) => console.warn(...args),
): Promise<AdminLoginNotice> {
  let error: unknown = null;
  try {
    ({ error } = await signIn({
      email,
      /**
       * 【`shouldCreateUser: false` 显式写出】auth-js 的默认值是 `true` ——
       * 对一个陌生邮箱会在 auth.users 建一行,并发一封注册确认信。
       * 线上关掉自助注册之后 GoTrue 也会拒;而这一层**不依赖 Dashboard 的开关**:
       * 开关哪天被人打开,这个页面仍然不建用户。
       */
      options: { shouldCreateUser: false, emailRedirectTo },
    }));
  } catch (thrown) {
    error = thrown;
  }
  const notice = adminLoginNotice(error);
  if (error !== null && error !== undefined) log('[admin-login]', notice, error);
  return notice;
}
