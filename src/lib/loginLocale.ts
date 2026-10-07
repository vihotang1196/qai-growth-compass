/**
 * 登录这一步的语言决定(前端那一半)。另一半在 api/_lib/loginLang.ts(assessment-auth 用)。
 * 规矩与成因写在那个文件头。
 */
export type Locale = 'zh' | 'en';

const DEFAULT_LOCALE: Locale = 'zh';

function isLocale(v: string | null | undefined): v is Locale {
  return v === 'zh' || v === 'en';
}

/** 页面初始语言:?lang= → localStorage → zh */
export function pickInitialLocale(search: string, stored: string | null): Locale {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (isLocale(fromQuery)) return fromQuery;
  if (isLocale(stored)) return stored;
  return DEFAULT_LOCALE;
}

/**
 * Landing 兑换 token 时要不要把语言发给 assessment-auth。
 *
 * **只在链接里显式写了合法的 `?lang=` 时才发**;否则不发,让 auth 用 `entitlement.lang`。
 * 原来发的是当前界面语言(`?lang=` → localStorage → zh)—— 于是浏览器里存过什么,
 * 登录之后就是什么,而那个人自己的语言(`entitlement.lang`)从来没被看过。
 * 当前界面语言**不**参与这个决定 —— 所以它不在参数里。
 */
export function langForAuthRequest(search: string): Locale | undefined {
  const fromQuery = new URLSearchParams(search).get('lang');
  return isLocale(fromQuery) ? fromQuery : undefined;
}
