/**
 * Deno 侧再导出 —— 实现只有一份,在 src/lib/optionMap.ts。
 * 问卷提交与答题提交都要把客户端传来的下标映射成语义值,而校验必须在服务端做。
 */
export { mapOption, mapOptions } from '../../../src/lib/optionMap.ts';
