/**
 * Deno 侧的再导出 —— 与 _shared/phone.ts 同一个做法。
 *
 * 实现只有一份,在 src/lib/quizFlow.ts。Edge Function 需要 scoreForOption
 * (分数一律服务端算,不信客户端传来的 score)与 isComplete(判断能不能进 survey)。
 * check:dep-sync 会沿这条 import 边把它纳入共享文件集。
 */
export {
  isComplete,
  nextStep,
  progress,
  scoreForOption,
  type QuizStep,
} from '../../../src/lib/quizFlow.ts';
