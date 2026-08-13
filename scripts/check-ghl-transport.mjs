#!/usr/bin/env node
/**
 * 守「所有 GHL 出站调用都经过唯一那个出口」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么这道门比那个函数本身重要】
 *
 * 测试批次的收口原本装在 `syncToGhl` 里,而那个函数是**字段写回专用**。
 * 注释里写着「将来 Stage 11 的 tags 一写出来就自动被覆盖」—— 那句话从来不成立:
 * 标签必然是另一条出站路径,**而新写一条出站路径,什么都不做就绕过了收口**。
 *
 * 这是这个项目遇到的第一种「绕过方式是缺席」的形状。前面所有收口都是翻转默认
 * (`PublicShell` 让新路由默认不带 chrome、批次范围做成必填参数),
 * 那些都要求新代码**主动做点什么**才会出错。这次不同,所以:
 * **函数只是给人一条正确的路,这道门才是让错的路走不通。**
 *
 * 【豁免的理由写在代码里,不写在这道门的白名单里】
 * 白名单只有文件名,半年后没人知道某个文件当初为什么在里面 ——
 * 于是要么不敢删、要么随手删(与 `check:env` 的豁免同一条理由)。
 * 所以豁免的写法是在**那一行的上方**放一条标记:
 *
 *     // ghl-transport-exempt: 位置级元数据(字段定义),不带任何客户数据
 *
 * 这道门把理由**打印出来**,所以它必须是句人话:少于 12 个字符的理由不接受。
 *
 * 【连常量一起守】只禁域名字面量是不够的:把 `GHL_API_HOST` 导进去拼 URL
 * 一样能绕过,而且看起来更正当。所以那个符号名在出口之外出现同样要豁免。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 唯一允许直接碰 GHL 传输的文件 */
const TRANSPORT = 'supabase/functions/_shared/ghlContact.ts';

/** 被守的两样东西:域名字面量,以及导出的主机常量 */
const PATTERNS = [
  { needle: 'services.leadconnectorhq.com', label: 'GHL 域名' },
  { needle: 'GHL_API_HOST', label: 'GHL_API_HOST 常量' },
];

const EXEMPT_MARKER = 'ghl-transport-exempt:';
const MIN_REASON_LEN = 12;
/** 标记允许写在命中行的上方几行内(留给多行注释块) */
const MARKER_LOOKBACK = 6;

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
      } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) files.push(p);
    }
  };
  walk(abs);
}

const errors = [];
const accepted = [];

for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (rel === TRANSPORT) continue;
  // 这道门自己会提到那两个名字 —— 它是规则的载体,不是违规者
  if (rel === 'scripts/check-ghl-transport.mjs') continue;

  const lines = readFileSync(abs, 'utf8').split('\n');
  for (const [i, line] of lines.entries()) {
    for (const { needle, label } of PATTERNS) {
      if (!line.includes(needle)) continue;
      // 命中行本身是豁免标记的话不算命中(标记里可以提到那个名字)
      if (line.includes(EXEMPT_MARKER)) continue;

      let reason = null;
      for (let k = Math.max(0, i - MARKER_LOOKBACK); k < i; k++) {
        const at = lines[k].indexOf(EXEMPT_MARKER);
        if (at !== -1) reason = lines[k].slice(at + EXEMPT_MARKER.length).trim();
      }
      if (reason === null) {
        errors.push(
          `${rel}:${i + 1} 直接用了${label} —— 所有 contact 级 GHL 调用必须经 ${TRANSPORT}。\n` +
            `      绕过它就绕过了测试批次收口,而绕过的方式是「什么都不做」。\n` +
            `      确实需要例外的话,在上方写一行理由:// ${EXEMPT_MARKER} <为什么这一处安全>`,
        );
      } else if (reason.length < MIN_REASON_LEN) {
        errors.push(
          `${rel}:${i + 1} 的豁免理由太短(“${reason}”)—— 至少 ${MIN_REASON_LEN} 个字符。\n` +
            `      理由是给半年后的人读的:只有名字的白名单会让人既不敢删也不敢留。`,
        );
      } else {
        accepted.push(`${rel}:${i + 1} — ${reason}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`[check-ghl-transport] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  console.error('  给假 contact 打标签会污染 GHL 的【全局】标签选择器,比清一条失败记录难得多。');
  process.exit(1);
}

console.log(
  `[check-ghl-transport] OK —— GHL 出站只经 ${TRANSPORT};` +
    (accepted.length
      ? `\n           ${accepted.length} 处带理由的豁免:\n${accepted.map((a) => `             ${a}`).join('\n')}`
      : '无豁免。'),
);
