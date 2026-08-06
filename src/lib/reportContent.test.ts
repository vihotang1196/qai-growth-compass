import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import {
  computeCosts,
  roundToSignificant,
  evalCostFormula,
  rankByWeakness,
  rootCauseLevel,
  selectActions,
  type ActionLibrary,
  type DimensionRef,
} from './reportContent';

const DIMS: DimensionRef[] = [
  { key: 'goal', order: 1 },
  { key: 'traffic', order: 2 },
  { key: 'capture', order: 3 },
  { key: 'convert', order: 4 },
  { key: 'value', order: 5 },
];

describe('rankByWeakness', () => {
  it('orders low → high, ties broken by dimension.order', () => {
    const scores = { goal: 3, traffic: 1, capture: 1, convert: 5, value: 2 };
    // traffic & capture tie at 1 → order puts traffic(2) before capture(3)
    expect(rankByWeakness(scores, DIMS)).toEqual(['traffic', 'capture', 'value', 'goal', 'convert']);
  });
});

describe('rootCauseLevel — boundaries at 2.0 and 3.5', () => {
  it('low below 2.0', () => {
    expect(rootCauseLevel(1.9)).toBe('low');
    expect(rootCauseLevel(0)).toBe('low');
  });
  it('2.0 and 3.5 are mid', () => {
    expect(rootCauseLevel(2.0)).toBe('mid');
    expect(rootCauseLevel(3.5)).toBe('mid');
    expect(rootCauseLevel(2.8)).toBe('mid');
  });
  it('high above 3.5', () => {
    expect(rootCauseLevel(3.6)).toBe('high');
    expect(rootCauseLevel(5)).toBe('high');
  });
});

/** 小型 action library:每维 3 条,applies_below 各不同,便于测过滤与补位 */
function lib(): ActionLibrary {
  const mk = (dim: string, belows: number[]): ActionLibrary[string] => ({
    root_cause: { low: `${dim}-low`, mid: `${dim}-mid`, high: `${dim}-high` },
    actions: belows.map((b, i) => ({
      id: `${dim}_${i}`,
      zh: `${dim} action ${i}`,
      en: `${dim} action ${i}`,
      difficulty: 'low',
      impact: 'high',
      roi_rank: i + 1,
      applies_below: b,
    })),
  });
  return {
    goal: mk('goal', [3, 3.5, 4]),
    traffic: mk('traffic', [3, 3.5, 4]),
    capture: mk('capture', [3, 3.5, 4]),
    convert: mk('convert', [3, 3.5, 4]),
    value: mk('value', [3, 3.5, 4]),
  };
}

describe('selectActions', () => {
  it('picks from the weakest 2 dims, sorted by roi_rank, top 3', () => {
    // goal=0, traffic=0 weakest → both have 3 qualifying actions (all applies_below > 0)
    const scores = { goal: 0, traffic: 0, capture: 5, convert: 5, value: 5 };
    const picked = selectActions(scores, DIMS, lib());
    expect(picked).toHaveLength(3);
    // roi_rank 1 from each dim, then rank 2 — sorted: goal_0(1), traffic_0(1), then a rank-2
    expect(picked.map((a) => a.roi_rank)).toEqual([1, 1, 2]);
    expect(picked.every((a) => a.dimension === 'goal' || a.dimension === 'traffic')).toBe(true);
  });

  it('backfills from the next-weakest dims when the top 2 yield fewer than 3', () => {
    // goal=3.9, traffic=3.9 → only applies_below=4 qualifies in each → 2 candidates.
    // capture is next-weakest (also 3.9) → backfill one from it.
    const scores = { goal: 3.9, traffic: 3.9, capture: 3.9, convert: 5, value: 5 };
    const picked = selectActions(scores, DIMS, lib());
    expect(picked).toHaveLength(3);
    // third one must come from capture (the backfill dim), not goal/traffic
    expect(picked[2].dimension).toBe('capture');
  });

  it('returns fewer than 3 when nothing qualifies anywhere', () => {
    // every dim maxed → no action has applies_below > 5
    const scores = { goal: 5, traffic: 5, capture: 5, convert: 5, value: 5 };
    expect(selectActions(scores, DIMS, lib())).toEqual([]);
  });

  it('never repeats an action id', () => {
    const scores = { goal: 0, traffic: 3.9, capture: 3.9, convert: 3.9, value: 3.9 };
    const picked = selectActions(scores, DIMS, lib());
    expect(new Set(picked.map((a) => a.id)).size).toBe(picked.length);
  });
});

describe('evalCostFormula', () => {
  const vars = { L: 75, V: 4000, baseline_close_rate: 0.15 };

  it('evaluates a product of vars and literals', () => {
    // L * 0.30 * baseline_close_rate * V = 75 * 0.3 * 0.15 * 4000 = 13500
    expect(evalCostFormula('L * 0.30 * baseline_close_rate * V', vars)).toBeCloseTo(13500, 5);
  });

  it('handles a formula without baseline_close_rate', () => {
    // L * 0.08 * V = 75 * 0.08 * 4000 = 24000
    expect(evalCostFormula('L * 0.08 * V', vars)).toBeCloseTo(24000, 5);
  });

  it('throws on an unknown token instead of silently returning garbage', () => {
    // 不用 eval,遇到不认识的记号要响。防的是有人往公式里塞别的变量或表达式
    expect(() => evalCostFormula('L * FOO * V', vars)).toThrow(/unsupported token/);
    expect(() => evalCostFormula('L + V', vars)).toThrow(/unsupported token/);
  });
});

describe('computeCosts', () => {
  const costModel = {
    baseline_close_rate: 0.15,
    rules: [
      { dimension: 'capture', formula: 'L * 0.30 * baseline_close_rate * V', zh_label: 'a', en_label: 'a', zh_note: 'n' },
      { dimension: 'convert', formula: 'L * 0.08 * V', zh_label: 'b', en_label: 'b', zh_note: 'n' },
    ],
  };

  it('only emits lines for dimensions below the threshold', () => {
    // capture 2.0 (< 3.0) → emitted; convert 4.0 (>= 3.0) → skipped
    const lines = computeCosts({ capture: 2.0, convert: 4.0 }, 75, 4000, costModel);
    expect(lines.map((l) => l.dimension)).toEqual(['capture']);
    expect(lines[0].amount).toBeCloseTo(13500, 5);
  });

  it('skips a dimension whose score is missing', () => {
    expect(computeCosts({ convert: 1.0 }, 75, 4000, costModel).map((l) => l.dimension)).toEqual([
      'convert',
    ]);
  });
});

/**
 * 用真实 config 跑一遍:每条 cost 公式都只含已知变量与数字,不含会让 evalCostFormula 抛的记号。
 * 这把「有人往 config 公式里塞了新变量」挡在报告出错之前。
 */
describe('real config cost formulas are all safe products', () => {
  it('every rule formula evaluates without throwing', () => {
    const vars = { L: 100, V: 5000, baseline_close_rate: config.cost_model.baseline_close_rate };
    for (const rule of config.cost_model.rules) {
      expect(() => evalCostFormula(rule.formula, vars), `${rule.dimension}: ${rule.formula}`).not.toThrow();
    }
  });

  it('every cost rule dimension exists in dimensions', () => {
    const keys = new Set(config.dimensions.map((d) => d.key));
    for (const rule of config.cost_model.rules) expect(keys.has(rule.dimension), rule.dimension).toBe(true);
  });
});

describe('roundToSignificant — kills false precision in cost figures', () => {
  it('rounds to 2 significant figures', () => {
    expect(roundToSignificant(33750)).toBe(34000);
    expect(roundToSignificant(24000)).toBe(24000);
    expect(roundToSignificant(1234)).toBe(1200);
    expect(roundToSignificant(987)).toBe(990);
  });

  it('handles zero and small values without blowing up', () => {
    expect(roundToSignificant(0)).toBe(0);
    expect(roundToSignificant(7)).toBe(7);
    expect(roundToSignificant(NaN)).toBe(0);
  });
});
