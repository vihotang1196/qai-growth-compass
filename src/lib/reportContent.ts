/**
 * 报告内容的纯逻辑 —— 30 天行动清单的选取、根因分档、代价换算。
 *
 * 报告页(Stage 8)从 assessment_results(分数/档位/最弱两维)+ config + 客户填的
 * 询盘量/客单价,拼出九个板块。这里是其中「算出来才有」的三块,纯函数、单独测 ——
 * 跟计分同一个理由:报告是产品的门面,内容算错比样式丑严重得多。
 */

export interface DimensionRef {
  key: string;
  order: number;
}

export interface ActionItem {
  id: string;
  zh: string;
  en: string;
  difficulty: string;
  impact: string;
  roi_rank: number;
  applies_below: number;
}

export interface DimensionActions {
  root_cause: { low: string; mid: string; high: string };
  actions: ActionItem[];
}

export type ActionLibrary = Record<string, DimensionActions>;

/** 选出来的一条行动,带上它来自哪一维(报告里要标) */
export interface SelectedAction extends ActionItem {
  dimension: string;
}

/**
 * 按弱到强给维度排序。与 scoring.topTwo 同一个规则:分低在前,平分按 dimension.order 靠前优先。
 * 抽出来是因为行动选取的「最弱 2 维 + 从次弱维补」要用到完整排序,不只是前两名。
 */
export function rankByWeakness(
  dimScores: Record<string, number>,
  dimensions: readonly DimensionRef[],
): string[] {
  return [...dimensions]
    .sort((a, b) => {
      const sa = dimScores[a.key];
      const sb = dimScores[b.key];
      if (sa !== sb) return sa - sb;
      return a.order - b.order;
    })
    .map((d) => d.key);
}

/**
 * 根因分档:config action_library._note 定的 low(<2.0)/ mid(2.0–3.5)/ high(>3.5)。
 * 边界:2.0 与 3.5 都算 mid。
 */
export function rootCauseLevel(score: number): 'low' | 'mid' | 'high' {
  if (score < 2.0) return 'low';
  if (score > 3.5) return 'high';
  return 'mid';
}

/**
 * 30 天行动清单:从最弱 2 维各取 applies_below > 该维得分的动作,按 roi_rank 排序,取前 3。
 *
 * 【不满 3 条的补法 —— 这是一处假设】_note 说「取不满 3 条则从次弱维补」。「次弱维」有两读:
 * 一是 weakest[1](但它已在池子里,说不通),二是【继续往更弱之后的维度取】weakest[2]、
 * weakest[3]…。按后者实现(唯一说得通的读法),同样用 applies_below > 该维得分 过滤,
 * 按弱度顺序补。只在最弱两维得分都偏高、候选不足 3 条时才触发。若原意不是这样,改这一处即可。
 */
export function selectActions(
  dimScores: Record<string, number>,
  dimensions: readonly DimensionRef[],
  library: ActionLibrary,
  limit = 3,
): SelectedAction[] {
  const ranked = rankByWeakness(dimScores, dimensions);

  const qualifying = (dimKey: string): SelectedAction[] =>
    (library[dimKey]?.actions ?? [])
      .filter((a) => a.applies_below > dimScores[dimKey])
      .sort((a, b) => a.roi_rank - b.roi_rank)
      .map((a) => ({ dimension: dimKey, ...a }));

  const chosen: SelectedAction[] = [];
  const seen = new Set<string>();
  const add = (items: SelectedAction[]) => {
    for (const it of items) {
      if (chosen.length >= limit) break;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      chosen.push(it);
    }
  };

  // 最弱 2 维合并后按 roi_rank 取前 limit
  const primary = ranked.slice(0, 2).flatMap(qualifying).sort((a, b) => a.roi_rank - b.roi_rank);
  add(primary);

  // 不满 limit:从次弱之后的维度按弱度顺序补(假设,见上)
  for (const dimKey of ranked.slice(2)) {
    if (chosen.length >= limit) break;
    add(qualifying(dimKey));
  }

  return chosen;
}

export interface CostRule {
  dimension: string;
  formula: string;
  zh_label: string;
  en_label: string;
  zh_note: string;
}

export interface CostLine {
  dimension: string;
  amount: number;
  zh_label: string;
  en_label: string;
  zh_note: string;
}

/**
 * 安全求值一条代价公式。公式全是乘积(如 `L * 0.30 * baseline_close_rate * V`),
 * 所以只支持 `*` 连接的「已知变量 / 数字字面量」,不用 eval —— eval 会把 config 变成
 * 一条任意代码执行入口。遇到不认识的记号就抛(响,不静默返回 0)。
 */
export function evalCostFormula(
  formula: string,
  vars: { L: number; V: number; baseline_close_rate: number },
): number {
  let product = 1;
  for (const raw of formula.split('*')) {
    const token = raw.trim();
    if (token in vars) {
      product *= vars[token as keyof typeof vars];
    } else {
      const n = Number(token);
      if (!Number.isFinite(n)) {
        throw new Error(`unsupported token in cost formula: ${JSON.stringify(token)} (formula: ${formula})`);
      }
      product *= n;
    }
  }
  return product;
}

/**
 * 代价换算:只对「得分 < 阈值(config applies_when,默认 3.0)」的维度算,与报告只给短板换算的意图一致。
 *
 * @param leadsPerMonth L —— 由客户 P2 的 value_map 得出(调用方解析,这里只收数值)
 * @param dealValue     V —— 由客户 P3 的 value_map 得出
 * @returns 按 config.rules 的顺序,过阈值的维度各一条。金额未取整,展示层决定格式
 */
export function computeCosts(
  dimScores: Record<string, number>,
  leadsPerMonth: number,
  dealValue: number,
  costModel: { baseline_close_rate: number; rules: readonly CostRule[] },
  threshold = 3.0,
): CostLine[] {
  const vars = { L: leadsPerMonth, V: dealValue, baseline_close_rate: costModel.baseline_close_rate };
  const lines: CostLine[] = [];
  for (const rule of costModel.rules) {
    const score = dimScores[rule.dimension];
    // 分数缺失或达标的维度不出代价 —— 报告只对短板换算
    if (score === undefined || score >= threshold) continue;
    lines.push({
      dimension: rule.dimension,
      amount: evalCostFormula(rule.formula, vars),
      zh_label: rule.zh_label,
      en_label: rule.en_label,
      zh_note: rule.zh_note,
    });
  }
  return lines;
}
