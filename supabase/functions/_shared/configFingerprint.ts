/**
 * Deno 侧再导出 —— 实现只有一份,在 src/lib/configFingerprint.ts。
 * (登记表与核对它的测试在 Node 那边;出分函数在这边算。两边各有一条「等于登记的那个」的测试。)
 */
export {
  canonicalJson,
  configFingerprint,
  configStamp,
  type ConfigStamp,
} from '../../../src/lib/configFingerprint.ts';
