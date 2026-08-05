/**
 * Deno 侧再导出 —— 实现只有一份,在 src/lib/ghlVerify.ts。
 * getFieldMap 用 parseFieldMap 建映射,syncToGhl 用 verifyWrittenFields + classifyGhlError 判成败。
 */
export {
  classifyGhlError,
  parseFieldMap,
  verifyWrittenFields,
  type FieldMap,
  type GhlErrorClass,
  type WrittenFieldMiss,
} from '../../../src/lib/ghlVerify.ts';
