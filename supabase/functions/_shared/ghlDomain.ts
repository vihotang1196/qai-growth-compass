/**
 * Deno 侧再导出 —— 实现只有一份,在 src/lib/ghlDomain.ts。
 *
 * GHL 写回前按 config 的 domain 校验。domain 有三种形态(枚举数组 / 区间字符串 / null),
 * 只做 includes 判断的话区间型会永远失败或永远跳过 —— 两种都是静默的。
 */
export {
  checkDomain,
  checkFields,
  type Domain,
  type DomainVerdict,
  type FieldCheckFailure,
  type FieldSpec,
} from '../../../src/lib/ghlDomain.ts';
