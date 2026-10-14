#!/usr/bin/env node
/**
 * 守「一个人可能有不止一份答题记录」这件事。**第十七道门**(2026-10-14 进构建链,重填第 1 步)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要一道门】重填之后一个 entitlement 会有多份 `assessment_sessions`。原来有两类写法在那一刻会坏,
 * 而且坏的方式不一样:
 *   - 按 entitlement 取**单行**(`.eq('entitlement_id', …).maybeSingle()`)→ 一人两份时 PostgREST 报错 → 500
 *   - 从 entitlement **嵌套** `assessment_sessions(...)` → 一对一变一对多,对象悄悄变成数组,读 `.status` 得 undefined,**不报错**
 *   - 统计(只取 completed 的那种嵌套)→ 一个人被算两次,也不报错
 * 第 1 步把它们全部改掉了;这道门让「漏改了一处」或「以后新写一处」在构建时红,而不是等到有人重填那天(判断标准 12)。
 *
 * 【判据】扫 `api/` 与 `supabase/functions/` 下的 .ts(不含测试)。对每一条 `.from('<表>')` 到下一个 `;` 的语句:
 *   R1 `.from('assessment_sessions')` 且带 `.eq('entitlement_id', …)` → 只允许在 `_shared/currentSession.ts`
 *      (「当前那份 / 报告看的那份」的唯一入口,定义在 `_shared/attempts.ts`)
 *   R2 `.from('assessment_entitlements')` 里嵌套 `assessment_sessions(…)` → 括号里必须取 `attempt_no`
 *      (取了它,说明写的人知道这里可能是多份,并且用 attempts.ts 挑了一份)
 *   R3 `.from('assessment_results' | 'assessment_survey')` 且带 `.eq('session.status', 'completed')`(统计的形状)
 *      里嵌套 `assessment_sessions(…)` → 同样必须取 `attempt_no`;更好的写法是改读视图 `assessment_latest_results`
 *
 * 【盲区 —— 写在这里,不装作覆盖了】
 *   - 「取了 attempt_no」不等于「真的去重了」:R2 / R3 只能逼人想到这件事,挑没挑对由 attempts.ts 的用例看着
 *   - 语句按「到下一个 `;`」切:select 字符串里写了分号会切错(现在没有)
 *   - 不扫 `scripts/`:`seed-test-data.ts` 原来按 `entitlement_id` upsert —— 2026-10-14 第 2 步改成按 `(entitlement_id, attempt_no)` 只写第 1 份
 *   - 从子表单行反查父行(`.eq('session_id', …)` 再嵌 session)不在判据里 —— 那本来就只有一行
 *   - 三元表达式两支写在同一条语句里时(报告端点原来的 render / cookie 两支),两支会一起被报 —— 宁可多报
 *
 * 【退出码】有命中 → 1;没有 → 0;自检失败 → 2。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOTS = ['api', 'supabase/functions'];
const R1_ALLOWED = ['supabase', 'functions', '_shared', 'currentSession.ts'].join(sep);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('_test.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** `src[open]` 是 `(`,回到与它配对的 `)` 之间的内容 */
function parenContent(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** 只留最外一层:嵌套在里面的资源(比如 session 下的 entitlement)取了 attempt_no 不算数 */
function topLevel(content) {
  let out = '';
  let depth = 0;
  for (const ch of content) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/**
 * 去掉注释、保留行号:注释里提到 `assessment_sessions(id)` 不该算一次嵌套(问卷洞察那条查询的注释就是这样)。
 * 行注释只认前面不是 `:` 的 `//`,免得把 `https://` 当成注释。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 返回 [{ line, rule, text }] —— 判据只在这一个函数里,自检也只测它 */
export function findSessionReads(raw, file = '') {
  const src = stripComments(raw);
  const hits = [];
  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) {
    const table = m[1];
    const end = src.indexOf(';', m.index);
    const stmt = src.slice(m.index, end === -1 ? undefined : end);
    const line = src.slice(0, m.index).split('\n').length;
    const text = stmt.split('\n')[0].trim();

    if (table === 'assessment_sessions' && /\.eq\(\s*['"]entitlement_id['"]/.test(stmt) && !file.endsWith(R1_ALLOWED)) {
      hits.push({ line, rule: 'R1', text });
    }

    const aggregate =
      (table === 'assessment_results' || table === 'assessment_survey') &&
      /\.eq\(\s*['"]session\.status['"]\s*,\s*['"]completed['"]/.test(stmt);
    if (table === 'assessment_entitlements' || aggregate) {
      for (const e of stmt.matchAll(/assessment_sessions(?:!inner)?\s*\(/g)) {
        const content = parenContent(stmt, e.index + e[0].length - 1);
        if (!/\battempt_no\b/.test(topLevel(content))) hits.push({ line, rule: table === 'assessment_entitlements' ? 'R2' : 'R3', text });
      }
    }
  }
  return hits;
}

/**
 * 自检(判断标准 0 / 1):先证明它抓得到第 1 步改掉的那几种原样写法,也证明它放过替代写法。
 * 跑不过就 exit 2。
 */
function selfTest() {
  const mustFlag = [
    // 原来的 5 处单行读(assessment-auth / quiz / score / report / report-file 的形状)
    "const { data } = await supa\n  .from('assessment_sessions')\n  .select('id, status')\n  .eq('entitlement_id', ent.id)\n  .maybeSingle();",
    // 原来的漏斗:entitlement 下嵌套 session,当成一个对象读
    "await supa.from('assessment_entitlements').select('id, session:assessment_sessions(id, status, profile)');",
    // 原来的名单(模板字符串、里面再嵌套)
    "await supa.from('assessment_entitlements').select(`id,\n session:assessment_sessions(\n id,\n status,\n result:assessment_results(total)\n )`).order('created_at');",
    // 原来的基准线 / 看板:按 completed 统计,每份都算(attempt_no 只出现在里层的 entitlement 下 —— 不算数)
    "await supa.from('assessment_results').select('total, session:assessment_sessions!inner(id, status, entitlement:assessment_entitlements!inner(cohort_id, attempt_no))').eq('session.status', 'completed');",
    // 原来的问卷洞察
    "await supa.from('assessment_survey').select('responses, session:assessment_sessions!inner(id, status, result:assessment_results!inner(weakest))').eq('session.status', 'completed');",
  ];
  const mustPass = [
    "await supa.from('assessment_sessions').select('id, profile').eq('id', sessionId).maybeSingle();",
    "await supa.from('assessment_entitlements').select('id, session:assessment_sessions(id, status, profile, attempt_no)');",
    "await supa.from('assessment_survey').select('responses, session:assessment_sessions!inner(id, status, attempt_no, result:assessment_results!inner(weakest))').eq('session.status', 'completed');",
    // 子表单行反查父行:本来就只有一行
    "await supa.from('assessment_results').select('total, session:assessment_sessions(entitlement:assessment_entitlements(ghl_contact_id))').eq('session_id', id);",
    "await supa.from('assessment_latest_results').select('session_id, total, cohort_id, cohort_is_test');",
    "await supa.from('assessment_sessions').insert({ entitlement_id: ent.id });",
    // 注释里提到嵌套不算
    "await supa\n  .from('assessment_survey')\n  /** 两张表都指向 `assessment_sessions(id)` */\n  .select('responses, session:assessment_sessions!inner(id, status, attempt_no)') // assessment_sessions(x)\n  .eq('session.status', 'completed');",
  ];
  const allowedFile = ['supabase', 'functions', '_shared', 'currentSession.ts'].join(sep);
  const bad = [
    ...mustFlag.filter((s) => findSessionReads(s).length !== 1).map((s) => `should flag once:\n${s}`),
    ...mustPass.filter((s) => findSessionReads(s).length !== 0).map((s) => `should not flag:\n${s}`),
    ...(findSessionReads(mustFlag[0], allowedFile).length !== 0 ? ['R1 should be allowed in _shared/currentSession.ts'] : []),
  ];
  if (bad.length) {
    console.error(`[check-session-reads] self-test failed —— the detector itself is wrong:\n\n${bad.join('\n\n')}`);
    process.exit(2);
  }
  return mustFlag.length + mustPass.length + 1;
}

const selfCases = selfTest();
const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    for (const h of findSessionReads(readFileSync(file, 'utf8'), file)) findings.push({ file: relative('.', file), ...h });
  }
}

if (findings.length === 0) {
  console.log(`[check-session-reads] OK —— every per-person session read goes through _shared/currentSession.ts or picks an attempt (self-test ${selfCases}/${selfCases}).`);
  process.exit(0);
}

for (const f of findings) console.log(`  ${f.rule}  ${f.file}:${f.line}  ${f.text}`);
console.log(
  `\n[check-session-reads] ${findings.length} place(s) assume one session per person.\n` +
    '  R1: read the current / report attempt via currentSession() / reportSession() in supabase/functions/_shared/currentSession.ts\n' +
    "  R2: an entitlement -> assessment_sessions embed must select attempt_no and pick one with _shared/attempts.ts\n" +
    "  R3: aggregates over completed sessions should read the view assessment_latest_results (or select attempt_no and dedupe)\n" +
    `  Self-test ${selfCases}/${selfCases}.`,
);
process.exit(1);
