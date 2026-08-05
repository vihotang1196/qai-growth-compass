/**
 * 报告的统计逻辑 —— 基准线选择、分位区间、维度差值。纯函数,单独测。
 *
 * 端点(assessment-report)从库里取出本人结果 + 同批次 / 全库结果,交给这里算。
 * 「基准线用 cohort 还是 global」「分位落哪一档」这类判断放在纯函数里,因为它们
 * 决定报告怎么给人定位,算错了人对不上号。
 */

export interface ResultRow {
  /** 维度 key → 分数(0.0–5.0) */
  dimensions: Record<string, number>;
  total: number;
  tier: string;
}

/** 一组结果里某维度的均值(保留一位小数)。空集返回 0 */
function meanBy(rows: readonly ResultRow[], key: string): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s, r) => s + (r.dimensions[key] ?? 0), 0);
  return Math.round((sum / rows.length) * 10) / 10;
}

export interface Baseline {
  /** cohort:本期样本够;global:本期不足,回落全库历史 */
  source: 'cohort' | 'global';
  n: number;
  /** 维度 key → 均值 */
  means: Record<string, number>;
}

/**
 * 选基准线(PROGRESS 0.9):同 cohort 且完成的人数 ≥ minN → 本期均值;不足 → 全库历史均值。
 * 返回 source 与 n,前端据此标注「本期基准 / 历史基准」,不在前端猜。
 *
 * @param cohortRows 本人所在 cohort、completed 且有 results 的结果(【含本人】—— 均值包含自己是
 *                   标准做法,n=1 时基准线与本人重合,那正是「样本太少」的诚实表现)
 * @param globalRows 全库 completed 且有 results 的结果(回落用)
 */
export function selectBaseline(
  cohortRows: readonly ResultRow[],
  globalRows: readonly ResultRow[],
  dimensionKeys: readonly string[],
  minN: number,
): Baseline {
  const useCohort = cohortRows.length >= minN;
  const rows = useCohort ? cohortRows : globalRows;
  const means: Record<string, number> = {};
  for (const k of dimensionKeys) means[k] = meanBy(rows, k);
  return { source: useCohort ? 'cohort' : 'global', n: rows.length, means };
}

/** 维度差值:本人 - 基准,正负都保留,一位小数。B1:维度层面给精确差值(指向动作) */
export function dimensionDiffs(
  mine: Record<string, number>,
  baselineMeans: Record<string, number>,
  dimensionKeys: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of dimensionKeys) {
    out[k] = Math.round(((mine[k] ?? 0) - (baselineMeans[k] ?? 0)) * 10) / 10;
  }
  return out;
}

export type PercentileBand = 'top25' | 'q25_50' | 'q50_75' | 'bottom25';

export interface CohortStanding {
  band: PercentileBand;
  /** 中位排名百分位(0–100,越高越靠前),给内部判档用,不直接展示精确名次 */
  percentile: number;
  /** 与本人同档(同 tier)的其他人数,不含本人 */
  sameTierOthers: number;
}

/**
 * 总分层面的定位(B1):只给分位【区间】+ 同档人数,不给精确名次 ——
 * 「第 18 / 20 名」只指向羞耻,会让人关页面;分位区间指向「还有提升空间」。
 *
 * 分位用中位排名:(严格低于我的人数 + 0.5×与我同分的人数) / 总数 × 100。越高越靠前。
 * allRows 含本人。
 */
export function cohortStanding(
  myTotal: number,
  myTier: string,
  allRows: readonly ResultRow[],
): CohortStanding {
  const n = allRows.length;
  const below = allRows.filter((r) => r.total < myTotal).length;
  const equal = allRows.filter((r) => r.total === myTotal).length;
  const percentile = n === 0 ? 0 : Math.round(((below + 0.5 * equal) / n) * 100);

  let band: PercentileBand;
  if (percentile >= 75) band = 'top25';
  else if (percentile >= 50) band = 'q25_50';
  else if (percentile >= 25) band = 'q50_75';
  else band = 'bottom25';

  const sameTierOthers = allRows.filter((r) => r.tier === myTier).length - 1; // 减本人
  return { band, percentile, sameTierOthers: Math.max(0, sameTierOthers) };
}
