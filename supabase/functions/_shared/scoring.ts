/**
 * Deno 侧再导出 —— 实现只有一份,在 src/lib/scoring.ts。
 *
 * v3:计分 = 每题按 option_count 归一化 → 维度内平均。assessment-score 的 finalize
 * 调 computeResult,徽章渲染(Stage 8)用 badgeForScore。分数一律服务端算。
 */
export {
  badgeForScore,
  computeResult,
  perQuestionScore,
  round1,
  tierForScore,
  type BadgeState,
  type DimensionConfig,
  type QuestionInput,
  type ScoreResult,
  type TierConfig,
} from '../../../src/lib/scoring.ts';
