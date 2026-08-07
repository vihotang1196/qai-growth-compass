/**
 * `assessment_entitlements.status` 的阶梯 —— **只往前走**。
 *
 * 【为什么抽出来】这条阶梯原本只活在 assessment-auth 里(一句
 * `if (status === 'pending' || status === 'link_sent')`)。finalize 要推 `completed`
 * 时就会出现第二份,而两份「哪些状态算更早」的判断迟早会对不上 ——
 * 那种不一致的失败形态是「安静地错」:状态被推回去了,代码看起来都对。
 * 所以在出现第二个调用点的这一刻抽出来,而不是给复制品加一道一致性守卫。
 *
 * 顺序与 migration 20260731000000 里的 check 约束同源:
 *   status text not null default 'pending'
 *   check (status in ('pending','link_sent','started','completed'))
 * 改这里必须同时改那张表的约束,反之亦然。
 */

export type EntitlementStatus = 'pending' | 'link_sent' | 'started' | 'completed';

/** 由早到晚。下标即先后,不要在别处另写一套顺序。 */
export const ENTITLEMENT_STATUS_ORDER: readonly EntitlementStatus[] = [
  'pending',
  'link_sent',
  'started',
  'completed',
] as const;

/**
 * 严格早于 `target` 的那些状态。
 *
 * 【给谁用】写库时当成过滤条件:`.eq('id', x).in('status', statusesBefore('completed'))`。
 * 这样「不许倒退」是数据库那一条 UPDATE 自己保证的,不依赖「先读后写」——
 * 先读后写在两个请求撞上时会互相覆盖(客户连点两次提交是真实存在的)。
 */
export function statusesBefore(target: EntitlementStatus): EntitlementStatus[] {
  return ENTITLEMENT_STATUS_ORDER.slice(0, ENTITLEMENT_STATUS_ORDER.indexOf(target));
}

/**
 * `current` 能不能推到 `target`。只有严格前进才为 true;原地不动、往回退都是 false。
 *
 * 【无法识别的 current 一律 false】表上有 check 约束,理论上不会出现。
 * 真出现了说明数据已经坏了,那时**不写**比猜一个方向写下去安全。
 */
export function canAdvance(current: string, target: EntitlementStatus): boolean {
  return statusesBefore(target).includes(current as EntitlementStatus);
}
