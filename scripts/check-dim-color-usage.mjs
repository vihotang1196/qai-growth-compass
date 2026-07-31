#!/usr/bin/env node
/**
 * 维度色用途检查(PROGRESS.md C1)。
 *
 * 六个维度色只能作为【带 2px 墨边框的填充】出现:
 *   ✅ background / background-color / SVG fill  →  bg-dim-* / fill-dim-*
 *   ❌ 文字色、边框色、描边、细线、小圆点
 *
 * 这条规则的成立前提是每个元素都有 2px 墨边框 —— 边框是色块与背景之间的
 * 分界,所以色块自己不必对黄底扛 3:1。一旦维度色跑去当文字色或无边框描边,
 * 这个前提就没了,对比度直接不合格。
 *
 * 所以这不是风格偏好,是可访问性约束,必须由构建强制。
 *
 * 【本脚本【不】检查「维度色填充里有没有正文」】
 * 那条规则同样是硬规则(见 brutalist.css),但 JSX 的 className 常常是模板
 * 字符串或 cn() 调用,静态检查只能覆盖一部分写法。一个有盲区的守卫比没有
 * 守卫更糟 —— 它让人以为这条已经被守住了。这条只写在注释里,靠 review 把关。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOTS = ['src'];
const EXTS = new Set(['.ts', '.tsx', '.css']);

/** [正则, 说明] —— 命中即失败 */
const FORBIDDEN = [
  [/\btext-dim-[a-z]+/g, 'text-dim-* 把维度色用作文字色'],
  [/\bborder-dim-[a-z]+/g, 'border-dim-* 把维度色用作边框色'],
  [/\bstroke-dim-[a-z]+/g, 'stroke-dim-* 把维度色用作描边'],
  [/\b(ring|outline|decoration|divide|caret|accent|shadow|placeholder)-dim-[a-z]+/g,
    '维度色只能做填充,不能用于该属性'],
  [/(^|[^-\w])color\s*:\s*var\(--dim-/gm, 'CSS color 用了维度色变量'],
  [/border(-[a-z]+)?-color\s*:\s*var\(--dim-/gm, 'CSS border-color 用了维度色变量'],
  [/(^|[^-\w])stroke\s*:\s*var\(--dim-/gm, 'CSS stroke 用了维度色变量'],
  [/outline(-color)?\s*:\s*var\(--dim-/gm, 'CSS outline 用了维度色变量'],
  // 字面色值:维度色必须走 token,不许直接写死
  [/#(1e5fa8|12897e|499c3e|6b46a8|ba801a|c94f4f)\b/gi, '维度色写成了字面色值,必须用 --dim-* token'],
];

/** 这些文件本身就是规则的定义处或说明处,豁免 */
const EXEMPT = [/src[/\\]styles[/\\]brutalist\.css$/];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (EXEMPT.some((re) => re.test(file))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [re, why] of FORBIDDEN) {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m) hits.push({ file, line: i + 1, match: m[0].trim(), why });
      }
    });
  }
}

if (hits.length) {
  console.error('[check-dim] FAILED — 维度色被用在了填充之外的地方:');
  for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.match}  ←  ${h.why}`);
  console.error('\n维度色只能作为带 2px 墨边框的填充(bg-dim-* / fill-dim-*)。');
  console.error('见 src/styles/brutalist.css 里 --dim-* 的注释与 PROGRESS.md C1。');
  process.exit(1);
}

console.log('[check-dim] OK — 维度色仅用于填充。');
