/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/dbError.ts。
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,而 api/cron/pdf-sweep.ts 与 render-pdf 也要用。)
 *
 * 用法:
 *   if (error) dbFail({ fn: FN, op: 'assessment_sessions.select', entitlement: ent.id }, error);
 *   if (error) console.error(dbLogLine({ fn: FN, op: '…' }, error));     // 记下来,照常继续
 *   catch (err) { console.error(`… failed: ${describeError(err).log}`); }
 */
export { DbError, dbFail, dbLogLine, describeError, type DbCtx } from '../../../api/_lib/dbError.ts';
