import { describe, expect, it } from 'vitest';
import {
  cohortStanding,
  dimensionDiffs,
  selectBaseline,
  type ResultRow,
} from './reportStats';

const KEYS = ['goal', 'traffic', 'capture', 'convert', 'value'];

function row(total: number, tier: string, dims: Partial<Record<string, number>> = {}): ResultRow {
  const dimensions: Record<string, number> = {};
  for (const k of KEYS) dimensions[k] = dims[k] ?? total;
  return { total, tier, dimensions };
}

describe('selectBaseline', () => {
  it('uses the cohort when it has >= minN completed results', () => {
    const cohort = Array.from({ length: 10 }, () => row(4, 'systemic', { goal: 4, traffic: 2 }));
    const b = selectBaseline(cohort, [row(1, 'manual')], KEYS, 10);
    expect(b.source).toBe('cohort');
    expect(b.n).toBe(10);
    expect(b.means.goal).toBe(4);
    expect(b.means.traffic).toBe(2);
  });

  it('falls back to global when the cohort is below minN', () => {
    const cohort = [row(4, 'systemic')]; // only 1
    const global = Array.from({ length: 3 }, () => row(2, 'spot', { goal: 2 }));
    const b = selectBaseline(cohort, global, KEYS, 10);
    expect(b.source).toBe('global');
    expect(b.n).toBe(3);
    expect(b.means.goal).toBe(2);
  });

  it('with a single record, cohort baseline equals that record (honest degenerate case)', () => {
    // n=1 < 10 so it falls to global; if global is also just that 1, baseline == self
    const one = [row(3.4, 'semi_auto', { goal: 0.6 })];
    const b = selectBaseline(one, one, KEYS, 10);
    expect(b.source).toBe('global');
    expect(b.means.goal).toBe(0.6);
  });
});

describe('dimensionDiffs', () => {
  it('signed diff mine - baseline, one decimal', () => {
    const diffs = dimensionDiffs({ goal: 0.6, traffic: 5 }, { goal: 3.0, traffic: 3.0 }, ['goal', 'traffic']);
    expect(diffs.goal).toBe(-2.4);
    expect(diffs.traffic).toBe(2.0);
  });
});

describe('cohortStanding — bands, not exact rank', () => {
  it('top score lands in top25', () => {
    const all = [row(5, 'flywheel'), row(3, 'semi_auto'), row(2, 'spot'), row(1, 'manual')];
    const s = cohortStanding(5, 'flywheel', all);
    expect(s.band).toBe('top25');
  });

  it('bottom score lands in bottom25', () => {
    const all = [row(5, 'flywheel'), row(4, 'systemic'), row(3, 'semi_auto'), row(1, 'manual')];
    expect(cohortStanding(1, 'manual', all).band).toBe('bottom25');
  });

  it('counts same-tier others, excluding self', () => {
    const all = [row(3, 'semi_auto'), row(3.2, 'semi_auto'), row(3.4, 'semi_auto'), row(1, 'manual')];
    // 3 semi_auto total, minus self = 2 others
    expect(cohortStanding(3, 'semi_auto', all).sameTierOthers).toBe(2);
  });

  it('same-tier others never goes negative', () => {
    const all = [row(3, 'semi_auto')];
    expect(cohortStanding(3, 'semi_auto', all).sameTierOthers).toBe(0);
  });
});
