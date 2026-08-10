/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/apiKeys.ts。
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,见那个文件头的说明。)
 * Edge Function 侧用 pickSecretKey:平台注入的 SUPABASE_SECRET_KEYS 是
 * 按名字索引的 JSON,不是字符串。
 */
export {
  classifySupabaseKey,
  pickPublishableKey,
  pickSecretKey,
  supabaseKeyHeaders,
  type SupabaseKeyKind,
} from '../../../api/_lib/apiKeys.ts';
