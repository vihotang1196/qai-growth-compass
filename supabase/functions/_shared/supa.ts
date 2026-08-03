import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * service role 客户端。
 *
 * 9 张表全部 RLS 全开且零 policy,anon / authenticated 一律拒绝 ——
 * 所有读写只能经由 service role(它绕过 RLS)。所以这个客户端是
 * 整个系统访问数据的唯一入口,别在别处另建一个。
 *
 * 三个环境变量由 Supabase Edge Functions 自动注入,不需要手动配。
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
