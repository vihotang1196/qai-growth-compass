/**
 * 每个学员的网页报告快照 —— 只读,给「改动前后逐字比对」用(判断标准 19)。
 *
 *   npm run snapshot:reports -- --out=<文件>          # 取一份快照
 *   npm run snapshot:reports -- --diff <前> <后>       # 比对两份,真实与测试分开报
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【快照里的「一份报告」是什么】assessment-report 端点对这个人的 cookie 会回的那份 JSON,
 * 用端点用的**同一组函数**重算:buildBaselinePools / selectBaseline / cohortStanding /
 * dimensionDiffs / perQuestionScore / langStates / effectiveLang。
 * 只换掉三样东西:
 *   - signed URL(每次请求都不一样)→ 「会不会签出一条」+ 文件路径的指纹
 *   - 问卷原文(开放题会带出个人信息)→ 整列的 md5 指纹
 *   - 对象的键序 → 一律排序(端点的 `answersByQuestion` 跟着库的行序走,前端按键取,键序没有含义)
 * 下面 `reportFor` 的组装那几行**照抄端点**。改端点的组装时要同步改这里 —— 这份快照证明的是
 * 「端点的输入与算法没变」,不是另写一个端点。
 * (重填第 2 步给 cookie 那条加的 `attempt` / `attempts` / `retake` 三个键**刻意不进快照**:它们是新增的、
 *  关于「历次」而不是报告内容;报告内容的每一个键仍在这里。)
 *
 * 【读法:legacy 与 latest】`--reader=legacy`(默认)按重填第 1 步之前端点的读法:答题记录按 entitlement 取那一份、
 * 基准池 = 全部 completed 的结果。`--reader=latest` 按第 1 步之后的读法(视图 `assessment_latest_results`
 * 与「报告看的那份」的规则);迁移 20261014100000 上线之前用它会直接报错。
 *
 * 【每个人用什么标识】entitlement id 的 md5 前 12 位。不取姓名、电话、邮箱、token、GHL contact id、
 * 任何原始 id;查询走 calibration/lib 的 `queryOwnAttemptChoice`(只读由语法保证 + 个人字段拦截;取哪一份由下面两种读法自己写明)。
 *
 * 【范围】每一个 entitlement,都带 test 标记。比对时真实学员与测试数据分开报 ——
 * 「真实学员的报告一个字都没变」是要证明的那句话,测试数据的变化只列出来。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { config, queryOwnAttemptChoice as query } from './calibration/lib.ts';
import { buildBaselinePools, type RawBaselineRow } from '../supabase/functions/_shared/baselinePools.ts';
import { cohortStanding, dimensionDiffs, selectBaseline } from '../src/lib/reportStats.ts';
import { perQuestionScore } from '../src/lib/scoring.ts';
import { langStates, type ReportFileRow } from '../api/_lib/reportFiles.ts';
import { effectiveLang } from '../api/_lib/lang.ts';

const DIM_KEYS = config.dimensions.map((d) => d.key);
const SCALE = config.meta.score_scale;
const MIN_N = config.cohorts.min_n_for_baseline;
const QUESTIONS = config.questions;
const P2 = config.profile_questions.find((p) => p.id === 'P2');
const P3 = config.profile_questions.find((p) => p.id === 'P3');

type Reader = 'legacy' | 'latest';

interface PersonRow {
  key: string;
  is_test: boolean;
  cohort_id: string | null;
  lang: string | null;
  revoked: boolean;
  session_key: string | null;
  session_status: string | null;
  profile: Record<string, unknown> | null;
  has_result: boolean;
  dim_scores: Record<string, number> | null;
  total: string | number | null;
  tier: string | null;
  weakest: unknown;
  strongest: unknown;
  answers: Record<string, number> | null;
  survey_md5: string | null;
  files: {
    lang: string;
    pdf_status: string;
    pdf_attempts: number | null;
    pdf_path: string | null;
    share_card_path: string | null;
    share_card_tall_path: string | null;
  }[];
}

interface PoolRow {
  session_key: string;
  cohort_id: string | null;
  is_test: boolean | null;
  dim_scores: Record<string, number>;
  total: string | number;
  tier: string;
}

/** 路径与 id 只留指纹:比得出「变没变」,看不出是哪一个 */
const fp = (col: string) => `case when ${col} is null then null else left(md5(${col}::text), 12) end`;

/**
 * 「这个人的报告用哪一份答题记录」。
 * legacy = 重填第 1 步之前端点的 `.eq('entitlement_id').maybeSingle()`(一人一份时就是那一份);
 * latest = 第 1 步之后端点的 `reportSession()`:最新完成的那份,一份都没完成时是当前那份
 *          (`supabase/functions/_shared/attempts.ts` 的 `pickReportAttempt`;没完成的最多一份,由部分唯一索引保证)。
 */
function sessionJoin(reader: Reader): string {
  if (reader === 'legacy') return 'left join assessment_sessions s on s.entitlement_id = e.id';
  return `left join lateral (
      select * from assessment_sessions s0 where s0.entitlement_id = e.id
      order by (s0.status = 'completed') desc, s0.attempt_no desc limit 1
    ) s on true`;
}

function loadPeople(reader: Reader): PersonRow[] {
  return query<PersonRow>(`
    select left(md5(e.id::text), 12) as key,
      coalesce(c.is_test, false) as is_test,
      e.cohort_id::text as cohort_id,
      e.lang,
      (e.access_revoked_at is not null) as revoked,
      ${fp('s.id')} as session_key,
      s.status as session_status,
      s.profile,
      (r.session_id is not null) as has_result,
      r.dim_scores, r.total, r.tier, r.weakest, r.strongest,
      (select jsonb_object_agg(a.question_id, a.option_index) from assessment_answers a where a.session_id = s.id) as answers,
      (select md5(sv.responses::text) from assessment_survey sv where sv.session_id = s.id) as survey_md5,
      coalesce((select jsonb_agg(jsonb_build_object(
          'lang', f.lang, 'pdf_status', f.pdf_status, 'pdf_attempts', f.pdf_attempts,
          'pdf_path', ${fp('f.pdf_path')},
          'share_card_path', ${fp('f.share_card_path')},
          'share_card_tall_path', ${fp('f.share_card_tall_path')}) order by f.lang)
        from assessment_report_files f where f.session_id = s.id), '[]'::jsonb) as files
    from assessment_entitlements e
    left join assessment_cohorts c on c.id = e.cohort_id
    ${sessionJoin(reader)}
    left join assessment_results r on r.session_id = s.id
  `);
}

/**
 * 基准池。
 * legacy = 第 1 步之前端点那条 PostgREST 查询(结果 !inner 答题记录 completed !inner entitlement,cohort 可空);
 * latest = 第 1 步之后端点读的视图 `assessment_latest_results`,只取端点取的那几列(批次两列用视图自己的)。
 * 按 session 指纹排序:端点不排序,均值保留一位小数,求和顺序只在进位边界上才有影响 —— 排序让快照本身确定。
 */
function loadPool(reader: Reader): PoolRow[] {
  if (reader === 'latest') {
    return query<PoolRow>(`
      select ${fp('r.session_id')} as session_key, r.cohort_id::text as cohort_id, r.cohort_is_test as is_test,
        r.dim_scores, r.total, r.tier
      from assessment_latest_results r
      order by 1
    `);
  }
  return query<PoolRow>(`
    select ${fp('s.id')} as session_key, e.cohort_id::text as cohort_id, c.is_test,
      r.dim_scores, r.total, r.tier
    from assessment_results r
    join assessment_sessions s on s.id = r.session_id and s.status = 'completed'
    join assessment_entitlements e on e.id = s.entitlement_id
    left join assessment_cohorts c on c.id = e.cohort_id
    order by 1
  `);
}

function fromValueMap(profile: Record<string, unknown>, id: string, map: number[] | undefined): number | null {
  const idx = profile[id];
  if (typeof idx !== 'number' || !map || idx < 0 || idx >= map.length) return null;
  return map[idx];
}

/** 一个人的报告 —— 组装照抄 assessment-report/index.ts(见文件头) */
function reportFor(p: PersonRow, pool: readonly PoolRow[]): unknown {
  if (!p.session_key) return { error: 'no_session', status: 409 };
  if (p.revoked) return { error: 'revoked', status: 403 };
  const currentLang = effectiveLang(p.lang);
  if (!p.has_result) return { error: 'not_ready', status: 404 };

  const answers = new Map(Object.entries(p.answers ?? {}));
  const submodules: Record<string, (number | null)[]> = {};
  const evidence: Record<string, ({ questionId: string; optionIndex: number } | null)[]> = {};
  for (const k of DIM_KEYS) {
    submodules[k] = [null, null, null];
    evidence[k] = [null, null, null];
  }
  for (const q of QUESTIONS) {
    const idx = answers.get(q.id);
    if (idx === undefined) continue;
    const s = perQuestionScore(idx, q.option_count, SCALE);
    if (s !== null) submodules[q.dimension][q.submodule_index] = s;
    evidence[q.dimension][q.submodule_index] = { questionId: q.id, optionIndex: idx };
  }
  const answersByQuestion: Record<string, number> = {};
  for (const [qid, idx] of answers) answersByQuestion[qid] = idx;

  const raw: RawBaselineRow[] = pool.map((r) => ({
    dim_scores: r.dim_scores,
    total: Number(r.total),
    tier: r.tier,
    session: { id: r.session_key, entitlement: { cohort_id: r.cohort_id, cohort: { is_test: r.is_test } } },
  }));
  const { globalRows, cohortRows } = buildBaselinePools(raw, p.cohort_id);
  const baseline = selectBaseline(cohortRows, globalRows, DIM_KEYS, MIN_N);
  const selfInPool = pool.some((r) => r.session_key === p.session_key);

  const myDims = (p.dim_scores ?? {}) as Record<string, number>;
  const total = Number(p.total);
  const cohort = cohortRows.length >= MIN_N
    ? { standing: cohortStanding(total, p.tier!, cohortRows), diffs: dimensionDiffs(myDims, baseline.means, DIM_KEYS) }
    : null;
  const profile = (p.profile ?? {}) as Record<string, unknown>;

  const fileRows = p.files as unknown as (ReportFileRow & { share_card_path: string | null; share_card_tall_path: string | null })[];
  const byLang = new Map(fileRows.map((r) => [r.lang, r]));
  const currentFile = byLang.get(currentLang) ?? null;
  // 端点在这几处现签 signed URL;这里换成「会签出一条:<路径指纹>」/ null
  const signed = (path: string | null | undefined) => (path ? `signed:${path}` : null);

  return {
    locale: currentLang,
    result: { dimensions: myDims, total, tier: p.tier, weakest: p.weakest, strongest: p.strongest },
    submodules,
    evidence,
    answersByQuestion,
    leadsPerMonth: fromValueMap(profile, 'P2', P2?.value_map),
    dealValue: fromValueMap(profile, 'P3', P3?.value_map),
    survey: p.survey_md5 === null ? {} : { md5: p.survey_md5 },
    baseline,
    diagnostics: { baselineIncludesSelf: selfInPool, sessionStatus: p.session_status },
    cohort,
    files: langStates(fileRows).map((st) => ({
      lang: st.lang,
      availability: st.availability,
      url: st.availability === 'ready' ? signed(st.path) : null,
      cardUrl: signed(byLang.get(st.lang)?.share_card_path),
      cardTallUrl: signed(byLang.get(st.lang)?.share_card_tall_path),
    })),
    pdfStatus: currentFile?.pdf_status ?? 'pending',
    pdfUrl: (currentFile?.pdf_status ?? 'pending') === 'ready' ? signed(currentFile?.pdf_path) : null,
    cardUrl: signed(currentFile?.share_card_path),
    cardTallUrl: signed(currentFile?.share_card_tall_path),
  };
}

/** 键排序的 JSON —— 快照逐字比对的前提 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

interface Snapshot {
  meta: { takenAt: string; reader: Reader; configVersion: string; people: number; real: number; test: number; poolSize: number };
  /** 每人一行:key → { test, report(canonical JSON 字符串) } */
  reports: Record<string, { test: boolean; report: string }>;
}

function take(reader: Reader): Snapshot {
  const people = loadPeople(reader);
  const pool = loadPool(reader);
  const keys = new Set<string>();
  const reports: Snapshot['reports'] = {};
  for (const p of people) {
    // 同一个 entitlement 出现两行 = 一人两份答题记录,而 legacy 读法会在这里 500 —— 直接停,不挑一行
    if (keys.has(p.key)) throw new Error(`entitlement ${p.key} 有不止一行(一人多份答题记录?)—— ${reader} 读法下端点会报错`);
    keys.add(p.key);
    reports[p.key] = { test: p.is_test, report: canonical(reportFor(p, pool)) };
  }
  const real = people.filter((p) => !p.is_test).length;
  return {
    meta: {
      takenAt: new Date().toISOString(),
      reader,
      configVersion: config.meta.version,
      people: people.length,
      real,
      test: people.length - real,
      poolSize: pool.length,
    },
    reports,
  };
}

function digest(s: Snapshot, test: boolean): string {
  const lines = Object.keys(s.reports).sort().filter((k) => s.reports[k].test === test).map((k) => `${k} ${s.reports[k].report}`);
  return `${lines.length} 份,指纹 ${sha(lines.join('\n'))}`;
}

/** 两份报告的差异,按字段路径展开(数字只给前后值,不给任何个人信息) */
function fieldDiffs(a: unknown, b: unknown, path = ''): string[] {
  if (canonical(a) === canonical(b)) return [];
  const isObj = (v: unknown) => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const ks = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...ks].sort().flatMap((k) =>
      fieldDiffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k)
    );
  }
  return [`${path}: ${canonical(a)} → ${canonical(b)}`];
}

function diff(beforeFile: string, afterFile: string): number {
  const a = JSON.parse(readFileSync(beforeFile, 'utf8')) as Snapshot;
  const b = JSON.parse(readFileSync(afterFile, 'utf8')) as Snapshot;
  console.log(`前:${beforeFile}(${a.meta.takenAt},读法 ${a.meta.reader},config ${a.meta.configVersion},基准池 ${a.meta.poolSize})`);
  console.log(`后:${afterFile}(${b.meta.takenAt},读法 ${b.meta.reader},config ${b.meta.configVersion},基准池 ${b.meta.poolSize})`);
  let realChanged = 0;
  for (const test of [false, true]) {
    const label = test ? '测试数据' : '真实学员';
    console.log(`\n## ${label}:前 ${digest(a, test)};后 ${digest(b, test)}`);
    const ka = Object.keys(a.reports).filter((k) => a.reports[k].test === test);
    const kb = Object.keys(b.reports).filter((k) => b.reports[k].test === test);
    const onlyA = ka.filter((k) => !kb.includes(k)).sort();
    const onlyB = kb.filter((k) => !ka.includes(k)).sort();
    const changed = ka.filter((k) => kb.includes(k) && a.reports[k].report !== b.reports[k].report).sort();
    console.log(`逐字相同 ${ka.length - onlyA.length - changed.length} · 有变化 ${changed.length} · 只在前 ${onlyA.length} · 只在后 ${onlyB.length}`);
    for (const k of onlyA) console.log(`  只在前:${k}`);
    for (const k of onlyB) console.log(`  只在后:${k}`);
    // 按字段路径汇总:每条「路径: 前 → 后」有几个人
    const byChange = new Map<string, string[]>();
    for (const k of changed) {
      for (const d of fieldDiffs(JSON.parse(a.reports[k].report), JSON.parse(b.reports[k].report))) {
        if (!byChange.has(d)) byChange.set(d, []);
        byChange.get(d)!.push(k);
      }
    }
    for (const [d, ks] of [...byChange].sort((x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : 1))) {
      console.log(`  ${String(ks.length).padStart(3)} 人  ${d}`);
    }
    if (!test) realChanged = changed.length + onlyA.length + onlyB.length;
  }
  return realChanged;
}

const argv = process.argv.slice(2);
if (argv[0] === '--diff') {
  if (argv.length !== 3) throw new Error('用法:--diff <前> <后>');
  const n = diff(argv[1], argv[2]);
  // 真实学员有任何一份不同 → exit 1,让「逐字相同」能直接当判据用
  process.exit(n === 0 ? 0 : 1);
} else {
  let out: string | null = null;
  let reader: Reader = 'legacy';
  for (const a of argv) {
    if (a.startsWith('--out=')) out = a.slice('--out='.length);
    else if (a === '--reader=legacy' || a === '--reader=latest') reader = a.slice('--reader='.length) as Reader;
    else throw new Error(`不认识的参数 ${JSON.stringify(a)}。用法见文件头`);
  }
  if (!out) throw new Error('要给 --out=<文件>(快照放在仓库外,比如 scratchpad)');
  const snap = take(reader);
  writeFileSync(out, JSON.stringify(snap, null, 1) + '\n');
  console.log(`已写 ${out}:${snap.meta.people} 个 entitlement(真实 ${snap.meta.real},测试 ${snap.meta.test}),基准池 ${snap.meta.poolSize} 份,读法 ${reader}`);
  console.log(`真实学员:${digest(snap, false)}`);
  console.log(`测试数据:${digest(snap, true)}`);
}
