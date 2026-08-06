import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { polygonPoints } from '@/components/RadarPentagon';
import { selectBaseline, type ResultRow } from './reportStats';

/**
 * 雷达图的核心不变量:**当基准样本只有本人一条时,两个多边形必须逐点相等。**
 *
 * 【为什么这条永久留着】n=1 时基准 = 本人,两条线重合是可验证的事实。一旦渲染路径
 * 出现按位置(而不是按 key)取值的错误,这条会立刻红。而同样的错误到 n≥10 之后会变成
 * 「看起来合理但完全错误的对比」—— 那时黑虚线只是「别人的均值」,没人能一眼看出它错位。
 * 这是那类「错误跨越几层之后才显形」的链路,必须锁在最底下。
 *
 * 断言的是【构造 axes 的方式】与渲染一致:两者都按 config.dimensions 的顺序、按 key 取值。
 */
const SCALE = config.meta.score_scale;
const DIM_KEYS = config.dimensions.map((d) => d.key);

/** 与 Report.tsx 里 radarAxes 完全相同的构造方式 */
function buildAxisValues(
  mine: Record<string, number>,
  baselineMeans: Record<string, number>,
): { values: number[]; baselines: number[] } {
  return {
    values: config.dimensions.map((d) => mine[d.key] ?? 0),
    baselines: config.dimensions.map((d) => baselineMeans[d.key] ?? 0),
  };
}

describe('radar invariant: with a single sample, self and baseline polygons coincide', () => {
  /** 真实的一组分数(用户实测那次):goal 5.0 / traffic 2.8 / capture 3.6 / convert 5.0 / value 5.0 */
  const mine: Record<string, number> = {
    goal: 5.0,
    traffic: 2.8,
    capture: 3.6,
    convert: 5.0,
    value: 5.0,
  };

  it('baseline built from only my row equals my scores, key by key', () => {
    const row: ResultRow = { dimensions: mine, total: 4.3, tier: 'flywheel' };
    const baseline = selectBaseline([row], [row], DIM_KEYS, 10);
    for (const k of DIM_KEYS) {
      expect(baseline.means[k], `dimension ${k}`).toBe(mine[k]);
    }
  });

  it('the two polygons render to identical point strings', () => {
    const row: ResultRow = { dimensions: mine, total: 4.3, tier: 'flywheel' };
    const baseline = selectBaseline([row], [row], DIM_KEYS, 10);
    const { values, baselines } = buildAxisValues(mine, baseline.means);
    expect(polygonPoints(baselines, SCALE)).toBe(polygonPoints(values, SCALE));
  });

  it('a JSONB key order different from config order changes nothing (keyed access, not positional)', () => {
    // 这一条直接钉住「按 key 取值」:把同一份分数用打乱的 key 顺序重建一个对象,
    // 结果必须完全一样。若哪天有人改成按 Object.values / 位置遍历,这条会红。
    const shuffled: Record<string, number> = {};
    for (const k of ['goal', 'value', 'capture', 'convert', 'traffic']) shuffled[k] = mine[k];
    expect(Object.keys(shuffled)).not.toEqual(DIM_KEYS); // 顺序确实不同

    const row: ResultRow = { dimensions: shuffled, total: 4.3, tier: 'flywheel' };
    const baseline = selectBaseline([row], [row], DIM_KEYS, 10);
    const { values, baselines } = buildAxisValues(mine, baseline.means);
    expect(polygonPoints(baselines, SCALE)).toBe(polygonPoints(values, SCALE));
  });

  it('two different rows make the baseline differ — the polygons must then NOT coincide', () => {
    // 反向锁:基准确实是「样本的均值」,不是「本人的复制」。
    // 若某天基准被误接成本人,上面三条仍会绿,这条会红
    const other: ResultRow = {
      dimensions: { goal: 1, traffic: 1, capture: 1, convert: 1, value: 1 },
      total: 1,
      tier: 'manual',
    };
    const rows = [{ dimensions: mine, total: 4.3, tier: 'flywheel' }, other];
    const baseline = selectBaseline(rows, rows, DIM_KEYS, 2); // minN=2 → 用 cohort
    const { values, baselines } = buildAxisValues(mine, baseline.means);
    expect(polygonPoints(baselines, SCALE)).not.toBe(polygonPoints(values, SCALE));
    expect(baseline.n).toBe(2);
  });
});
