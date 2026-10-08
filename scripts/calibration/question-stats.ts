/**
 * 课后校准 ① —— 每一题的作答分布、难度、与所在维度的相关性。
 *
 *   npm run calib:questions                 # 真实学员(默认)
 *   npm run calib:questions -- --scope=test # 只跑测试批次
 *   npm run calib:questions -- --cohort=<uuid> [--json]
 *
 * 只看**已出分**的人(有 assessment_results 的 session),每题的分数用线上同一个 `perQuestionScore`。
 *
 * 每题给出:
 *   - 分布:每个选项被选了几次、占比;最多那一项的占比(「一边倒」)
 *   - 得分率 p:平均分 / 5(0–1,越高越容易;「难度」= 1 − p)
 *   - r(维度):这题分数与所在维度分(三题均值)的相关 —— 含这题自己,所以偏高
 *   - r(其余):这题与同维另外两题均值的相关(item-rest)—— 看「这题和同维其它题是不是在量同一件事」,判断用这一列
 * 末尾的「提示」只是按固定阈值标出来值得看的题,不是结论(样本小时相关系数很不稳)。
 */
import { perQuestionScore } from '../../src/lib/scoring.ts';
import { config, fmt, header, mean, parseArgs, pct, pearson, query, scopeWhere, table } from './lib.ts';

const args = parseArgs(process.argv.slice(2));
const SCALE = config.meta.per_question_scale;

const rows = query<{ k: string; question_id: string; option_index: number }>(`
  with base as (
    select r.session_id, row_number() over (order by r.computed_at) as k
    from assessment_results r
    join assessment_sessions s on s.id = r.session_id
    join assessment_entitlements e on e.id = s.entitlement_id
    left join assessment_cohorts c on c.id = e.cohort_id
    where ${scopeWhere(args.scope)}
  )
  select b.k::text as k, a.question_id, a.option_index
  from base b join assessment_answers a on a.session_id = b.session_id
`);

// 人(序号)→ 题 → 分
const byPerson = new Map<string, Map<string, { idx: number; score: number }>>();
const QMETA = new Map(config.questions.map((q) => [q.id, q]));
for (const r of rows) {
  const q = QMETA.get(r.question_id);
  if (!q) continue; // 题库里已经没有的题(改版前的旧答案)不算
  const score = perQuestionScore(r.option_index, q.option_count, SCALE);
  if (score === null) continue;
  if (!byPerson.has(r.k)) byPerson.set(r.k, new Map());
  byPerson.get(r.k)!.set(r.question_id, { idx: r.option_index, score });
}
const people = [...byPerson.values()];

const TOP_SHARE_FLAG = 0.8;
const ITEM_REST_FLAG = 0.2;

interface QStat {
  id: string;
  dimension: string;
  answered: number;
  counts: number[];
  topShare: number | null;
  p: number | null;
  rDim: number | null;
  rRest: number | null;
  hints: string[];
}

const stats: QStat[] = [];
for (const d of config.dimensions) {
  const qs = config.questions.filter((q) => q.dimension === d.key);
  for (const q of qs) {
    const counts = new Array(q.option_count).fill(0) as number[];
    const item: number[] = [];
    const dim: number[] = [];
    const rest: number[] = [];
    for (const p of people) {
      const a = p.get(q.id);
      if (!a) continue;
      counts[a.idx] += 1;
      // 相关只用这一维三题都答了的人
      const others = qs.filter((o) => o.id !== q.id).map((o) => p.get(o.id)?.score);
      if (others.some((x) => x === undefined)) continue;
      const o = others as number[];
      item.push(a.score);
      dim.push((a.score + o[0] + o[1]) / 3);
      rest.push((o[0] + o[1]) / 2);
    }
    const answered = counts.reduce((x, y) => x + y, 0);
    const topShare = answered ? Math.max(...counts) / answered : null;
    const m = mean(item);
    const s: QStat = {
      id: q.id,
      dimension: d.key,
      answered,
      counts,
      topShare,
      p: m === null ? null : m / SCALE,
      rDim: pearson(item, dim),
      rRest: pearson(item, rest),
      hints: [],
    };
    if (topShare !== null && topShare >= TOP_SHARE_FLAG) s.hints.push(`一边倒(最多那项 ${pct(Math.max(...counts), answered)})`);
    if (s.rRest !== null && s.rRest < ITEM_REST_FLAG) s.hints.push(`与同维其它题相关低(r=${fmt(s.rRest)})`);
    if (answered > 0 && s.rRest === null) s.hints.push('相关算不出(样本 < 3 或没有变化)');
    stats.push(s);
  }
}

if (args.json) {
  console.log(JSON.stringify({ scope: args.scope, n: people.length, thresholds: { TOP_SHARE_FLAG, ITEM_REST_FLAG }, questions: stats }, null, 2));
} else {
  console.log(header('每题作答分布 / 难度 / 相关', args, people.length, [
    `得分率 p = 平均分 / ${SCALE}(越高越容易);r(其余) = 这题与同维另两题均值的相关,判断「区分度」看这一列。`,
    `提示阈值:最多那项 ≥ ${TOP_SHARE_FLAG * 100}% 标「一边倒」;r(其余) < ${ITEM_REST_FLAG} 标「相关低」。样本小于约 30 人时相关系数波动很大,只当线索。`,
  ]));
  for (const d of config.dimensions) {
    const list = stats.filter((s) => s.dimension === d.key);
    console.log(`## ${d.zh} (${d.key})`);
    console.log(
      table(
        ['题', '作答', '分布(选项:人数)', '最多那项', '得分率 p', 'r(维度)', 'r(其余)', '提示'],
        list.map((s) => [
          s.id,
          String(s.answered),
          s.counts.map((c, i) => `${i}:${c}`).join(' '),
          s.topShare === null ? '—' : `${(s.topShare * 100).toFixed(0)}%`,
          fmt(s.p),
          fmt(s.rDim),
          fmt(s.rRest),
          s.hints.join(';') || '',
        ]),
      ),
    );
    for (const q of config.questions.filter((x) => x.dimension === d.key)) {
      console.log(`   ${q.id} 选项:${q.zh.options.map((o, i) => `${i}=${o.slice(0, 14)}`).join(' / ')}`);
    }
    console.log('');
  }
}
