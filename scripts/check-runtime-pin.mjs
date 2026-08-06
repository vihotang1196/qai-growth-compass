#!/usr/bin/env node
/**
 * 守「运行时版本被钉住,且与依赖运行时二进制的包相容」。
 *
 * 【为什么需要这道门 —— 这是本项目第一次纯外部环境漂移导致的失败】
 * 2026-07-31 字体探针实测通过;2026-08-06 同一份代码、同一个包版本失败,
 * 中间我们什么都没改 —— 变的是 Vercel 默认 Node 版本(升到 24.x),而
 * @sparticuz/chromium@131 打包的那批 .so 与 Node 24 的基础镜像 glibc/nss 层对不上。
 * 症状:libnss3.so cannot open shared object file。
 *
 * 前面所有 bug 都是我们自己引入的;这个是平台在我们不知情的情况下换了地基,
 * 而这次升级【没有任何一处会通知我们】。
 *
 * 所以规则:**任何依赖运行时二进制的东西,都不该让平台默认值决定。**
 * engines.node 钉住之后,升级变成一个我们主动做的动作,而不是某天早上突然发现的事故。
 *
 * 这道门断言两件事:
 *   1. package.json 有 engines.node(不留空 → 不吃平台默认值)
 *   2. 钉的版本落在 @sparticuz/chromium 自己声明的 engines.node 范围内
 *      —— 升 chromium 时若忘了同步 Node,这里会红
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const errors = [];

const pinned = pkg.engines?.node;
if (!pinned) {
  errors.push(
    'package.json 没有 engines.node —— 那意味着吃 Vercel 的默认版本,而它会在我们不知情时升级。' +
      '2026-08-06 就是这么坏的:同一份代码从通过变成 libnss3.so 缺失。钉一个,比如 "22.x"。',
  );
}

/**
 * 取一个 range 里各个「或」分支的【主版本号】。
 *
 * 【第一版是错的,而且是被「验它会不会红」抓出来的】原来抓所有数字:
 * ">=22.17.0 || >=24.0.0" → [22,17,0,24,0,0] → min 得 0,于是任何版本都判相容,
 * 门永远绿。一个绿着的门守着坏行为,比没有门更危险 —— 这次是门自己坏了。
 * 现在按 || 分段,每段只取第一个数字(那才是主版本)。
 */
const majorsOf = (range) =>
  String(range)
    .split('||')
    .map((part) => {
      const m = /(\d+)/.exec(part);
      return m ? Number(m[1]) : NaN;
    })
    .filter((n) => Number.isFinite(n));

let chromiumRange = null;
try {
  chromiumRange = JSON.parse(
    readFileSync(join(ROOT, 'node_modules/@sparticuz/chromium/package.json'), 'utf8'),
  ).engines?.node;
} catch {
  // 没装就不判(CI 里 install 之后才跑得到)
}

if (pinned && chromiumRange) {
  const pinnedMajor = majorsOf(pinned)[0];
  const allowed = majorsOf(chromiumRange);
  const min = Math.min(...allowed);
  // chromium 的范围形如 ">=20.11.0" 或 "^22.17.0 || >=24.0.0";只要钉的主版本 >= 其最小主版本即可
  if (!Number.isFinite(pinnedMajor) || pinnedMajor < min) {
    errors.push(
      `engines.node = "${pinned}"(主版本 ${pinnedMajor})低于 @sparticuz/chromium 要求的 ` +
        `"${chromiumRange}" —— 升 chromium 时要同步这里,否则函数起不来。`,
    );
  }
}

if (errors.length) {
  console.error(`[check-runtime-pin] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(
  `[check-runtime-pin] OK —— engines.node = "${pinned}"` +
    (chromiumRange ? `,@sparticuz/chromium 要求 "${chromiumRange}",相容。` : '(chromium 未装,跳过配对检查)'),
);
