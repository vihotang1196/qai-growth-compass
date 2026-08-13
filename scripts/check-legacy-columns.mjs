#!/usr/bin/env node
/**
 * 守「已经搬走的列不再被读」。
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
              `      旧列还在库里(删列不可逆,分两步走),但**读它的人**才是第二真相源。\n` +
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
