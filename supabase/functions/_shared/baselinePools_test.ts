import { assertEquals } from '@std/assert';
import { buildBaselinePools, isTestResultRow, type RawBaselineRow } from './baselinePools.ts';

const COHORT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const COHORT_TEST = 'bbbbbbbb-0000-4000-8000-000000000002';

function row(
  total: number,
  cohortId: string | null,
  isTest: boolean | null,
  sessionId = 's',
): RawBaselineRow {
  return {
    dim_scores: { goal: total },
    total,
    tier: 'spot',
    session: {
      id: sessionId,
      entitlement: {
        cohort_id: cohortId,
        cohort: isTest === null ? null : { is_test: isTest },
      },
    },
  };
}

Deno.test('测试行一律不进全局池 —— 这是这个模块存在的理由', () => {
  const rows = [row(4, COHORT_A, false), row(1, COHORT_TEST, true), row(5, COHORT_A, false)];
  const { globalRows } = buildBaselinePools(rows, COHORT_A);
  assertEquals(globalRows.length, 2);
  assertEquals(globalRows.map((r) => r.total).sort(), [4, 5]);
});

Deno.test('真实学员的全局兜底不含任何测试数据 —— 新批次第一个人正是走这条路', () => {
  /**
   * selectBaseline 在同批次不足 min_n 时回落全局池。这条是那次失败的直接断言:
   * 一个刚开的真实批次只有他一个人,基准取全局 —— 那时全局池里绝不能有假数据。
   */
  const rows = [row(1, COHORT_TEST, true), row(1, COHORT_TEST, true), row(4, COHORT_A, false)];
  const { globalRows, cohortRows } = buildBaselinePools(rows, COHORT_A);
  assertEquals(cohortRows.length, 1); // 他自己
  assertEquals(globalRows.length, 1); // 也只有他 —— 两条测试行都被剔掉
  assertEquals(globalRows[0].total, 4);
});

Deno.test('测试批次里的人,自己那批仍然是他的基准', () => {
  // 现场模式演示时那份报告要像真的 —— 测试数据只在【别人的】报告里才是污染
  const rows = [row(2, COHORT_TEST, true, 'x'), row(3, COHORT_TEST, true, 'y')];
  const { cohortRows, globalRows } = buildBaselinePools(rows, COHORT_TEST);
  assertEquals(cohortRows.length, 2);
  assertEquals(globalRows.length, 0);
});

Deno.test('没有批次的人没有同批次基准,而不是与所有无批次的人合池', () => {
  const rows = [row(4, null, false), row(5, null, false)];
  assertEquals(buildBaselinePools(rows, null).cohortRows.length, 0);
  assertEquals(buildBaselinePools(rows, null).globalRows.length, 2);
});

Deno.test('拿不到 cohort 时按【不是测试】处理', () => {
  /**
   * 判据缺失时按真实处理,与列的默认值同向。反过来(缺失即视为测试)会让一次
   * 写漏 select 的查询把整个全局池清空 —— 那时基准 n=0,报告上只是「没有对比」,
   * 没人会怀疑是查询写漏了。
   */
  assertEquals(isTestResultRow(row(4, COHORT_A, null)), false);
  assertEquals(isTestResultRow({ total: 4, tier: 'spot' }), false);
  assertEquals(buildBaselinePools([row(4, COHORT_A, null)], COHORT_A).globalRows.length, 1);
});

Deno.test('is_test 只认 true —— null / undefined / 缺失都不算', () => {
  assertEquals(isTestResultRow(row(4, COHORT_A, true)), true);
  assertEquals(isTestResultRow(row(4, COHORT_A, false)), false);
  assertEquals(isTestResultRow(row(4, COHORT_A, null)), false);
});

Deno.test('dim_scores 缺失时归一成空对象,不抛', () => {
  const bare: RawBaselineRow = { total: 3, tier: 'spot', session: null };
  const { globalRows } = buildBaselinePools([bare], null);
  assertEquals(globalRows.length, 1);
  assertEquals(globalRows[0].dimensions, {});
});

Deno.test('同一行可以同时在两个池里(真实学员看自己批次)', () => {
  // 反向锁:剔除只作用于全局池,不该顺手把同批次池也清掉
  const rows = [row(4, COHORT_A, false)];
  const { globalRows, cohortRows } = buildBaselinePools(rows, COHORT_A);
  assertEquals(globalRows.length, 1);
  assertEquals(cohortRows.length, 1);
});
