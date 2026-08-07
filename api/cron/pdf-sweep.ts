import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  MAX_PDF_ATTEMPTS,
  pdfSweepReason,
  type PdfSweepRow,
} from '../_lib/pdfState.js';

/**
 * Vercel Cron → PDF 渲染的定时兜底 sweep(Stage 9 最后一件)。
 *
 * 【它补的是哪个洞】finalize 用 `EdgeRuntime.waitUntil` 异步触发渲染,
 * 拿不到那个 API 时退化成 fire-and-forget —— **触发可能丢**。丢了的话状态永远停在
 * `pending`,而在此之前唯一的出路是 Admin 那个按钮,也就是「靠人发现」。
 * 这是异步化本身引入的失败形态,所以兜底也该由这一层出。
 *
 * 【为什么不做成 Edge Function】retention 那条走 Vercel Cron → Edge Function,
 * 理由是「不想为了删库把 SUPABASE_SERVICE_ROLE_KEY 放进 Vercel」。
 * 那个理由在这里不成立:render-pdf 本来就要这把 key,已经在 Vercel 上了。
 * 再绕一跳只是多一个会坏的地方。
 *
 * 【不 await 不行】Vercel 的 Node 函数在 handler 返回后会被冻结,
 * 没 await 的 fetch 会被取消 —— 那样触发是「有时成功」,而那种不确定正是这个
 * sweep 要消灭的东西。所以这里【等】,代价是一次 sweep 的批量必须很小(见 BATCH_CAP)。
 */

/**
 * 一次最多重跑几条。
 *
 * 不是随手取的:这个函数自己的 maxDuration 是 60 秒(vercel.json),
 * 单次渲染约 16 秒、冷启动更久。三条并发跑完约 20–25 秒,留了一倍余量。
 * 到上限会在返回里说明**还剩多少条**,不静默截断 —— 静默截断会让「扫完了」
 * 和「扫了一部分」在日志里长得一样(判断标准 2)。
 */
const BATCH_CAP = 3;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured — refusing to run');
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    APP_BASE_URL: process.env.APP_BASE_URL,
    INTERNAL_FN_SECRET: process.env.INTERNAL_FN_SECRET,
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`server_misconfigured: missing ${missing.join(', ')} (Vercel env)`);
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const supa = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    /**
     * 取数刻意【宽】,判断交给 pdfSweepReason。
     *
     * SQL 里只排掉两类一眼就不用管的:已经 ready 的,和次数已经用完的
     * (`pdf_attempts < MAX` 与端点自己的守卫是同一个条件 —— 挑人边界等于收人边界,
     * 否则 sweep 会一遍遍挑出端点必然 409 的行)。
     * 「陈旧多久算陈旧」这种带时间的判断留在纯函数里,那样它可断言;
     * 写进 PostgREST 的 filter 就只能靠线上观察。
     *
     * 已有的部分索引 assessment_results_pdf_status_idx (pdf_status) where pdf_status <> 'ready'
     * 正好覆盖这个查询。
     */
    const { data, error } = await supa
      .from('assessment_results')
      .select('session_id, pdf_status, pdf_attempts, pdf_status_at, computed_at')
      .neq('pdf_status', 'ready')
      .lt('pdf_attempts', MAX_PDF_ATTEMPTS)
      .order('computed_at', { ascending: true });
    if (error) throw error;

    const now = Date.now();
    const candidates = (data ?? [])
      .map((row) => ({ row: row as PdfSweepRow, reason: pdfSweepReason(row as PdfSweepRow, now) }))
      .filter((c): c is { row: PdfSweepRow; reason: NonNullable<typeof c.reason> } => c.reason !== null);

    const batch = candidates.slice(0, BATCH_CAP);
    const deferred = candidates.length - batch.length;

    if (batch.length === 0) {
      // 「没活干」也要说出来,否则「跑了」和「跑了但没干活」在 Cron 历史里没有区别
      return res.status(200).json({ ok: true, scanned: data?.length ?? 0, swept: 0, deferred: 0 });
    }

    const base = env.APP_BASE_URL!.replace(/\/$/, '');
    const results = await Promise.all(
      batch.map(async ({ row, reason }) => {
        console.log(`pdf-sweep: re-rendering ${row.session_id} (${reason}, attempts=${row.pdf_attempts})`);
        try {
          const upstream = await fetch(`${base}/api/render-pdf`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-Secret': env.INTERNAL_FN_SECRET!,
            },
            body: JSON.stringify({ session_id: row.session_id }),
          });
          const text = await upstream.text().catch(() => '');
          if (!upstream.ok) {
            console.error(
              `pdf-sweep: ${row.session_id} returned ${upstream.status}: ${text.slice(0, 300)}`,
            );
          }
          // render-pdf 自己会把结果写进 pdf_status / pdf_last_error,这里不重复写库 ——
          // 两处都写状态就会出现「谁最后写的」这种没人想查的问题
          return { session_id: row.session_id, reason, status: upstream.status, ok: upstream.ok };
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.error(`pdf-sweep: ${row.session_id} threw: ${detail}`);
          return { session_id: row.session_id, reason, status: 0, ok: false, detail };
        }
      }),
    );

    const failed = results.filter((r) => !r.ok).length;
    if (deferred > 0) {
      // 明说这一轮没扫完 —— 下一次 cron 会接着扫,但「还剩多少」必须留在日志里
      console.log(`pdf-sweep: ${deferred} more candidate(s) left for the next run (cap ${BATCH_CAP})`);
    }
    return res.status(200).json({
      ok: failed === 0,
      scanned: data?.length ?? 0,
      swept: results.length,
      failed,
      deferred,
      results,
    });
  } catch (err) {
    console.error(`pdf-sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(500).json({ error: 'sweep_failed' });
  }
}
