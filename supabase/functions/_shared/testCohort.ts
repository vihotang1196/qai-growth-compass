/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/testCohort.ts。
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,而 api/cron/pdf-sweep.ts 也要用。)
 * 两个对外出口(syncToGhl / sendMagicLink)的收口判断都从这里取。
 */
export { isTestCohort, isTestEntitlement, isTestSessionCohort } from '../../../api/_lib/testCohort.ts';
