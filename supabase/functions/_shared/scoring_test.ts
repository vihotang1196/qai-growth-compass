import { assertEquals, assertThrows } from '@std/assert';
import { computeResult, dimensionScore, round1, tierForScore } from './scoring.ts';
import {
  DIM_SCORE_TABLE,
  DIMS,
  OPTS,
  RESULT_CASES,
  TIER_BOUNDARY_CASES,
  TIERS,
} from '../../../src/lib/scoring.cases.ts';

// 用例与 Node 侧共用一份 —— 两侧各写一遍的话漏掉的那侧会显示「全部通过」
for (const c of RESULT_CASES) {
  Deno.test(`computeResult: ${c.name}`, () => {
    const r = computeResult(c.rawSums, DIMS, TIERS, OPTS);
    assertEquals(r.total, c.expectTotal);
    assertEquals(r.tier, c.expectTier);
    if (c.expectDim) assertEquals(r.dimensions, c.expectDim);
    if (c.expectWeakest) assertEquals(r.weakest, c.expectWeakest);
    if (c.expectStrongest) assertEquals(r.strongest, c.expectStrongest);
  });
}

for (const c of DIM_SCORE_TABLE) {
  Deno.test(`dimensionScore raw ${c.raw} → ${c.expect}`, () => {
    assertEquals(dimensionScore(c.raw, OPTS.maxRaw, OPTS.scale), c.expect);
  });
}

for (const c of TIER_BOUNDARY_CASES) {
  Deno.test(`tierForScore ${c.score} → ${c.expect}`, () => {
    assertEquals(tierForScore(c.score, TIERS), c.expect);
  });
}

Deno.test('round1: 2.85 → 2.9(没加 EPSILON 会得 2.8)', () => {
  assertEquals(round1(2.85), 2.9);
});

Deno.test('缺一个维度直接抛', () => {
  const { goal: _drop, ...missing } = Object.fromEntries(DIMS.map((d) => [d.key, 6]));
  assertThrows(() => computeResult(missing, DIMS, TIERS, OPTS), Error, 'missing raw sum');
});
