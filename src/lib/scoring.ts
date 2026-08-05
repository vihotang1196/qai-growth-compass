/**
 * 计分核心 —— 纯逻辑。原始作答 → 五维分数 / 总分 / 档位 / 最弱两维 / 最强两维 / 子模块徽章。
 *
 * 【v3 的关键变化:每题先归一化,再取维度内平均】
 * 选项数不再统一(3 或 4),固定分母作废。每道题代表一个子模块,权重必须相等 ——
 * 4 选项的题不能因为格子多就占更大权重。所以是「每题归一化到 0–5,再维度内平均」。
 * 这两种算法在选项数统一时等价,不统一时不等价。
 *
 * 分数一律服务端算,客户端只传 option_index。这个模块是那套分数的唯一来源,
 * 报告、GHL 写回、offer 分流全部读它的输出。
 *
 * 三处单独锁死:
 *   1. 总分取整一次,显示与档位判定共用同一个值(否则显示 2.8 而档位按 2.84999 判)。
 *   2. tiers 查找在十分位整数上做,绕开浮点边界。
 *   3. 最弱/最强平分按 dimension.order 靠前优先。
 * 加上 v3 新增的第 4 处:徽章按归一化分判定,不按 option_index —— index 2 在 3 选项题
 *   是满分 5.0、在 4 选项题只有 3.33,照 option_index 判会把一批「已具备」错标成「部分具备」。
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

/** 一道题的原始作答 —— option_count 随题不同,归一化要用它做分母 */
export interface QuestionInput {
  dimension: string;
  optionIndex: number;
  optionCount: number;
}

export type BadgeState = 'full' | 'partial' | 'missing';

export interface ScoreResult {
  /** 维度 key → 分数(0.0–5.0,一位小数) */
  dimensions: Record<string, number>;
  /** 总分(0.0–5.0,一位小数)—— 显示与档位判定共用这一个值 */
  total: number;
  tier: string;
  weakest: [string, string];
  strongest: [string, string];
}

/**
 * 一位小数取整,round-half-up。
 * 加 EPSILON:裸 Math.round(2.85*10)/10 会踩浮点(2.85*10 在 float 里是 28.4999…),
 * 给 28 → 2.8 而人预期 2.9。分数非负,不用担心负数方向。
 */
export function round1(x: number): number {
  return Math.round((x + Number.EPSILON) * 10) / 10;
}

/**
 * 单题归一化分:(option_index / (option_count - 1)) * scale,保留 4 位小数。
 *
 * 【为什么归一化而不是查表】选项数不统一。3 选项得 0 / 2.5 / 5,4 选项得
 * 0 / 1.667 / 3.333 / 5。顶格永远是 scale,零格永远是 0,中间按位置线性分布。
 *
 * 【越界返回 null 而不是抛】越界只可能来自客户端脏数据,那是 400 不是 500。
 * option_count < 2 也返回 null —— 分母 (option_count-1) 会是 0。
 */
export function perQuestionScore(
  optionIndex: number,
  optionCount: number,
  scale: number,
): number | null {
  if (!Number.isInteger(optionIndex) || !Number.isInteger(optionCount)) return null;
  if (optionCount < 2) return null;
  if (optionIndex < 0 || optionIndex >= optionCount) return null;
  return Math.round((optionIndex / (optionCount - 1)) * scale * 1e4) / 1e4;
}

/**
 * 子模块徽章 —— 按归一化分判定,与 config.scoring.submodule_badge_thresholds 一致:
 *   full    >= scale(顶格)
 *   missing == 0(零格)
 *   partial 其余
 *
 * 【为什么 >= scale 而不是 === scale】归一化时顶格 index 给的正好是 scale(整数,精确),
 * 用 >= 是防御:即便 config 改了 scale 或引入浮点微差,顶格仍判 full。
 */
export function badgeForScore(score: number, scale: number): BadgeState {
  if (score >= scale) return 'full';
  if (score <= 0) return 'missing';
  return 'partial';
}

/**
 * 档位判定 —— 输入必须是已取整到一位小数的分数。在十分位整数上比较,
 * 绕开 2.1 存成 2.0999… 的浮点边界。返回 null 只可能是分数越界(上游算错)。
 */
export function tierForScore(score: number, tiers: readonly TierConfig[]): string | null {
  const tenths = Math.round(score * 10);
  for (const t of tiers) {
    if (tenths >= Math.round(t.min * 10) && tenths <= Math.round(t.max * 10)) return t.key;
  }
  return null;
}

/** 取最低/最高的两维。平分按 order 靠前优先(两个方向一致) */
function topTwo(
  scores: Record<string, number>,
  dims: readonly DimensionConfig[],
  dir: 'asc' | 'desc',
): [string, string] {
  const sorted = [...dims].sort((a, b) => {
    const sa = scores[a.key];
    const sb = scores[b.key];
    if (sa !== sb) return dir === 'asc' ? sa - sb : sb - sa;
    return a.order - b.order;
  });
  return [sorted[0].key, sorted[1].key];
}

/**
 * 主入口:每道题的作答 → 完整结果。
 *
 * 【要求每维都有题】按 dimension 分组后,每个维度必须至少有一道题,否则那一维算不出分。
 * 缺维度直接抛,不拿 0 顶替 —— 拿 0 顶替会算出看起来正常的错分数,那正是断点续答
 * 那条链路要防的静默错误。调用方应先用 isComplete 确认答满再调这里。
 */
export function computeResult(
  questions: readonly QuestionInput[],
  dimensions: readonly DimensionConfig[],
  tiers: readonly TierConfig[],
  opts: { scale: number },
): ScoreResult {
  // 按维度收集每题的归一化分
  const perDim = new Map<string, number[]>();
  for (const d of dimensions) perDim.set(d.key, []);
  for (const q of questions) {
    const bucket = perDim.get(q.dimension);
    if (!bucket) {
      // 题挂在一个不存在的维度上 —— config 校验应拦住,但这里不假设
      throw new Error(`computeResult: question references unknown dimension "${q.dimension}"`);
    }
    const s = perQuestionScore(q.optionIndex, q.optionCount, opts.scale);
    if (s === null) {
      throw new Error(
        `computeResult: invalid answer (optionIndex=${q.optionIndex}, optionCount=${q.optionCount})`,
      );
    }
    bucket.push(s);
  }

  const scores: Record<string, number> = {};
  for (const d of dimensions) {
    const arr = perDim.get(d.key)!;
    if (arr.length === 0) {
      throw new Error(`computeResult: no answers for dimension "${d.key}"`);
    }
    // 维度分 = 该维各题归一化分的平均,取一位小数
    scores[d.key] = round1(arr.reduce((sum, s) => sum + s, 0) / arr.length);
  }

  // 总分:五维简单平均,取整一次。这一个值同时用于显示和档位判定
  const mean = dimensions.reduce((sum, d) => sum + scores[d.key], 0) / dimensions.length;
  const total = round1(mean);

  const tier = tierForScore(total, tiers);
  if (tier === null) {
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
