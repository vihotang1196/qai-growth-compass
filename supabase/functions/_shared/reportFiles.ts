/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/reportFiles.ts。
 * (放在 api/ 下是因为 render-pdf 与报告页的按钮也要用同一份判定。)
 */
export {
  availabilityOf,
  downloadableIn,
  langStates,
  offerableLangs,
  pdfObjectPath,
  shareCardObjectPath,
  type LangAvailability,
  type LangState,
  type ReportFileRow,
} from '../../../api/_lib/reportFiles.ts';
