import { assertEquals } from '@std/assert';
import { asRows, latestPerEntitlement, pickCurrent, pickReportAttempt } from './attempts.ts';

const a = (attempt_no: number | undefined, status: string, tag = `${attempt_no}-${status}`) => ({ attempt_no, status, tag });

Deno.test('一人一份(今天的全部数据):三种取法都取到那一份 —— 第 1 步对现有数据零变化的根据', () => {
  for (const status of ['in_progress', 'survey', 'completed']) {
    const only = a(1, status);
    assertEquals(pickCurrent([only]), only);
    assertEquals(pickReportAttempt([only]), only);
  }
  // 迁移之前读出来的行没有 attempt_no:按第 1 份算
  const legacy = a(undefined, 'completed');
  assertEquals(pickCurrent([legacy]), legacy);
  assertEquals(pickReportAttempt([legacy]), legacy);
});

Deno.test('没有答题记录:都是 null', () => {
  assertEquals(pickCurrent([]), null);
  assertEquals(pickReportAttempt([]), null);
});

Deno.test('当前答题记录 = 没做完的那份;都做完了 = attempt_no 最大的那份(与行序无关)', () => {
  assertEquals(pickCurrent([a(1, 'completed'), a(2, 'in_progress')])?.tag, '2-in_progress');
  assertEquals(pickCurrent([a(2, 'in_progress'), a(1, 'completed')])?.tag, '2-in_progress');
  assertEquals(pickCurrent([a(1, 'completed'), a(3, 'completed'), a(2, 'completed')])?.tag, '3-completed');
  // 没做完的那份即使不是编号最大的,也是「当前」—— 定义说的是「有没做完的就是它」,不是「最新的就是它」
  assertEquals(pickCurrent([a(2, 'completed'), a(1, 'survey')])?.tag, '1-survey');
});

Deno.test('报告看的那份 = 最新完成的;一份都没完成 = 当前那份(于是「还没出分」照旧)', () => {
  // 重填做到一半:报告仍然是上一份完成的,不是没做完的那份
  assertEquals(pickReportAttempt([a(1, 'completed'), a(2, 'survey')])?.tag, '1-completed');
  assertEquals(pickReportAttempt([a(2, 'completed'), a(1, 'completed'), a(3, 'in_progress')])?.tag, '2-completed');
  assertEquals(pickReportAttempt([a(1, 'in_progress')])?.tag, '1-in_progress');
});

Deno.test('PostgREST 的嵌套:一对一时是对象、一对多时是数组、没有时是 null —— 统一成数组', () => {
  const one = a(1, 'completed');
  assertEquals(asRows(one), [one]);
  assertEquals(asRows([one, a(2, 'survey')]).length, 2);
  assertEquals(asRows(null), []);
  assertEquals(asRows(undefined), []);
});

Deno.test('每人只留最新完成的一份(统计去重);一人一份时原样、原序返回', () => {
  const rows = [
    { ent: 'x', attempt_no: 1, v: 'x1' },
    { ent: 'y', attempt_no: 1, v: 'y1' },
    { ent: 'z', attempt_no: undefined, v: 'z1' },
  ];
  assertEquals(latestPerEntitlement(rows, (r) => r.ent, (r) => r.attempt_no).map((r) => r.v), ['x1', 'y1', 'z1']);
  const multi = [
    { ent: 'x', attempt_no: 1, v: 'x1' },
    { ent: 'y', attempt_no: 1, v: 'y1' },
    { ent: 'x', attempt_no: 3, v: 'x3' },
    { ent: 'x', attempt_no: 2, v: 'x2' },
  ];
  assertEquals(latestPerEntitlement(multi, (r) => r.ent, (r) => r.attempt_no).map((r) => r.v), ['x3', 'y1']);
  // attempt_no 嵌在里层也行(问卷洞察的行是 survey → session.attempt_no)
  const nested = multi.map((r) => ({ ent: r.ent, session: { attempt_no: r.attempt_no }, v: r.v }));
  assertEquals(latestPerEntitlement(nested, (r) => r.ent, (r) => r.session.attempt_no).map((r) => r.v), ['x3', 'y1']);
});

Deno.test('取不到 entitlement 的行不去重、原样保留(不悄悄丢数据)', () => {
  const rows = [{ ent: null, attempt_no: 1 }, { ent: null, attempt_no: 1 }];
  assertEquals(latestPerEntitlement(rows, (r) => r.ent, (r) => r.attempt_no).length, 2);
});
