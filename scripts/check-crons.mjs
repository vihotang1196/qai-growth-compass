#!/usr/bin/env node
/**
 * 守「cron 函数与排期一一对应」—— **双向**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么需要这道门:这次的缺口本身就是它】
 *
 * `assessment-ghl-resync` 存在、鉴权正确、候选查询也对,而且 `ghlWriteback` 一直在
 * 往 `ghl_next_retry_at` 里写待重试的时间 —— **但没有任何东西调它**。
 * 于是 GHL 写回失败在生产上从来没有被重试过,而失败形态极安静:
 * 数据停在那里,Admin 名单页上显示「失败」,看起来像要人手动处理,
 * 实际是系统本该自动处理的。**那件事只有靠人翻 `vercel.json` 才会发现。**
 *
 * 【两个方向拦的是不同的事故】
 *   → 有文件没排期:函数永远不跑,而它看起来是装好了的(上面那次)
 *   → 有排期没文件:每次触发都 404,而 **Vercel 的 cron 历史里 404 也是一次执行记录** ——
 *     「跑过了」这个印象是对的,「跑成了」是错的,而列表里两者长得一样
 *
 * 【为什么不顺手校验 cron 表达式的语义】
 * 「每 15 分钟」写成 `15 * * * *`(每小时的第 15 分钟)是个真实存在的手滑,
 * 但那要一个 cron 解析器才能判「作者想要的频率」—— 而作者的意图不在文件里。
 * 所以这里只做**形状**校验(五段、非空),频率对不对靠部署后看 Invocations。
 * 做不到的事写出来,不装(与 `check:dim` 那条盲区同一个交代)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CRON_DIR = join(ROOT, 'api', 'cron');
const errors = [];

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const crons = Array.isArray(vercel.crons) ? vercel.crons : [];

/** 磁盘上的 cron 函数:api/cron/*.ts(不含 .d.ts / 测试) */
const files = existsSync(CRON_DIR)
  ? readdirSync(CRON_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !/\.test\./.test(f))
  : [];
const filePaths = new Map(files.map((f) => [`/api/cron/${f.replace(/\.ts$/, '')}`, f]));

/** 排期表里的 path → schedule(重复 path 也要拦:后一条会静默覆盖前一条的意图) */
const scheduled = new Map();
for (const [i, entry] of crons.entries()) {
  const path = typeof entry?.path === 'string' ? entry.path : '';
  const schedule = typeof entry?.schedule === 'string' ? entry.schedule.trim() : '';
  if (!path) {
    errors.push(`vercel.json crons[${i}] 没有 path。`);
    continue;
  }
  if (!schedule) {
    errors.push(`vercel.json crons[${i}] (${path}) 没有 schedule —— 不会被触发。`);
  } else if (schedule.split(/\s+/).length !== 5) {
    errors.push(
      `vercel.json crons[${i}] (${path}) 的 schedule "${schedule}" 不是五段 —— ` +
        `Vercel 只接受标准五段 cron。`,
    );
  }
  if (scheduled.has(path)) {
    errors.push(`vercel.json crons 里 ${path} 出现了两次 —— 后一条会盖掉前一条。`);
  }
  scheduled.set(path, schedule);
}

// ① 有文件没排期 —— 这次的缺口
for (const [path, file] of filePaths) {
  if (!scheduled.has(path)) {
    errors.push(
      `api/cron/${file} 没有排期。它**永远不会自己跑**,而它看起来是装好了的 —— ` +
        `在 vercel.json 的 crons 里加一条 { "path": "${path}", "schedule": "..." },` +
        `或者删掉这个文件。`,
    );
  }
}

// ② 有排期没文件 —— 每次触发 404,而 404 在 cron 历史里也是一次执行记录
for (const path of scheduled.keys()) {
  if (!path.startsWith('/api/cron/')) {
    // 非 /api/cron/ 的排期不在这道门的管辖内(比如以后有人排 /api/xxx),但要说出来
    console.warn(`[check-crons] 注意:${path} 不在 api/cron/ 下,这道门不检查它是否存在。`);
    continue;
  }
  if (!filePaths.has(path)) {
    errors.push(
      `vercel.json 排了 ${path},但 api/cron/ 下没有对应文件 —— ` +
        `每次触发都是 404,而 Vercel 的 cron 历史里 404 也算一次执行记录:` +
        `列表看起来在跑,实际什么都没发生。`,
    );
  }
}

if (errors.length) {
  console.error(`[check-crons] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  console.error('  一个存在但没人调用的 cron 函数,失败时不会报错 —— 它只是不发生。');
  process.exit(1);
}

const pairs = [...filePaths.keys()].sort().map((p) => `${p} @ ${scheduled.get(p)}`);
console.log(
  `[check-crons] OK —— ${filePaths.size} 个 cron 函数与 ${scheduled.size} 条排期双向对齐:\n` +
    pairs.map((p) => `           ${p}`).join('\n'),
);
