/**
 * 从结果 + 问卷派生 GHL 标签 —— **纯函数,没有 IO**。外发在别处。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【格式串只在 config 里有一份】`tags_always` 写着
 * `assessment_tier_{tier_key}` / `assessment_weak_{weakest_1}`,
 * 这里**读那些模板并填占位符**,不在代码里再写一遍前缀。
 * 再写一遍的后果不是不一致而已 —— GHL 的标签是**全局的**,
 * 代码里拼出一个 config 里没有的前缀,就在客户的标签选择器里多一个永久的垃圾项。
 *
 * 【`when` 那些表达式**不求值**】config 里的 `when` 是给人看的
 * (`"total < 2.9 and monthly_marketing_budget >= 2000"`)。
 * 写一个表达式求值器等于在项目里引入一门小语言,而它与那句话的语义会**悄悄分叉**。
 * 这里改成:每个条件标签对应一个**具名判定**,并且有一条用例断言
 * 「config 里每个 `tags_conditional` 都有对应的判定」——
 * 于是以后有人只在 config 里加一条标签、忘了写代码,**测试会红**,
 * 而不是那个标签静默地永远不打(判断标准 18 那个形状)。
 *
 * 【取值必须落在 config 自己的取值域里】`{tier_key}` 只能是 `tiers[].key`,
 * `{weakest_1}` 只能是 `dimensions[].key`。脏值不是「拼出一个奇怪的字符串」,
 * 是**在 GHL 里创建一个永久的全局标签**,而那比字段写错难清理得多。
 * 所以派生失败一律**不产出那个标签**,并把原因带回去(调用方按 CONFIG 类处理)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import config from '../../../src/config/assessment-config.json' with { type: 'json' };
import { isHighIntent, isPriorityMismatch } from './surveySignals.ts';

const TIER_KEYS: readonly string[] = config.tiers.map((t) => t.key);
const DIMENSION_KEYS: readonly string[] = config.dimensions.map((d) => d.key);
const ALWAYS_TEMPLATES: readonly string[] = config.ghl_writeback.tags_always;
const CONDITIONAL: readonly { tag: string; when: string; note?: string }[] =
  config.ghl_writeback.tags_conditional;

/**
 * 我们自己的命名空间。**移除旧标签时只允许碰这个前缀开头的**——
 * 客户在 GHL 里有大量与本系统无关的标签,误删一个是不可逆的。
 */
export const TAG_NAMESPACE = 'assessment_';

/** GHL 标签统一小写下划线。派生出来的每个标签都要过这一关 */
const TAG_SHAPE = /^[a-z0-9_]+$/;

export interface TagInput {
  tier: string;
  /** `weakest[0]`,即「该先修的那一环」 */
  weakestPrimary: string | null | undefined;
  total: number | null | undefined;
  /** `assessment_survey.responses` —— 存的已经是语义值(见 optionMap) */
  responses: Record<string, unknown>;
}

export interface DerivedTags {
  /** 要打上去的标签,已去重、已按字典序排好(顺序固定便于比对与断言) */
  tags: string[];
  /**
   * 派生过程中被跳过的东西 —— **非空就说明 config 与代码不一致**。
   * 调用方要把它记成 CONFIG 类错误:重试同样的输入不会变好。
   */
  problems: string[];
}

/**
 * 占位符 → 取值 + 它的合法取值域。
 * 【新增占位符必须在这里登记】未登记的占位符会让那个标签**不产出**并报 problem ——
 * 而不是把 `assessment_weak_{weakest_2}` 这种字面量打到 GHL 上去。
 */
function placeholders(input: TagInput): Record<string, { value: unknown; domain: readonly string[] }> {
  return {
    tier_key: { value: input.tier, domain: TIER_KEYS },
    weakest_1: { value: input.weakestPrimary, domain: DIMENSION_KEYS },
  };
}

/**
 * 条件标签的具名判定。**键必须与 config 的 `tag` 字段逐字对应** ——
 * 有一条用例钉这件事。
 */
const PREDICATES: Record<string, (input: TagInput) => boolean> = {
  /** S7 前两项。判定复用 surveySignals,与问卷洞察的高意向名单同一个定义 */
  assessment_hot_lead: (i) => isHighIntent(i.responses.consult_interest),

  /**
   * 痛点大且有预算。阈值来自 config 的 `when`,而**这里是那句话的唯一实现** ——
   * 改阈值要同时改 config 的 `when`(给人看)和这里(执行);
   * 有一条用例把两者对上,所以只改一处会红。
   */
  assessment_priority_high: (i) => {
    const budget = i.responses.monthly_marketing_budget;
    if (typeof i.total !== 'number' || typeof budget !== 'number') return false;
    return i.total < PRIORITY_HIGH_MAX_TOTAL && budget >= PRIORITY_HIGH_MIN_BUDGET;
  },

  /**
   * 「想修的 ≠ 该修的」。**必须复用 `isPriorityMismatch`** ——
   * 报告页第 7 板块、问卷洞察名单、这个标签是同一个定义。
   * 各写一份的后果:同一个人在报告里没被高亮、却被打上了 mismatch 标签,
   * 于是销售拿着一份和学员看到的不一样的判断去沟通,而没有任何东西会报错。
   */
  assessment_mismatch: (i) =>
    isPriorityMismatch(i.responses.priority_dimension, i.weakestPrimary ? [i.weakestPrimary] : null),
};

/** 与 config 里 `assessment_priority_high` 的 `when` 一一对应的两个阈值 */
export const PRIORITY_HIGH_MAX_TOTAL = 2.9;
export const PRIORITY_HIGH_MIN_BUDGET = 2000;

/**
 * 把模板里的 `{x}` 填上;任何一处填不了就返回 null 并说明原因。
 *
 * 【为什么导出成 `_fillTemplate`】「未登记的占位符」这条分支,
 * 今天的 config **产不出来**(两个占位符都登记了)—— 而一条产不出输入的分支
 * 等于没有断言在守它(判断标准 1 推论三:无事可做的绿)。
 * 导出给测试直接喂一个 `{weakest_2}` 模板,那条分支才真的被走过。
 * 下划线前缀 = 只给测试用,与 `_resetFieldMapCache` 同一个约定。
 */
export function _fillTemplate(
  template: string,
  input: TagInput,
  problems: string[],
): string | null {
  const table = placeholders(input);
  let out = template;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    const name = m[1];
    const slot = table[name];
    if (!slot) {
      problems.push(`tags_always 模板 "${template}" 里的占位符 {${name}} 没有登记 —— 代码没跟上 config`);
      return null;
    }
    const value = slot.value;
    if (typeof value !== 'string' || !slot.domain.includes(value)) {
      problems.push(
        `模板 "${template}" 的 {${name}} 取到 ${JSON.stringify(value)},不在取值域 ` +
          `[${slot.domain.join(', ')}] 内 —— 不产出这个标签(否则会在 GHL 里建一个全局垃圾标签)`,
      );
      return null;
    }
    out = out.replace(`{${name}}`, value);
  }
  return out;
}

export function deriveTags(input: TagInput): DerivedTags {
  const problems: string[] = [];
  const tags = new Set<string>();

  for (const template of ALWAYS_TEMPLATES) {
    const tag = _fillTemplate(template, input, problems);
    if (tag) tags.add(tag);
  }

  for (const entry of CONDITIONAL) {
    const predicate = PREDICATES[entry.tag];
    if (!predicate) {
      // config 里加了标签而代码没跟上。**不猜条件**,报出来
      problems.push(`条件标签 "${entry.tag}"(when: ${entry.when})没有对应的判定 —— 代码没跟上 config`);
      continue;
    }
    if (predicate(input)) tags.add(entry.tag);
  }

  // 形状与命名空间兜底:走到这里都该是干净的,不干净就说明上面漏了一种情况
  const clean: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(TAG_NAMESPACE) || !TAG_SHAPE.test(tag)) {
      problems.push(`标签 "${tag}" 不符合命名空间或字符集(${TAG_NAMESPACE}* + [a-z0-9_])—— 不外发`);
      continue;
    }
    clean.push(tag);
  }

  return { tags: clean.sort(), problems };
}

/**
 * 这套规则**可能产出的全部标签**。
 *
 * 【为什么要有这个函数】要在 GHL 后台先把标签建出来(或者至少知道会自动创建哪些),
 * 而那份清单原本是手写在 PROGRESS 里的 —— 已经漂了:
 * 文档写着「`assessment_weak_*` 六个,共 15 个」,而维度只有 5 个,实际是 14 个。
 * 手写的清单会漂,而漂的方向没人盯着(判断标准 12)。所以让它可推导。
 */
export function tagUniverse(
  /** 只为可测:默认就是 config 里那份。多占位符那条分支今天的 config 产不出来 */
  templates: readonly string[] = ALWAYS_TEMPLATES,
): string[] {
  const out = new Set<string>();
  for (const template of templates) {
    const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (names.length === 0) {
      out.add(template);
      continue;
    }
    // 目前每个模板最多一个占位符;多于一个就要笛卡尔积,那时再说 —— 但要说出来
    if (names.length > 1) throw new Error(`模板 "${template}" 有多个占位符,tagUniverse 还没支持`);
    const domain = names[0] === 'tier_key' ? TIER_KEYS : names[0] === 'weakest_1' ? DIMENSION_KEYS : null;
    if (!domain) throw new Error(`模板 "${template}" 的占位符 {${names[0]}} 没有登记取值域`);
    for (const v of domain) out.add(template.replace(`{${names[0]}}`, v));
  }
  for (const entry of CONDITIONAL) out.add(entry.tag);
  return [...out].sort();
}
