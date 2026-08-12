import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 「这一行属于测试 / 演示批次吗」—— **所有对外出口的收口判断**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么是收口,而不是每个查询各加一句过滤】
 *
 * 逐个查询加过滤 = 手写覆盖范围(判断标准 12)。已经栽了三次:
 *   `assessment-ghl-resync` → 对 GHL 发了 15 次请求,查不存在的 contact
 *   `api/cron/pdf-sweep`    → 把 15 条 seed 全渲了,15 次 Chromium
 *   基准线                   → 修掉了,但当时也是「发现一处补一处」
 * 而 seed 脚本里那句「刻意不渲」被 sweep 完全无视 ——
 * **意图写在注释里对自动化流程无效。**
 *
 * 对外副作用只有两个出口(全仓查证,各只有 2 个调用点):
 *   `ghlWriteback.syncToGhl()`   ← resync + finalize
 *   `resendLink.sendMagicLink()` ← Admin 重发/换链接 + login-request
 * 判断放在这两处,就覆盖了**现在和将来**所有的 GHL 流量与外发消息 ——
 * 包括 Stage 11 的 tags,因为它一定会走 syncToGhl。
 * **那是在功能写出来之前就覆盖了它**,而不是等它上线之后再补一处。
 *
 * 【过滤的判据是请求的来源,不是数据的属性】见判断标准 13。
 * 所以这里只提供判断,**不替调用方决定拦不拦** ——
 * 对外出口一律跳过;而 Admin 的「重新生成 PDF」、演示时的答题是**有人请求**的,照做。
 * 同一份数据在两条路径上得到不同待遇,这是有意的。
 *
 * 【代价:每次外发前多一次 DB 查询】接受。
 * **不要为了省这一次查询而把判断交给调用方传参** ——
 * 那就又回到「调用方必须记得」,也就是这一整条的病因。
 *
 * (放在 `api/_lib/` 是因为 Vercel 只编译 `/api` 内的 TS,而 `api/cron/pdf-sweep.ts`
 * 也要用这里的纯判断;Deno 侧经 `_shared/testCohort.ts` 一行 re-export 取用。
 * 见 renderToken 的先例。)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * 纯判断:一个 cohort 行是不是测试批次。
 *
 * 【只认 `true`】null / undefined / 缺字段一律当「不是测试」——
 * 与列的默认值同向,也与 `baselinePools` 那边同一个方向。
 * 反过来的话,一次写漏 select 的查询会把所有真实数据都当成测试数据跳过,
 * 而那种「什么都不发了」的故障会安静地持续到有人投诉。
 */
export function isTestCohort(cohort: { is_test?: boolean | null } | null | undefined): boolean {
  return cohort?.is_test === true;
}

/**
 * 按 entitlement id 查它的批次是不是测试批次。
 *
 * 【查不到时回 false,不抛】收口判断失败不该让外发整体崩掉 ——
 * 那会把一个「判断不了」变成一次全站故障。回 false 的方向是「照常发」,
 * 与列默认值同向;真出问题时由外发本身的错误路径报出来。
 */
export async function isTestEntitlement(
  supa: SupabaseClient,
  entitlementId: string,
): Promise<boolean> {
  const { data, error } = await supa
    .from('assessment_entitlements')
    .select('cohort:assessment_cohorts(is_test)')
    .eq('id', entitlementId)
    .maybeSingle();
  if (error) {
    console.error(`isTestEntitlement(${entitlementId}) failed: ${error.message}`);
    return false;
  }
  return isTestCohort((data as { cohort?: { is_test?: boolean | null } | null } | null)?.cohort);
}

/**
 * 按 session id 查它所属 entitlement 的批次是不是测试批次。
 *
 * `syncToGhl` 手上只有 session id(其余参数都是 payload),所以要这一条。
 */
export async function isTestSessionCohort(
  supa: SupabaseClient,
  sessionId: string,
): Promise<boolean> {
  const { data, error } = await supa
    .from('assessment_sessions')
    .select('entitlement:assessment_entitlements(cohort:assessment_cohorts(is_test))')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) {
    console.error(`isTestSessionCohort(${sessionId}) failed: ${error.message}`);
    return false;
  }
  const row = data as {
    entitlement?: { cohort?: { is_test?: boolean | null } | null } | null;
  } | null;
  return isTestCohort(row?.entitlement?.cohort);
}
