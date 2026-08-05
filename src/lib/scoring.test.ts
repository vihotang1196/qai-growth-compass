import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { computeResult, dimensionScore, round1, tierForScore } from './scoring';
import {
  DIM_SCORE_TABLE,
  DIMS,
  OPTS,
  RESULT_CASES,
  TIER_BOUNDARY_CASES,
  TIERS,
} from './scoring.cases';

describe('round1 — round-half-up, dodging float error', () => {
  it('half-tenths round up', () => {
    expect(round1(1.25)).toBe(1.3);
    expect(round1(3.75)).toBe(3.8);
    expect(round1(2.5)).toBe(2.5);
    // 这一条如果失败,说明没加 EPSILON:2.85*10 在 float 里是 28.4999…
    expect(round1(2.85)).toBe(2.9);
  });
});

describe('dimensionScore', () => {
  for (const c of DIM_SCORE_TABLE) {
    it(`raw ${c.raw} → ${c.expect}`, () => {
      expect(dimensionScore(c.raw, OPTS.maxRaw, OPTS.scale)).toBe(c.expect);
    });
  }
});

describe('tierForScore — boundaries land in the right tier', () => {
  for (const c of TIER_BOUNDARY_CASES) {
    it(`${c.score} → ${c.expect}`, () => {
      expect(tierForScore(c.score, TIERS)).toBe(c.expect);
    });
  }
  it('out of range returns null, no silent fallback', () => {
    expect(tierForScore(-0.1, TIERS)).toBeNull();
    expect(tierForScore(5.1, TIERS)).toBeNull();
  });
});

describe('computeResult — three hand-verification cases', () => {
  for (const c of RESULT_CASES) {
    it(c.name, () => {
      const r = computeResult(c.rawSums, DIMS, TIERS, OPTS);
      expect(r.total, 'total').toBe(c.expectTotal);
      expect(r.tier, 'tier').toBe(c.expectTier);
      if (c.expectDim) expect(r.dimensions).toEqual(c.expectDim);
      if (c.expectWeakest) expect(r.weakest, 'weakest').toEqual(c.expectWeakest);
      if (c.expectStrongest) expect(r.strongest, 'strongest').toEqual(c.expectStrongest);
    });
  }

  it('case 3 total is not the bucket-weighted 2.8', () => {
    // 显式钉住:如果哪天有人把 total_formula 改回木桶,这一条会红并指名 2.8
    const r = computeResult({ goal: 0, traffic: 12, capture: 12, convert: 12, value: 12 }, DIMS, TIERS, OPTS);
    expect(r.total).not.toBe(2.8);
    expect(r.total).toBe(4.0);
  });

  it('a missing dimension throws, no 0 substitution', () => {
    // 拿 0 顶替会算出一个看起来正常的错分数 —— 那正是要防的静默错误
    const { goal: _drop, ...missing } = rawSumsFull();
    expect(() => computeResult(missing, DIMS, TIERS, OPTS)).toThrow(/missing raw sum/);
  });

  it('ties in weakest break by order, not array position', () => {
    // 全维同分:最弱两维应是 order 最靠前的 goal、traffic
    const r = computeResult(rawSumsFull(), DIMS, TIERS, OPTS);
    expect(r.weakest).toEqual(['goal', 'traffic']);
    expect(r.strongest).toEqual(['goal', 'traffic']);
  });
});

function rawSumsFull(): Record<string, number> {
  return Object.fromEntries(DIMS.map((d) => [d.key, 6]));
}

/**
 * 计分用的常量与 config 一致 —— cases 里手写的 TIERS / OPTS / DIMS 必须等于配置。
 * 手写是为了让用例自解释,但一旦和 config 分叉,验收就验的是一个不存在的标度。
 */
describe('scoring cases align with config', () => {
  it('OPTS equals config max_raw / scale', () => {
    expect(OPTS.maxRaw).toBe(config.meta.max_raw_per_dimension);
    expect(OPTS.scale).toBe(config.meta.score_scale);
    expect(OPTS.maxRaw).toBe(4 * Math.max(...config.scoring.option_values));
  });

  it('TIERS equals config.tiers', () => {
    expect(TIERS.map((t) => [t.key, t.min, t.max])).toEqual(
      config.tiers.map((t) => [t.key, t.min, t.max]),
    );
  });

  it('DIMS key/order equals config.dimensions', () => {
    expect(DIMS.map((d) => [d.key, d.order])).toEqual(
      config.dimensions.map((d) => [d.key, d.order]),
    );
  });
});
