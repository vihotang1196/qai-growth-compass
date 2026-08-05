/**
 * 断点续答的用例 —— Node 与 Deno 两侧的测试都 import 这一份。
 *
 * 【为什么用例单独一个文件】跟 phone.cases.ts 同一个理由:两侧各写一遍用例,
 * 迟早有一侧漏掉某个用例,而漏掉的那一侧会显示「全部通过」。
 * 一份用例两侧共用,漏就一起漏,不会出现一侧绿一侧红的假象。
 */
import type { QuizStep } from './quizFlow.ts';

export const PROFILE_IDS = ['P1', 'P2', 'P3'] as const;
/** 真实是 24 题;用例里用 6 题,因为要测的是空洞与边界,不是题量 */
export const QUESTION_IDS = ['G1', 'G2', 'G3', 'G4', 'M1', 'M2'] as const;

export interface StepCase {
  name: string;
  answered: string[];
  expected: QuizStep;
}

export const STEP_CASES: StepCase[] = [
  {
    name: 'nothing answered → first profile question',
    answered: [],
    expected: { phase: 'profile', index: 0 },
  },
  {
    name: 'one profile answer → second profile question',
    answered: ['P1'],
    expected: { phase: 'profile', index: 1 },
  },
  {
    name: 'profile done → first scored question',
    answered: ['P1', 'P2', 'P3'],
    expected: { phase: 'questions', index: 0 },
  },
  {
    name: 'three scored answers → fourth question',
    answered: ['P1', 'P2', 'P3', 'G1', 'G2', 'G3'],
    expected: { phase: 'questions', index: 3 },
  },
  {
    name: 'everything answered → done',
    answered: ['P1', 'P2', 'P3', 'G1', 'G2', 'G3', 'G4', 'M1', 'M2'],
    expected: { phase: 'done' },
  },

  // ── 空洞:这几条是这个模块存在的理由 ──────────────────────────
  {
    // 按「最后已答之后」续会跳到 M1,G3 永久缺失 → 该维度 raw_sum 少一题,
    // 而公式分母写死 12,那一维分数被静默低估,报告的最弱维度可能指错
    name: 'gap in scored questions → back to the gap, not past the last answered',
    answered: ['P1', 'P2', 'P3', 'G1', 'G2', 'G4'],
    expected: { phase: 'questions', index: 2 },
  },
  {
    name: 'gap in profile → fill the profile gap before scored questions',
    answered: ['P1', 'P3', 'G1', 'G2'],
    expected: { phase: 'profile', index: 1 },
  },
  {
    name: 'only the last question answered → back to the first',
    answered: ['M2'],
    expected: { phase: 'profile', index: 0 },
  },
  {
    name: 'profile empty but scored full → still back to profile',
    answered: ['G1', 'G2', 'G3', 'G4', 'M1', 'M2'],
    expected: { phase: 'profile', index: 0 },
  },

  // ── 配置外的旧答案 ────────────────────────────────────────
  {
    // 题目改版之后库里可能留着已删除题目的答案。数量凑够了,但覆盖没够 ——
    // 按数量判断会误认为答完
    name: 'stale answer not in config → ignored for coverage, back to the real gap',
    answered: ['P1', 'P2', 'P3', 'G1', 'G2', 'G3', 'G4', 'M1', 'X_DELETED'],
    expected: { phase: 'questions', index: 5 },
  },
];

export interface ScoreCase {
  optionIndex: number;
  optionValues: number[];
  expected: number | null;
  why: string;
}

export const SCORE_CASES: ScoreCase[] = [
  { optionIndex: 0, optionValues: [0, 1, 2, 3], expected: 0, why: 'first option' },
  { optionIndex: 3, optionValues: [0, 1, 2, 3], expected: 3, why: 'last option' },
  { optionIndex: 4, optionValues: [0, 1, 2, 3], expected: null, why: 'out of range → null, caller returns 400' },
  { optionIndex: -1, optionValues: [0, 1, 2, 3], expected: null, why: 'negative index' },
  { optionIndex: 1.5, optionValues: [0, 1, 2, 3], expected: null, why: 'non-integer' },
  { optionIndex: NaN, optionValues: [0, 1, 2, 3], expected: null, why: 'NaN' },
  {
    // 这一条是「查表而不是直接用下标」的证据:如果实现写成 return optionIndex,
    // 上面几条全过,只有这条会红
    optionIndex: 2,
    optionValues: [0, 1, 3, 5],
    expected: 3,
    why: 'non-linear scale — using the index directly gives 2, the table gives 3',
  },
];
