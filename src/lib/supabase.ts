import { pickPublishableKey } from '../../api/_lib/apiKeys';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 浏览器侧的 Supabase 客户端 —— **只用于 Admin 的 magic link 登录**。
 *
 * 【它不碰任何业务表】9 张表 RLS 全开且零 policy,anon 一律被拒。
 * 所有数据读写都走 `/api/*` 代理到 Edge Function,由 service role 执行。
 * 这个客户端唯一的职责是拿到一个 Supabase Auth 的 access token,
 * 然后把它交给 `assessment-admin` 去验。
 *
 * 【anon key 出现在 bundle 里是设计如此】它是公开凭证,而且在这个项目里
 * 它连一行数据都读不到 —— 零 policy 意味着 anon 什么都做不了。
 */
let client: SupabaseClient | null = null;

export function supabaseAuth(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  /**
   * 【两代 key,新的优先】`VITE_SUPABASE_PUBLISHABLE_KEY` 是新的,
   * `VITE_SUPABASE_ANON_KEY` 是 legacy 兜底。按下 Disable 之后 legacy 不认了。
   *
   * ⚠️ 两者都是 **build-time** 的:Vite 构建时替换成字面量编译进 dist。
   * 所以换 key **必须重新构建 + 部署**,改环境变量不够 ——
   * 漏了的症状是 Admin 登录坏掉,不会有任何一处说「key 旧了」。
   * `npm run smoke` 里有一条专门守它。
   */
  const anonKey = pickPublishableKey(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  if (!url || !anonKey) {
    // 这两个缺失时后台完全不可用,所以直接抛 —— 静默降级会让人以为是登录逻辑坏了
    throw new Error(
      'missing VITE_SUPABASE_URL, or neither VITE_SUPABASE_PUBLISHABLE_KEY nor VITE_SUPABASE_ANON_KEY',
    );
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      /**
       * 【PKCE,不用默认的 implicit】auth-js 的默认值是 `implicit` ——
       * 那会把 access_token 放进回调 URL 的 hash。它自己会清,但用的是
       * `window.location.hash = ''`,那是一次 fragment 导航:**新增一条历史记录,
       * 而带 token 的那条留在后面**,按后退键就能翻出来。而 replaceState 只能改
       * 当前那一条,更早的删不掉 —— History API 没有删除条目的能力。
       *
       * PKCE 下 token 完全不进 URL,回调只带一个 `?code=`,auth-js 用它换 session
       * 之后用 replaceState 清掉。管理员凭证是整个系统权限最高的东西,
       * 让它一次都不出现在地址栏比事后清理可靠。
       *
       * 【代价,已确认接受】code verifier 存在**发起登录的那个浏览器**里,
       * 所以 magic link 必须在同一个浏览器打开 —— 在手机上点开电脑上申请的邮件
       * 会失败(code verifier not found)。后台只有一个人,这个约束不构成负担。
       *
       * Supabase Auth 后台的 Redirect URLs **不用改**:redirectTo 取的还是
       * options.emailRedirectTo,路径没变,变的只是回调参数的形式。
       */
      flowType: 'pkce',
    },
  });
  return client;
}

/** 当前 access token;未登录时为 null */
export async function adminAccessToken(): Promise<string | null> {
  const { data } = await supabaseAuth().auth.getSession();
  return data.session?.access_token ?? null;
}
