#!/usr/bin/env node
/**
 * 部署前的一道 preflight:**有未应用的迁移时,拒绝部署函数。**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么需要它 —— 顺序错过一次,而那次只是没撞上真实流量】
 *
 * 正确顺序是 `db push` → `deploy:functions`:函数会按新签名调用 RPC,
 * 而那个签名只有迁移会创建。反过来做,中间那段时间**付款 webhook 是断的** ——
 * 新学员付了钱建不了准入记录。
 *
 * 那一次没出事,原因是当时**还没有真实学员**,不是因为顺序不重要。
 * 「靠人记得」在没有流量时看起来一直有效,而它失效的那一次代价最大。
 *
 * 【为什么不做成构建门】`npm run build` 时没有数据库,「那条迁移跑过没有」查不了
 * (`check:rpc-contract` 已经守了仓库内部一致性,而它明说守不了这件事)。
 * 这件事只能在**部署时**问,而部署时恰好连得上库。
 *
 * 【拿不到答案时一律拒绝部署 —— fail closed】
 * CLI 失败、没登录、没 link、网络不通,都不能当成「没有未应用的迁移」。
 * 那会把这道 preflight 变成一个在最需要它的时候(环境不对)自动让路的东西 ——
 * 而那正是 `--sloppy-imports` 那次的教训:一道在某些环境里不响的检查等于没有检查。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * 【CLI 有两种输出格式,而决定因素是 stdout 是不是 TTY】
 *
 *   - stdout 被重定向(我们这种 `execFileSync`)→ **一行 JSON**
 *   - 在终端里手敲 → **表格**
 *   - 而 `--output json` 反直觉地**强制表格**(实测两次)
 *
 * 上一版只解析 JSON,并且在注释里把差异归给了那个 flag ——
 * **观测本身没错(管道下确实是 JSON),错在把它当成了全部**:
 * 真正的变量是 TTY,而人在终端里看到的与脚本拿到的不是同一个东西。
 *
 * 所以现在**两种都解析**:这样它不依赖「哪一种才是真的」这个我不该赌的前提。
 */
export function parseTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.replace(/`/g, '').trim());
    if (cells.length < 2) continue;
    // 表头与分隔线跳过
    if (/^local$/i.test(cells[0]) || /^-+$/.test(cells[0])) continue;
    if (!/^\d{6,}$/.test(cells[0]) && !/^\d{6,}$/.test(cells[1])) continue;
    rows.push({ local: cells[0], remote: cells[1], time: cells[2] ?? '' });
  }
  return rows.length ? { migrations: rows } : null;
}

/**
 * 纯判定 —— **导出是为了能直接喂一份输出测那条红路径**。
 *
 * 每条形如 `{ local, remote }`;未应用的那条 `remote` 是空的(反过来
 * `local` 空、`remote` 有值 = 远端有一条本地没有的迁移,那同样值得拦:
 * 那说明有人直接在库上改过,或者本地少了一个文件)。
 */
export function classifyMigrations(json) {
  const rows = Array.isArray(json?.migrations) ? json.migrations : null;
  if (!rows) return { ok: false, reason: '解析不了 CLI 的输出格式(JSON 与表格都没认出来)—— 不当作通过' };
  const notApplied = rows.filter((r) => r.local && !r.remote).map((r) => r.local);
  const onlyRemote = rows.filter((r) => !r.local && r.remote).map((r) => r.remote);
  return { ok: notApplied.length === 0 && onlyRemote.length === 0, notApplied, onlyRemote, total: rows.length };
}

function fail(lines) {
  console.error('[check-migrations-applied] FAILED:');
  for (const l of lines) console.error(`  ✗ ${l}`);
  console.error('');
  console.error('  正确顺序:npm run db:push(或 supabase db push)→ npm run deploy:functions。');
  console.error('  反过来做的话,函数会按新签名调用一个还不存在的 RPC —— 而 webhook 是付款入口。');
  process.exit(1);
}

let json;
/**
 * 【两条路径共用同一段解析与同一段诊断】
 * 上一版把「解析不了就回显实际内容」只写在 CLI 那条分支里,于是用 `--from-file`
 * 跑的变异走的是另一段代码 —— **验的不是真正会跑的那一段**
 * (判断标准 1 推论五:变异要真的改到那条路径)。
 */
function parseCliOutput(text) {
  const jsonLine = text.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
  return jsonLine ? JSON.parse(jsonLine) : parseTable(text);
}

let rawText;
const fromFile = process.argv.indexOf('--from-file');
if (fromFile !== -1) {
  // 只为测那些路径:直接喂一份 CLI 形状的输出(JSON 或表格都行)
  rawText = readFileSync(process.argv[fromFile + 1], 'utf8');
  json = parseCliOutput(rawText);
} else {
  try {
    /**
     * 【不带 `--output json`】实测:不带参数时(非 TTY)输出的**就是** JSON;
     * 而带上 `--output json` 反而输出表格、JSON 那一行消失。
     * 这不是猜的 —— 两种都跑过并比对了首字符与末行。
     * 一个「看起来更明确」的参数把输出变得更难解析,而那种反直觉只能靠实测发现。
     */
    const out = execFileSync('supabase', ['migration', 'list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    rawText = out;
    json = parseCliOutput(out);
  } catch (err) {
    fail([
      `跑不了 \`supabase migration list\`:${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      '拿不到答案时**一律拒绝部署** —— 一道在环境不对时自动让路的检查等于没有检查。',
    ]);
  }
}

/**
 * 【把实际拿到的东西回显出来】上一版只说「没有输出 JSON」——
 * 那把一个格式假设说成了事实,而看到那句话的人无法判断到底收到了什么。
 * 一条失败路径除了失败,还要说清**去哪找**(判断标准 9)。
 */
if (!json) {
  fail([
    '解析不了 `supabase migration list` 的输出(JSON 与表格都没认出来)—— 拿不到答案就不放行。',
    `实际收到的前 200 字符:${JSON.stringify((rawText ?? '').slice(0, 200))}`,
  ]);
}

const verdict = classifyMigrations(json);
if (!verdict.ok) {
  const lines = [];
  if (verdict.reason) lines.push(verdict.reason);
  if (verdict.notApplied?.length) {
    lines.push(
      `有 ${verdict.notApplied.length} 条迁移**还没应用到远端**:${verdict.notApplied.join(', ')}`,
    );
  }
  if (verdict.onlyRemote?.length) {
    lines.push(
      `远端有 ${verdict.onlyRemote.length} 条本地没有的迁移:${verdict.onlyRemote.join(', ')} —— ` +
        `本地少了文件,或者有人直接在库上改过。两种都要先弄清再部署。`,
    );
  }
  fail(lines);
}

console.log(
  `[check-migrations-applied] OK —— ${verdict.total} 条迁移本地与远端一致,可以部署函数。`,
);
