import { assertEquals, assertThrows } from '@std/assert';
import { badgeForScore, computeResult, perQuestionScore, round1, tierForScore } from './scoring.ts';
import {
  BADGE_CASES,
  DIMS,
  PER_QUESTION_CASES,
  QUESTIONS_SHAPE,
  RESULT_CASES,
  SCALE,
  TIERS,
} from '../../../src/lib/scoring.cases.ts';

// 用例与 Node 侧共用一份 —— 两侧各写一遍的话漏掉的那侧会显示「全部通过」
for (const c of RESULT_CASES) {
  Deno.test(`computeResult: ${c.name}`, () => {
    const r = computeResult(c.questions, DIMS, TIERS, { scale: SCALE });
    assertEquals(r.total, c.expectTotal);
    assertEquals(r.tier, c.expectTier);
    if (c.expectDim) assertEquals(r.dimensions, c.expectDim);
    if (c.expectWeakest) assertEquals(r.weakest, c.expectWeakest);
    if (c.expectStrongest) assertEquals(r.strongest, c.expectStrongest);
  });
}

for (const c of PER_QUESTION_CASES) {
  Deno.test(`perQuestionScore (${c.optionIndex},${c.optionCount}) → ${c.expect} (${c.why})`, () => {
    assertEquals(perQuestionScore(c.optionIndex, c.optionCount, SCALE), c.expect);
  });
}

for (const c of BADGE_CASES) {
  Deno.test(`badge index ${c.optionIndex}/${c.optionCount} → ${c.expect} (${c.why})`, () => {
    const s = perQuestionScore(c.optionIndex, c.optionCount, SCALE)!;
    assertEquals(badgeForScore(s, SCALE), c.expect);
  });
}

Deno.test('round1: 2.85 → 2.9(没加 EPSILON 会得 2.8)', () => {
  assertEquals(round1(2.85), 2.9);
});

Deno.test('tierForScore 越界 → null', () => {
  assertEquals(tierForScore(5.1, TIERS), null);
});

Deno.test('缺一个维度直接抛', () => {
  const missing = QUESTIONS_SHAPE.filter((q) => q.dimension !== 'goal').map((q) => ({
    dimension: q.dimension,
    optionIndex: q.optionCount - 1,
    optionCount: q.optionCount,
  }));
  assertThrows(() => computeResult(missing, DIMS, TIERS, { scale: SCALE }), Error, 'no answers for dimension');
});
