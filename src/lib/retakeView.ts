import type { AttemptSummary, ReportPayload } from '@/lib/reportApi';

/**
 * 报告页上「重填」那几块该不该出现、出现成什么样 —— 纯函数,页面只照着画(重填第 3 步,docs/retake-design.md 第 2 节)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【能不能重填由服务端说了算】报告接口回的 `retake`(与 start_retake 同一个 `retakeEligibility`)。
 * 这里不重算任何规则 —— 24 小时、6 份、批次开没开放,都只读服务端给的结果与数字。
 * 页面上按钮变灰只是告诉人;真正的拦阻在 start_retake。
 *
 * 【`not_open` = 什么都不出现】第 2 步起 `RETAKE_OPEN_TO_REAL_COHORTS = false`:真实批次的人 start_retake 回 `not_open`,
 * 报告接口的 `retake.reason` 也是它。那时这一节整个不渲 —— 真实学员的报告页与今天一模一样;只有测试批次看得到、用得了。
 * 第 5 步把那个开关改成 true 之后,真实学员拿到的是别的原因,这里不用改。
 *
 * 【PDF 渲染模式下全都不出现】渲染器打开的报告页(`?rt=`)回的 payload 本来就没有这三个键;
 * 这里再显式判一次 —— 不靠「恰好没有那几个键」。打印另由各块上的 `no-print` 管。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type RetakeAction =
  | { kind: 'hidden' }
  | { kind: 'start'; used: number; max: number; minHours: number }
  | { kind: 'continue'; attemptNo: number }
  | { kind: 'too_soon'; nextAllowedAt: string | null; minHours: number }
  | { kind: 'limit_reached'; max: number }
  | { kind: 'revoked' };

export interface RetakeCtx {
  /** PDF 渲染器打开的报告页(`?rt=`) */
  renderMode: boolean;
  /** 页面开着的时候链接被作废了:点「重填 / 继续 / 放弃」拿到 403。payload 不会再变,所以由页面记下来 */
  revokedNow?: boolean;
}

type RetakeData = Pick<ReportPayload, 'attempt' | 'attempts' | 'retake'>;

/** 看的是不是以前的一份(不是最新那份) */
function viewingOlder(d: RetakeData): boolean {
  return d.attempt !== null && d.attempt !== undefined && !d.attempt.isLatest;
}

/** 报告最下方那一节 */
export function retakeAction(d: RetakeData, ctx: RetakeCtx): RetakeAction {
  const r = d.retake;
  if (ctx.renderMode || !r) return { kind: 'hidden' };
  // 以前的一份上不放重填 —— 它在最新那份报告的最下方;以前那份的页面顶上有「看最新的一份」
  if (viewingOlder(d)) return { kind: 'hidden' };
  if (ctx.revokedNow) return { kind: 'revoked' };
  if (r.openAttempt !== null) return { kind: 'continue', attemptNo: r.openAttempt };
  if (r.canStart) return { kind: 'start', used: (d.attempts ?? []).length, max: r.maxAttempts, minHours: r.minHoursBetween };
  switch (r.reason) {
    case 'too_soon':
      return { kind: 'too_soon', nextAllowedAt: r.nextAllowedAt, minHours: r.minHoursBetween };
    case 'limit_reached':
      return { kind: 'limit_reached', max: r.maxAttempts };
    case 'revoked':
      return { kind: 'revoked' };
    default:
      // not_open(还没对这个批次开放)、no_completed_attempt(报告页上不会出现)、没带编号的 open_attempt
      return { kind: 'hidden' };
  }
}

/** 顶部那条「你有一次重填还没做完 —— 继续 / 放弃」。关于人,不关于这一页:以前那份的页面上也出现 */
export function openRetakeBanner(d: RetakeData, ctx: RetakeCtx): { attemptNo: number } | null {
  if (ctx.renderMode || ctx.revokedNow || !d.retake || d.retake.openAttempt === null) return null;
  return { attemptNo: d.retake.openAttempt };
}

export interface HistoryItem extends AttemptSummary {
  /** 现在页面上显示的就是这一份 */
  viewing: boolean;
  /** 编号最大的完成份 = 默认显示的那份 */
  latest: boolean;
}

/** 历次结果:两份以上才有;编号从大到小(最新在前) */
export function historyItems(d: RetakeData, ctx: RetakeCtx): HistoryItem[] | null {
  const list = d.attempts ?? [];
  if (ctx.renderMode || list.length < 2) return null;
  const latestNo = Math.max(...list.map((a) => a.no));
  const viewingNo = d.attempt?.no ?? latestNo;
  return [...list].sort((a, b) => b.no - a.no).map((a) => ({ ...a, viewing: a.no === viewingNo, latest: a.no === latestNo }));
}

/** 看的是以前的一份时,页面顶上那一行 */
export function historyNote(d: RetakeData, ctx: RetakeCtx): { no: number; completedAt: string | null } | null {
  if (ctx.renderMode || !viewingOlder(d)) return null;
  return { no: d.attempt!.no, completedAt: d.attempt!.completedAt };
}

/** `?attempt=` —— 与服务端同一个判据(1–999,不带前导 0);别的一律当作「没指定」= 最新那份,不猜 */
export function parseAttemptParam(raw: string | null): number | null {
  return raw !== null && /^[1-9][0-9]{0,2}$/.test(raw) ? Number(raw) : null;
}

/**
 * 时间一律按马来西亚时间(UTC+8)显示,不按手机的时区 —— 学员都在马来西亚,而「24 小时之后」这个点
 * 要和顾问、和后台说的是同一个钟点。手机时区设错了的人看到的仍是马来西亚的钟点(文案里写明了)。
 */
const MYT = 'Asia/Kuala_Lumpur';
const FORMATS = {
  zh: new Intl.DateTimeFormat('zh-CN', { timeZone: MYT, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: MYT, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
};

export function formatMalaysiaTime(iso: string | null, locale: 'zh' | 'en'): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : FORMATS[locale].format(ms);
}

/** 离 `iso` 还有多久,向上取整到分钟(还没到就至少 1 分钟);已经到了 / 没有时间 → null */
export function waitUntil(iso: string | null, nowMs: number): { hours: number; minutes: number } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || ms <= nowMs) return null;
  const totalMinutes = Math.ceil((ms - nowMs) / 60_000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
