#!/usr/bin/env node
/**
 * 守「config 里每个 `zh*` 字段都有对应的 `en*`」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么必须从「应该有哪些」那一侧列举】
 *
 * 这道门的成因:英文 PDF 第 5 页出现了一行中文 CTA ——
 * `offer_routing` 的五条只有 `zh_cta`,**没有 `en_cta`**。
 *
 * 而「grep en 找漏的」是找不到它的:**那个字段根本不存在,所以搜 en 搜不到它。**
 * 遍历已有的条目只能看见「已有的」;缺失的那些只有从
 * **「按规则应该存在哪些」**那一侧列举才会现形。
 *
 * (与 `check:legacy-columns` 同一个取向:按机器判据扫,而不是按记忆搜。
 * 那次是 9 处读点,这次是若干个缺失的 en 字段。)
 *
 * 判据:递归走整棵 config,凡是见到 `zh` 或 `zh_xxx` 这样的键,
 * 就要求同一个对象里有对应的 `en` / `en_xxx`。反方向同样拦(有 en 没 zh)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'src/config/assessment-config.json';
const config = JSON.parse(readFileSync(join(ROOT, CONFIG), 'utf8'));

const problems = [];
const exempted = [];
let pairsChecked = 0;

/**
 * 【豁免写在 config 里,不写在这道门的白名单里】
 *
 * `"zh_note": "…"` 旁边放 `"zh_note_i18n": "internal —— 为什么不需要 en"`。
 * 理由**在数据旁边**:白名单在门里,改那一行的人看不到;兄弟键在 config 里,
 * 谁改那一行谁就看见(与 `check:ghl-transport` 的豁免同一条约定)。
 *
 * 门把接受的理由**打印出来** —— 一个每次构建都念一遍的豁免,至少还在视野里。
 */
const EXEMPT_SUFFIX = '_i18n';
const MIN_REASON_LEN = 8;

/**
 * `zh` → `en`;`zh_cta` → `en_cta`(前缀之后的部分逐字保留)。
 *
 * ⚠️ **第一版这里是两个链式 `replace`,而它们互相抵消**:
 * `'zh_cta'.replace(/^zh(?=_)/,'en')` → `'en_cta'`,紧接着
 * `.replace(/^en(?=_)/,'zh')` → **又变回 `'zh_cta'`**。
 * 于是 `counterpart('zh_cta') === 'zh_cta'`,而那个键当然「存在」——
 * **这道门本来会永远漏掉那个促成它诞生的字段。**
 *
 * 它被发现只因为我手上有一个**独立的预期答案**(那个英文 PDF 里的中文 CTA):
 * 门报了 9 处、而其中没有 offer_routing,两者对不上。
 * 没有那个已知答案的话,「OK」看起来完全正常。
 */
const counterpart = (key) => {
  if (key === 'zh') return 'en';
  if (key === 'en') return 'zh';
  if (key.startsWith('zh_')) return `en_${key.slice(3)}`;
  return `zh_${key.slice(3)}`;
};
const isLangKey = (key) => key === 'zh' || key === 'en' || /^(zh|en)_/.test(key);

function walk(node, path) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;

  for (const key of Object.keys(node)) {
    if (isLangKey(key) && !key.endsWith(EXEMPT_SUFFIX)) {
      const other = counterpart(key);
      const exemptKey = `${key}${EXEMPT_SUFFIX}`;
      const reason = typeof node[exemptKey] === 'string' ? node[exemptKey].trim() : null;
      if (reason !== null) {
        if (reason.length < MIN_REASON_LEN) {
          problems.push(`${path}.${exemptKey} 的理由太短(“${reason}”)—— 至少 ${MIN_REASON_LEN} 个字符`);
        } else {
          exempted.push(`${path}.${key} — ${reason}`);
        }
      } else if (!(other in node)) {
        problems.push(
          `${path}: 有 \`${key}\` 但**没有** \`${other}\`` +
            `(内部说明不需要 en 的话,放一个 \`${exemptKey}\` 兄弟键写明理由)`,
        );
      } else {
        pairsChecked += 1;
      }
    }
    walk(node[key], `${path}.${key}`);
  }
}

walk(config, 'config');

if (problems.length) {
  console.error(`[check-i18n-parity] FAILED —— ${problems.length} 处单语字段:`);
  // 同一条会被 zh/en 两侧各报一次,去重后更好读
  for (const p of [...new Set(problems)]) console.error(`  ✗ ${p}`);
  console.error('');
  console.error('  Stage 12 要出英文全量版。一个只有 zh 的字段不是「漏翻」——');
  console.error('  是**结构上没有 en 的位置**,而那种缺口 grep en 找不到:那个键根本不存在。');
  process.exit(1);
}
console.log(
  `[check-i18n-parity] OK —— ${CONFIG} 里 ${pairsChecked / 2} 对 zh/en 字段齐全` +
    `(按「应该有哪些」列举,不是按已有的搜)` +
    (exempted.length
      ? `;${exempted.length} 处带理由的豁免:\n${[...new Set(exempted)].map((e) => `             ${e}`).join('\n')}`
      : '(无豁免)') +
    '。',
);
