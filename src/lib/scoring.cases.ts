/**
 * 计分用例 —— Node 与 Deno 两侧共用。含三组手算验收(客户自己也能验算的那三组)。
 *
 * v3:计分从「raw_sum / 固定分母」改为「每题归一化 → 维度内平均」。用例据此重写。
 */
import type { QuestionInput } from './scoring.ts';

/** 五维,按 order。用真实 key,因为 topTwo 的平分处理要按 order */
export const DIMS = [
  { key: 'goal', order: 1 },
  { key: 'traffic', order: 2 },
  { key: 'capture', order: 3 },
  { key: 'value', order: 5 },
  { key: 'convert', order: 4 },
] as const;

/** v2 的 tiers,0–5 刻度(v3 不变) */
export const TIERS = [
  { key: 'manual', min: 0.0, max: 2.0 },
  { key: 'spot', min: 2.1, max: 2.8 },
  { key: 'semi_auto', min: 2.9, max: 3.5 },
  { key: 'systemic', min: 3.6, max: 4.2 },
  { key: 'flywheel', min: 4.3, max: 5.0 },
] as const;

export const SCALE = 5;

/**
 * 15 道题的形状(维度 + 选项数)。只有 T2/C2/C3 是 4 选项,其余 3 选项。
 * 有一条测试断言这份 fixture 与真实 config 一致,防止它偷偷漂移。
 */
export const QUESTIONS_SHAPE: Array<{ id: string; dimension: string; optionCount: number }> = [
  { id: 'G1', dimension: 'goal', optionCount: 3 },
  { id: 'G2', dimension: 'goal', optionCount: 3 },
  { id: 'G3', dimension: 'goal', optionCount: 3 },
  { id: 'T1', dimension: 'traffic', optionCount: 3 },
  { id: 'T2', dimension: 'traffic', optionCount: 4 },
  { id: 'T3', dimension: 'traffic', optionCount: 3 },
  { id: 'C1', dimension: 'capture', optionCount: 3 },
  { id: 'C2', dimension: 'capture', optionCount: 4 },
  { id: 'C3', dimension: 'capture', optionCount: 4 },
  { id: 'V1', dimension: 'convert', optionCount: 3 },
  { id: 'V2', dimension: 'convert', optionCount: 3 },
  { id: 'V3', dimension: 'convert', optionCount: 3 },
  { id: 'M1', dimension: 'value', optionCount: 3 },
  { id: 'M2', dimension: 'value', optionCount: 3 },
  { id: 'M3', dimension: 'value', optionCount: 3 },
];

/** 每道题都选「零格」(index 0) */
export function allZero(): QuestionInput[] {
  return QUESTIONS_SHAPE.map((q) => ({ dimension: q.dimension, optionIndex: 0, optionCount: q.optionCount }));
}

/** 每道题都选「顶格」(index = optionCount-1) */
export function allMax(): QuestionInput[] {
  return QUESTIONS_SHAPE.map((q) => ({
    dimension: q.dimension,
    optionIndex: q.optionCount - 1,
    optionCount: q.optionCount,
  }));
}

/** 指定某一维全零,其余全顶格 */
export function oneDimZero(zeroDim: string): QuestionInput[] {
  return QUESTIONS_SHAPE.map((q) => ({
    dimension: q.dimension,
    optionIndex: q.dimension === zeroDim ? 0 : q.optionCount - 1,
    optionCount: q.optionCount,
  }));
}

export interface ResultCase {
  name: string;
  questions: QuestionInput[];
  expectTotal: number;
  expectTier: string;
  expectDim?: Record<string, number>;
  expectWeakest?: [string, string];
  expectStrongest?: [string, string];
}

export const RESULT_CASES: ResultCase[] = [
  {
    // 手算验收 ①
    name: 'all zero → every dim 0.0, total 0.0, manual',
    questions: allZero(),
    expectTotal: 0.0,
    expectTier: 'manual',
    expectDim: { goal: 0, traffic: 0, capture: 0, convert: 0, value: 0 },
  },
  {
    // 手算验收 ② —— 顶格无论 3 还是 4 选项都归一到 5.0,这正是「权重相等」
    name: 'all max → every dim 5.0, total 5.0, flywheel',
    questions: allMax(),
    expectTotal: 5.0,
    expectTier: 'flywheel',
    expectDim: { goal: 5, traffic: 5, capture: 5, convert: 5, value: 5 },
  },
  {
    // 手算验收 ③ —— 简单平均 (0+5+5+5+5)/5 = 4.0;木桶会给 2.8
    name: 'goal all zero, rest all max → goal 0.0 rest 5.0, total 4.0, systemic',
    questions: oneDimZero('goal'),
    expectTotal: 4.0,
    expectTier: 'systemic',
    expectDim: { goal: 0, traffic: 5, capture: 5, convert: 5, value: 5 },
    expectWeakest: ['goal', 'traffic'],
    expectStrongest: ['traffic', 'capture'],
  },
];

/** perQuestionScore 全表。半分位与 4 选项的 1.6667 / 3.3333 是易错点 */
export const PER_QUESTION_CASES: Array<{
  optionIndex: number;
  optionCount: number;
  expect: number | null;
  why: string;
}> = [
  { optionIndex: 0, optionCount: 3, expect: 0, why: '3-option, zero' },
  { optionIndex: 1, optionCount: 3, expect: 2.5, why: '3-option, middle' },
  { optionIndex: 2, optionCount: 3, expect: 5, why: '3-option, top = full' },
  { optionIndex: 0, optionCount: 4, expect: 0, why: '4-option, zero' },
  { optionIndex: 1, optionCount: 4, expect: 1.6667, why: '4-option, 2nd' },
  { optionIndex: 2, optionCount: 4, expect: 3.3333, why: '4-option, 3rd (NOT full)' },
  { optionIndex: 3, optionCount: 4, expect: 5, why: '4-option, top = full' },
  { optionIndex: 3, optionCount: 3, expect: null, why: 'out of range (3-option has no index 3)' },
  { optionIndex: -1, optionCount: 3, expect: null, why: 'negative index' },
  { optionIndex: 1.5, optionCount: 3, expect: null, why: 'non-integer' },
  { optionIndex: 0, optionCount: 1, expect: null, why: 'option_count < 2, divisor is 0' },
];

/** 徽章判定:按归一化分,不按 option_index。这是 v3 的连带修正 */
export const BADGE_CASES: Array<{ optionIndex: number; optionCount: number; expect: string; why: string }> = [
  { optionIndex: 0, optionCount: 3, expect: 'missing', why: '3-option, zero' },
  { optionIndex: 1, optionCount: 3, expect: 'partial', why: '3-option, middle' },
  { optionIndex: 2, optionCount: 3, expect: 'full', why: '3-option index 2 = full' },
  { optionIndex: 0, optionCount: 4, expect: 'missing', why: '4-option, zero' },
  { optionIndex: 1, optionCount: 4, expect: 'partial', why: '4-option index 1' },
  // 这一条是连带修正的核心:index 2 在 4 选项题只有 3.33,是 partial 不是 full。
  // 旧逻辑 (index === 3 → full) 会把 3 选项的 index 2 错标成 partial
  { optionIndex: 2, optionCount: 4, expect: 'partial', why: '4-option index 2 = 3.33 → partial' },
  { optionIndex: 3, optionCount: 4, expect: 'full', why: '4-option top → full' },
];
