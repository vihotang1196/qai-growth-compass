import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UI_STRINGS, type UiKey } from '@/config/ui-strings';

export type Locale = 'zh' | 'en';

/** config 与 ui-strings 里所有可翻译节点的形状 */
export interface LocalizedNode {
  zh: string;
  en?: string;
}

const STORAGE_KEY = 'compass_lang';
const DEFAULT_LOCALE: Locale = 'zh';

function isLocale(v: string | null | undefined): v is Locale {
  return v === 'zh' || v === 'en';
}

/** 优先级:?lang= → localStorage → zh */
export function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  if (isLocale(fromQuery)) return fromQuery;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // 隐私模式下 localStorage 不可用,回落默认值
  }
  return DEFAULT_LOCALE;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /** 取 config 里的 { zh, en } 节点 */
  t: (node: LocalizedNode | undefined | null) => string;
  /** 取 ui-strings 里的壳文案 */
  tk: (key: UiKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略:localStorage 不可用不影响本次会话内的切换
    }
    // 语言进 URL,分享出去的链接保持同一语言
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
  }, []);

  const t = useCallback(
    (node: LocalizedNode | undefined | null): string => {
      if (!node) return '';
      const value = locale === 'en' ? node.en : node.zh;
      if (value) return value;
      if (import.meta.env.DEV && locale === 'en') {
        console.warn('[i18n] missing en translation, falling back to zh:', node.zh);
      }
      return node.zh ?? '';
    },
    [locale],
  );

  const tk = useCallback(
    (key: UiKey): string => t(UI_STRINGS[key]),
    [t],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, tk }),
    [locale, setLocale, t, tk],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useT must be used inside <LocaleProvider>');
  return ctx;
}
