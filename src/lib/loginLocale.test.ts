import { describe, expect, it } from 'vitest';
import { loginLang } from '../../api/_lib/loginLang';
import { langForAuthRequest, pickInitialLocale } from './loginLocale';

/**
 * token 登录之后界面用哪种语言 —— 前端与 assessment-auth 两半拼起来测。
 *
 * 2026-10-07 第二次彩排:entitlement 是 en,链接是 `/?t=…`(真实链接都不带语言),
 * 而界面是中文。成因:前端把**浏览器当前的界面语言**发给 auth,auth 原样回传,
 * `entitlement.lang` 从头到尾没被看过。
 *
 * 规矩(Viho 2026-10-07 定,修法 A):链接显式带了 `?lang=` → 以它为准;
 * 否则用 `entitlement.lang`(人的语言,GHL 写入的);localStorage 里存的东西不再决定登录后的语言。
 */
function uiAfterLogin({
  search,
  stored,
  entitlementLang,
}: {
  search: string;
  stored: string | null;
  entitlementLang: string | null;
}) {
  const initial = pickInitialLocale(search, stored); // Landing 渲染时的语言
  void initial; // 渲染时的语言不参与登录后的决定 —— 原来就是它被发了过去
  const sent = langForAuthRequest(search); // Landing 发给 auth 的
  return loginLang(sent, entitlementLang); // auth 回的;Landing 照它 setLocale
}

describe('the language after a token login', () => {
  // 起因:entitlement en、链接不带 lang、这台手机的 localStorage 存着 zh(第一次彩排留下的)→ 应当是英文
  it('an en learner whose browser stored zh gets English (the rehearsal-2 case)', () => {
    expect(uiAfterLogin({ search: '?t=tok', stored: 'zh', entitlementLang: 'en' })).toBe('en');
  });

  // 反方向:entitlement zh、浏览器存着 en → 应当是中文
  it('a zh learner whose browser stored en gets Chinese', () => {
    expect(uiAfterLogin({ search: '?t=tok', stored: 'en', entitlementLang: 'zh' })).toBe('zh');
  });

  // 全新浏览器(什么都没存)、entitlement en → 英文(原来会落到默认的中文)
  it('an en learner on a fresh browser gets English, not the zh default', () => {
    expect(uiAfterLogin({ search: '?t=tok', stored: null, entitlementLang: 'en' })).toBe('en');
  });

  // 链接显式带了 ?lang= → 以它为准,两个方向都是
  it('an explicit ?lang= in the link wins over entitlement.lang', () => {
    expect(uiAfterLogin({ search: '?t=tok&lang=zh', stored: 'en', entitlementLang: 'en' })).toBe('zh');
    expect(uiAfterLogin({ search: '?t=tok&lang=en', stored: 'zh', entitlementLang: 'zh' })).toBe('en');
  });

  // ?lang= 不合法 → 当作没给,用 entitlement.lang
  it('an invalid ?lang= is ignored and entitlement.lang is used', () => {
    expect(uiAfterLogin({ search: '?t=tok&lang=fr', stored: 'zh', entitlementLang: 'en' })).toBe('en');
  });

  // entitlement.lang 缺失 / 不合法 → 默认 zh
  it('a missing or invalid entitlement.lang falls back to zh', () => {
    expect(uiAfterLogin({ search: '?t=tok', stored: 'en', entitlementLang: null })).toBe('zh');
    expect(uiAfterLogin({ search: '?t=tok', stored: 'en', entitlementLang: 'fr' })).toBe('zh');
  });
});

describe('langForAuthRequest', () => {
  // 只有链接里显式写了才发;否则不发 —— 让 auth 用 entitlement.lang
  it('sends only an explicit, valid ?lang= from the link', () => {
    expect(langForAuthRequest('?t=tok&lang=en')).toBe('en');
    expect(langForAuthRequest('?t=tok')).toBeUndefined();
    expect(langForAuthRequest('?t=tok&lang=fr')).toBeUndefined();
  });
});

describe('pickInitialLocale (unchanged: ?lang= -> localStorage -> zh)', () => {
  it('keeps the page-load order', () => {
    expect(pickInitialLocale('?lang=en', 'zh')).toBe('en');
    expect(pickInitialLocale('', 'en')).toBe('en');
    expect(pickInitialLocale('', null)).toBe('zh');
  });
});
