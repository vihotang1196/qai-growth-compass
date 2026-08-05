/**
 * 计分用例 —— Node 与 Deno 两侧共用。含三组手算验收(客户自己也能验算的那三组)。
 */

/** 五维,按 order。用真实 key,因为 topTwo 的平分处理要按 order */
export const DIMS = [
  { key: 'goal', order: 1 },
  { key: 'traffic', order: 2 },
  { key: 'capture', order: 3 },
  { key: 'convert', order: 4 },
  { key: 'value', order: 5 },
] as const;

/** v2 的 tiers,0–5 刻度 */
export const TIERS = [
  { key: 'manual', min: 0.0, max: 2.0 },
  { key: 'spot', min: 2.1, max: 2.8 },
  { key: 'semi_auto', min: 2.9, max: 3.5 },
  { key: 'systemic', min: 3.6, max: 4.2 },
  { key: 'flywheel', min: 4.3, max: 5.0 },
] as const;

export const OPTS = { maxRaw: 12, scale: 5 };

/** 把「每维每题都选某个下标」展开成 raw_sum。每维 4 题,option value = 下标(0–3) */
export function rawSumsAllSame(optionValue: number): Record<string, number> {
  const per = optionValue * 4;
  return Object.fromEntries(DIMS.map((d) => [d.key, per]));
}

export interface ResultCase {
  name: string;
  rawSums: Record<string, number>;
  expectTotal: number;
  expectTier: string;
  expectDim?: Record<string, number>;
  expectWeakest?: [string, string];
  expectStrongest?: [string, string];
}

export const RESULT_CASES: ResultCase[] = [
  {
    // 手算验收 ①
    name: 'all 0 → every dim 0.0, total 0.0, manual',
    rawSums: rawSumsAllSame(0),
    expectTotal: 0.0,
    expectTier: 'manual',
    expectDim: { goal: 0, traffic: 0, capture: 0, convert: 0, value: 0 },
  },
  {
    // 手算验收 ②
    name: 'all 3 → every dim 5.0, total 5.0, flywheel',
    rawSums: rawSumsAllSame(3),
    expectTotal: 5.0,
    expectTier: 'flywheel',
    expectDim: { goal: 5, traffic: 5, capture: 5, convert: 5, value: 5 },
  },
  {
    // 手算验收 ③ —— 唯一能区分简单平均与木桶加权的一组。
    // 简单平均 (0+5+5+5+5)/5 = 4.0 → systemic;木桶 0.7×4+0.3×0 = 2.8 会算成 spot
    name: 'one dim all 0, rest all 3 → that dim 0.0 rest 5.0, total 4.0, systemic',
    rawSums: { goal: 0, traffic: 12, capture: 12, convert: 12, value: 12 },
    expectTotal: 4.0,
    expectTier: 'systemic',
    expectDim: { goal: 0, traffic: 5, capture: 5, convert: 5, value: 5 },
    // 最弱:goal(0)最低,其余全 5.0 平分 → order 靠前的 traffic
    expectWeakest: ['goal', 'traffic'],
    // 最强:全 5.0 平分 → order 靠前的 traffic、capture
    expectStrongest: ['traffic', 'capture'],
  },
];

/** dimensionScore 全表:raw_sum 0–12 各自的分数。半分位(3→1.25、6→2.5、9→3.75)是易错点 */
export const DIM_SCORE_TABLE: Array<{ raw: number; expect: number }> = [
  { raw: 0, expect: 0.0 },
  { raw: 1, expect: 0.4 },
  { raw: 2, expect: 0.8 },
  { raw: 3, expect: 1.3 }, // 1.25 → round-half-up → 1.3
  { raw: 4, expect: 1.7 },
  { raw: 5, expect: 2.1 },
  { raw: 6, expect: 2.5 },
  { raw: 7, expect: 2.9 },
  { raw: 8, expect: 3.3 },
  { raw: 9, expect: 3.8 }, // 3.75 → round-half-up → 3.8
  { raw: 10, expect: 4.2 },
  { raw: 11, expect: 4.6 },
  { raw: 12, expect: 5.0 },
];

/** 档位边界:每个切点的两侧各取一个,确认落在预期档。这些点是 tiers 定义里最脆的地方 */
export const TIER_BOUNDARY_CASES: Array<{ score: number; expect: string }> = [
  { score: 0.0, expect: 'manual' },
  { score: 2.0, expect: 'manual' },
  { score: 2.1, expect: 'spot' },
  { score: 2.8, expect: 'spot' },
  { score: 2.9, expect: 'semi_auto' },
  { score: 3.5, expect: 'semi_auto' },
  { score: 3.6, expect: 'systemic' },
  { score: 4.2, expect: 'systemic' },
  { score: 4.3, expect: 'flywheel' },
  { score: 5.0, expect: 'flywheel' },
];
