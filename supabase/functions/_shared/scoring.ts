/**
 * Deno 侧再导出 —— 与 _shared/phone.ts / quizFlow.ts 同一个做法,实现只有一份。
 *
 * Stage 7 的计分 Edge Function 在答完后调 computeResult:把每维 raw_sum 算成
 * 分数 / 总分 / 档位 / 最弱两维,写进 assessment_results。分数一律服务端算,
 * 不信客户端传来的值。
 */
export {
  computeResult,
  dimensionScore,
  round1,
  tierForScore,
  type DimensionConfig,
  type ScoreResult,
  type TierConfig,
} from '../../../src/lib/scoring.ts';
