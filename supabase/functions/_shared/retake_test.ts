import { assert, assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  abandonRetake,
  checkRetake,
  fileRequestDecision,
  loginStatus,
  profilePrefill,
  RETAKE_MAX_ATTEMPTS,
  RETAKE_MIN_HOURS,
  retakeEligibility,
  retakePrefill,
  startRetake,
  supersededSessionIds,
  surveyPrefill,
  type AttemptRow,
} from './retake.ts';
import { guardSessionWrite } from './sessionGuard.ts';
import { pickCurrent } from './attempts.ts';
import { mapOption, mapOptions } from './optionMap.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 重填第 2 步(docs/retake-design.md 第 4、5 节)。每一条都先对着「没有限制 / 没有守卫」的桩跑红。
 * 数据库那一半(两个触发器)不在这里 —— 它们的红绿在 PGlite 与生产的回滚探针里做,见 PROGRESS。
 * ─────────────────────────────────────────────────────────────────────────────
 */

const H = 3_600_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const row = (attempt_no: number, status: string, completedMsAgo: number | null = null): AttemptRow => ({
  id: `s${attempt_no}`,
  attempt_no,
  status,
  completed_at: completedMsAgo === null ? null : at(completedMsAgo),
});
const TEST = { revoked: false, isTest: true, openToReal: false, nowMs: NOW };
const REAL = { ...TEST, isTest: false };

// ── 频率限制(Viho 2026-10-14:24 小时、最多 6 份;链接作废不能重填)──

Deno.test('能重填:最近一次完成超过 24 小时、没有没做完的、不到 6 份 → 下一份是最大编号 + 1', () => {
  assertEquals(retakeEligibility([row(1, 'completed', 25 * H)], TEST), { ok: true, nextAttemptNo: 2 });
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H), row(2, 'completed', 30 * H)], TEST), { ok: true, nextAttemptNo: 3 });
});

Deno.test('不到 24 小时:拒绝,并给出可以再重填的时间(= 最近一次完成 + 24 小时);恰好 24 小时可以', () => {
  const r = retakeEligibility([row(1, 'completed', 90 * H), row(2, 'completed', 23 * H)], TEST);
  assertEquals(r, { ok: false, reason: 'too_soon', nextAllowedAt: new Date(NOW - 23 * H + RETAKE_MIN_HOURS * H).toISOString() });
  assertEquals(retakeEligibility([row(1, 'completed', 24 * H)], TEST).ok, true);
  assertEquals(RETAKE_MIN_HOURS, 24);
});

Deno.test('已满 6 份:拒绝(先于时间检查 —— 等多久都没用)', () => {
  assertEquals(RETAKE_MAX_ATTEMPTS, 6);
  const six = [1, 2, 3, 4, 5, 6].map((n) => row(n, 'completed', (100 - n) * H));
  assertEquals(retakeEligibility(six, TEST), { ok: false, reason: 'limit_reached' });
  const sixRecent = [1, 2, 3, 4, 5].map((n) => row(n, 'completed', (100 - n) * H)).concat(row(6, 'completed', 1 * H));
  assertEquals(retakeEligibility(sixRecent, TEST).ok === false && (retakeEligibility(sixRecent, TEST) as { reason: string }).reason, 'limit_reached');
});

Deno.test('有一份没做完的:拒绝(继续或放弃那一份)', () => {
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H), row(2, 'survey')], TEST), { ok: false, reason: 'open_attempt' });
});

Deno.test('一份都没完成:不是重填,拒绝', () => {
  assertEquals(retakeEligibility([row(1, 'in_progress')], TEST), { ok: false, reason: 'no_completed_attempt' });
  assertEquals(retakeEligibility([], TEST), { ok: false, reason: 'no_completed_attempt' });
});

Deno.test('链接作废:拒绝(优先于一切)', () => {
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H)], { ...TEST, revoked: true }), { ok: false, reason: 'revoked' });
});

// ── 对真实学员开不开放:数据库开关(第 5 步的准备,Viho 2026-10-16)──

Deno.test('真实批次:开关关着 → not_open;开着 → 与测试批次同样的规则', () => {
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H)], REAL), { ok: false, reason: 'not_open' });
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H)], { ...REAL, openToReal: true }), { ok: true, nextAttemptNo: 2 });
  // 开着时其余限制一条不少
  assertEquals(retakeEligibility([row(1, 'completed', 2 * H)], { ...REAL, openToReal: true }), {
    ok: false,
    reason: 'too_soon',
    nextAllowedAt: new Date(NOW - 2 * H + RETAKE_MIN_HOURS * H).toISOString(),
  });
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H), row(2, 'survey')], { ...REAL, openToReal: true }), { ok: false, reason: 'open_attempt' });
  // 作废仍然优先
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H)], { ...REAL, openToReal: true, revoked: true }), { ok: false, reason: 'revoked' });
});

Deno.test('测试批次不看开关:关着也照常(第 2、3 步的验收就是这样走的)', () => {
  assertEquals(retakeEligibility([row(1, 'completed', 90 * H)], { ...TEST, openToReal: false }), { ok: true, nextAttemptNo: 2 });
});

// ── start_retake / 放弃:用记录调用的假 client ──

interface Op {
  m: string;
  a: unknown[];
}
interface Query {
  table: string;
  ops: Op[];
}
const op = (q: Query, m: string) => q.ops.find((o) => o.m === m);
const writes = (log: Query[]) => log.filter((q) => op(q, 'insert') || op(q, 'update') || op(q, 'delete') || op(q, 'upsert'));

function fakeSupa(handler: (q: Query) => { data?: unknown; error?: unknown }, log: Query[]) {
  return {
    from(table: string) {
      const q: Query = { table, ops: [] };
      log.push(q);
      const builder: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(handler(q)).then((r) => ({ data: r.data ?? null, error: r.error ?? null })).then(res, rej);
          }
          return (...a: unknown[]) => {
            q.ops.push({ m: String(prop), a });
            return builder;
          };
        },
      });
      return builder;
    },
  } as unknown as SupabaseClient;
}

function world(opts: {
  rows: AttemptRow[];
  isTest?: boolean;
  revoked?: boolean;
  insertError?: { code: string; message: string };
  rowsAfterConflict?: AttemptRow[];
  deleted?: number;
  /** 开关表回什么:不给 = 一行都没有(关) */
  switchRows?: readonly unknown[];
  switchError?: { code: string; message: string };
}) {
  let conflicted = false;
  return (q: Query) => {
    if (q.table === 'assessment_retake_switch') {
      if (op(q, 'insert') || op(q, 'update') || op(q, 'delete') || op(q, 'upsert')) throw new Error('nothing in a student request may write the switch');
      return opts.switchError ? { error: opts.switchError } : { data: opts.switchRows ?? [] };
    }
    if (q.table === 'assessment_entitlements') {
      return { data: { access_revoked_at: opts.revoked ? at(H) : null, cohort: { is_test: opts.isTest ?? true } } };
    }
    if (q.table === 'assessment_sessions') {
      if (op(q, 'insert')) {
        if (opts.insertError) {
          conflicted = true;
          return { error: opts.insertError };
        }
        const ins = op(q, 'insert')!.a[0] as { attempt_no: number };
        return { data: { id: 'new', status: 'in_progress', attempt_no: ins.attempt_no } };
      }
      if (op(q, 'delete')) return { data: Array.from({ length: opts.deleted ?? 1 }, () => ({ id: 'x' })) };
      return { data: conflicted && opts.rowsAfterConflict ? opts.rowsAfterConflict : opts.rows };
    }
    return { data: null };
  };
}

Deno.test('start_retake 成功:只插一行 —— entitlement + 下一个编号,不带背景题、不带任何答案(预填只是初始值,不是已答)', async () => {
  const log: Query[] = [];
  const out = await startRetake(fakeSupa(world({ rows: [row(1, 'completed', 30 * H)] }), log), 'e1', NOW);
  assertEquals(out, { ok: true, sessionId: 'new', attemptNo: 2 });
  const w = writes(log);
  assertEquals(w.length, 1);
  assertEquals(w[0].table, 'assessment_sessions');
  assertEquals(op(w[0], 'insert')!.a[0], { entitlement_id: 'e1', attempt_no: 2 });
});

Deno.test('start_retake 被拒(不到 24 小时 / 满 6 份 / 作废 / 有没做完的 / 真实批次):什么都没写', async () => {
  const cases: [Parameters<typeof world>[0], string][] = [
    [{ rows: [row(1, 'completed', 2 * H)] }, 'too_soon'],
    [{ rows: [1, 2, 3, 4, 5, 6].map((n) => row(n, 'completed', (100 - n) * H)) }, 'limit_reached'],
    [{ rows: [row(1, 'completed', 30 * H)], revoked: true }, 'revoked'],
    [{ rows: [row(1, 'completed', 30 * H), row(2, 'in_progress')] }, 'open_attempt'],
    [{ rows: [row(1, 'completed', 30 * H)], isTest: false }, 'not_open'],
  ];
  for (const [w, reason] of cases) {
    const log: Query[] = [];
    const out = await startRetake(fakeSupa(world(w), log), 'e1', NOW);
    assertEquals(out.ok, false, reason);
    if (!out.ok) assertEquals(out.reason, reason);
    assertEquals(writes(log).length, 0, `${reason}: wrote something`);
  }
});

const OPEN = [{ open: true, changed_by: 'viho@example.com', changed_at: '2026-10-17T02:00:00Z' }];
const CLOSED_AGAIN = [{ open: false, changed_by: 'viho@example.com', changed_at: '2026-10-17T03:00:00Z' }, ...OPEN];
const switchReads = (log: Query[]) => log.filter((q) => q.table === 'assessment_retake_switch').length;

/** 读开关出错时 retakeSwitch.ts 会打一行 error —— 那是要的;这里收起来 */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
}

Deno.test('start_retake,真实批次:开关开着 → 能开始(只插一行);关着、开过又关了、读不到 → not_open,什么都没写', async () => {
  const log: Query[] = [];
  const out = await startRetake(fakeSupa(world({ rows: [row(1, 'completed', 30 * H)], isTest: false, switchRows: OPEN }), log), 'e1', NOW);
  assertEquals(out, { ok: true, sessionId: 'new', attemptNo: 2 });
  assertEquals(writes(log).length, 1);
  assertEquals(switchReads(log), 1);

  for (
    const [label, w] of [
      ['no row', {}],
      ['closed again', { switchRows: CLOSED_AGAIN }],
      ['read error', { switchError: { code: '42P01', message: 'relation does not exist' } }],
      ['not a boolean', { switchRows: [{ open: 'true', changed_by: 'x', changed_at: 'y' }] }],
    ] as const
  ) {
    const log2: Query[] = [];
    const refused = await quietly(() => startRetake(fakeSupa(world({ rows: [row(1, 'completed', 30 * H)], isTest: false, ...w }), log2), 'e1', NOW));
    assertEquals(refused, { ok: false, reason: 'not_open' }, label);
    assertEquals(writes(log2).length, 0, `${label}: wrote something`);
  }
});

Deno.test('start_retake,测试批次:不读开关 —— 开关表坏了也照常', async () => {
  const log: Query[] = [];
  const out = await startRetake(
    fakeSupa(world({ rows: [row(1, 'completed', 30 * H)], isTest: true, switchError: { code: '42P01', message: 'relation does not exist' } }), log),
    'e1',
    NOW,
  );
  assertEquals(out, { ok: true, sessionId: 'new', attemptNo: 2 });
  assertEquals(switchReads(log), 0);
});

Deno.test('start_retake,链接作废:不用读开关就拒绝', async () => {
  const log: Query[] = [];
  const out = await startRetake(fakeSupa(world({ rows: [row(1, 'completed', 30 * H)], isTest: false, revoked: true, switchRows: OPEN }), log), 'e1', NOW);
  assertEquals(out, { ok: false, reason: 'revoked' });
  assertEquals(switchReads(log), 0);
});

Deno.test('checkRetake(报告页的按钮用的那一个)与 start_retake 读的是同一个开关、给同一个答案', async () => {
  const rows = [row(1, 'completed', 30 * H)];
  const ctx = { revoked: false, isTest: false, nowMs: NOW };
  assertEquals(await checkRetake(fakeSupa(world({ rows, switchRows: OPEN }), []), rows, ctx, 'test'), { ok: true, nextAttemptNo: 2 });
  assertEquals(await checkRetake(fakeSupa(world({ rows }), []), rows, ctx, 'test'), { ok: false, reason: 'not_open' });
  assertEquals(
    await quietly(() => checkRetake(fakeSupa(world({ rows, switchError: { code: 'PGRST000', message: 'boom' } }), []), rows, ctx, 'test')),
    { ok: false, reason: 'not_open' },
  );
  const log: Query[] = [];
  assertEquals(await checkRetake(fakeSupa(world({ rows }), log), rows, { ...ctx, isTest: true }, 'test'), { ok: true, nextAttemptNo: 2 });
  assertEquals(switchReads(log), 0);
});

Deno.test('开关关着时,做到一半的重填:报告页仍然知道有一份没做完(给「继续 / 放弃」),只是不给「开始新的」', async () => {
  const rows = [row(1, 'completed', 30 * H), row(2, 'survey')];
  assertEquals(await checkRetake(fakeSupa(world({ rows }), []), rows, { revoked: false, isTest: false, nowMs: NOW }, 'test'), {
    ok: false,
    reason: 'not_open',
  });
});

Deno.test('开关关着时,放弃照样可以 —— 放弃不读开关(学员不会卡在半路)', async () => {
  const log: Query[] = [];
  const out = await abandonRetake(
    fakeSupa(world({ rows: [row(1, 'completed', 30 * H), row(2, 'survey')], isTest: false, switchError: { code: '42P01', message: 'x' } }), log),
    'e1',
  );
  assertEquals(out, { ok: true, attemptNo: 2 });
  assertEquals(switchReads(log), 0);
});

Deno.test('两个并发的 start_retake:数据库的唯一约束让第二个插入失败 → 回 open_attempt,不报 500', async () => {
  const log: Query[] = [];
  const out = await startRetake(
    fakeSupa(world({
      rows: [row(1, 'completed', 30 * H)],
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint "assessment_sessions_one_open_attempt"' },
      rowsAfterConflict: [row(1, 'completed', 30 * H), row(2, 'in_progress')],
    }), log),
    'e1',
    NOW,
  );
  assertEquals(out, { ok: false, reason: 'open_attempt' });
});

Deno.test('放弃:只删没做完的那一份,而且删除本身带着「不是 completed」的条件', async () => {
  const log: Query[] = [];
  const out = await abandonRetake(fakeSupa(world({ rows: [row(1, 'completed', 30 * H), row(2, 'survey')] }), log), 'e1');
  assertEquals(out, { ok: true, attemptNo: 2 });
  const del = writes(log);
  assertEquals(del.length, 1);
  assert(op(del[0], 'delete'));
  const eqs = del[0].ops.filter((o) => o.m === 'eq' || o.m === 'neq').map((o) => [o.m, ...o.a]);
  assertEquals(eqs, [['eq', 'id', 's2'], ['neq', 'status', 'completed']]);
});

Deno.test('放弃:第一份不能放弃(那不是重填);没有没做完的 → 拒绝;都不写', async () => {
  for (const [rows, reason] of [
    [[row(1, 'in_progress')], 'first_attempt'],
    [[row(1, 'completed', 30 * H)], 'no_open_attempt'],
  ] as const) {
    const log: Query[] = [];
    const out = await abandonRetake(fakeSupa(world({ rows: [...rows] }), log), 'e1');
    assertEquals(out, { ok: false, reason });
    assertEquals(writes(log).length, 0);
  }
});

Deno.test('放弃时那一份刚好完成了(删除条件没命中):回 no_open_attempt,不报成功', async () => {
  const log: Query[] = [];
  const out = await abandonRetake(fakeSupa(world({ rows: [row(1, 'completed', 30 * H), row(2, 'survey')], deleted: 0 }), log), 'e1');
  assertEquals(out, { ok: false, reason: 'no_open_attempt' });
});

// ── 旧页面的守卫:不需要新写,但要钉住它在两份时仍然成立(第 5 节第 1 条)──

Deno.test('第 2 份已开始:第 1 份的页面来写 → session_changed;就算 id 对上了,第 1 份已完成 → already_completed', () => {
  const rows = [row(1, 'completed', 30 * H), row(2, 'in_progress')];
  const current = pickCurrent(rows)!;
  assertEquals(current.id, 's2');
  assertEquals(guardSessionWrite(current, 's1'), { ok: false, error: 'session_changed' });
  assertEquals(guardSessionWrite(rows[0], 's1'), { ok: false, error: 'already_completed' });
});

// ── 登录去向:做过的人去报告,即使有一份重填没做完 ──

Deno.test('登录去向看「报告看的那份」:有完成的就是 completed(→ 报告页);一份都没完成照旧', () => {
  assertEquals(loginStatus([row(1, 'completed', 30 * H), row(2, 'in_progress')]), 'completed');
  // attemptsOf 回的是编号从大到小 —— 没做完的第 2 份排在最前,去向仍然是报告
  assertEquals(loginStatus([row(2, 'in_progress'), row(1, 'completed', 30 * H)]), 'completed');
  assertEquals(loginStatus([row(1, 'survey')]), 'survey');
  assertEquals(loginStatus([]), null);
});

// ── 预填(Viho 的第 3 个决定)──

const SURVEY = config.survey_questions as unknown as {
  id: string;
  type: string;
  field: string;
  zh: { options?: string[] };
  option_to_dimension?: string[];
  option_to_value?: string[];
  value_map?: number[];
}[];

/** 与 assessment-score 的 saveSurvey 同一套正向映射 —— 预填要把它反过来 */
function storeLikeSaveSurvey(responses: Record<string, unknown>): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const q of SURVEY) {
    const v = responses[q.id];
    if (v === undefined) continue;
    if (q.type === 'single_select') {
      const table = q.option_to_dimension ?? q.option_to_value ?? q.value_map;
      stored[q.field] = table ? mapOption<string | number>(v as number, table) : v;
    } else if (q.type === 'multi_select') stored[q.field] = mapOptions(v as number[], q.zh.options!);
    else stored[q.field] = v;
  }
  return stored;
}

Deno.test('问卷预填 = 上一次的答案换回页面提交时的形状(下标);每一道单选的每一个选项都来回一遍', () => {
  for (const q of SURVEY.filter((q) => q.type === 'single_select')) {
    for (let i = 0; i < q.zh.options!.length; i++) {
      assertEquals(surveyPrefill(storeLikeSaveSurvey({ [q.id]: i }))[q.id], i, `${q.id} option ${i}`);
    }
  }
  const full = { S1: 3, S2: 1, S3: 2, S4: [0, 2, 5], S5: 'double the close rate in 90 days ✓', S6: 'not enough people', S7: 1 };
  assertEquals(surveyPrefill(storeLikeSaveSurvey(full)), full);
});

Deno.test('问卷预填:库里的值对不上现在的选项(改过题)→ 那一题不预填,不猜;多选里有一项对不上 → 整题不预填', () => {
  const stored = storeLikeSaveSurvey({ S1: 0, S4: [1, 2], S7: 0 });
  stored.priority_dimension = 'no-such-dimension';
  (stored.current_tools as string[]).push('a tool that no longer exists');
  const out = surveyPrefill(stored);
  assertEquals('S1' in out, false);
  assertEquals('S4' in out, false);
  assertEquals(out.S7, 0);
});

Deno.test('背景题预填:只留合法的下标', () => {
  assertEquals(profilePrefill({ P1: 2, P2: 9, P3: 'x', P9: 1 }), { P1: 2 });
  assertEquals(profilePrefill(null), {});
});

Deno.test('预填只给「第 2 份及以后、还没做完」的那一份,来源是最新完成的那一份;15 道正式题一道都不带', async () => {
  const log: Query[] = [];
  const supa = fakeSupa((q) => {
    if (q.table === 'assessment_sessions') return { data: { profile: { P1: 4, P2: 1, P3: 0 } } };
    if (q.table === 'assessment_survey') return { data: { responses: storeLikeSaveSurvey({ S1: 2, S7: 3, S5: 'x' }) } };
    return { data: null };
  }, log);
  const rows = [row(1, 'completed', 90 * H), row(2, 'completed', 30 * H), row(3, 'in_progress')];
  const out = await retakePrefill(supa, rows, rows[2]);
  assertEquals(out, { fromAttempt: 2, profile: { P1: 4, P2: 1, P3: 0 }, survey: { S1: 2, S5: 'x', S7: 3 } });
  assert(!log.some((q) => q.table === 'assessment_answers'), 'prefill must not read (or carry) the scored answers');
  // 读的是第 2 份(最新完成的),不是第 1 份
  for (const q of log) assertEquals(q.ops.find((o) => o.m === 'eq')!.a, q.table === 'assessment_sessions' ? ['id', 's2'] : ['session_id', 's2']);

  assertEquals(await retakePrefill(supa, [row(1, 'in_progress')], row(1, 'in_progress')), null);
  assertEquals(await retakePrefill(supa, rows.slice(0, 2), rows[1]), null);
});

// ── 「生成另一种语言」只对最新那一份(Viho 的第 2 个决定)──

Deno.test('历史那一份:已经生成好的照常给;没有的不触发渲染(refuse),也不写任何东西', () => {
  assertEquals(fileRequestDecision(false, 'ready'), 'ready');
  assertEquals(fileRequestDecision(false, 'working'), 'working');
  assertEquals(fileRequestDecision(false, 'absent'), 'refuse_history');
  assertEquals(fileRequestDecision(false, 'failed'), 'refuse_history');
  assertEquals(fileRequestDecision(false, 'exhausted'), 'exhausted');
  // 最新那一份:与今天完全一样
  assertEquals(fileRequestDecision(true, 'absent'), 'render');
  assertEquals(fileRequestDecision(true, 'failed'), 'render');
  assertEquals(fileRequestDecision(true, 'ready'), 'ready');
});

// ── 重试只认最新一份(第 3 节:旧一份的重试晚到会把新数字盖回旧数字)──

Deno.test('第 1 份留着失败的重试、第 2 份已完成 → 第 1 份作废;没有更新的完成份 → 不作废', () => {
  const candidates = [
    { session_id: 'a1', entitlement_id: 'A', attempt_no: 1 },
    { session_id: 'a2', entitlement_id: 'A', attempt_no: 2 },
    { session_id: 'b1', entitlement_id: 'B', attempt_no: 1 },
    // C 的第 2 份有结果、但答题记录没标上 completed(finalize 那一步失败只记日志)—— 视图里最新的还是第 1 份:不能把第 2 份作废
    { session_id: 'c2', entitlement_id: 'C', attempt_no: 2 },
  ];
  const latest = [
    { entitlement_id: 'A', attempt_no: 2 },
    { entitlement_id: 'B', attempt_no: 1 },
    { entitlement_id: 'C', attempt_no: 1 },
  ];
  assertEquals([...supersededSessionIds(candidates, latest)], ['a1']);
  // 视图里没有这个人(还没有任何一份完成)→ 不作废
  assertEquals([...supersededSessionIds([{ session_id: 'd1', entitlement_id: 'D', attempt_no: 1 }], latest)], []);
});
