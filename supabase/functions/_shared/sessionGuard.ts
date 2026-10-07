/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/sessionGuard.ts(规矩与成因写在那个文件头)。
 */
export { guardSessionWrite, type GuardError, type WriteGuard } from '../../../api/_lib/sessionGuard.ts';
