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
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // 这两个缺失时后台完全不可用,所以直接抛 —— 静默降级会让人以为是登录逻辑坏了
    throw new Error('missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** 当前 access token;未登录时为 null */
export async function adminAccessToken(): Promise<string | null> {
  const { data } = await supabaseAuth().auth.getSession();
  return data.session?.access_token ?? null;
}
