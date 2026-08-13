/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/lang.ts。
 *
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,而 `render-pdf` 与报告页的下载按钮
 * 也要用同一份判定:语言跟着人走,而 PDF 是异步渲染的 —— 渲染那一刻没有链接可读。
 * 与 renderToken / surveySignals / entitlementWarnings 同一个方向。)
 */
export {
  DEFAULT_LANG,
  effectiveLang,
  isLang,
  LANGS,
  parseLang,
  shouldPersistLang,
  type Lang,
  type LangParse,
} from '../../../api/_lib/lang.ts';
