/**
 * PDF 渲染状态机里「谁该被兜底重跑」的判断 —— **纯函数,没有 IO**。
 *
 * 【为什么单独一个模块】`MAX_ATTEMPTS` 原来只活在 `render-pdf.ts` 里。sweep 也要用它:
 * sweep 的**挑人边界必须等于端点的收人边界**,否则它会一遍遍挑出端点必然拒掉的行 ——
 * 那不是「没效果」,是每次 cron 都白打一串请求,而日志里看起来一切正常。
 * 直接从 `render-pdf.ts` 导入不行:那个文件在模块顶层就会拉起 chromium 的环境探测,
 * sweep 只是想读一个数字,不该把整套 Lambda 环境注入也一起拖进来。
 *
 * 判断标准 4 的另一面:这里把「该不该重跑」抽成可断言的纯函数,
 * 而 sweep 那边只剩取数与发请求。
 */

/** 上限 3 次。超过就 failed_permanent,等 Admin 手动重置 —— 见 D6。 */
export const MAX_PDF_ATTEMPTS = 3;

/**
 * `pending` 多久没动就认为「那次异步触发丢了」。
 *
 * finalize 用 `EdgeRuntime.waitUntil` 触发渲染,拿不到那个 API 时退化成 fire-and-forget,
 * 触发可能丢 —— 丢了的话状态永远停在 `pending`。渲染本身约 16 秒,
 * 3 分钟足够区分「还在跑」和「压根没被触发」。
 */
export const PDF_PENDING_STALE_MS = 3 * 60_000;

/**
 * `rendering` 多久没动就认为「渲染中途死了」。
 *
 * render-pdf 的 maxDuration 是 60 秒,超时会被直接杀掉 —— 那时状态已经写成 `rendering`,
 * 而没有任何人会把它改回来。5 分钟留了五倍余量,不会撞上正常渲染。
 */
export const PDF_RENDERING_STALE_MS = 5 * 60_000;

export interface PdfSweepRow {
  session_id: string;
  /**
   * 这一行是哪种语言 —— **候选的粒度是 (session, lang)**。
   * 按 session 挑的话同一份会被重复渲,而两次渲染写同一个对象:
   * 后一次覆盖前一次,可中间那一次的 attempts 已经记上了。
   */
  lang: string;
  pdf_status: string;
  pdf_attempts: number;
  /**
   * 状态最后一次变化的时刻;新建的行可能还没有,回落 `created_at`。
   * (原来回落的是 `assessment_results.computed_at` —— 那一列在旧表上,
   * 而报告文件现在自己有 `created_at`。)
   */
  pdf_status_at: string | null;
  created_at: string;
}

/** 被挑中的原因 —— 不是布尔值,因为日志里要说清楚「为什么重跑这一条」 */
export type PdfSweepReason = 'failed_retry' | 'pending_trigger_lost' | 'rendering_stuck';

/**
 * 这一行该不该被 sweep 重跑?不该则回 `null`。
 *
 * 【为什么 attempts 的判断放在状态之前】端点自己的守卫看的是 `pdf_attempts >= MAX`,
 * **不是 `pdf_status = 'failed_permanent'`**。两者平时一致,但不是同一个条件:
 * 手工改过状态、或将来加了别的置位路径,就会分叉。挑人条件照抄端点的收人条件,
 * 这两条边界才不会各走各的。
 *
 * 【为什么 `rendering` 也在里面】它是另一种「永远不会自己好」的卡死:
 * 函数在写下 rendering 之后超时被杀,没有任何人会把它改回来。
 * 只扫 pending 的话这一类只能靠人从名单页发现 —— 那正是 sweep 想取消的东西。
 *
 * 【时间基准 coalesce(pdf_status_at, computed_at)】`pdf_status_at` 是后加的列,
 * 老行是 null;而且迁移与代码的上线顺序不保证。回落到 `computed_at`(非空)之后,
 * 这两种情况都不会让判断失灵 —— 最坏是把年龄算大了,而那正是安全的方向。
 */
export function pdfSweepReason(row: PdfSweepRow, nowMs: number): PdfSweepReason | null {
  if (row.pdf_attempts >= MAX_PDF_ATTEMPTS) return null;

  const since = Date.parse(row.pdf_status_at ?? row.created_at);
  // 时间戳读不出来时【不】重跑:宁可漏一条等人发现,也不要因为一个坏值反复烧渲染
  if (Number.isNaN(since)) return null;
  const ageMs = nowMs - since;

  switch (row.pdf_status) {
    case 'failed':
      return 'failed_retry';
    case 'pending':
      return ageMs >= PDF_PENDING_STALE_MS ? 'pending_trigger_lost' : null;
    case 'rendering':
      return ageMs >= PDF_RENDERING_STALE_MS ? 'rendering_stuck' : null;
    // 'ready' 不用管;'failed_permanent' 是「重试一万次也没用」的那一类(D9 的 CONFIG),
    // 每天定时去重跑一件确定会失败的事,只会把日志喂成噪音
    default:
      return null;
  }
}
