import { assertEquals } from '@std/assert';
import {
  aggregateCohort,
  type AggregateAnswerRow,
  type AggregateResultRow,
} from './cohortAggregate.ts';

const DIMS = ['goal', 'traffic', 'capture', 'convert', 'value'];
const TIERS = ['manual', 'spot', 'semi_auto', 'systemic', 'flywheel'];
const QUESTIONS = [
  { id: 'G1', option_count: 3 },
  { id: 'T1', option_count: 4 },
  { id: 'C1', option_count: 3 },
];

function result(
  total: number,
  tier: string,
  weakest: string[],
  dims: Partial<Record<string, number>> = {},
): AggregateResultRow {
  return {
    total,
    tier,
    weakest,
    dim_scores: { goal: 0, traffic: 0, capture: 0, convert: 0, value: 0, ...dims },
  };
}

const ans = (question_id: string, option_index: number): AggregateAnswerRow => ({
  question_id,
  option_index,
});

Deno.test('n=0:平均总分是 null,不是 0 ——「没有人」与「平均分 0」是两件事', () => {
  const a = aggregateCohort([], [], DIMS, TIERS, QUESTIONS, 10);
  assertEquals(a.n, 0);
  assertEquals(a.averageTotal, null);
});

Deno.test('档位分布含 0 —— 分布图要看得出哪一档是空的', () => {
  const a = aggregateCohort([result(4.2, 'systemic', ['traffic'])], [], DIMS, TIERS, QUESTIONS, 10);
  assertEquals(a.tierCounts, {
    manual: 0,
    spot: 0,
    semi_auto: 0,
    systemic: 1,
    flywheel: 0,
  });
  // 键必须齐全:少一个键的话前端那一档会整根柱子消失,而不是显示为 0
  assertEquals(Object.keys(a.tierCounts).sort(), [...TIERS].sort());
});

Deno.test('最弱维度按人次累加 —— 每人两维,总数是 2n', () => {
  const a = aggregateCohort(
    [
      result(2, 'spot', ['traffic', 'convert']),
      result(2, 'spot', ['traffic', 'value']),
    ],
    [],
    DIMS,
    TIERS,
    QUESTIONS,
    10,
  );
  assertEquals(a.weakestCounts.traffic, 2);
  assertEquals(a.weakestCounts.convert, 1);
  assertEquals(a.weakestCounts.value, 1);
  assertEquals(a.weakestCounts.goal, 0);
  const total = Object.values(a.weakestCounts).reduce((x, y) => x + y, 0);
  assertEquals(total, 4);
});

Deno.test('维度平均键齐全,雷达图才画得出五个顶点', () => {
  const a = aggregateCohort(
    [result(3, 'semi_auto', [], { goal: 5, traffic: 0 })],
    [],
    DIMS,
    TIERS,
    QUESTIONS,
    10,
  );
  assertEquals(Object.keys(a.dimensionMeans).sort(), [...DIMS].sort());
  assertEquals(a.dimensionMeans.goal, 5);
  assertEquals(a.dimensionMeans.traffic, 0);
});

Deno.test('样本不足时【比例字段是 null】—— 前端渲不出百分比', () => {
  /**
   * 这是这个模块最重要的一条。平均值永远是事实;比例是关于总体的断言。
   * n=2 时「100% 都选了第一个」是误导,而「2 人选了第一个」是事实。
   * 所以阈值不下在显示与否上,下在说法的性质上 —— 而且不够时那个数字
   * **根本不在响应里**,前端不需要「记得别渲」。
   */
  const a = aggregateCohort(
    [result(2, 'spot', ['traffic']), result(3, 'spot', ['traffic'])],
    [ans('G1', 0), ans('G1', 0)],
    DIMS,
    TIERS,
    QUESTIONS,
    10,
  );
  assertEquals(a.enoughForShares, false);
  assertEquals(a.questions.find((q) => q.id === 'G1')!.topShare, null);
  // 但计数照给 —— 它是事实
  assertEquals(a.questions.find((q) => q.id === 'G1')!.counts, [2, 0, 0]);
});

Deno.test('样本够了才给比例', () => {
  const results = Array.from({ length: 10 }, () => result(2, 'spot', ['traffic']));
  const answers = Array.from({ length: 10 }, () => ans('G1', 0));
  const a = aggregateCohort(results, answers, DIMS, TIERS, QUESTIONS, 10);
  assertEquals(a.enoughForShares, true);
  assertEquals(a.questions.find((q) => q.id === 'G1')!.topShare, 1);
});

Deno.test('阈值是「大于等于」,不是「大于」', () => {
  // 边界一律显式钉住 —— 差一个人的判断没人会去核对
  const mk = (k: number) => Array.from({ length: k }, () => result(2, 'spot', ['traffic']));
  assertEquals(aggregateCohort(mk(9), [], DIMS, TIERS, QUESTIONS, 10).enoughForShares, false);
  assertEquals(aggregateCohort(mk(10), [], DIMS, TIERS, QUESTIONS, 10).enoughForShares, true);
});

Deno.test('题目按集中度降序 —— 最一边倒的排最前(那才是上课素材)', () => {
  /**
   * 用途决定排序:一道全场都选同一个选项的题是当天最直接的开场素材,
   * 而「某一维平均 2.8」讲不出东西。
   */
  const answers = [
    // G1:3 人全选 0 → 集中度 1.0
    ans('G1', 0), ans('G1', 0), ans('G1', 0),
    // T1:1/1/1 分散 → 集中度 1/3
    ans('T1', 0), ans('T1', 1), ans('T1', 2),
    // C1:2 比 1 → 集中度 2/3
    ans('C1', 0), ans('C1', 0), ans('C1', 1),
  ];
  const a = aggregateCohort(mkN(3), answers, DIMS, TIERS, QUESTIONS, 10);
  assertEquals(a.questions.map((q) => q.id), ['G1', 'C1', 'T1']);
});

Deno.test('集中度相同时按题号排,保证同一批数据两次请求顺序一致', () => {
  // 不定序的输出会让「看板变了」与「数据变了」分不清
  const answers = [ans('G1', 0), ans('T1', 0), ans('C1', 0)];
  const a = aggregateCohort(mkN(1), answers, DIMS, TIERS, QUESTIONS, 10);
  assertEquals(a.questions.map((q) => q.id), ['C1', 'G1', 'T1']);
});

Deno.test('topIndex 总是给 —— 它是事实,不是比例', () => {
  const a = aggregateCohort(
    mkN(2),
    [ans('T1', 2), ans('T1', 2), ans('T1', 0)],
    DIMS,
    TIERS,
    QUESTIONS,
    10,
  );
  const t1 = a.questions.find((q) => q.id === 'T1')!;
  assertEquals(t1.topIndex, 2);
  assertEquals(t1.topShare, null); // 比例不给
  assertEquals(t1.counts, [1, 0, 2, 0]);
});

Deno.test('counts 的长度等于 option_count —— 混合题型不能共用一个长度', () => {
  const a = aggregateCohort(mkN(1), [], DIMS, TIERS, QUESTIONS, 10);
  assertEquals(a.questions.find((q) => q.id === 'G1')!.counts.length, 3);
  assertEquals(a.questions.find((q) => q.id === 'T1')!.counts.length, 4);
});

Deno.test('越界下标与未知题号一律跳过,不污染分布', () => {
  /**
   * config 改版之后库里会留着旧题的作答、以及超出新 option_count 的下标。
   * 那些不是这一批的事实,静默计入会让分布图凭空多出一根柱子。
   */
  const a = aggregateCohort(
    mkN(1),
    [ans('G1', 9), ans('NOPE', 0), ans('G1', -1), ans('G1', 1)],
    DIMS,
    TIERS,
    QUESTIONS,
    10,
  );
  assertEquals(a.questions.find((q) => q.id === 'G1')!.counts, [0, 1, 0]);
  assertEquals(a.questions.find((q) => q.id === 'G1')!.answered, 1);
});

Deno.test('answered 与 n 可以不等 —— 有人没答完', () => {
  // 拿 n 当分母算比例会低估集中度,所以分母必须是这一题的实际作答数
  const a = aggregateCohort(mkN(10), [ans('G1', 0), ans('G1', 0)], DIMS, TIERS, QUESTIONS, 10);
  const g1 = a.questions.find((q) => q.id === 'G1')!;
  assertEquals(a.n, 10);
  assertEquals(g1.answered, 2);
  assertEquals(g1.topShare, 1); // 2/2,不是 2/10
});

Deno.test('域外的 tier 不静默计入', () => {
  const a = aggregateCohort(
    [result(3, 'bogus_tier', [])],
    [],
    DIMS,
    TIERS,
    QUESTIONS,
    10,
  );
  assertEquals(Object.values(a.tierCounts).reduce((x, y) => x + y, 0), 0);
});

Deno.test('minN 原样回报 —— 前端不另写一份阈值', () => {
  assertEquals(aggregateCohort([], [], DIMS, TIERS, QUESTIONS, 7).minN, 7);
});

function mkN(k: number): AggregateResultRow[] {
  return Array.from({ length: k }, () => result(2, 'spot', ['traffic']));
}
