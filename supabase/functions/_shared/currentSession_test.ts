import { assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentSession, reportSession } from './currentSession.ts';

interface Call {
  table: string;
  select: string;
  eq: [string, unknown];
  order: [string, unknown];
}

/** 只实现这条链用到的那几步;记下每一步的参数 */
function fakeSupa(rows: unknown[] | null, error: unknown = null, calls: Call[] = []) {
  return {
    from: (table: string) => ({
      select: (select: string) => ({
        eq: (col: string, val: unknown) => ({
          order: (ocol: string, oopts: unknown) => ({
            limit: () => {
              calls.push({ table, select, eq: [col, val], order: [ocol, oopts] });
              return Promise.resolve({ data: rows, error });
            },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

Deno.test('按 entitlement 取全部答题记录,一定带 id / status / attempt_no,再加调用方要的列', async () => {
  const calls: Call[] = [];
  await currentSession(fakeSupa([], null, calls), 'ent-1', 'profile, entitlement:assessment_entitlements(lang)');
  assertEquals(calls, [{
    table: 'assessment_sessions',
    select: 'id, status, attempt_no, profile, entitlement:assessment_entitlements(lang)',
    eq: ['entitlement_id', 'ent-1'],
    order: ['attempt_no', { ascending: false }],
  }]);
  await reportSession(fakeSupa([], null, calls), 'ent-2');
  assertEquals(calls[1].select, 'id, status, attempt_no');
});

Deno.test('一人一份(今天):currentSession 与 reportSession 都回那一份', async () => {
  const only = { id: 's1', status: 'survey', attempt_no: 1 };
  assertEquals((await currentSession(fakeSupa([only]), 'e')).data, only);
  assertEquals((await reportSession(fakeSupa([only]), 'e')).data, only);
});

Deno.test('一人两份:当前 = 没做完的,报告 = 完成的那份', async () => {
  const rows = [{ id: 's2', status: 'in_progress', attempt_no: 2 }, { id: 's1', status: 'completed', attempt_no: 1 }];
  assertEquals((await currentSession(fakeSupa(rows), 'e')).data?.id, 's2');
  assertEquals((await reportSession(fakeSupa(rows), 'e')).data?.id, 's1');
});

Deno.test('没有答题记录 → data: null、error: null(调用方照旧回 no_session)', async () => {
  assertEquals(await currentSession(fakeSupa([]), 'e'), { data: null, error: null });
  assertEquals(await reportSession(fakeSupa(null), 'e'), { data: null, error: null });
});

Deno.test('查询出错 → 原样把 error 交回去,data 为 null(调用方 dbFail)', async () => {
  const err = { message: 'boom', code: '42P01' };
  assertEquals(await currentSession(fakeSupa(null, err), 'e'), { data: null, error: err as never });
});
