/**
 * 计分核心 —— 纯逻辑。原始作答 → 五维分数 / 总分 / 档位 / 最弱两维 / 最强两维。
 *
 * 【为什么单独一个模块、且分数一律在这里算】客户端只传 option_index,分数由服务端
 * 按 config 查表得出(见 assessment-quiz)。这个模块是那套分数的唯一来源,报告、
 * GHL 写回、offer 分流全部读它的输出。写错一处,后面每一层都跟着错,而且看起来正常。
 *
 * 三处最容易出错、因此单独锁死:
 *   1. 总分取整必须发生在档位判定【之前】,且显示与判定用【同一个】取整值 ——
 *      否则显示 2.8 而档位按未取整的 2.84999 判,两者对不上,学员直接不信报告。
 *   2. tiers 查找在【十分位整数】上做,绕开浮点边界(2.1 可能存成 2.0999…)。
 *   3. 最弱/最强的平分处理:按 dimension.order 靠前者优先,不是数组顺序、不是字典序。
 */

export interface DimensionConfig {
  key: string;
  order: number;
}

export interface TierConfig {
  key: string;
  min: number;
  max: number;
}

export interface ScoreResult {
  /** 维度 key → 分数(0.0–5.0,一位小数) */
  dimensions: Record<string, number>;
  /** 总分(0.0–5.0,一位小数)—— 显示与档位判定共用这一个值 */
  total: number;
  tier: string;
  /** 最弱两维,分低者在前;平分按 order 靠前优先 */
  weakest: [string, string];
  /** 最强两维,分高者在前;平分按 order 靠前优先 */
  strongest: [string, string];
}

/**
 * 一位小数取整,round-half-up。
 *
 * 【为什么加 EPSILON】裸 Math.round((raw)*10)/10 会踩浮点:2.85*10 在 float 里是
 * 28.4999…,Math.round 给 28 → 2.8,而人预期 2.9。加一个 EPSILON 把它顶回 28.5。
 * 分数非负,不用担心负数方向。
 */
export function round1(x: number): number {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

/** 单维分数:raw_sum(0–12)→ (raw_sum/12)*5,一位小数 */
export function dimensionScore(rawSum: number, maxRaw: number, scale: number): number {
  return round1((rawSum / maxRaw) * scale);
}

/**
 * 档位判定 —— 输入必须是【已取整到一位小数】的分数。
 *
 * 在十分位整数上比较:score 2.9、min 2.9、max 3.5 全部 ×10 取整成 29 / 29 / 35。
 * 这样 2.1 存成 2.0999… 这类浮点误差不会让分数落在两档之间的缝里。
 *
 * 覆盖性由 config 保证(有测试锁 tiers 在 0.0–5.0 无缝无重叠),所以正常不会返回 null;
 * 返回 null 只可能是分数越界(<0 或 >5)—— 那是上游算错,让调用方显式处理,不静默兜底。
 */
export function tierForScore(score: number, tiers: readonly TierConfig[]): string | null {
  const tenths = Math.round(score * 10);
  for (const t of tiers) {
    if (tenths >= Math.round(t.min * 10) && tenths <= Math.round(t.max * 10)) return t.key;
  }
  return null;
}

/**
 * 取最低/最高的两维。平分时按 order 靠前优先。
 * dir = 'asc' 取最弱(分低在前),'desc' 取最强(分高在前)。
 */
function topTwo(
  scores: Record<string, number>,
  dims: readonly DimensionConfig[],
  dir: 'asc' | 'desc',
): [string, string] {
  const sorted = [...dims].sort((a, b) => {
    const sa = scores[a.key];
    const sb = scores[b.key];
    if (sa !== sb) return dir === 'asc' ? sa - sb : sb - sa;
    // 平分:order 靠前优先,两个方向都一样
    return a.order - b.order;
  });
  return [sorted[0].key, sorted[1].key];
}

/**
 * 主入口:每维的 raw_sum → 完整结果。
 *
 * 【要求全维齐全】rawSums 必须含每一个维度的 key。缺一个维度就意味着那一维的题没答全,
 * 此时算分是错的(总分被少算的维度拉低)。所以缺维度直接抛,不拿 0 顶替 ——
 * 拿 0 顶替会算出一个看起来正常的错分数,那正是断点续答那条链路要防的静默错误。
 * 调用方应先用 isComplete 确认答满再调这里。
 */
export function computeResult(
  rawSums: Record<string, number>,
  dimensions: readonly DimensionConfig[],
  tiers: readonly TierConfig[],
  opts: { maxRaw: number; scale: number },
): ScoreResult {
  const scores: Record<string, number> = {};
  for (const d of dimensions) {
    const raw = rawSums[d.key];
    if (raw === undefined) {
      throw new Error(`computeResult: missing raw sum for dimension "${d.key}"`);
    }
    scores[d.key] = dimensionScore(raw, opts.maxRaw, opts.scale);
  }

  // 总分:五维简单平均,取整一次。这一个值同时用于显示和档位判定
  const mean = dimensions.reduce((sum, d) => sum + scores[d.key], 0) / dimensions.length;
  const total = round1(mean);

  const tier = tierForScore(total, tiers);
  if (tier === null) {
    // config 已锁 tiers 无缝覆盖 0.0–5.0,走到这里说明 total 越界 —— 上游算错
    throw new Error(`computeResult: total ${total} fell outside every tier`);
  }

  return {
    dimensions: scores,
    total,
    tier,
    weakest: topTwo(scores, dimensions, 'asc'),
    strongest: topTwo(scores, dimensions, 'desc'),
  };
}
