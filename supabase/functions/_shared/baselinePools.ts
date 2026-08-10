/**
 * 基准线的两个池怎么分 —— **纯函数,没有 IO**。
 *
 * 【为什么抽出来】原来这段就地写在 assessment-report 里,带着两个 `as any`,
 * 而「测试数据不许进全局池」这条规则一旦只活在一句 filter 里,就没有任何东西能断言它。
 * 它的失败形态是**最不该出错的那一处**:新批次第一个学员的报告,基准是一堆假数据,
 * 而报告本身看起来完全正常 —— 没有报错、没有异常值,只有基准线悄悄偏了。
 * 这种「安静地错」必须有断言看着(判断标准 2 与 4)。
 */

/** 计分用到的那三列;dim_scores 的形状由调用方保证 */
export interface ResultRow {
  dimensions: Record<string, number>;
  total: number;
  tier: string;
}

/**
 * PostgREST 回来的原始行:结果 + 一路嵌到 cohort 的 is_test。
 * 字段可空是因为 PostgREST 对嵌套资源的返回形状依查询而变,这里按最宽松的形状收。
 */
export interface RawBaselineRow {
  dim_scores?: unknown;
  total: number;
  tier: string;
  session?: {
    id?: string;
    entitlement?: {
      cohort_id?: string | null;
      cohort?: { is_test?: boolean | null } | null;
    } | null;
  } | null;
}

/**
 * 这一行是不是测试 / 演示数据。
 *
 * 【拿不到 cohort 时算「不是测试」】判据缺失时按真实处理 —— 与列的默认值同向。
 * 反过来(缺失即视为测试)会让一次查询写漏 select 就把整个池清空,
 * 而那时基准线会变成 n=0,报告上看起来只是「没有对比」,没人会怀疑是查询写漏了。
 */
export function isTestResultRow(row: RawBaselineRow): boolean {
  return row.session?.entitlement?.cohort?.is_test === true;
}

const norm = (r: RawBaselineRow): ResultRow => ({
  dimensions: (r.dim_scores ?? {}) as Record<string, number>,
  total: r.total,
  tier: r.tier,
});

/**
 * 分池。
 *
 * - **全局池一律剔除测试行** —— 这是这个函数存在的理由。
 * - **同批次池按 cohort_id 过滤,不额外剔除测试行**:一个测试批次里的学员,
 *   他自己的报告应该拿他自己那批做基准(现场模式演示时那份报告要像真的)。
 *   测试批次的数据只在「别人的报告」里才是污染。
 * - `cohortId` 为 null 时同批次池为空 —— 没有批次就没有同批次基准,
 *   而不是「和所有没有批次的人比」。
 */
export function buildBaselinePools(
  rows: readonly RawBaselineRow[],
  cohortId: string | null,
): { globalRows: ResultRow[]; cohortRows: ResultRow[] } {
  const globalRows: ResultRow[] = [];
  const cohortRows: ResultRow[] = [];
  for (const r of rows) {
    if (!isTestResultRow(r)) globalRows.push(norm(r));
    if (cohortId !== null && r.session?.entitlement?.cohort_id === cohortId) {
      cohortRows.push(norm(r));
    }
  }
  return { globalRows, cohortRows };
}
