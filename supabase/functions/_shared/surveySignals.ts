/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/surveySignals.ts。
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,而报告页也要用同一份定义。)
 * 「想修的 ≠ 该修的」这个判断同时给学员的报告与后台的问卷洞察用,不能有两份。
 */
export {
  CONSULT_INTENT_VALUES,
  HIGH_INTENT_VALUES,
  isHighIntent,
  isPriorityMismatch,
  priorityAlignment,
  type PriorityAlignment,
} from '../../../api/_lib/surveySignals.ts';
