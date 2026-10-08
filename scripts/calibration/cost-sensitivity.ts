/**
 * 课后校准 ③ —— cost_model 各系数的敏感度:每个系数 ±10%,学员报告里的金额分布怎么变。
 *
 *   npm run calib:cost                 # 真实学员(默认)
 *   npm run calib:cost -- --scope=test # 只跑测试批次
 *   npm run calib:cost -- --cohort=<uuid> [--json]
 *
 * 金额用线上同一套函数算:`computeCosts`(只对得分 < 3.0 的维度出一条)+ `roundToSignificant`
 * (报告里显示的是取整到 2 位有效数字的数)。L(月询盘)与 V(客单价)按 P2 / P3 的 value_map 解析,
 * 与报告端点相同;解析不出的人报告里没有代价换算,这里也不算。
 *
 * 变动的系数:
 *   - baseline_close_rate(5 条里 4 条用它)
 *   - 每条规则公式里那个假设值(capture 0.30、convert 0.08、traffic 0.50、value 0.25、goal 0.20)
 *   - 出代价的门槛 3.0(applies_when)—— 它不改金额,改的是「谁的报告里出现哪几条」
 *
 * 每个变体给:有代价换算的人数、条数、每人合计金额(显示值)的分布、与基准相比中位数变了多少、
 * 「报告里显示的数字会变」的人数。公式全是乘积,所以金额本身就是 ±10%;值得看的是取整之后有多少人的数字真的变了,
 * 以及门槛变动时有多少条出现 / 消失。
 */
import { computeCosts, roundToSignificant, type CostRule } from '../../src/lib/reportContent.ts';
import { config, fmt, header, parseArgs, pct, quantile, query, scopeWhere, table } from './lib.ts';

const args = parseArgs(process.argv.slice(2));
const P2 = config.profile_questions.find((p) => p.id === 'P2')!.value_map as number[];
const P3 = config.profile_questions.find((p) => p.id === 'P3')!.value_map as number[];
const BASE_THRESHOLD = 3.0;

const raw = query<{ dim_scores: Record<string, number>; p2: string | null; p3: string | null }>(`
  select r.dim_scores, s.profile->>'P2' as p2, s.profile->>'P3' as p3
  from assessment_results r
  join assessment_sessions s on s.id = r.session_id
  join assessment_entitlements e on e.id = s.entitlement_id
  left join assessment_cohorts c on c.id = e.cohort_id
  where ${scopeWhere(args.scope)}
`);

/** 与报告端点的 fromValueMap 相同:下标越界 / 缺失 → null */
const fromMap = (idx: string | null, map: number[]): number | null => {
  const i = idx === null ? NaN : Number(idx);
  return Number.isInteger(i) && i >= 0 && i < map.length ? map[i] : null;
};
const people = raw
  .map((r) => ({ dims: r.dim_scores, L: fromMap(r.p2, P2), V: fromMap(r.p3, P3) }))
  .filter((p): p is { dims: Record<string, number>; L: number; V: number } => p.L !== null && p.V !== null);

type Model = { baseline_close_rate: number; rules: readonly CostRule[] };
const BASE: Model = { baseline_close_rate: config.cost_model.baseline_close_rate, rules: config.cost_model.rules };

/** 公式里那个数字字面量(每条规则只有一个);换掉它就是改这条规则的假设 */
const literalOf = (formula: string): string => {
  const lits = formula.split('*').map((t) => t.trim()).filter((t) => Number.isFinite(Number(t)));
  if (lits.length !== 1) throw new Error(`expected exactly one numeric assumption in ${JSON.stringify(formula)}`);
  return lits[0];
};
const scaleRule = (m: Model, dim: string, f: number): Model => ({
  ...m,
  rules: m.rules.map((r) => {
    if (r.dimension !== dim) return r;
    const lit = literalOf(r.formula);
    const next = String(Math.round(Number(lit) * f * 1e6) / 1e6);
    return { ...r, formula: r.formula.split('*').map((t) => (t.trim() === lit ? ` ${next} ` : t)).join('*') };
  }),
});

interface Variant {
  name: string;
  model: Model;
  threshold: number;
}
const variants: Variant[] = [{ name: '基准(现在的 config)', model: BASE, threshold: BASE_THRESHOLD }];
for (const f of [0.9, 1.1]) {
  const tag = f < 1 ? '−10%' : '+10%';
  variants.push({ name: `baseline_close_rate ${BASE.baseline_close_rate} ${tag}`, model: { ...BASE, baseline_close_rate: BASE.baseline_close_rate * f }, threshold: BASE_THRESHOLD });
  for (const r of BASE.rules) variants.push({ name: `${r.dimension} 的假设 ${literalOf(r.formula)} ${tag}`, model: scaleRule(BASE, r.dimension, f), threshold: BASE_THRESHOLD });
  variants.push({ name: `门槛 ${BASE_THRESHOLD} ${tag}(→ ${+(BASE_THRESHOLD * f).toFixed(2)})`, model: BASE, threshold: BASE_THRESHOLD * f });
}

/** 一个人在报告里看到的:每条的显示金额(按维度) */
const shown = (p: (typeof people)[number], v: Variant): Map<string, number> =>
  new Map(computeCosts(p.dims, p.L, p.V, v.model, v.threshold).map((l) => [l.dimension, roundToSignificant(l.amount)]));

const baseShown = people.map((p) => shown(p, variants[0]));
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

const results = variants.map((v) => {
  const per = people.map((p) => shown(p, v));
  const totals = per.map(sum).filter((t) => t > 0);
  let changed = 0;
  let added = 0;
  let removed = 0;
  per.forEach((m, i) => {
    const b = baseShown[i];
    if (m.size !== b.size || [...m].some(([k, x]) => b.get(k) !== x)) changed++;
    for (const k of m.keys()) if (!b.has(k)) added++;
    for (const k of b.keys()) if (!m.has(k)) removed++;
  });
  return {
    name: v.name,
    withCosts: per.filter((m) => m.size > 0).length,
    lines: per.reduce((n, m) => n + m.size, 0),
    p25: quantile(totals, 0.25),
    median: quantile(totals, 0.5),
    p75: quantile(totals, 0.75),
    max: totals.length ? Math.max(...totals) : null,
    changed,
    added,
    removed,
  };
});
const baseMedian = results[0].median;

if (args.json) {
  console.log(JSON.stringify({ scope: args.scope, n: raw.length, withLV: people.length, results }, null, 2));
} else {
  console.log(header('cost_model 系数敏感度(每个 ±10%)', args, raw.length, [
    `其中能解析出 L 与 V(报告里有代价换算)的:${people.length} 人。金额是报告里显示的值(2 位有效数字),「合计」= 一个人所有代价条目相加,单位 RM / 月。`,
  ]));
  const lv = (map: number[], key: 'L' | 'V') => map.map((x) => `${x}:${people.filter((p) => p[key] === x).length}`).join(' ');
  console.log(`L(月询盘)分布 ${lv(P2, 'L')}   V(客单价 RM)分布 ${lv(P3, 'V')}\n`);
  const money = (x: number | null) => (x === null ? '—' : Math.round(x).toLocaleString('en-US'));
  console.log(
    table(
      ['变体', '有代价的人', '条数', '合计 p25', '合计中位', '合计 p75', '合计最大', '中位变化', '显示数字变了的人', '新出现 / 消失的条目'],
      results.map((r, i) => [
        r.name,
        String(r.withCosts),
        String(r.lines),
        money(r.p25),
        money(r.median),
        money(r.p75),
        money(r.max),
        i === 0 || baseMedian === null || r.median === null || baseMedian === 0 ? '' : `${r.median >= baseMedian ? '+' : ''}${fmt((100 * (r.median - baseMedian)) / baseMedian, 1)}%`,
        i === 0 ? '' : `${r.changed}(${pct(r.changed, people.length)})`,
        i === 0 ? '' : `+${r.added} / −${r.removed}`,
      ]),
    ),
  );
}
