/**
 * 问卷里的两个销售信号 —— **纯函数,没有 IO**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么抽出来:「不一致」这个定义已经在给学员看的报告里用了】
 *
 * `Report.tsx` 里原本就有一句 `priority !== result.weakest[0]`,
 * 报告第 7 板块靠它决定要不要高亮。问卷洞察页要用同一个判断 ——
 * 而**如果两边各写一份,同一个人可能在后台被标成「不一致」而在他自己的报告里没有**
 * (或者反过来)。那种不一致没有任何东西会报错,只会让运营拿着一份和学员看到的
 * 不一样的名单去沟通。
 *
 * 所以在出现第二个调用点的这一刻抽出来,而不是给复制品加保险
 * (判断标准 3,与 `entitlementStatus` 那次同一个时机判断)。
 *
 * 【判据就是 `!== weakest[0]`,不是「不在 weakest 里」】
 * 考虑过改成「priority 不在最弱两维里」—— 那个集合在业务上更「纯」
 * (选中 weakest[1] 的人方向基本是对的)。**但没有改**:
 * 报告里已经按 `weakest[0]` 高亮了,改定义会让**已经发出去的报告与后台对不上**。
 * 要改就两边一起改,而且要想清楚已发出的报告怎么处理 —— 那是一次产品决定,
 * 不是顺手改一个比较符。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * S7「要不要聊」映射出来的四个值(`option_to_value`),前两个算高意向。
 *
 * 顺序即选项顺序,所以「前两项」= `asap` / `later`。
 * 【不写死成一个布尔判断散在各处】名单页、导出、计数都从这一个来源取。
 */
export const CONSULT_INTENT_VALUES = ['asap', 'later', 'self', 'no'] as const;
export const HIGH_INTENT_VALUES: readonly string[] = CONSULT_INTENT_VALUES.slice(0, 2);

/** S7 是不是高意向。认不出的值一律 false —— 宁可漏掉一个人,也不要把「没意愿」的人推给销售 */
export function isHighIntent(consultInterest: unknown): boolean {
  return typeof consultInterest === 'string' && HIGH_INTENT_VALUES.includes(consultInterest);
}

/**
 * 「想修的」与「该修的」不一致。
 *
 * 与 `Report.tsx` 同一份定义:`priority !== weakest[0]`。
 *
 * 【priority 缺失时不算不一致】S1 是 required,但历史数据里可能没有;
 * 没填的人不该出现在「方向选错了」的名单里 —— 他没选方向。
 */
export function isPriorityMismatch(
  priority: unknown,
  weakest: readonly string[] | null | undefined,
): boolean {
  if (typeof priority !== 'string' || priority.length === 0) return false;
  const primary = weakest?.[0];
  if (typeof primary !== 'string' || primary.length === 0) return false;
  return priority !== primary;
}

/**
 * 三分:正中 / 挨着 / 偏了。
 *
 * 【为什么除了布尔还给三分】`mismatched` 是要优先聊的那批,但
 * 「选中了最弱第二维」与「选了一个根本不弱的维度」在沟通上完全不同 ——
 * 前者方向基本对、只是排序错;后者是在往收益最小的那一环使劲。
 * 名单页把这两类分开显示,而 `isPriorityMismatch` 的布尔判定保持与报告一致。
 */
export type PriorityAlignment = 'aligned' | 'second_weakest' | 'mismatched';

export function priorityAlignment(
  priority: unknown,
  weakest: readonly string[] | null | undefined,
): PriorityAlignment | null {
  if (typeof priority !== 'string' || priority.length === 0) return null;
  if (!weakest || weakest.length === 0) return null;
  if (priority === weakest[0]) return 'aligned';
  if (weakest.includes(priority)) return 'second_weakest';
  return 'mismatched';
}
