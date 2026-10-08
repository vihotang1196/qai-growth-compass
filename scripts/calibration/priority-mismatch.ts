/**
 * 课后校准 ④ —— isPriorityMismatch:现有判据的触发比例,与几种候选判据对比。
 *
 *   npm run calib:priority                 # 真实学员(默认)
 *   npm run calib:priority -- --scope=test # 只跑测试批次
 *   npm run calib:priority -- --cohort=<uuid> [--json]
 *
 * 「想修的」= 问卷 S1 选的维度(priority_dimension);「该修的」= 计分算出的最弱维度。
 * 现有判据(线上的 `isPriorityMismatch`,api/_lib/surveySignals.ts):priority ≠ weakest[0]。
 * 它有三个读者:学员报告第 7 板块的提示、GHL 的「方向错配」标签、后台问卷洞察(用的是三分法 `priorityAlignment`)。
 *
 * 候选判据(都只在这里算,线上没有):
 *   B  priority 不在最弱两维里(当初考虑过、没改的那个,见 PROGRESS「C. 需要真实样本才值得重新看的一个判据」)
 *   C  priority 那一维的分数比最低分高出 0.5 以上 —— 选了一个「和最弱差不多弱」的维度不算错配(容忍平分与近似平分)
 *   D  priority 是最强两维之一 —— 最严的那种:选了自己最强的地方
 *
 * 另外两个数帮着判断现有判据是不是「被平分骗了」:
 *   - 现有判据触发的人里,priority 那一维的分数**等于**最低分的有几个 —— 他其实选的就是最弱(之一),
 *     只是平分时 weakest[0] 按维度顺序取了另一个
 *   - 最弱两维平分的人数
 *
 * 只取 S1 与 S7 两个选择题字段,问卷的开放题原文不取。
 */
import { isHighIntent, isPriorityMismatch, priorityAlignment } from '../../api/_lib/surveySignals.ts';
import { config, header, parseArgs, pct, query, scopeWhere, table } from './lib.ts';

const args = parseArgs(process.argv.slice(2));

const raw = query<{ weakest: string[]; strongest: string[]; dim_scores: Record<string, number>; priority: string | null; consult: string | null }>(`
  select r.weakest, r.strongest, r.dim_scores,
         v.responses->>'priority_dimension' as priority,
         v.responses->>'consult_interest' as consult
  from assessment_results r
  join assessment_sessions s on s.id = r.session_id
  join assessment_entitlements e on e.id = s.entitlement_id
  left join assessment_cohorts c on c.id = e.cohort_id
  left join assessment_survey v on v.session_id = r.session_id
  where ${scopeWhere(args.scope)}
`);

const withPriority = raw.filter((r) => typeof r.priority === 'string' && r.priority.length > 0);
const minOf = (d: Record<string, number>) => Math.min(...Object.values(d));

const criteria: { key: string; label: string; hit: (r: (typeof withPriority)[number]) => boolean }[] = [
  { key: 'A', label: 'A 现有:priority ≠ weakest[0]', hit: (r) => isPriorityMismatch(r.priority, r.weakest) },
  { key: 'B', label: 'B priority 不在最弱两维里', hit: (r) => !r.weakest.slice(0, 2).includes(r.priority!) },
  { key: 'C', label: 'C priority 那维比最低分高 0.5 以上', hit: (r) => (r.dim_scores[r.priority!] ?? Infinity) - minOf(r.dim_scores) > 0.5 + 1e-9 },
  { key: 'D', label: 'D priority 是最强两维之一', hit: (r) => r.strongest.slice(0, 2).includes(r.priority!) },
];

const hi = withPriority.filter((r) => isHighIntent(r.consult));
const rows = criteria.map((c) => {
  const n = withPriority.filter(c.hit).length;
  const nHi = hi.filter(c.hit).length;
  return { key: c.key, label: c.label, n, rate: pct(n, withPriority.length), nHi, rateHi: pct(nHi, hi.length) };
});

const triggeredA = withPriority.filter(criteria[0].hit);
const tieArtefact = triggeredA.filter((r) => Math.abs((r.dim_scores[r.priority!] ?? Infinity) - minOf(r.dim_scores)) < 1e-9).length;
const weakTie = withPriority.filter((r) => Math.abs((r.dim_scores[r.weakest[0]] ?? 0) - (r.dim_scores[r.weakest[1]] ?? 0)) < 1e-9).length;

const align = { aligned: 0, second_weakest: 0, mismatched: 0 };
for (const r of withPriority) {
  const a = priorityAlignment(r.priority, r.weakest);
  if (a) align[a]++;
}
const chosen = Object.fromEntries(config.dimensions.map((d) => [d.key, withPriority.filter((r) => r.priority === d.key).length]));
const weakest0 = Object.fromEntries(config.dimensions.map((d) => [d.key, withPriority.filter((r) => r.weakest[0] === d.key).length]));

if (args.json) {
  console.log(JSON.stringify({ scope: args.scope, n: raw.length, withPriority: withPriority.length, highIntent: hi.length, criteria: rows, tieArtefact, weakTie, align, chosen, weakest0 }, null, 2));
} else {
  console.log(header('isPriorityMismatch:现有判据 vs 候选判据', args, raw.length, [
    `有问卷 S1 的:${withPriority.length} 人;其中 S7 高意向(asap / later):${hi.length} 人。`,
  ]));
  console.log(table(['判据', '触发人数', '触发比例', '高意向里触发', '高意向里比例'], rows.map((r) => [r.label, String(r.n), r.rate, String(r.nHi), r.rateHi])));
  console.log('');
  console.log(`现有判据 A 触发的 ${triggeredA.length} 人里,priority 那维的分数「等于」最低分的:${tieArtefact} 人(${pct(tieArtefact, triggeredA.length)})—— 这些人选的其实就是最弱之一,是平分时取序造成的触发。`);
  console.log(`最弱两维平分的人:${weakTie}(${pct(weakTie, withPriority.length)})。`);
  console.log(`三分法(后台问卷洞察用的 priorityAlignment):一致 ${align.aligned} · 选了次弱 ${align.second_weakest} · 错配 ${align.mismatched}`);
  console.log('');
  console.log(table(['维度', 'S1 选它的人', '它是 weakest[0] 的人'], config.dimensions.map((d) => [d.zh, String(chosen[d.key]), String(weakest0[d.key])])));
}
