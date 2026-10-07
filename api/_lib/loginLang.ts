/**
 * token 登录之后,界面该用哪种语言 —— assessment-auth 用它决定回给前端的 `lang`。
 * 纯函数;Node 与 Deno 共用(Deno 侧 `_shared/loginLang.ts` 再导出)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么有它】2026-10-07 第二次彩排:entitlement 是 en,Viho 打开链接,整个界面是中文。
 * 真实链接都是 `/?t=<token>`、不带语言(`magicLink()`),而前端原来把**浏览器当前的界面语言**
 * (`?lang=` → localStorage → zh)发给 auth,auth 原样回传 —— `entitlement.lang` 从头到尾没被看过。
 * 结果:界面跟着浏览器,自动生成的 PDF 跟着 `entitlement.lang`,两者可以不一样。
 *
 * 【规矩(Viho 2026-10-07 定,修法 A)】
 *   1. 链接**显式**带了合法的 `?lang=` → 以它为准(前端只在这种时候才把 lang 发过来)
 *   2. 否则用 `entitlement.lang` —— 人的语言,由 GHL 写入,也决定 GHL 消息用哪个模板
 *   3. 都没有 / 不合法 → zh
 * 学员登录后手动切换界面语言**不写回** `entitlement.lang`(同一天的决定,理由见 PROGRESS)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { effectiveLang, parseLang, type Lang } from './lang.js';

export function loginLang(requested: unknown, entitlementLang: unknown): Lang {
  return effectiveLang(entitlementLang, parseLang(requested));
}
