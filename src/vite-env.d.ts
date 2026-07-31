/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** BunnyCDN 字体目录,如 https://cdn.qiai.tech/fonts/ */
  readonly VITE_CDN_FONT_BASE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_APP_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
