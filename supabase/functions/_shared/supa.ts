import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pickSecretKey } from './apiKeys.ts';

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
  /**
   * 【两代 key 都认,新的优先】平台注入的 `SUPABASE_SECRET_KEYS` 是**按名字索引的 JSON**
   * (默认那把叫 `default`),不是字符串;而 legacy 的 `SUPABASE_SERVICE_ROLE_KEY`
   * 在按下 Disable 之后就不认了。
   *
   * 顺序不能反:新的优先才能在 Disable 之后继续工作;legacy 兜底才能在配好新 key 之前、
   * 以及 Disable 被开回来时照样跑。判断在 _shared/apiKeys.ts,那边有用例。
   */
  const key = pickSecretKey(
    Deno.env.get('SUPABASE_SECRET_KEYS'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  );
  if (!url || !key) {
    throw new Error(
      'missing SUPABASE_URL, or neither SUPABASE_SECRET_KEYS nor SUPABASE_SERVICE_ROLE_KEY is set — ' +
        '按下 Disable JWT-based API keys 之后 legacy 那把就不认了,这时必须有 SUPABASE_SECRET_KEYS。' +
        '若刚 Disable 就看到这条,先确认函数已重新部署(平台注入的变量在旧实例上不会变)。',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
