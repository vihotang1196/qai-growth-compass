/**
 * 漏斗 —— **纯函数,没有 IO**。取数在 assessment-admin,这里只算分段。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【1 个基数 + 5 段,不是 6 段】
 *
 * 「已付款」≡ entitlement 这一行存在(`assessment-ghl-webhook` 是**付款** workflow
 * 的入口)。所以它是**基数**,画成一段的话那一段永远 100% ——
 * 一个永远满格的分段不携带任何信息,只会占掉一格注意力。
 *
 * 【「已登录」与「已开始答题」在 status 上分不开,要靠别的表】
 * `assessment-auth` 同时盖 `first_login_at` 与 `status='started'`,所以
 * `entitlement.status` 看不出「登录了但一题没答」。判据换成:
 *   已开始答题 = **profile 非空 或 有 ≥1 条 answer**
 * profile(3 道背景题)是答题流程的第一步,所以它比 answers 更早 ——
 * 只看 answers 会把「答了背景题就走了」的人误判成「没开始」。
 *
 * 【为什么分段是单调级联,而不是各自独立判断】
 * 漏斗的语义是「至少走到这一步」。各自独立判断的话,数据一有不一致
 * (比如 completed 却没有 link_sent_at)就会出现**后一段比前一段大** ——
 * 那看起来像代码 bug,而且会让人怀疑整块数据。
 * 所以从最后一段往前级联:走到后面就必然算走过前面。
 *
 * 【但平滑掉的不一致必须报出来】级联会把矛盾数据抹平,而抹平等于隐藏。
 * 所以另外数一个 `inconsistent`:原始判据非单调的行数。
 * 它不为 0 就说明别处有 bug(比如链接不是经 sendMagicLink 发出去的),
 * 而那正是这块数据能提供的最有价值的信号之一(判断标准 2:
 * 打印一个值但不对它做判断等于没打印 —— 这里反过来,平滑一个值却不报告它也等于说谎)。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type FunnelStageKey = 'link_sent' | 'logged_in' | 'started_answering' | 'survey' | 'completed';

/** 顺序即漏斗顺序,级联依赖它 */
export const FUNNEL_STAGES: readonly FunnelStageKey[] = [
  'link_sent',
  'logged_in',
  'started_answering',
  'survey',
  'completed',
] as const;

export interface FunnelRowInput {
  linkSentAt: string | null;
  firstLoginAt: string | null;
  /** `null` = 这个人还没有 session(没登录过) */
  sessionStatus: string | null;
  /** profile(3 道背景题)填过 */
  profileFilled: boolean;
  /** 至少答过 1 道计分题 */
  hasAnswer: boolean;
}

export interface FunnelStage {
  key: FunnelStageKey;
  /** 至少走到这一步的人数 */
  reached: number;
  /** 从上一步(或基数)掉在这里的人数 */
  droppedFromPrev: number;
}

export interface Funnel {
  /** 已付款 = 行数。基数,不是分段 */
  base: number;
  stages: FunnelStage[];
  /**
   * 原始判据非单调的行数 —— 已被级联抹平,但必须报出来。
   * 不为 0 说明别处有 bug,而不是这块统计有 bug。
   */
  inconsistent: number;
}

/** 一行的原始判据(未级联) */
function rawFlags(row: FunnelRowInput): Record<FunnelStageKey, boolean> {
  return {
    link_sent: row.linkSentAt !== null,
    logged_in: row.firstLoginAt !== null || row.sessionStatus !== null,
    started_answering: row.profileFilled || row.hasAnswer,
    survey: row.sessionStatus === 'survey' || row.sessionStatus === 'completed',
    completed: row.sessionStatus === 'completed',
  };
}

export function buildFunnel(rows: readonly FunnelRowInput[]): Funnel {
  const reached: Record<FunnelStageKey, number> = {
    link_sent: 0,
    logged_in: 0,
    started_answering: 0,
    survey: 0,
    completed: 0,
  };
  let inconsistent = 0;

  for (const row of rows) {
    const raw = rawFlags(row);
    // 从最后一段往前级联:走到后面就必然算走过前面
    let carried: boolean = false;
    let rowInconsistent: boolean = false;
    const monotone: Record<string, boolean> = {};
    for (let i = FUNNEL_STAGES.length - 1; i >= 0; i--) {
      const key = FUNNEL_STAGES[i];
      const value: boolean = raw[key] || carried;
      if (value !== raw[key]) rowInconsistent = true;
      monotone[key] = value;
      carried = value;
    }
    if (rowInconsistent) inconsistent += 1;
    for (const key of FUNNEL_STAGES) if (monotone[key]) reached[key] += 1;
  }

  const stages: FunnelStage[] = [];
  let prev = rows.length; // 上一层是基数
  for (const key of FUNNEL_STAGES) {
    stages.push({ key, reached: reached[key], droppedFromPrev: prev - reached[key] });
    prev = reached[key];
  }

  return { base: rows.length, stages, inconsistent };
}
