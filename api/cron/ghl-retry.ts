import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pickPublishableKey, supabaseKeyHeaders } from '../_lib/apiKeys.js';

/**
 * Vercel Cron → assessment-ghl-resync。**这是入口审计里最要紧的那个缺口。**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【它补的是什么:一个已经上线、正确、但从来没运行过的重试机制】
 *
 * `ghlWriteback` 在 TRANSIENT 失败时会写 `ghl_next_retry_at`(2^attempts 分钟,
 * 上限 6 小时),`assessment-ghl-resync` 会按它挑候选行重跑。两半都在,
 * 索引也在(`assessment_results_ghl_retry_idx`)—— **缺的只是有人去叫它**。
 *
 * 而这个缺口的失败形态特别安静:写回失败 → 标记待重试 → 没人来 →
 * 数据永远停在那里,而 Admin 名单页上那一列显示的是「失败」,
 * **看起来像是要人手动处理的东西,实际是系统本该自动处理的**。
 * 没有任何东西会报错,因为从系统的角度看什么都没发生。
 *
 * 【为什么是每 15 分钟一次,不是 10 分钟也不是每小时】
 * 第一次退避是 2 分钟,所以更密的排期只会让第一次重试早几分钟到;
 * 而 resync 的 `BATCH_CAP` 是 50,15 分钟一次把最坏情况下的 GHL 请求量
 * 压在 200/小时这个量级 —— GHL 有限流,而重试打爆限流会把 TRANSIENT 变成更多 TRANSIENT。
 *
 * (排期字面量在 `vercel.json` 的 crons 里 —— cron 表达式里那个星号加斜杠
 * 会把块注释提前闭合,所以这里只用文字说。上一版我塞了零宽空格躲开它,
 * 而**源码里的不可见字符**正是这一轮在清的东西 —— 那个躲法当场被 eslint 抓了。)
 *
 * 【测试批次不会被打到,而且是两层】
 * ① `syncToGhl` 在**发出任何请求之前**就查 `isTestSessionCohort` 并直接返回;
 * ② 它把失败记成 `CONFIG:` 前缀,而 resync 的候选过滤会跳过 CONFIG/AUTH 行 ——
 * 所以测试行连续被挑中重试也不会有对外请求。开这条 cron 之前先确认过这两层。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron 会带 Authorization: Bearer $CRON_SECRET(前提是配了 CRON_SECRET)
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
    INTERNAL_FN_SECRET: process.env.INTERNAL_FN_SECRET,
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`server_misconfigured: missing ${missing.join(', ')} (Vercel env)`);
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  const base = env.SUPABASE_URL!;
  const internal = env.INTERNAL_FN_SECRET!;

  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/functions/v1/assessment-ghl-resync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internal,
        /**
         * 【两个头还是一个头由 key 的代次决定】与 retention / 代理共用
         * `_lib/apiKeys` 那一份判断 —— 新的 publishable key 不是 JWT,
         * 放进 `Authorization: Bearer` 会被拒,而鉴权被拒从来不会说
         * 「你把 key 放错头了」。
         */
        ...supabaseKeyHeaders(
          pickPublishableKey(
            process.env.SUPABASE_PUBLISHABLE_KEY,
            process.env.SUPABASE_ANON_KEY,
          ) ?? '',
        ),
      },
      body: '{}',
    });
    const text = await upstream.text();
    /**
     * 把上游的状态与结果原样带出来 —— Cron 执行历史里因此看得到「重试了几条、
     * 成了几条」。否则「跑了」和「跑了但一条都没处理」在日志里没有区别
     * (判断标准 2:打印一个值但不对它做判断等于没打印;这里是它的孪生 ——
     * 一次成功的调用如果不带回结果,就等于没调用过)。
     */
    if (!upstream.ok) {
      console.error(`ghl-resync returned ${upstream.status}: ${text.slice(0, 200)}`);
    } else {
      console.log(`ghl-resync ok: ${text.slice(0, 200)}`);
    }
    return res.status(upstream.status).send(text);
  } catch (err) {
    console.error(`cron ghl-retry failed: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
}
