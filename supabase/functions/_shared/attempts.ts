/**
 * 「一个人有几份答题记录时,用哪一份」—— 唯一的定义(重填第 1 步,docs/retake-design.md 第 1 节)。纯函数,没有 IO。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【今天每个人最多一份】这一层上线时数据里没有任何人有两份,所以下面每一种取法取到的都是那唯一一份 ——
 * 这一步对已有的报告、名单、统计零变化(上线前后快照逐字比对来证明)。
 * 它存在是为了让「一人多份」到来时,每一个读者已经在用同一个定义,而不是各自 `.maybeSingle()` 然后 500。
 *
 * 【两种「哪一份」】
 *   - **当前答题记录**(答题、出分、登录去向):有没做完的就是它(数据库的部分唯一索引保证最多一份),
 *     否则是 attempt_no 最大的那份。
 *   - **报告看的那份**(报告、报告文件、名单、漏斗):最新**完成**的那份;一份都没完成时是当前那份 ——
 *     于是「还没出分」「还没开始」这些今天的回应原样不变,而重填做到一半的人仍然看到上一份完成的报告。
 *
 * 【SQL 那一侧的同一个定义】统计用的视图 `assessment_latest_results`(迁移 20261014100000)是「每人最新完成的一份」;
 * 它与 `pickReportAttempt` / `latestPerEntitlement` 必须说同一件事。报告快照的 `--reader=latest` 用视图,
 * 与按今天的读法取的快照逐字比对。
 *
 * 【没有 attempt_no 的行按第 1 份算】迁移之前的代码读出来的行没有这一列;那时也确实每人只有第 1 份。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface AttemptLike {
  status: string | null;
  attempt_no?: number | null;
}

const attemptNo = (r: { attempt_no?: number | null }) => r.attempt_no ?? 1;

/** attempt_no 从大到小;不改原数组 */
function newestFirst<T extends { attempt_no?: number | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => attemptNo(y) - attemptNo(x));
}

/** 当前答题记录:没做完的那份;都做完了就是 attempt_no 最大的那份。没有任何一份 → null */
export function pickCurrent<T extends AttemptLike>(rows: readonly T[]): T | null {
  const sorted = newestFirst(rows);
  return sorted.find((r) => r.status !== 'completed') ?? sorted[0] ?? null;
}

/** 报告看的那份:最新完成的;一份都没完成 → 当前那份。没有任何一份 → null */
export function pickReportAttempt<T extends AttemptLike>(rows: readonly T[]): T | null {
  return newestFirst(rows).find((r) => r.status === 'completed') ?? pickCurrent(rows);
}

/**
 * PostgREST 嵌套回来的 `assessment_sessions`:一对一关系时是对象,一对多时是数组,没有时是 null。
 * 今天 `entitlement_id` 上还有 unique,所以是对象;第 2 步去掉它之后会变成数组 ——
 * 不统一的话,读 `.status` 会**悄悄**读出 undefined,不报错(附录里「嵌套成一个对象」那两处)。
 */
export function asRows<T>(embed: T | readonly T[] | null | undefined): T[] {
  if (embed === null || embed === undefined) return [];
  return Array.isArray(embed) ? [...(embed as readonly T[])] : [embed as T];
}

/**
 * 统计去重:每个 entitlement 只留 attempt_no 最大的那一行(调用方先筛好「已完成」)。
 * 输出顺序 = 每个 entitlement 第一次出现的位置,所以一人一份时原样、原序返回。
 * 取不到 entitlement 的行原样保留 —— 不悄悄丢数据。
 * `attemptOf` 取不到(迁移之前的行)按第 1 份算。
 */
export function latestPerEntitlement<T>(
  rows: readonly T[],
  entitlementOf: (row: T) => string | null | undefined,
  attemptOf: (row: T) => number | null | undefined,
): T[] {
  const no = (r: T) => attemptOf(r) ?? 1;
  const best = new Map<string, T>();
  for (const r of rows) {
    const ent = entitlementOf(r);
    if (!ent) continue;
    const cur = best.get(ent);
    if (cur === undefined || no(r) > no(cur)) best.set(ent, r);
  }
  const out: T[] = [];
  const emitted = new Set<string>();
  for (const r of rows) {
    const ent = entitlementOf(r);
    if (!ent) {
      out.push(r);
      continue;
    }
    if (emitted.has(ent)) continue;
    emitted.add(ent);
    out.push(best.get(ent)!);
  }
  return out;
}
