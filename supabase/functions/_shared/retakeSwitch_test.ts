import { assert, assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isOpenRow, parseSwitchSet, readRetakeSwitch, RETAKE_SWITCH_TABLE, retakeSwitchAction, setRetakeSwitch, SWITCH_HISTORY } from './retakeSwitch.ts';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 对真实学员开放重填的开关(重填第 5 步的准备,Viho 2026-10-16)。每一条都先对着「永远关、什么都不读不写」的桩跑红。
 * 表本身(只追加、权限)的红绿在 PGlite 里做,见 PROGRESS。
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Op {
  m: string;
  a: unknown[];
}
interface Query {
  table: string;
  ops: Op[];
}
const op = (q: Query, m: string) => q.ops.find((o) => o.m === m);

function fakeSupa(handler: (q: Query) => { data?: unknown; error?: unknown } | Promise<never>, log: Query[]) {
  return {
    from(table: string) {
      const q: Query = { table, ops: [] };
      log.push(q);
      const builder: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve()
                .then(() => handler(q))
                .then((r) => ({ data: r.data ?? null, error: r.error ?? null }))
                .then(res, rej);
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

const ROW = (open: unknown, by = 'viho@example.com', at = '2026-10-17T02:00:00+00:00') => ({ open, changed_by: by, changed_at: at });

/** 读的时候控制台会有一行 error(那正是要的);测试里收起来,顺便断言它说了什么 */
async function quietly<T>(fn: () => Promise<T>): Promise<{ out: T; logged: string[] }> {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  try {
    return { out: await fn(), logged };
  } finally {
    console.error = orig;
  }
}

// ── 读:默认关闭,读不到也关闭 ──

Deno.test('一行都没有(迁移之后的样子)→ 关闭,而且算「读到了」', async () => {
  const log: Query[] = [];
  const s = await readRetakeSwitch(fakeSupa(() => ({ data: [] }), log), 'test');
  assertEquals(s, { open: false, readable: true, recent: [] });
});

Deno.test('最新一行 open = true → 开着;读的是那张表、按 id 倒序、只取要的条数', async () => {
  const log: Query[] = [];
  const s = await readRetakeSwitch(fakeSupa(() => ({ data: [ROW(true)] }), log), 'test');
  assertEquals(s.open, true);
  assertEquals(s.readable, true);
  assertEquals(log.length, 1);
  assertEquals(log[0].table, RETAKE_SWITCH_TABLE);
  assertEquals(op(log[0], 'order')!.a, ['id', { ascending: false }]);
  assertEquals(op(log[0], 'limit')!.a, [1]);
  // 只读:什么都不写
  assert(!op(log[0], 'insert') && !op(log[0], 'update') && !op(log[0], 'delete') && !op(log[0], 'upsert'));
});

Deno.test('当前值只看最新那一行:开过又关了 → 关', async () => {
  const s = await readRetakeSwitch(
    fakeSupa(() => ({ data: [ROW(false, 'viho@example.com', '2026-10-17T03:00:00Z'), ROW(true, 'viho@example.com', '2026-10-17T02:00:00Z')] }), []),
    'test',
    20,
  );
  assertEquals(s.open, false);
  assertEquals(s.recent, [
    { open: false, by: 'viho@example.com', at: '2026-10-17T03:00:00Z' },
    { open: true, by: 'viho@example.com', at: '2026-10-17T02:00:00Z' },
  ]);
});

Deno.test('读取出错(PostgREST 的 error)→ 关闭、readable: false,并在日志里说「按关闭处理」', async () => {
  const { out, logged } = await quietly(() =>
    readRetakeSwitch(fakeSupa(() => ({ error: { code: '42P01', message: 'relation "assessment_retake_switch" does not exist' } }), []), 'test')
  );
  assertEquals(out, { open: false, readable: false, recent: [] });
  assertEquals(logged.length, 1);
  assert(logged[0].includes('closed'), logged[0]);
});

Deno.test('读的时候抛异常(网络断了)→ 关闭、readable: false —— 绝不把异常抛给学员的请求', async () => {
  const { out, logged } = await quietly(() => readRetakeSwitch(fakeSupa(() => Promise.reject(new TypeError('fetch failed')), []), 'test'));
  assertEquals(out, { open: false, readable: false, recent: [] });
  assertEquals(logged.length, 1);
});

Deno.test('回来的不是数组(形状不对)→ 关闭、readable: false', async () => {
  const { out } = await quietly(() => readRetakeSwitch(fakeSupa(() => ({ data: { open: true } }), []), 'test'));
  assertEquals(out, { open: false, readable: false, recent: [] });
});

Deno.test('只认布尔 true:字符串 "true"、1、null、缺字段 → 都是关', () => {
  assertEquals(isOpenRow(ROW(true)), true);
  for (const v of ['true', 1, null, undefined, 'yes', {}]) assertEquals(isOpenRow(ROW(v)), false, JSON.stringify(v));
  assertEquals(isOpenRow(null), false);
  assertEquals(isOpenRow(undefined), false);
  assertEquals(isOpenRow('true'), false);
});

Deno.test('最新一行的 open 不是布尔 true → 关(哪怕更早的一行是开)', async () => {
  const s = await readRetakeSwitch(fakeSupa(() => ({ data: [ROW('true'), ROW(true)] }), []), 'test', 5);
  assertEquals(s.open, false);
});

// ── 设:参数必须是明确的布尔 ──

Deno.test('retake_switch_set 的参数:open 必须是布尔 —— 没有默认值,也没有「切换」', () => {
  assertEquals(parseSwitchSet({ open: true }), { ok: true, open: true });
  assertEquals(parseSwitchSet({ open: false }), { ok: true, open: false });
  for (const body of [{}, { open: 'true' }, { open: 1 }, { open: null }, { toggle: true }, { open: 'false' }]) {
    assertEquals(parseSwitchSet(body as Record<string, unknown>), { ok: false }, JSON.stringify(body));
  }
});

Deno.test('设开关 = 插一行:开还是关、谁(管理员邮箱);时间由数据库给。只插这一行,不改不删', async () => {
  const log: Query[] = [];
  await setRetakeSwitch(fakeSupa(() => ({ data: null }), log), true, 'viho@example.com', 'test');
  assertEquals(log.length, 1);
  assertEquals(log[0].table, RETAKE_SWITCH_TABLE);
  assertEquals(op(log[0], 'insert')!.a[0], { open: true, changed_by: 'viho@example.com' });
  assert(!op(log[0], 'update') && !op(log[0], 'delete') && !op(log[0], 'upsert'));

  const log2: Query[] = [];
  await setRetakeSwitch(fakeSupa(() => ({ data: null }), log2), false, 'other-admin@example.com', 'test');
  assertEquals(op(log2[0], 'insert')!.a[0], { open: false, changed_by: 'other-admin@example.com' });
});

Deno.test('写不进去 → 抛(后台看到失败,开关保持原样);不会悄悄当成功', async () => {
  await assertRejects(() =>
    setRetakeSwitch(fakeSupa(() => ({ error: { code: '42501', message: 'permission denied' } }), []), false, 'viho@example.com', 'test')
  );
});

Deno.test('没有管理员邮箱就不写(记录里「谁」不能是空的)', async () => {
  const log: Query[] = [];
  await assertRejects(() => setRetakeSwitch(fakeSupa(() => ({ data: null }), log), false, '  ', 'test'));
  assertEquals(log.length, 0);
});

// ── assessment-admin 的两个 action(index.ts 只把 verdict.email 交进来)──

/** 一张只追加的假表:insert 往前放,select 回当前的全部(新的在前) */
function switchTable(rows: { open: unknown; changed_by: string; changed_at: string }[]) {
  return (q: Query) => {
    const ins = op(q, 'insert');
    if (ins) {
      const r = ins.a[0] as { open: boolean; changed_by: string };
      rows.unshift({ ...r, changed_at: '2026-10-17T04:00:00+00:00' });
      return { data: null };
    }
    const lim = op(q, 'limit')?.a[0] as number | undefined;
    return { data: rows.slice(0, lim ?? rows.length) };
  };
}

async function quietLog<T>(fn: () => Promise<T>): Promise<{ out: T; logged: string[] }> {
  const logged: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  try {
    return { out: await fn(), logged };
  } finally {
    console.log = orig;
  }
}

Deno.test('retake_switch:回当前状态与最近 20 次切换;只读', async () => {
  const log: Query[] = [];
  const out = await retakeSwitchAction(fakeSupa(switchTable([ROW(true)]), log), 'retake_switch', {}, 'viho@example.com', 'test');
  assertEquals(out, { status: 200, body: { open: true, readable: true, recent: [{ open: true, by: 'viho@example.com', at: '2026-10-17T02:00:00+00:00' }] } });
  assertEquals(SWITCH_HISTORY, 20);
  assertEquals(op(log[0], 'limit')!.a, [20]);
  assert(log.every((q) => !op(q, 'insert')));
});

Deno.test('retake_switch_set:记下的「谁」只认通过名单的那个管理员 —— 请求体里自称的不算;写完重读回给页面;打一行审计日志', async () => {
  const rows: { open: unknown; changed_by: string; changed_at: string }[] = [];
  const log: Query[] = [];
  const { out, logged } = await quietLog(() =>
    retakeSwitchAction(fakeSupa(switchTable(rows), log), 'retake_switch_set', { open: true, by: 'someone-else@example.com', changed_by: 'x' }, 'viho@example.com', 'test')
  );
  assertEquals(out.status, 200);
  assertEquals((out.body as { open: boolean }).open, true);
  assertEquals(rows.map((r) => [r.open, r.changed_by]), [[true, 'viho@example.com']]);
  assertEquals(log.filter((q) => op(q, 'insert')).length, 1);
  assertEquals(logged.length, 1);
  assert(logged[0].includes('viho@example.com') && logged[0].includes('ON'), logged[0]);

  const again = await quietLog(() => retakeSwitchAction(fakeSupa(switchTable(rows), []), 'retake_switch_set', { open: false }, 'ops@example.com', 'test'));
  assertEquals((again.out.body as { open: boolean; recent: unknown[] }).open, false);
  assertEquals((again.out.body as { recent: unknown[] }).recent.length, 2);
  assert(again.logged[0].includes('ops@example.com') && again.logged[0].includes('OFF'), again.logged[0]);
});

Deno.test('retake_switch_set 参数不对(没给 / 字符串 / 数字)→ 400,一行都不写', async () => {
  for (const body of [{}, { open: 'true' }, { open: 1 }, { open: null }]) {
    const log: Query[] = [];
    const out = await retakeSwitchAction(fakeSupa(switchTable([]), log), 'retake_switch_set', body, 'viho@example.com', 'test');
    assertEquals(out.status, 400, JSON.stringify(body));
    assertEquals(log.length, 0, JSON.stringify(body));
  }
});

Deno.test('retake_switch_set 写不进去 → 抛给 assessment-admin 的 catch(500 + 分类),不回「成功」', async () => {
  await assertRejects(() =>
    quietLog(() =>
      retakeSwitchAction(fakeSupa(() => ({ error: { code: '42501', message: 'permission denied' } }), []), 'retake_switch_set', { open: false }, 'viho@example.com', 'test')
    )
  );
});

// ── 谁读这个开关:只有「开始新的重填」那一处规则 ──

Deno.test('读开关的只有 retake.ts(开始重填与报告页的按钮共用的那一处)与后台的 action;设开关的只有 assessment-admin', async () => {
  const root = new URL('../', import.meta.url);
  const readers = new Set<string>();
  const setters = new Set<string>();
  const checkers = new Set<string>();
  const actions = new Set<string>();
  async function walk(dir: URL, rel: string) {
    for await (const e of Deno.readDir(dir)) {
      if (e.isDirectory) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        await walk(new URL(`${e.name}/`, dir), `${rel}${e.name}/`);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('_test.ts')) {
        const src = await Deno.readTextFile(new URL(e.name, dir));
        const path = `${rel}${e.name}`;
        if (/\breadRetakeSwitch\(/.test(src) && path !== '_shared/retakeSwitch.ts') readers.add(path);
        if (/\bsetRetakeSwitch\(/.test(src) && path !== '_shared/retakeSwitch.ts') setters.add(path);
        if (/\bcheckRetake\(/.test(src) && path !== '_shared/retake.ts') checkers.add(path);
        if (/\bretakeSwitchAction\(/.test(src) && path !== '_shared/retakeSwitch.ts') actions.add(path);
      }
    }
  }
  await walk(root, '');
  assertEquals([...readers].sort(), ['_shared/retake.ts']);
  // 设开关只经 retakeSwitchAction(retakeSwitch.ts 自己),而它只有 assessment-admin 调
  assertEquals([...setters].sort(), []);
  assertEquals([...actions].sort(), ['assessment-admin/index.ts']);
  // 「能不能开始」:开始重填(retake.ts 自己的 startRetake)与报告页的按钮 —— 没有别人
  assertEquals([...checkers].sort(), ['assessment-report/index.ts']);
});
