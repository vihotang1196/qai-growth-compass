/**
 * 答题流程的纯逻辑 —— 断点续答落在哪一题、分数怎么由选项映射、什么算答完。
 *
 * 【为什么单独一个模块】断点续答是硬要求:24 题答到一半掉线要重来的话弃答率会很难看。
 * 而「从哪一题继续」这个判断有一个容易写错的形态(见 nextStep 的注释),
 * 那种错的后果不是体验差,是**算分算错**。所以它必须是纯函数、必须单独测。
 *
 * 【为什么不扩 check:cross】phone 那边需要跨运行时逐字比对,是因为 libphonenumber
 * 在 Node 与 Deno 里可能行为不同。这里只有数组索引和整数比较,两个运行时不可能不一致 ——
 * 扩过去只增成本不增信号。两侧各自的测试套件已经够。
 */

import { mapOption } from './optionMap.ts';

export type QuizStep =
  | { phase: 'profile'; index: number }
  | { phase: 'questions'; index: number }
  | { phase: 'done' };

/**
 * 下一步落在哪。
 *
 * 【关键:取「第一个未答」,不是「最后已答之后」】
 *
 * 这两者在没有空洞时结果相同,有空洞时不同。空洞是会出现的:
 *   - 客户回头改了某题,而那次改动的保存请求失败了
 *   - 客户用后退键跳着答
 *   - 我们自己以后加「允许跳过」
 *
 * 如果按「最后已答之后」续,空洞会被**永久跳过**。而那题的答案缺失不会有任何提示 ——
 * 它会一路走到算分:该维度的 raw_sum 少一题,而公式是 `(raw_sum / 12) * 5`,
 * 分母写死 12,于是那一维的分数被**静默低估**,报告的「最弱维度」可能因此指错。
 *
 * 那是错的结论,不是差的体验。所以这里一定是第一个未答。
 */
export function nextStep(
  profileIds: readonly string[],
  questionIds: readonly string[],
  answered: ReadonlySet<string>,
): QuizStep {
  const firstProfile = profileIds.findIndex((id) => !answered.has(id));
  if (firstProfile !== -1) return { phase: 'profile', index: firstProfile };

  const firstQuestion = questionIds.findIndex((id) => !answered.has(id));
  if (firstQuestion !== -1) return { phase: 'questions', index: firstQuestion };

  return { phase: 'done' };
}

/**
 * 是不是全答完了。
 *
 * 【按覆盖判断,不按数量】数量相等不代表覆盖 —— 库里可能存着一条配置里已经删掉的
 * 旧答案(题目改版之后)。那种情况下 count 会凑够,而某道现役题其实没答。
 * 只有逐个 id 检查才拦得住。
 */
export function isComplete(
  profileIds: readonly string[],
  questionIds: readonly string[],
  answered: ReadonlySet<string>,
): boolean {
  return nextStep(profileIds, questionIds, answered).phase === 'done';
}

/** 进度:已答 / 总数。背景题与测评题合在一起算,因为客户感知的是一条进度条 */
export function progress(
  profileIds: readonly string[],
  questionIds: readonly string[],
  answered: ReadonlySet<string>,
): { done: number; total: number; pct: number } {
  const all = [...profileIds, ...questionIds];
  // 只数配置里有的 —— 库里的旧答案不该把进度条顶过 100%
  const done = all.filter((id) => answered.has(id)).length;
  const total = all.length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * 选项下标 → 分数。
 *
 * 【查表而不是直接用下标】当前 `option_values` 是 `[0,1,2,3]`,等于恒等映射,
 * 直接 `return optionIndex` 今天也对。但那样一旦标度改成 `[0,1,3,5]`
 * 之类的非线性,这里会静默继续用下标 —— 分数全错而没有任何报错。
 *
 * 【实现委托给 mapOption】「下标 → 语义值」这个形状在 config 里出现了五次
 * (题目分数、S1 维度、S7 意向值、P2/P3/S2 数值)。越界检查、非整数检查各写一遍的话,
 * 任何一处漏掉都会让脏下标静默变成 undefined。所以只有一份实现,这里是它的一个特例。
 * 越界返回 null(400 不是 500)的约定也由那一份统一定义。
 */
export function scoreForOption(
  optionIndex: number,
  optionValues: readonly number[],
): number | null {
  return mapOption(optionIndex, optionValues);
}
