/**
 * 课后校准脚本的共用部分:参数、只读查询、批次范围、统计函数。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【怎么取数】经 `supabase db query --linked`(本机 Supabase CLI 的登录与 link,和平时只读查询同一条路)。
 * 不需要也不读任何 key;本机没有 service key 也能跑。
 *
 * 【只读,由语法保证,不靠自觉】每条查询都被包成 `select * from (<sql>) as q` 再发出去 ——
 * Postgres 不允许在 FROM 子查询里写 insert / update / delete(含带写操作的 CTE),
 * 所以就算有人往脚本里塞了一条写语句,它也只会报语法错,不会执行。另加一道关键词检查,报得更早。
 *
 * 【不输出个人信息】查询只取计分与选项这类字段;姓名、电话、邮箱、token、GHL contact id、
 * 任何 id、问卷的开放题原文(S5 / S6)一概不取 —— 不是「取了不打印」,是查询里就没有。
 * 下面的 `assertNoPersonalColumns` 在发查询之前再拦一次。每个人在脚本里只是一个序号。
 *
 * 【范围是参数,而且每次输出都打印出来】(判断标准 15)
 *   --scope=real    默认。「不是测试批次」—— 包括 cohort_id 为 null 的行(批次被删的真实学员)
 *   --scope=test    只跑测试批次(现在就能用测试数据验脚本)
 *   --cohort=<uuid> 只跑某一个批次(会同时打印它是不是测试批次)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../src/config/assessment-config.json' with { type: 'json' };

export { config };
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type Scope = { kind: 'real' } | { kind: 'test' } | { kind: 'cohort'; id: string };

export interface Args {
  scope: Scope;
  json: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: readonly string[]): Args {
  let scope: Scope = { kind: 'real' };
  let json = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--scope=real') scope = { kind: 'real' };
    else if (a === '--scope=test') scope = { kind: 'test' };
    else if (a.startsWith('--cohort=')) {
      const id = a.slice('--cohort='.length);
      if (!UUID.test(id)) throw new Error(`--cohort 要一个批次 uuid,收到 ${JSON.stringify(id)}`);
      scope = { kind: 'cohort', id };
    } else {
      throw new Error(`不认识的参数 ${JSON.stringify(a)}。可用:--scope=real(默认)| --scope=test | --cohort=<uuid> | --json`);
    }
  }
  return { scope, json };
}

/**
 * 范围对应的 where 片段。表别名约定:`c` = assessment_cohorts(left join),`e` = assessment_entitlements。
 * 「不是测试批次」写成 `coalesce(c.is_test, false) = false`,不是「在真实批次 id 列表里」——
 * 后者会漏掉 cohort_id 为 null 的真实学员(判断标准 15 的 ⚠️)。
 */
export function scopeWhere(scope: Scope): string {
  if (scope.kind === 'real') return 'coalesce(c.is_test, false) = false';
  if (scope.kind === 'test') return 'c.is_test = true';
  return `e.cohort_id = '${scope.id}'`;
}

export function describeScope(scope: Scope): string {
  if (scope.kind === 'real') return '真实学员(所有不是测试批次的行,含批次已删除的)';
  if (scope.kind === 'test') return '只有测试批次';
  return `批次 ${scope.id}`;
}

/** 这些名字出现在 SQL 里就拒绝 —— 个人信息与开放题原文不该被取出来 */
const PERSONAL = [/phone/i, /email/i, /access_token/i, /ghl_contact_id/i, /\be\.name\b/i, /goal_90d/i, /biggest_blocker/i];

export function assertNoPersonalColumns(sql: string): void {
  for (const re of PERSONAL) {
    if (re.test(sql)) throw new Error(`查询里出现了个人信息字段(${re}),拒绝执行`);
  }
  // 问卷只许取两个选择题字段,整列 responses 会带出开放题原文
  const stripped = sql.replace(/responses\s*->>\s*'(priority_dimension|consult_interest)'/g, '');
  if (/\bresponses\b/.test(stripped)) {
    throw new Error("查询里取了整列 responses(会带出开放题原文),只许 responses->>'priority_dimension' / 'consult_interest'");
  }
}

const WRITE_WORDS = /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call|vacuum|lock)\b/i;

/** 只读查询,返回行。见文件头:包进 FROM 子查询 + 关键词检查 + 个人字段检查 */
export function query<T = Record<string, unknown>>(sql: string): T[] {
  if (WRITE_WORDS.test(sql)) throw new Error('查询里出现了写操作关键词,拒绝执行');
  assertNoPersonalColumns(sql);
  const wrapped = `select * from (${sql}) as q`;
  const r = spawnSync('supabase', ['db', 'query', '--linked', wrapped], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`没能运行 supabase CLI:${r.error.message}(要先装好 CLI、登录、在仓库里 supabase link)`);
  const out = r.stdout ?? '';
  const start = out.indexOf('{');
  if (r.status !== 0 || start < 0) {
    throw new Error(`supabase db query 失败(exit ${r.status}):${(r.stderr || out).slice(0, 600)}`);
  }
  const parsed = JSON.parse(out.slice(start)) as { rows?: T[]; error?: unknown };
  if (!parsed.rows) throw new Error(`supabase db query 没有返回 rows:${out.slice(0, 600)}`);
  return parsed.rows;
}

// ── 统计 ─────────────────────────────────────────────────────────────────

export const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** 分位数,线性插值(与 numpy 默认 / Excel PERCENTILE.INC 相同) */
export function quantile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** 截尾平均:两端各去掉 trim 比例(向下取整个数)再平均 */
export function trimmedMean(xs: readonly number[], trim: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * trim);
  return mean(s.slice(k, s.length - k));
}

/** Pearson 相关。任一边没有变化(方差 0)或样本 < 3 时没有定义,回 null —— 不回 0,0 会被读成「不相关」 */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export const fmt = (x: number | null | undefined, d = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d);

export const pct = (part: number, whole: number): string => (whole ? `${((100 * part) / whole).toFixed(1)}%` : '—');

/** 等宽表格(中文按 2 个字宽算) */
export function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const w = (s: string) => [...s].reduce((n, ch) => n + (/[⺀-￿]/.test(ch) ? 2 : 1), 0);
  const widths = head.map((h, i) => Math.max(w(h), ...rows.map((r) => w(r[i] ?? ''))));
  const line = (cells: readonly string[]) => cells.map((c, i) => c + ' '.repeat(widths[i] - w(c))).join('  ');
  return [line(head), widths.map((n) => '-'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}

export function header(title: string, args: Args, n: number, extra: string[] = []): string {
  return [
    `# ${title}`,
    `范围:${describeScope(args.scope)}  |  样本:${n} 人(已出分)  |  config ${config.meta.version}  |  ${new Date().toISOString()}`,
    '只含统计,不含任何个人信息(查询里不取姓名 / 联系方式 / id / 开放题原文)。',
    ...extra,
    '',
  ].join('\n');
}

/** 对一小组已知答案先自检 —— 统计函数错了,后面所有数字都是错的,而且看起来完全正常 */
function selfTest(): void {
  const eq = (a: number | null, b: number | null, what: string) => {
    if (a === null || b === null ? a !== b : Math.abs(a - b) > 1e-9) throw new Error(`calibration lib self-test failed: ${what} = ${a}, expected ${b}`);
  };
  eq(quantile([1, 2, 3, 4], 0.5), 2.5, 'median');
  eq(quantile([10, 20, 30, 40, 50], 0.25), 20, 'p25');
  eq(quantile([7], 0.9), 7, 'single');
  eq(trimmedMean([0, 1, 2, 3, 100], 0.2), 2, 'trimmed');
  eq(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 'perfect r');
  eq(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1, 'negative r');
  eq(pearson([1, 2, 3], [5, 5, 5]), null, 'zero variance');
  eq(pearson([1, 2], [1, 2]), null, 'n < 3');
  let blocked = 0;
  for (const bad of ["select e.name from assessment_entitlements e", 'select responses from assessment_survey', 'select phone_e164 from x']) {
    try {
      assertNoPersonalColumns(bad);
    } catch {
      blocked++;
    }
  }
  if (blocked !== 3) throw new Error(`calibration lib self-test failed: personal-column guard blocked ${blocked}/3`);
  assertNoPersonalColumns("select responses->>'priority_dimension' as p from assessment_survey");
  // 写操作在发出之前就被拒绝(不会走到 supabase CLI)
  let refused = 0;
  for (const bad of ['delete from assessment_results', 'with x as (update assessment_results set total = 0 returning 1) select * from x']) {
    try {
      query(bad);
    } catch (e) {
      if (e instanceof Error && e.message.includes('写操作')) refused++;
    }
  }
  if (refused !== 2) throw new Error(`calibration lib self-test failed: write guard refused ${refused}/2`);
}
selfTest();
