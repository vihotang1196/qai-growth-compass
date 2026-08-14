#!/usr/bin/env node
/**
 * 守「已经**删掉**的列不再被读」。
 *
 * 【当下的后果由**迁移**推出来,不是手写在这里的】
 * 这道门诞生时守「读了第二个真相源」;`20260813000000` 删掉那些列之后,
 * 读它 = PostgREST 42703 → 端点 500。**判据一个字没改,后果严重了一档。**
 * 所以报错信息里那句「后果」是 `consequence()` 按 `drop column` 算出来的 ——
 * 一份要人维护的注释,迟早与现实脱节。
 *
 * ⚠️ 也因此**不要**因为「列已经删了」就把这道门撤掉:
 * 那些列名在新表 `assessment_report_files` 里**依然存在**(同名),
 * 所以「写代码时习惯性写回 `.from('assessment_results').select('pdf_status')`」
 * 是一个仍然会发生、而且现在会 500 的错误。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么是门,而不是「记得别读」】
 *
 * 两组列已经有了新家,但旧列还在库里(删列不可逆,所以分两步):
 *   `assessment_results.pdf_* / share_card_*` → `assessment_report_files`(按语言分行)
 *   `assessment_sessions.locale`              → `assessment_entitlements.lang`(语言跟着人走)
 *
 * 关键那句是:**一列没人读就不构成第二个真相源;危险的是读它的人,不是列本身。**
 * 所以顺序是「门先立起来,列之后再删」—— 门在的那一刻,旧列就已经不是真相源了,
 * 而删列只是收拾残留。
 *
 * 【为什么不能只 grep 列名】新表 `assessment_report_files` 用的是**同名列**
 * (`pdf_status` / `pdf_path` / …),`locale` 在前端还是 i18n 的正当叫法。
 * 只按名字扫会把新写的正确代码全部报成违规 —— 而一道误报的门会让人开始习惯性忽略它,
 * 那正是它失效的方式。
 *
 * 所以判据是**表 + 列的组合**:找 `.from('<旧表>')`,再看它后面那段 `.select(...)`
 * 里有没有搬走的列名。窗口取到下一个 `.from(` 或空行块为止。
 *
 * 【豁免写在代码里,不写在这道门的白名单里】与 `check:ghl-transport` 同一条约定:
 * 白名单只有文件名,半年后没人知道某个文件当初为什么在里面。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 【这一列还在不在,从**迁移文件**推,不从数据库查】
 *
 * 一道门的价值会随代码变化而变化,而它自己不知道 ——
 * 这道门诞生时守的是「读了第二个真相源」(旧列还在,读它拿到的可能是过期数据);
 * `20260813000000` 把那些列删掉之后,读它 = PostgREST **42703 → 端点 500**。
 * 判据一个字没改,后果严重了一档。
 *
 * 上一版把这件事写成了**手写的注释** —— 而手写的东西要人维护,
 * 正是这个项目一路在拆的那一类。
 *
 * 【为什么不连库去查】
 *   ① 构建时没有库,这是 `check:rpc-contract`(仓库内部一致性)与部署 preflight
 *      (连得上库)分工的前提。给构建门加库依赖,要么 Vercel 构建拿不到凭证而红,
 *      要么连不上时 fail-open —— 后者正是 `--sloppy-imports` 的形状:
 *      一道在某些环境里不响的检查等于没有检查。
 *   ② **推出来的答案不改变这道门的动作** —— 两种情况都是拒绝,只有措辞不同。
 *      为一个字符串付一个库依赖,交换不划算。
 *
 * 而「这一列删没删」这件事**本来就在仓库里**:`drop column` 写在迁移文件中,
 * 而迁移是这个仓库里 schema 的真相源。所以推得出来,而且不用付上面两项代价。
 */
function droppedColumns() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const dropped = new Set();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return dropped; // 迁移目录都没有的话,按「列还在」处理(措辞轻,但动作不变)
  }
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/alter\s+table\s+(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      const table = m[1];
      for (const c of m[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi)) {
        dropped.add(`${table}.${c[1]}`);
      }
    }
  }
  return dropped;
}

const DROPPED = droppedColumns();

/** 旧表 → 已经搬走的列 */
const MOVED = [
  {
    table: 'assessment_results',
    columns: [
      'pdf_path',
      'pdf_status',
      'pdf_status_at',
      'pdf_attempts',
      'pdf_last_error',
      'share_card_path',
      'share_card_tall_path',
      'share_card_error',
    ],
    movedTo: 'assessment_report_files(session_id, lang)',
  },
  {
    table: 'assessment_sessions',
    columns: ['locale'],
    movedTo: 'assessment_entitlements.lang（语言跟着人走 —— PDF 异步渲染时没有链接可读）',
  },
];

const EXEMPT_MARKER = 'legacy-column-exempt:';
const MIN_REASON_LEN = 12;
const MARKER_LOOKBACK = 8;

const SCAN_DIRS = ['src', 'api', 'supabase/functions', 'scripts'];
const files = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p);
      } else if (/\.(ts|tsx|mjs)$/.test(e.name)) files.push(p);
    }
  };
  walk(abs);
}

/**
 * 这一次违规的**当下后果** —— 由迁移推出来,不是手写的。
 * 【为什么要说后果而不只是「别读」】下一个人看到的如果只有「这一列搬走了」,
 * 他可能觉得「那就先凑合读一下」;而「读它现在直接 500」是另一回事。
 */
function consequence(table, hits) {
  const gone = hits.filter((c) => DROPPED.has(`${table}.${c}`));
  if (gone.length === hits.length) {
    return `⚠️ 这些列**已经从库里删掉了**(见迁移里的 drop column)——` +
      `读它 = PostgREST 42703 → 端点 500,不是「读到过期数据」那么轻。`;
  }
  if (gone.length > 0) {
    return `⚠️ 其中 ${gone.join(', ')} **已经从库里删掉了** —— 读它会 42703 → 500;` +
      `其余的还在,读它是「第二真相源」。`;
  }
  return `旧列还在库里(删列不可逆,分两步走),但**读它的人**才是第二真相源。`;
}

const errors = [];
const accepted = [];

for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (rel === 'scripts/check-legacy-columns.mjs') continue; // 规则的载体,不是违规者

  const source = readFileSync(abs, 'utf8');
  const lines = source.split('\n');
  /**
   * 【扫之前先把注释挖空 —— 而这一步是被自己的误报逼出来的】
   * 第一版直接扫原文,于是这道门报了**它自己那几条解释性注释**:
   * 「不再写 `locale`,真相源已经搬到 …」这句话里就有 `locale` 这个词。
   *
   * 一道误报的门会让人开始习惯性忽略它,而那正是它失效的方式
   * (判断标准 1 推论二)。所以注释内容一律挖空,但**保留换行**,
   * 这样报出来的行号仍然对得上。
   */
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  /**
   * ── 规则二:**嵌套 select 里的表**(`alias:table(col, …)`)──
   *
   * 【为什么必须单独一条】规则一只看 `.from('<旧表>')` 之后那条查询的参数。
   * 而 PostgREST 的嵌套写法长这样:
   *
   *     .from('assessment_entitlements').select(`… session:assessment_sessions(
   *        result:assessment_results(total, tier, pdf_status, pdf_last_error) )`)
   *
   * 那也是**对旧表旧列的读**,但它不出现在任何 `.from('assessment_results')` 后面 ——
   * 于是规则一整个漏掉了它。名单页就是这么在门绿着的情况下一直读旧列的,
   * 而发现它的方式是**改那段代码时顺手看了一眼 select**,不是门报出来。
   *
   * 这正是[判断标准 12]那个形状:**覆盖范围是手写的守卫,会被代码悄悄长到边界外面** ——
   * 我写规则一时脑子里只有「顶层 select」这一种形状。
   */
  for (const m of text.matchAll(/(\w+)\s*:\s*(\w+)\s*\(/g)) {
    const moved = MOVED.find((x) => x.table === m[2]);
    if (!moved) continue;
    // 括号配平,取这个嵌套块自己的内容
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const inner = text.slice(m.index + m[0].length, i);
    const hits = moved.columns.filter((c) => new RegExp(`\\b${c}\\b`).test(inner));
    if (!hits.length) continue;
    const lineNo = text.slice(0, m.index).split('\n').length;
    let reason = null;
    for (let k = Math.max(0, lineNo - 1 - MARKER_LOOKBACK); k < lineNo; k++) {
      const at = lines[k].indexOf(EXEMPT_MARKER);
      if (at !== -1) reason = lines[k].slice(at + EXEMPT_MARKER.length).trim();
    }
    if (reason === null) {
      errors.push(
        `${rel}:${lineNo} 在**嵌套 select** \`${m[1]}:${m[2]}(…)\` 里读了已经搬走的列:${hits.join(', ')}\n` +
          `      新家:${moved.movedTo}\n` +
          `      ${consequence(m[2], hits)}`,
      );
    } else if (reason.length < MIN_REASON_LEN) {
      errors.push(`${rel}:${lineNo} 的豁免理由太短(“${reason}”)—— 至少 ${MIN_REASON_LEN} 个字符。`);
    } else {
      accepted.push(`${rel}:${lineNo} 嵌套 (${hits.join(', ')}) — ${reason}`);
    }
  }

  for (const { table, columns, movedTo } of MOVED) {
    const needle = `.from('${table}')`;
    let idx = 0;
    while ((idx = text.indexOf(needle, idx)) !== -1) {
      const start = idx + needle.length;
      /**
       * 【只看查询自己的参数,不看后面那一整段代码】
       * 第一版取「到下一个 `.from(` 为止的 1200 字符」当窗口,于是
       * `return { locale: effectiveLang(...) }` 这种**payload 键名**也被算成读列 ——
       * 那个 `locale` 是给前端的字段名,与 `assessment_sessions.locale` 无关。
       *
       * 收紧成:从这条 `.from()` 到语句结束(`;`)之间,**只取
       * select / insert / update / upsert 四个方法的参数**。列名只可能出现在那里面。
       */
      const stmtEnd = text.indexOf(';', start);
      const chain = text.slice(start, stmtEnd === -1 ? text.length : stmtEnd);
      let args = '';
      for (const m of chain.matchAll(/\.(select|insert|update|upsert)\(/g)) {
        // 括号配平,取这一次调用的完整参数
        let depth = 0;
        let i = m.index + m[0].length - 1;
        for (; i < chain.length; i++) {
          if (chain[i] === '(') depth += 1;
          else if (chain[i] === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        args += chain.slice(m.index, i + 1);
      }
      const window = args;

      const hits = columns.filter((c) => new RegExp(`\\b${c}\\b`).test(window));

      if (hits.length) {
        const lineNo = text.slice(0, idx).split('\n').length;
        let reason = null;
        for (let k = Math.max(0, lineNo - 1 - MARKER_LOOKBACK); k < lineNo; k++) {
          const at = lines[k].indexOf(EXEMPT_MARKER);
          if (at !== -1) reason = lines[k].slice(at + EXEMPT_MARKER.length).trim();
        }
        if (reason === null) {
          errors.push(
            `${rel}:${lineNo} 从 ${table} 读了已经搬走的列:${hits.join(', ')}\n` +
              `      新家:${movedTo}\n` +
              `      ${consequence(table, hits)}\n` +
              `      确实需要例外的话,在上方写一行理由:// ${EXEMPT_MARKER} <为什么这一处必须读旧列>`,
          );
        } else if (reason.length < MIN_REASON_LEN) {
          errors.push(`${rel}:${lineNo} 的豁免理由太短(“${reason}”)—— 至少 ${MIN_REASON_LEN} 个字符。`);
        } else {
          accepted.push(`${rel}:${lineNo} (${hits.join(', ')}) — ${reason}`);
        }
      }
      idx = start;
    }
  }
}

if (errors.length) {
  console.error(`[check-legacy-columns] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  console.error('  一列没人读就不构成第二个真相源 —— 门先立起来,列之后再删。');
  process.exit(1);
}

console.log(
  `[check-legacy-columns] OK —— ${MOVED.length} 组已搬走的列没有任何读点` +
    (accepted.length
      ? `;${accepted.length} 处带理由的豁免:\n${accepted.map((a) => `             ${a}`).join('\n')}`
      : '(无豁免)。'),
);
