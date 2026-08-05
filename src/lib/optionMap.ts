/**
 * 选项下标 → 语义值 的统一映射。
 *
 * 【为什么合成一个】这个形状在 config 里出现了四次，长得不一样但语义相同：
 *   questions          option_index → 归一化分(v3 在 scoring.perQuestionScore,不走这里)
 *   survey S1          option_index → option_to_dimension[i]     (维度 key)
 *   survey S7          option_index → option_to_value[i]         (asap/later/self/no)
 *   profile P2 / P3    option_index → value_map[i]               (数值:询盘量 / 客单价)
 *   survey S2          option_index → value_map[i]               (数值:预算)
 *
 * 写成四套的话，越界检查、非整数检查、「缺映射表」的处理都要各写一遍，
 * 而其中任何一处漏掉都会让一个脏下标静默变成 undefined ——
 * 那个 undefined 会一路流进算分、流进成本估算、流进 GHL 写回。
 *
 * 【越界返回 null 而不是抛】越界只可能来自客户端传来的脏数据，那是 400 不是 500。
 * 让调用方决定怎么回。
 */

/**
 * 按下标从映射表取值。
 *
 * @param optionIndex 客户端传来的选项下标，未经信任
 * @param table       config 里的映射数组
 */
export function mapOption<T>(optionIndex: number, table: readonly T[]): T | null {
  if (!Number.isInteger(optionIndex)) return null;
  if (optionIndex < 0 || optionIndex >= table.length) return null;
  return table[optionIndex];
}

/**
 * 多选题的下标数组 → 值数组。
 *
 * 【任一下标越界就整体判失败，不是跳过坏的那个】跳过会让客户勾了 5 项、存进去 4 项，
 * 而客户不会知道。S4「你现在在用哪些工具」如果静默少存一项，
 * 后面按工具分流的销售判断就基于一份不完整的事实。
 *
 * 【去重】同一个下标传两次只算一次 —— 前端理论上不会，但这是外部输入。
 */
export function mapOptions<T>(optionIndexes: readonly number[], table: readonly T[]): T[] | null {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const i of optionIndexes) {
    const v = mapOption(i, table);
    if (v === null) return null;
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(v);
  }
  return out;
}
