/**
 * render-pdf 写「ready」那一步:重试,以及写不进去时回给调用方什么。纯逻辑,便于测试。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么有这一层】2026-10-07 之前,render-pdf 写 ready 的那次 update 结果根本没看 ——
 * 写不进去照样回 200 ok。于是 report-file 告诉学员「好了」、Admin 的「重新生成」显示成功,
 * 而库里那一行还是 `rendering`,报告页拿不到下载链接。PDF 其实已经传上去了,
 * 只是没有任何东西知道。
 *
 * 【现在的规矩(Viho 2026-10-07 定)】
 *   - 写 ready:短间隔重试最多 3 次(数据库抖一下是最常见的失败,值得等几百毫秒)
 *   - 仍然失败:记日志(dbLogLine),**向调用方返回失败,不再报成功**;
 *     那一行停在 `rendering`,pdf-sweep 看到它陈旧(5 分钟)会重渲一次 —— 兜底在那里
 *   - 回给调用方的说明是固定措辞,不带数据库原文(原文只进日志)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface WriteOutcome {
  ok: boolean;
  attempts: number;
  error: unknown;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `write` 每次都要发一次新的请求(supabase-js 的查询构造器是 thenable,传一个返回它的函数即可)。
 * 写的那一下自己抛了(网络层)也算一次失败,照样重试。
 */
export async function writeWithRetry(
  write: () => PromiseLike<{ error: unknown }>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<WriteOutcome> {
  const max = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 250;
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const { error } = await write();
      if (!error) return { ok: true, attempts: attempt, error: null };
      lastError = error;
    } catch (err) {
      lastError = err;
    }
    if (attempt < max) await sleep(delayMs);
  }
  return { ok: false, attempts: max, error: lastError };
}

/** 写 ready 的结果 → 回给调用方的 HTTP 状态与 body */
export function afterReadyWrite(
  outcome: WriteOutcome,
  success: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } {
  if (outcome.ok) return { status: 200, body: success };
  return {
    status: 500,
    body: {
      error: 'status_write_failed',
      detail:
        `The PDF was uploaded, but marking it ready failed after ${outcome.attempts} attempts. ` +
        'The row stays "rendering"; pdf-sweep will re-render it once it goes stale.',
      attempts: outcome.attempts,
    },
  };
}

/**
 * 写 ready 时的那一行。
 *
 * 【成功就把 pdf_attempts 清零】2026-10-07 起。原来只增不减:每次渲染(包括成功的)在认领时 +1,
 * 于是同一份 PDF 被正常重渲三次之后,第四次会在 render-pdf 门口被永久拒绝(failed_permanent),
 * 库里留着的是上一次的 PDF。清零之后,这一列的意思是「上次成功之后连续失败了几次」——
 * 正好是 3 次上限要数的东西。roster / CSV / 报告页都不显示这个数,所以没有可见的变化。
 */
export function readyPatch(input: {
  path: string;
  glyphMessage: string | null;
  cardPaths: Record<string, string | null>;
  cardError: string | null;
  nowIso: string;
}): Record<string, unknown> {
  return {
    pdf_path: input.path,
    pdf_status: 'ready',
    pdf_status_at: input.nowIso,
    pdf_last_error: input.glyphMessage,
    ...input.cardPaths,
    // 成功时显式清空,免得上一次的错误一直挂着骗人
    share_card_error: input.cardError,
    pdf_attempts: 0,
  };
}
