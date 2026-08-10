/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** BunnyCDN 字体目录,如 https://cdn.qiai.tech/fonts/ */
  readonly VITE_CDN_FONT_BASE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 新格式(sb_publishable_…);与上面那个二选一,新的优先 */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_APP_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
