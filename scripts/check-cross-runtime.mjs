#!/usr/bin/env node
/**
 * 跨运行时行为一致性检查。
 *
 * 在 Node 与 Deno 里各跑一次 scripts/dump-phone.ts,逐字对比输出。
 *
 * 【为什么这道检查独立存在】check:dep-sync 保证两边解析到同一个版本,
 * 两个测试套件保证两边都等于 cases 里的 expected —— 逻辑上已能推出两边相等。
 * 但那是推出来的,不是量出来的。这里把两边的真实输出摆在一起 diff:
 * 一旦哪天不一致,能直接看到差在哪一条、差成什么样,而不是一句 assertion failed。
 *
 * 这也是唯一能抓住「两边都错成一样以外的所有情况」的检查 ——
 * 号码元数据、Intl 行为、正则引擎差异都会在这里现形。
 */
import { spawnSync } from 'node:child_process';

const DUMP = 'scripts/dump-phone.ts';
const DENO_CONFIG = 'supabase/functions/deno.json';

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') {
    console.error(`[check-cross] ${label}: 找不到 ${cmd}。`);
    if (cmd === 'deno') console.error('  Deno 未安装 —— brew install deno');
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`[check-cross] ${label} 退出码 ${r.status}:`);
    console.error(r.stderr.trim() || r.stdout.trim());
    process.exit(1);
  }
  return r.stdout.trimEnd().split('\n');
}

const node = run('node', 'node', [DUMP]);
const deno = run('deno', 'deno', ['run', '--allow-read', '--config', DENO_CONFIG, DUMP]);

for (const [label, lines] of [['Node', node], ['Deno', deno]]) {
  if (lines.filter((l) => l.trim()).length === 0) {
    console.error(`[check-cross] ${label} 侧没有任何输出 —— dump 脚本大概坏了,不当作通过。`);
    process.exit(1);
  }
}

const diffs = [];
const max = Math.max(node.length, deno.length);
for (let i = 0; i < max; i++) {
  if (node[i] !== deno[i]) {
    diffs.push({ line: i + 1, node: node[i] ?? '(缺行)', deno: deno[i] ?? '(缺行)' });
  }
}

if (diffs.length) {
  console.error(
    `[check-cross] FAILED —— ${diffs.length} / ${max} 行不一致。` +
      '同一份 phone.ts 在两个运行时给出了不同结果:',
  );
  for (const d of diffs) {
    console.error(`  第 ${d.line} 行`);
    console.error(`    node: ${d.node}`);
    console.error(`    deno: ${d.deno}`);
  }
  console.error(
    '\nwebhook 入库与登录查询分别跑在这两个运行时上。' +
      '结果不一致意味着号码存进去和查出来对不上,而代码看起来完全一致。',
  );
  process.exit(1);
}

console.log(`[check-cross] OK —— Node 与 Deno 的 ${max} 行输出逐字相同。`);
