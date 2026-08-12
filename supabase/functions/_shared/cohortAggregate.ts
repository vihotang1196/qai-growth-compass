import { round1 } from './scoring.ts';

/**
 * 批次聚合 —— **纯函数,没有 IO**。取数与鉴权在 assessment-admin,这里只算。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【最重要的一条设计:计数总是给,比例只在样本够时才给】
 *
 * 一个平均值永远是事实(「这 2 个人的平均分是 3.1」为真);
 * 而一个**比例**是关于总体的断言(「60% 在这一档」暗示了一个可推广的分布)。
 * n=2 时前者仍然可读,后者是误导。
 *
 * 所以阈值不下在「显示 / 不显示」上,下在**说法的性质**上:
 *   n < minN → 只回计数。**比例字段根本不存在**,前端渲不出来。
 *   n ≥ minN → 附上比例。
 * 这与「让错的状态不可表示」是同一个取向(判断标准 15 旁边那条):
 * 不是「前端记得别渲百分比」,是**那个数字不在响应里**。
 *
 * 【为什么不按面板设阈值】按数量给每个面板定阈值是任意的,而且不指向任何动作 ——
 * 这条判断在 `glyphCheck` 的分级注释里已经写过一次(「按成因分,不按数量分」)。
 * 「计数 vs 比例」是成因,「n≥3 才画雷达」是任意数字。
 *
 * 【minN 复用 config 的 `cohorts.min_n_for_baseline`】不另立一个常量:
 * 它的语义本来就是「样本够到可以做群体判断」,而这正是这里要的那条线。
 * 报告页在同一个阈值下**隐藏**整个 cohort_rank 板块 —— 那是给学员看的,
 * 少一块比给一个不可靠的分位好;而看板是给运营看的,
 * **要明说「样本不足」而不是静静少一块**,否则会被当成功能坏了。受众不同,选择不同。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface AggregateResultRow {
  dim_scores: Record<string, number> | null;
  total: number;
  tier: string;
  weakest: string[] | null;
}

export interface AggregateAnswerRow {
  question_id: string;
  option_index: number;
}

export interface QuestionSpec {
  id: string;
  option_count: number;
}

/** 一道题的选项分布 */
export interface QuestionDistribution {
  id: string;
  /** 每个选项被选了多少次,长度 = option_count(含 0,分布图要看得出空档) */
  counts: number[];
  /** 一共有多少条作答(可能小于批次人数 —— 有人没答完) */
  answered: number;
  /**
   * 最集中那个选项占的比例。**样本不足时为 null** —— 见文件头。
   * 排序仍然用它(内部算),只是不外露。
   */
  topShare: number | null;
  /** 最集中那个选项的下标。这个总是给:它是事实,不是比例 */
  topIndex: number;
}

export interface CohortAggregate {
  n: number;
  /** n=0 时为 null,不是 0 —— 「没有人」与「平均分 0」是两件事 */
  averageTotal: number | null;
  /** 每一维的平均分。缺维补 0,键齐全,雷达图才画得出五个顶点 */
  dimensionMeans: Record<string, number>;
  /** 五档各多少人,含 0 —— 分布图要看得出哪一档是空的 */
  tierCounts: Record<string, number>;
  /** 每一维被判为「最弱」的次数(每人两维,所以总数是 2n) */
  weakestCounts: Record<string, number>;
  /** 按集中度降序 —— 最一边倒的题排最前,那是最直接的上课素材 */
  questions: QuestionDistribution[];
  /** 样本是否够到可以给比例。前端据此决定说法,而比例字段本身在不够时就是 null */
  enoughForShares: boolean;
  /** 那条线是多少 —— 报出来,免得前端另写一份 */
  minN: number;
}

export function aggregateCohort(
  results: readonly AggregateResultRow[],
  answers: readonly AggregateAnswerRow[],
  dimensionKeys: readonly string[],
  tierKeys: readonly string[],
  questions: readonly QuestionSpec[],
  minN: number,
): CohortAggregate {
  const n = results.length;
  const enoughForShares = n >= minN;

  const dimensionMeans: Record<string, number> = {};
  for (const key of dimensionKeys) {
    // 缺维当 0 参与平均 —— 与 computeResult 对缺维的处理一致(它会抛,所以这里不该出现)
    const sum = results.reduce((acc, r) => acc + (r.dim_scores?.[key] ?? 0), 0);
    dimensionMeans[key] = n === 0 ? 0 : round1(sum / n);
  }

  const tierCounts: Record<string, number> = {};
  for (const key of tierKeys) tierCounts[key] = 0;
  for (const r of results) {
    // 域外的 tier 不静默丢掉 —— 表上有 check 约束,真出现了说明数据坏了
    if (r.tier in tierCounts) tierCounts[r.tier] += 1;
  }

  const weakestCounts: Record<string, number> = {};
  for (const key of dimensionKeys) weakestCounts[key] = 0;
  for (const r of results) {
    for (const key of r.weakest ?? []) {
      if (key in weakestCounts) weakestCounts[key] += 1;
    }
  }

  const byQuestion = new Map<string, number[]>();
  for (const q of questions) byQuestion.set(q.id, new Array(q.option_count).fill(0));
  for (const a of answers) {
    const counts = byQuestion.get(a.question_id);
    // 认不出的题号 / 越界下标一律跳过:那是 config 改版留下的历史作答,不是这一批的事实
    if (!counts || a.option_index < 0 || a.option_index >= counts.length) continue;
    counts[a.option_index] += 1;
  }

  const distributions: QuestionDistribution[] = questions.map((q) => {
    const counts = byQuestion.get(q.id) ?? [];
    const answered = counts.reduce((a, b) => a + b, 0);
    let topIndex = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[topIndex]) topIndex = i;
    const share = answered === 0 ? 0 : counts[topIndex] / answered;
    return {
      id: q.id,
      counts,
      answered,
      // 【比例只在样本够时存在】不够时是 null,前端渲不出百分比
      topShare: enoughForShares ? round1(share * 100) / 100 : null,
      topIndex,
      // 排序用的集中度不外露 —— 挂在这里只为下面 sort 用
      _share: share,
    } as QuestionDistribution & { _share: number };
  });

  /**
   * 【按集中度降序】用途决定排序:一道全场都选同一个选项的题,是当天最直接的开场素材;
   * 而「造流量平均 2.8」讲不出东西。所以最一边倒的排最前。
   * 集中度相同时按题号,保证输出确定(否则同一批数据两次请求顺序可能不同)。
   */
  distributions.sort((a, b) => {
    const sa = (a as QuestionDistribution & { _share: number })._share;
    const sb = (b as QuestionDistribution & { _share: number })._share;
    if (sb !== sa) return sb - sa;
    return a.id.localeCompare(b.id);
  });
  for (const d of distributions) delete (d as { _share?: number })._share;

  return {
    n,
    averageTotal: n === 0 ? null : round1(results.reduce((a, r) => a + r.total, 0) / n),
    dimensionMeans,
    tierCounts,
    weakestCounts,
    questions: distributions,
    enoughForShares,
    minN,
  };
}
