import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };
import { HIGH_INTENT_VALUES } from './surveySignals.ts';
import {
  _fillTemplate,
  deriveTags,
  PRIORITY_HIGH_MAX_TOTAL,
  PRIORITY_HIGH_MIN_BUDGET,
  TAG_NAMESPACE,
  tagUniverse,
  type TagInput,
} from './ghlTags.ts';

/** 一个「答完了、各项都正常」的人:semi_auto 档、最弱是接客户、想尽快聊 */
function input(over: Partial<TagInput> = {}): TagInput {
  return {
    tier: 'semi_auto',
    weakestPrimary: 'capture',
    total: 3.2,
    responses: {
      consult_interest: 'asap',
      priority_dimension: 'capture',
      monthly_marketing_budget: 700,
    },
    ...over,
  };
}
const withResp = (over: Record<string, unknown>, rest: Partial<TagInput> = {}): TagInput =>
  input({ ...rest, responses: { ...input().responses, ...over } });

const S2_VALUE_MAP = (config.survey_questions.find((q) => q.field === 'monthly_marketing_budget') as
  | { value_map?: number[] }
  | undefined)?.value_map ?? [];

Deno.test('无条件那三个都按 config 的模板产出', () => {
  const { tags, problems } = deriveTags(input());
  assertEquals(problems, []);
  for (const t of ['assessment_completed', 'assessment_tier_semi_auto', 'assessment_weak_capture']) {
    assertEquals(tags.includes(t), true, `缺 ${t}`);
  }
});

Deno.test('config 里每个 tags_conditional 都必须有对应的判定', () => {
  /**
   * 这条是这个模块最重要的一条。以后有人只在 config 里加一条条件标签、忘了写判定,
   * **没有任何东西会报错** —— 那个标签只是永远不打,而运营会以为它在打
   * (判断标准 18 那个形状)。所以让这件事变成一条会红的断言。
   *
   * 判据是 `deriveTags` 会把「没有判定」记成 problem,所以用一个
   * **所有条件都不成立**的输入去跑:problems 必须是空的 —— 空 = 每个都有判定。
   */
  const noneMatch = withResp(
    { consult_interest: 'no', priority_dimension: 'capture', monthly_marketing_budget: 0 },
    { total: 4.9 },
  );
  const { problems } = deriveTags(noneMatch);
  assertEquals(problems, [], `有条件标签没有判定:\n${problems.join('\n')}`);
});

Deno.test('hot_lead 复用 isHighIntent —— 与问卷洞察的高意向名单同一个定义', () => {
  for (const v of HIGH_INTENT_VALUES) {
    assertEquals(deriveTags(withResp({ consult_interest: v })).tags.includes('assessment_hot_lead'), true, v);
  }
  for (const v of ['self', 'no', '', 'ASAP']) {
    assertEquals(deriveTags(withResp({ consult_interest: v })).tags.includes('assessment_hot_lead'), false, v);
  }
});

Deno.test('priority_high 的两个阈值与 config 的 when 逐字对上', () => {
  /**
   * `when` 是给人看的字符串,判定是代码 —— 两者必须说同一件事。
   * 【这条断言存在的理由】我在代码注释里写了「有一条用例把两者对上」,
   * 而一句没有断言支撑的注释就是这个项目反复栽过的那种声明。所以这里真的对一遍:
   * 从 `when` 里抠出两个数字,和导出的两个常量比。
   */
  const entry = config.ghl_writeback.tags_conditional.find((c) => c.tag === 'assessment_priority_high');
  assertEquals(typeof entry?.when, 'string');
  const numbers = (entry!.when.match(/[\d.]+/g) ?? []).map(Number);
  assertEquals(numbers.includes(PRIORITY_HIGH_MAX_TOTAL), true, `when 里没有 ${PRIORITY_HIGH_MAX_TOTAL}: ${entry!.when}`);
  assertEquals(numbers.includes(PRIORITY_HIGH_MIN_BUDGET), true, `when 里没有 ${PRIORITY_HIGH_MIN_BUDGET}: ${entry!.when}`);
});

Deno.test('priority_high 的边界:两个条件都要成立', () => {
  const on = (total: number, budget: number) =>
    deriveTags(withResp({ monthly_marketing_budget: budget }, { total })).tags.includes(
      'assessment_priority_high',
    );
  assertEquals(on(2.89, PRIORITY_HIGH_MIN_BUDGET), true); // 刚好够
  assertEquals(on(PRIORITY_HIGH_MAX_TOTAL, PRIORITY_HIGH_MIN_BUDGET), false); // total 是严格小于
  assertEquals(on(2.0, PRIORITY_HIGH_MIN_BUDGET - 1), false); // 预算差一点
  assertEquals(on(4.5, 15000), false); // 有钱但没痛点
});

Deno.test('预算档位用 config 的 value_map 真实取值,不用我编的数', () => {
  /**
   * 「≥ 2000」落在哪几档是**产品要在 GHL 里配 workflow 时依赖的事实**,
   * 所以用 config 里那五个真实档位去跑,而不是随手写 1000 / 3000。
   * value_map 一改,这条会红 —— 那正是该红的时候。
   */
  assertEquals(S2_VALUE_MAP.length > 0, true, '没找到 S2 的 value_map');
  const hits = S2_VALUE_MAP.filter((budget) =>
    deriveTags(withResp({ monthly_marketing_budget: budget }, { total: 2.0 })).tags.includes(
      'assessment_priority_high',
    ),
  );
  assertEquals(hits, S2_VALUE_MAP.filter((b) => b >= PRIORITY_HIGH_MIN_BUDGET));
});

Deno.test('mismatch 复用 isPriorityMismatch —— 报告页 / 问卷洞察 / 标签同一个定义', () => {
  const has = (i: TagInput) => deriveTags(i).tags.includes('assessment_mismatch');
  // 想修的正是该修的 → 不打
  assertEquals(has(withResp({ priority_dimension: 'capture' }, { weakestPrimary: 'capture' })), false);
  // 想修的不是该修的 → 打
  assertEquals(has(withResp({ priority_dimension: 'convert' }, { weakestPrimary: 'capture' })), true);
  // 【没选方向的人不算不一致】—— 他没选方向,不该进这批名单,也不该被打标签
  assertEquals(has(withResp({ priority_dimension: undefined }, { weakestPrimary: 'capture' })), false);
  assertEquals(has(withResp({ priority_dimension: 'convert' }, { weakestPrimary: null })), false);
});

Deno.test('脏 tier 不产出标签,而是报 problem —— 绝不在 GHL 里建垃圾全局标签', () => {
  /**
   * 这是这个模块的安全边界:GHL 的标签是**全局的**,拼错一次就在客户的标签选择器里
   * 多一个永久项,而那比字段写错难清理得多。
   */
  const { tags, problems } = deriveTags(input({ tier: 'Semi_Auto' })); // 大小写不对
  assertEquals(tags.some((t) => t.startsWith('assessment_tier_')), false);
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], '不在取值域');
  // 别的标签照常产出 —— 一个脏值不该让整批标签消失
  assertEquals(tags.includes('assessment_completed'), true);
});

Deno.test('weakest 缺失时同样不产出,而不是拼出 assessment_weak_undefined', () => {
  const { tags, problems } = deriveTags(input({ weakestPrimary: null }));
  assertEquals(tags.some((t) => t.startsWith('assessment_weak_')), false);
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], 'weakest_1');
});

Deno.test('未登记的占位符:不产出,不把字面量打出去', () => {
  /**
   * 今天的 config 产不出这条分支(两个占位符都登记了),所以直接喂
   * `_fillTemplate` 一个 `{weakest_2}` 模板 —— 否则这条分支上没有任何断言
   * (判断标准 1 推论三:无事可做的绿与真的守住了,在报告里长得一样)。
   */
  const problems: string[] = [];
  const out = _fillTemplate('assessment_weak_{weakest_2}', input(), problems);
  assertEquals(out, null);
  assertEquals(problems.length, 1);
  assertStringIncludes(problems[0], '{weakest_2}');
  assertStringIncludes(problems[0], '没有登记');
});

Deno.test('tagUniverse:数量与内容都由 config 推导,不手写', () => {
  /**
   * PROGRESS 里那份手写清单已经漂了(写着「assessment_weak_* 六个,共 15 个」,
   * 而维度只有 5 个)。这条钉的是「清单等于 config 推出来的东西」。
   */
  const universe = tagUniverse();
  const tierTags = config.tiers.map((t) => `assessment_tier_${t.key}`);
  const weakTags = config.dimensions.map((d) => `assessment_weak_${d.key}`);
  const fixed = ['assessment_completed', ...config.ghl_writeback.tags_conditional.map((c) => c.tag)];
  assertEquals(universe, [...tierTags, ...weakTags, ...fixed].sort());
  assertEquals(universe.length, config.tiers.length + config.dimensions.length + fixed.length);
});

Deno.test('每个可能产出的标签都在命名空间内、且形状合法', () => {
  // 命名空间是「移除旧标签只碰自己的」那条规则的前提,所以它必须对整个取值域成立
  for (const tag of tagUniverse()) {
    assertEquals(tag.startsWith(TAG_NAMESPACE), true, tag);
    assertEquals(/^[a-z0-9_]+$/.test(tag), true, tag);
  }
});

Deno.test('deriveTags 产出的东西一定是 tagUniverse 的子集', () => {
  /**
   * 反向锁:任何一条派生规则跑出取值域之外,这条就红 ——
   * 而「跑出取值域」在 GHL 上的后果是一个永久的全局标签。
   */
  const universe = new Set(tagUniverse());
  const cases: TagInput[] = [
    input(),
    withResp({ consult_interest: 'later', priority_dimension: 'goal' }, { total: 1.1, tier: 'manual' }),
    withResp({ monthly_marketing_budget: 15000 }, { total: 2.0, tier: 'flywheel', weakestPrimary: 'value' }),
    withResp({ consult_interest: 'no', priority_dimension: undefined }, { total: 5, tier: 'systemic' }),
  ];
  for (const c of cases) {
    for (const tag of deriveTags(c).tags) {
      assertEquals(universe.has(tag), true, `${tag} 不在 tagUniverse 里`);
    }
  }
});

Deno.test('tagUniverse 遇到不支持的模板会抛,而不是悄悄少列几个', () => {
  /**
   * 少列几个标签的后果是 GHL 里少建几个,而对应的 workflow 永远不触发 ——
   * 那是个安静的失败,所以宁可抛。
   *
   * 【为什么给 tagUniverse 加了可注入参数】第一版我在测试里**重写了一遍那个判断**
   * (自己拼 names、自己 throw),那是同义反复:它验的是我在测试里写的代码,
   * 与 tagUniverse 是否真的会抛毫无关系(判断标准 8)。改成把模板喂进去。
   */
  assertThrows(
    () => tagUniverse(['assessment_x_{tier_key}_{weakest_1}']),
    Error,
    '有多个占位符',
  );
  assertThrows(() => tagUniverse(['assessment_y_{unknown_slot}']), Error, '没有登记取值域');
  // 反向锁:正常模板不抛
  tagUniverse(['assessment_tier_{tier_key}']);
});
