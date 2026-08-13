/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/entitlementWarnings.ts。
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,而 Roster 也要用同一份取值域:
 * 写入方是 webhook、读出方是名单页,两边各写一份的话码会对不上,
 * 而对不上的表现是名单页把一条真实告警显示成空白。)
 */
export {
  isWarningCode,
  parseWarnings,
  warningLabelKey,
  WARNING_CODES,
  type EntitlementWarning,
  type WarningCode,
} from '../../../api/_lib/entitlementWarnings.ts';
