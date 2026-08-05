import { assertEquals } from '@std/assert';
import { isComplete, nextStep, progress } from './quizFlow.ts';
import { PROFILE_IDS, QUESTION_IDS, STEP_CASES } from '../../../src/lib/quizFlow.cases.ts';

// 用例与 Node 侧共用一份 —— 两侧各写一遍的话漏掉的那侧会显示「全部通过」
for (const c of STEP_CASES) {
  Deno.test(`nextStep: ${c.name}`, () => {
    assertEquals(nextStep(PROFILE_IDS, QUESTION_IDS, new Set(c.answered)), c.expected);
  });
}


Deno.test('isComplete:数量凑够但有配置外的旧答案 → 不算答完', () => {
  const answered = new Set(['P1', 'P2', 'P3', 'G1', 'G2', 'G3', 'G4', 'M1', 'X_DELETED']);
  assertEquals(answered.size, [...PROFILE_IDS, ...QUESTION_IDS].length);
  assertEquals(isComplete(PROFILE_IDS, QUESTION_IDS, answered), false);
});

Deno.test('progress:配置外的旧答案不把进度顶过 100%', () => {
  const answered = new Set([...PROFILE_IDS, ...QUESTION_IDS, 'X_DELETED']);
  assertEquals(progress(PROFILE_IDS, QUESTION_IDS, answered), { done: 9, total: 9, pct: 100 });
});
