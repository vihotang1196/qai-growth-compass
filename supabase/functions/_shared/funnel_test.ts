import { assertEquals } from '@std/assert';
import { buildFunnel, FUNNEL_STAGES, type FunnelRowInput } from './funnel.ts';

/** 默认是一个「刚付款、什么都还没做」的人 */
function row(over: Partial<FunnelRowInput> = {}): FunnelRowInput {
  return {
    linkSentAt: null,
    firstLoginAt: null,
    sessionStatus: null,
    profileFilled: false,
    hasAnswer: false,
    ...over,
  };
}

const AT = '2026-08-01T10:00:00Z';
const reachedOf = (f: ReturnType<typeof buildFunnel>) =>
  Object.fromEntries(f.stages.map((s) => [s.key, s.reached]));

Deno.test('已付款是基数,不是分段 —— 分段列表里没有它', () => {
  /**
   * 「已付款」≡ 行存在,所以画成一段永远 100%。一个永远满格的分段
   * 不携带任何信息,只占掉一格注意力。
   */
  const f = buildFunnel([row(), row()]);
  assertEquals(f.base, 2);
  assertEquals(f.stages.length, 5);
  assertEquals(
    f.stages.map((s) => s.key),
    ['link_sent', 'logged_in', 'started_answering', 'survey', 'completed'],
  );
});

Deno.test('一个 pending 的人在第一段之后就掉出去 —— 这是本模块最该验的一条', () => {
  /**
   * 真实库里那 2 条:1 条 completed、1 条 pending 没答完。
   * 那条 pending 必须在第一段之后掉出去。**它没掉出去就说明取数起点错了** ——
   * 从 assessment_results 起查会只看到已完成的人,于是每一段都是 100%。
   */
  const f = buildFunnel([
    row({ linkSentAt: AT, firstLoginAt: AT, sessionStatus: 'completed', profileFilled: true, hasAnswer: true }),
    row(), // 只付了款,链接都还没发
  ]);
  assertEquals(f.base, 2);
  assertEquals(reachedOf(f), {
    link_sent: 1,
    logged_in: 1,
    started_answering: 1,
    survey: 1,
    completed: 1,
  });
  assertEquals(f.stages[0].droppedFromPrev, 1); // 2 → 1,掉在「已发链接」这一段
});

Deno.test('「已登录但一题没答」必须与「已开始答题」分开 —— status 上分不开', () => {
  /**
   * assessment-auth 同时盖 first_login_at 与 status='started',
   * 所以 entitlement.status 看不出这个区别。判据换成 profile / answers。
   */
  const f = buildFunnel([row({ linkSentAt: AT, firstLoginAt: AT, sessionStatus: 'in_progress' })]);
  assertEquals(reachedOf(f).logged_in, 1);
  assertEquals(reachedOf(f).started_answering, 0);
});

Deno.test('只答了背景题就走的人算「已开始答题」', () => {
  // profile 是答题流程的第一步,比计分题更早 —— 只看 answers 会把这个人误判成没开始
  const f = buildFunnel([
    row({ linkSentAt: AT, firstLoginAt: AT, sessionStatus: 'in_progress', profileFilled: true }),
  ]);
  assertEquals(reachedOf(f).started_answering, 1);
});

Deno.test('「已进问卷」是一段独立的流失点', () => {
  /**
   * 答满 15 题却没交问卷 —— finalize 要求 survey 行存在,所以这是真实流失,
   * 而在只有四态的 entitlement.status 上它完全看不见。
   */
  const f = buildFunnel([
    row({ linkSentAt: AT, firstLoginAt: AT, sessionStatus: 'survey', profileFilled: true, hasAnswer: true }),
  ]);
  assertEquals(reachedOf(f).survey, 1);
  assertEquals(reachedOf(f).completed, 0);
  assertEquals(f.stages[4].droppedFromPrev, 1); // 卡在最后 7 题
});

Deno.test('漏斗永不上升 —— 任何输入下都单调不增', () => {
  /**
   * 后一段比前一段大看起来像代码 bug,而且会让人怀疑整块数据。
   * 这条用一批刻意矛盾的行来试。
   */
  const f = buildFunnel([
    // completed 却没有 link_sent_at / first_login_at:级联应当把前面几段补上
    row({ sessionStatus: 'completed' }),
    row({ linkSentAt: AT }),
    row(),
    row({ sessionStatus: 'survey', hasAnswer: true }),
  ]);
  const counts = f.stages.map((s) => s.reached);
  for (let i = 1; i < counts.length; i++) {
    assertEquals(counts[i] <= counts[i - 1], true, `${counts[i - 1]} → ${counts[i]} 上升了`);
  }
  assertEquals(counts[0] <= f.base, true);
});

Deno.test('级联会把矛盾抹平,但 inconsistent 必须把它报出来', () => {
  /**
   * 抹平等于隐藏。inconsistent 不为 0 说明**别处**有 bug
   * (比如链接不是经 sendMagicLink 发出去的),而不是这块统计有 bug。
   */
  const f = buildFunnel([
    row({ sessionStatus: 'completed' }), // 完成了却没有 link_sent_at / first_login_at
  ]);
  assertEquals(reachedOf(f).link_sent, 1); // 被级联补上
  assertEquals(f.inconsistent, 1); // 但报出来了
});

Deno.test('数据一致时 inconsistent 是 0 —— 反向锁', () => {
  // 没有这条,「inconsistent 恒为行数」也能让上面那条绿
  const f = buildFunnel([
    row({ linkSentAt: AT, firstLoginAt: AT, sessionStatus: 'completed', profileFilled: true, hasAnswer: true }),
    row({ linkSentAt: AT }),
    row(),
  ]);
  assertEquals(f.inconsistent, 0);
});

Deno.test('空输入:基数 0,五段全 0,不抛', () => {
  const f = buildFunnel([]);
  assertEquals(f.base, 0);
  assertEquals(f.stages.every((s) => s.reached === 0 && s.droppedFromPrev === 0), true);
  assertEquals(f.inconsistent, 0);
});

Deno.test('第一段的 droppedFromPrev 是相对基数算的', () => {
  // 不然「付了款但链接都没发出去」这批人会不出现在任何一段的流失里
  const f = buildFunnel([row(), row(), row({ linkSentAt: AT })]);
  assertEquals(f.base, 3);
  assertEquals(f.stages[0].reached, 1);
  assertEquals(f.stages[0].droppedFromPrev, 2);
});

Deno.test('有 session 就算登录过,即使 first_login_at 没盖上', () => {
  /**
   * session 是 auth 建的,所以它存在就意味着登录发生过。
   * auth 里那次盖时间戳是「失败只记 console.error」的,所以它可能缺 ——
   * 拿它当唯一判据会少算登录人数。
   */
  const f = buildFunnel([row({ linkSentAt: AT, sessionStatus: 'in_progress' })]);
  assertEquals(reachedOf(f).logged_in, 1);
});

Deno.test('分段顺序由 FUNNEL_STAGES 决定,输出与它逐字一致', () => {
  // 级联依赖这个顺序,所以顺序本身要被钉住
  assertEquals(buildFunnel([row()]).stages.map((s) => s.key), [...FUNNEL_STAGES]);
});
