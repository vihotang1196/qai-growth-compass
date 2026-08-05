import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { badgeForScore, computeResult, perQuestionScore, round1, tierForScore } from './scoring';
import {
  BADGE_CASES,
  DIMS,
  PER_QUESTION_CASES,
  QUESTIONS_SHAPE,
  RESULT_CASES,
  SCALE,
  TIERS,
} from './scoring.cases';

describe('round1 — round-half-up, dodging float error', () => {
  it('half-tenths round up; 2.85 → 2.9 (needs EPSILON)', () => {
    expect(round1(1.25)).toBe(1.3);
    expect(round1(2.5)).toBe(2.5);
    expect(round1(2.85)).toBe(2.9);
  });
});

describe('perQuestionScore — normalize by option_count', () => {
  for (const c of PER_QUESTION_CASES) {
    it(`(${c.optionIndex}, ${c.optionCount}) → ${c.expect} (${c.why})`, () => {
      expect(perQuestionScore(c.optionIndex, c.optionCount, SCALE)).toBe(c.expect);
    });
  }
});

describe('badgeForScore — by normalized score, not option_index', () => {
  for (const c of BADGE_CASES) {
    it(`index ${c.optionIndex} of ${c.optionCount} → ${c.expect} (${c.why})`, () => {
      const s = perQuestionScore(c.optionIndex, c.optionCount, SCALE)!;
      expect(badgeForScore(s, SCALE)).toBe(c.expect);
    });
  }

  it('the connected fix: 3-option index 2 is full, 4-option index 2 is partial', () => {
    // 同一个 option_index 2,在 3 选项题里是满分、4 选项题里不是 —— 这是徽章必须按
    // 归一化分判定的整个理由。旧的 index===3→full 会把 3 选项的满分错标成 partial
    expect(badgeForScore(perQuestionScore(2, 3, SCALE)!, SCALE)).toBe('full');
    expect(badgeForScore(perQuestionScore(2, 4, SCALE)!, SCALE)).toBe('partial');
  });
});

describe('tierForScore — boundaries', () => {
  it('lands each boundary in the right tier', () => {
    expect(tierForScore(2.0, TIERS)).toBe('manual');
    expect(tierForScore(2.1, TIERS)).toBe('spot');
    expect(tierForScore(2.8, TIERS)).toBe('spot');
    expect(tierForScore(2.9, TIERS)).toBe('semi_auto');
    expect(tierForScore(4.3, TIERS)).toBe('flywheel');
  });
  it('out of range → null', () => {
    expect(tierForScore(-0.1, TIERS)).toBeNull();
    expect(tierForScore(5.1, TIERS)).toBeNull();
  });
});

describe('computeResult — three hand-verification cases', () => {
  for (const c of RESULT_CASES) {
    it(c.name, () => {
      const r = computeResult(c.questions, DIMS, TIERS, { scale: SCALE });
      expect(r.total, 'total').toBe(c.expectTotal);
      expect(r.tier, 'tier').toBe(c.expectTier);
      if (c.expectDim) expect(r.dimensions).toEqual(c.expectDim);
      if (c.expectWeakest) expect(r.weakest, 'weakest').toEqual(c.expectWeakest);
      if (c.expectStrongest) expect(r.strongest, 'strongest').toEqual(c.expectStrongest);
    });
  }

  it('case 3 total is 4.0 (simple average), not the bucket-weighted 2.8', () => {
    const r = computeResult(RESULT_CASES[2].questions, DIMS, TIERS, { scale: SCALE });
    expect(r.total).not.toBe(2.8);
    expect(r.total).toBe(4.0);
  });

  it('a missing dimension throws, no 0 substitution', () => {
    // 去掉 goal 的三道题 → goal 无题可算。拿 0 顶替会算出看起来正常的错分数
    const missing = RESULT_CASES[1].questions.filter((q) => q.dimension !== 'goal');
    expect(() => computeResult(missing, DIMS, TIERS, { scale: SCALE })).toThrow(/no answers for dimension/);
  });

  it('an out-of-range answer throws', () => {
    const bad = [...allMaxLike(), { dimension: 'goal', optionIndex: 9, optionCount: 3 }];
    expect(() => computeResult(bad, DIMS, TIERS, { scale: SCALE })).toThrow(/invalid answer/);
  });

  it('ties break by order, not array position of DIMS', () => {
    // DIMS 在 cases 里刻意乱序(value 排在 convert 前)。全维同分时最弱/最强都应是
    // order 最靠前的 goal、traffic —— 证明 topTwo 按 order 不按数组下标
    const allMid = QUESTIONS_SHAPE.map((q) => ({ dimension: q.dimension, optionIndex: 0, optionCount: q.optionCount }));
    const r = computeResult(allMid, DIMS, TIERS, { scale: SCALE });
    expect(r.weakest).toEqual(['goal', 'traffic']);
    expect(r.strongest).toEqual(['goal', 'traffic']);
  });
});

function allMaxLike() {
  return QUESTIONS_SHAPE.map((q) => ({
    dimension: q.dimension,
    optionIndex: q.optionCount - 1,
    optionCount: q.optionCount,
  }));
}

/**
 * fixture 与真实 config 对齐 —— cases 手写的 DIMS / TIERS / SCALE / QUESTIONS_SHAPE
 * 一旦和 config 分叉,验收就验的是一个不存在的东西。
 */
describe('scoring cases align with config', () => {
  it('SCALE == config.meta.score_scale', () => {
    expect(SCALE).toBe(config.meta.score_scale);
  });

  it('TIERS == config.tiers', () => {
    expect(TIERS.map((t) => [t.key, t.min, t.max])).toEqual(
      config.tiers.map((t) => [t.key, t.min, t.max]),
    );
  });

  it('DIMS == config.dimensions (compared by order)', () => {
    const norm = (arr: { key: string; order: number }[]) =>
      [...arr].sort((a, b) => a.order - b.order).map((d) => [d.key, d.order]);
    expect(norm(DIMS as unknown as { key: string; order: number }[])).toEqual(
      norm(config.dimensions),
    );
  });

  it('QUESTIONS_SHAPE == config.questions (id, dimension, option_count)', () => {
    expect(QUESTIONS_SHAPE).toEqual(
      config.questions.map((q) => ({
        id: q.id,
        dimension: q.dimension,
        optionCount: q.option_count,
      })),
    );
  });
});
