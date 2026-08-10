import type { VercelRequest, VercelResponse } from '@vercel/node';
import { pickPublishableKey, supabaseKeyHeaders } from '../_lib/apiKeys.js';

/**
 * Vercel Cron → assessment-maintenance(PROGRESS.md S4-B)。
 *
 * 排期在 vercel.json 的 crons 里。这个 handler 只做两件事:
 * 校验来源是 Vercel Cron,然后带 INTERNAL_FN_SECRET 调 Edge Function。
 *
 * 【为什么不在这里直接删库】那需要把 SUPABASE_SERVICE_ROLE_KEY 放进 Vercel。
 * 目前没有任何 Vercel 函数需要它(Stage 9 的 render-pdf 才需要),
 * 提前放进去只是白扩大暴露面。Edge Function 那边的 service role 是平台注入的,
 * 不经过我们任何配置。
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
    const upstream = await fetch(
      `${base.replace(/\/$/, '')}/functions/v1/assessment-maintenance`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': internal,
          /**
           * 【两个头还是一个头由 key 的代次决定】新的 publishable key 不是 JWT,
           * 放进 `Authorization: Bearer` 会被拒。与代理共用 _lib/apiKeys 那一份判断 ——
           * 两处各写一遍迟早对不上,而对不上的症状是鉴权被拒,
           * 而鉴权被拒从来不会说「你把 key 放错头了」。
           */
          ...supabaseKeyHeaders(
            pickPublishableKey(process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY) ?? '',
          ),
        },
        body: '{}',
      },
    );
    const text = await upstream.text();
    // 把上游的状态和结果原样带出来 —— Cron 的执行历史里看得到删了多少行,
    // 否则「跑了」和「跑了但没干活」在日志里没有区别
    if (!upstream.ok) console.error(`maintenance returned ${upstream.status}: ${text.slice(0, 200)}`);
    return res.status(upstream.status).send(text);
  } catch (err) {
    console.error(`cron retention failed: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
}
