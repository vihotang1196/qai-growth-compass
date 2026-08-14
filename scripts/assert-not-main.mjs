#!/usr/bin/env node
/**
 * 「不许在 main 上直接提交」的判定 —— **抽成脚本是为了能直接测两个方向**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要有它:同一个错误四次,而第四次是「检查跑了但没拦」】
 * 前三次是没检查。第四次我把 `git status -sb` 与编辑用 `&&` 串在一条命令里 ——
 * 它打印了 `## main...origin/main`,而**编辑照常执行**。
 *
 * 那与 `grep … && commit` 那次同族:**一个只输出、不改变控制流的检查,
 * 和没有检查的差别只在于人有没有认真看那一行。**
 *
 * 【为什么放过合并提交】这个仓库的工作方式就是「把分支合进 main」,
 * 而带冲突的合并要 `git commit` 收尾。一律拒绝会把正常工作流也拦掉,
 * 而**一道拦住正常操作的门会被关掉**。
 *
 * 【为什么参数可注入】钩子跑的时候 HEAD 就是那个待判的分支,没法「假装在 main 上」——
 * 而一道没验过红路径的门就是上一条教训本身
 * (判断标准 1 推论六:变异证明会红,真实运行证明会绿,两个方向都要)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export function verdict({ branch, merging }) {
  if (branch !== 'main') return { ok: true, reason: `在 ${branch} 上,放行` };
  if (merging) return { ok: true, reason: '这是一次合并提交(MERGE_HEAD 存在),放行' };
  return { ok: false };
}

const argBranch = process.argv[2];
const argMerging = process.argv[3] === 'merging';
let branch = argBranch;
let merging = argMerging;
if (!argBranch) {
  try {
    branch = execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    branch = 'detached';
  }
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
  merging = existsSync(`${gitDir}/MERGE_HEAD`);
}

const v = verdict({ branch, merging });
if (!v.ok) {
  console.error('✗ 拒绝在 main 上直接提交(合并提交除外)。');
  console.error('  先切分支:git checkout -b <name> —— 未提交的改动会跟着过去。');
  console.error('  确实要在 main 上提交:git commit --no-verify');
  process.exit(1);
}
console.log(`[assert-not-main] OK —— ${v.reason}`);
