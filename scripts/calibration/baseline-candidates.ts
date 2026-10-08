/**
 * 课后校准 ② —— 各维度批次基准线的候选值,与现在报告里用的那条对比。
 *
 *   npm run calib:baseline                 # 真实学员(默认):每个真实批次 + 全部真实学员
 *   npm run calib:baseline -- --scope=test # 只跑测试批次
 *   npm run calib:baseline -- --cohort=<uuid> [--json]
 *
 * 「现在用的」= 报告端点用的同一个函数 `selectBaseline`(src/lib/reportStats.ts):
 * 本批已出分 ≥ min_n_for_baseline(10)就用本批的**均值**,否则用全部真实学员的均值。
 * 候选值都在**同一个样本池**上算:中位数、10% 截尾均值、p10 / p25 / p75 / p90。
 * 末列「中位 − 现用」为正,说明均值被低分拉低了(分布左偏);为负则相反。
 *
 * 另给每个批次的总分分布与档位分布 —— 改档位区间(tiers)前要看的就是这个。
 *
 * 【测试模式不取真实池】--scope=test 时只取测试批次的行;某个测试批次不足 10 人时,
 * 报告用的是全部真实学员的均值,而这里不去取它(只跑测试批次的模式不该读到真实学员)。
 */
import { selectBaseline, type ResultRow } from '../../src/lib/reportStats.ts';
import { config, fmt, header, parseArgs, quantile, query, scopeWhere, table, trimmedMean, mean } from './lib.ts';

const args = parseArgs(process.argv.slice(2));
const DIMS = config.dimensions.map((d) => d.key);
const MIN_N = config.cohorts.min_n_for_baseline;

interface Row {
  cohort_id: string | null;
  cohort: string | null;
  is_test: boolean | null;
  dim_scores: Record<string, number>;
  total: string | number;
  tier: string;
}

const raw = query<Row>(`
  select c.id::text as cohort_id, c.name as cohort, c.is_test, r.dim_scores, r.total, r.tier
  from assessment_results r
  join assessment_sessions s on s.id = r.session_id
  join assessment_entitlements e on e.id = s.entitlement_id
  left join assessment_cohorts c on c.id = e.cohort_id
  where ${scopeWhere(args.scope)}
`);
const toRow = (r: Row): ResultRow => ({ dimensions: r.dim_scores, total: Number(r.total), tier: r.tier });

// 「全部真实学员」池:只有 --scope=real 时取得到(与 baselinePools 的 globalRows 同一判据:不是测试批次)
const globalRows = args.scope.kind === 'real' ? raw.map(toRow) : [];

const groups = new Map<string, { label: string; isTest: boolean; rows: ResultRow[] }>();
for (const r of raw) {
  const key = r.cohort_id ?? '(none)';
  if (!groups.has(key)) groups.set(key, { label: r.cohort ?? '(批次已删除)', isTest: r.is_test === true, rows: [] });
  groups.get(key)!.rows.push(toRow(r));
}

interface Report {
  label: string;
  isTest: boolean;
  n: number;
  current: { source: string; n: number; means: Record<string, number> } | null;
  pool: string;
  dims: Record<string, Record<string, number | null>>;
  totals: Record<string, number | null>;
  tiers: Record<string, number>;
}

function analyse(label: string, isTest: boolean, rows: ResultRow[], pooled: boolean): Report {
  // 「现在用的」:批次池 ≥ MIN_N 用批次池,否则用全局真实池(测试模式下拿不到全局池)
  const current = pooled
    ? selectBaseline([], rows, DIMS, MIN_N) // 空的批次池 ⇒ 走全局那一支,来源标成 global
    : rows.length >= MIN_N || globalRows.length > 0
      ? selectBaseline(rows, globalRows, DIMS, MIN_N)
      : null;
  const poolRows = pooled || rows.length >= MIN_N ? rows : globalRows;
  const pool = pooled ? '本池' : rows.length >= MIN_N ? '本批' : globalRows.length ? '全部真实学员(本批不足 10 人)' : '(测试模式不取真实池)';
  const dims: Report['dims'] = {};
  for (const k of DIMS) {
    const xs = poolRows.map((r) => r.dimensions[k]).filter((x): x is number => typeof x === 'number');
    dims[k] = {
      current: current ? current.means[k] : null,
      mean: mean(xs),
      median: quantile(xs, 0.5),
      trimmed10: trimmedMean(xs, 0.1),
      p10: quantile(xs, 0.1),
      p25: quantile(xs, 0.25),
      p75: quantile(xs, 0.75),
      p90: quantile(xs, 0.9),
    };
  }
  const tot = rows.map((r) => r.total);
  const tiers: Record<string, number> = {};
  for (const t of config.tiers) tiers[t.key] = rows.filter((r) => r.tier === t.key).length;
  return {
    label,
    isTest,
    n: rows.length,
    current: current ? { source: current.source, n: current.n, means: current.means } : null,
    pool,
    dims,
    totals: { mean: mean(tot), p25: quantile(tot, 0.25), median: quantile(tot, 0.5), p75: quantile(tot, 0.75), min: tot.length ? Math.min(...tot) : null, max: tot.length ? Math.max(...tot) : null },
    tiers,
  };
}

const reports: Report[] = [...groups.values()].map((g) => analyse(g.label, g.isTest, g.rows, false));
if (args.scope.kind === 'real' && globalRows.length) reports.push(analyse('全部真实学员(批次不足 10 人时报告用这一池)', false, globalRows, true));

if (args.json) {
  console.log(JSON.stringify({ scope: args.scope, minN: MIN_N, reports }, null, 2));
} else {
  console.log(header('各维度基准线:候选值 vs 现在用的', args, raw.length, [
    `现在用的 = selectBaseline:本批已出分 ≥ ${MIN_N} 人用本批均值,否则用全部真实学员的均值。候选值在同一个池上算。`,
  ]));
  for (const r of reports) {
    console.log(`## ${r.label}${r.isTest ? '  [测试批次]' : ''}  —— ${r.n} 人;基准池:${r.pool}${r.current ? `(现用来源 ${r.current.source},n=${r.current.n})` : ''}`);
    console.log(
      table(
        ['维度', '现用(均值)', '中位数', '截尾均值10%', 'p10', 'p25', 'p75', 'p90', '中位−现用'],
        config.dimensions.map((d) => {
          const x = r.dims[d.key];
          const delta = x.median !== null && x.current !== null ? x.median - x.current : null;
          return [`${d.zh}`, fmt(x.current), fmt(x.median), fmt(x.trimmed10), fmt(x.p10), fmt(x.p25), fmt(x.p75), fmt(x.p90), delta === null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(2)];
        }),
      ),
    );
    console.log(`   总分:均值 ${fmt(r.totals.mean)} · p25 ${fmt(r.totals.p25)} · 中位 ${fmt(r.totals.median)} · p75 ${fmt(r.totals.p75)} · 范围 ${fmt(r.totals.min, 1)}–${fmt(r.totals.max, 1)}`);
    console.log(`   档位:${config.tiers.map((t) => `${t.zh} ${r.tiers[t.key]}`).join(' · ')}`);
    console.log('');
  }
}
