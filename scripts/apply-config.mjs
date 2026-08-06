#!/usr/bin/env node
/**
 * 把一份新的 assessment-config.json 落盘并立刻校验。
 *
 * 【为什么要这个脚本】config 下载到本地这条路已经失败三次(浏览器下载 / 编辑器写盘
 * 都不可靠),每次都得手对路径、手确认版本号,而且中间出过「以为覆盖了其实没落地」——
 * 那一次如果没先读文件就开工,会对着旧 config 改断言而毫无察觉。
 *
 * 所以固定成一条通路:JSON 进来 → 备份旧的 → 校验 → 只有校验通过才落盘。
 *
 * 用法:
 *   node scripts/apply-config.mjs <新文件路径>     从文件读
 *   pbpaste | node scripts/apply-config.mjs -      从剪贴板读
 *   node scripts/apply-config.mjs --check          只校验当前 config，不写
 *
 * 【校验不通过就不落盘】这是刻意的:一份坏 config 落盘之后，
 * 所有测试会一起红，而排查方向会被引到测试上，而不是引到 config 上。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'src/config/assessment-config.json');

/**
 * 校验规则 —— 与 src/lib/quizFlow.test.ts 里那批断言同源。
 *
 * 【为什么这里也写一遍而不是只靠 vitest】这个脚本要在【落盘之前】判断，
 * 而 vitest 只能测已经在磁盘上的文件。顺序反了就失去了「不落盘」的保护。
 * 两处规则分叉的风险由最后一条自检兜住:落盘后脚本会提示跑 npm test。
 */
function validate(c) {
  const errors = [];
  const okList = [];
  const chk = (cond, label) => {
    if (cond) okList.push(label);
    else errors.push(label);
  };

  chk(typeof c?.meta?.version === 'string', 'meta.version 存在');
  const dims = c.dimensions ?? [];
  const dimKeys = dims.map((d) => d.key);
  const questions = c.questions ?? [];

  // 题数与维度数从 meta 读，不写死 —— 以后再改维度数这个脚本不用动
  const expectQ = c.meta?.question_count;
  const expectD = c.meta?.dimension_count;
  const perDim = c.meta?.questions_per_dimension;
  chk(questions.length === expectQ, `questions 数量 = meta.question_count (${questions.length} vs ${expectQ})`);
  chk(dims.length === expectD, `dimensions 数量 = meta.dimension_count (${dims.length} vs ${expectD})`);

  const counts = {};
  for (const q of questions) counts[q.dimension] = (counts[q.dimension] ?? 0) + 1;
  chk(
    dimKeys.every((k) => counts[k] === perDim),
    `每维恰好 ${perDim} 题 (${JSON.stringify(counts)})`,
  );
  // 反向：一道题挂到打错的维度上，正向断言拦不住
  chk(
    JSON.stringify([...new Set(questions.map((q) => q.dimension))].sort()) ===
      JSON.stringify([...dimKeys].sort()),
    'questions 的 dimension 集合 == dimensions 的 key 集合',
  );

  /**
   * v3：固定分母作废。每题 option_count 为 3 或 4,且必须与实际选项数组长度一致 ——
   * 计分按 option_count 归一化,长度对不上会让归一化的分母错,分数静默偏。
   */
  chk(
    questions.every((q) => q.option_count === q.zh?.options?.length),
    'option_count == zh.options 长度(每题)',
  );
  chk(
    questions.every((q) => q.zh?.options?.length === q.en?.options?.length),
    '每题两语言选项数一致',
  );
  chk(
    questions.every((q) => q.option_count >= 2),
    'option_count >= 2(归一化分母 option_count-1 不能为 0)',
  );

  /**
   * v3:每维 3 个子模块下标 0/1/2 各一道,没有 maturity 题(submodule_index 全非 null)。
   */
  for (const d of dims) {
    const mine = questions.filter((q) => q.dimension === d.key);
    const sub = mine.map((q) => q.submodule_index).sort((a, b) => a - b);
    const expected = d.submodules_zh.map((_, i) => i);
    chk(
      JSON.stringify(sub) === JSON.stringify(expected) && mine.every((q) => q.submodule_index !== null),
      `${d.key}: 子模块下标 [${expected.join(',')}] 各一道,无 maturity`,
    );
    chk(d.submodules_zh.length === d.submodules_en.length, `${d.key}: 两语言子模块数一致`);
  }

  // v3 不变量:题数 == 所有维度 submodules 长度之和(15 个三级项一一对应)
  const submoduleTotal = dims.reduce((n, d) => n + d.submodules_zh.length, 0);
  chk(
    questions.length === submoduleTotal,
    `题数 == 所有维度 submodules 长度之和 (${questions.length} vs ${submoduleTotal})`,
  );

  const qids = questions.map((q) => q.id);
  chk(new Set(qids).size === qids.length, '题 id 唯一');

  // S1 的 option_to_dimension 顺序 == dimensions 的 order
  const orderKeys = [...dims].sort((a, b) => a.order - b.order).map((d) => d.key);
  const s1 = (c.survey_questions ?? []).find((s) => s.id === 'S1');
  chk(
    JSON.stringify(s1?.option_to_dimension) === JSON.stringify(orderKeys),
    'S1 的 option_to_dimension == dimensions 的 order 顺序',
  );

  // tiers 在一位小数刻度上无缝无重叠覆盖 0.0–scale
  const scale = c.meta?.score_scale ?? 5;
  const covered = new Set();
  let overlap = false;
  for (const t of c.tiers ?? []) {
    for (let x = Math.round(t.min * 10); x <= Math.round(t.max * 10); x++) {
      if (covered.has(x)) overlap = true;
      covered.add(x);
    }
  }
  chk(!overlap, 'tiers 无重叠');
  const gaps = [];
  for (let x = 0; x <= scale * 10; x++) if (!covered.has(x)) gaps.push((x / 10).toFixed(1));
  chk(gaps.length === 0, `tiers 无缝覆盖 0.0–${scale.toFixed(1)}${gaps.length ? ' 缺:' + gaps.join(',') : ''}`);

  // 交叉引用：改一处忘另一处的地方，失败形态都是静默的
  const cf = c.ghl_writeback?.custom_fields ?? [];
  const byKey = (k) => cf.find((f) => f.key === k);
  const tierKeys = (c.tiers ?? []).map((t) => t.key);
  chk(
    JSON.stringify([...(byKey('qai_assessment_tier')?.domain ?? [])].sort()) ===
      JSON.stringify([...tierKeys].sort()),
    'ghl tier domain == tiers 的 key 集合',
  );
  for (const k of ['qai_assessment_weakest_1', 'qai_assessment_weakest_2', 'qai_assessment_priority']) {
    chk(
      JSON.stringify([...(byKey(k)?.domain ?? [])].sort()) === JSON.stringify([...dimKeys].sort()),
      `ghl ${k} domain == dimensions 的 key 集合`,
    );
  }
  chk(
    (c.cost_model?.rules ?? []).every((r) => dimKeys.includes(r.dimension)),
    'cost_model 的维度都在维度表内',
  );
  chk(
    dimKeys.every((k) => c.offer_routing?.[k]),
    'offer_routing 覆盖全部维度',
  );
  const products = Object.keys(c.offer_routing?.products ?? {});
  chk(
    dimKeys.every((k) => products.includes(c.offer_routing?.[k]?.product)),
    'offer_routing 引用的 product 都已定义',
  );
  chk(
    dimKeys.every((k) => {
      const a = c.action_library?.[k];
      return a && Array.isArray(a.actions) && a.actions.length > 0 && a.root_cause?.low && a.root_cause?.mid && a.root_cause?.high;
    }),
    'action_library 每维都有动作 + low/mid/high 三档 root_cause',
  );

  // related_question 必须指向真实题目(或 null)——指向不存在的题会让报告的「现在→目标」
  // 对比行取不到选项文案,静默渲染成空
  const qidSet = new Set(questions.map((q) => q.id));
  const badRel = [];
  for (const [dim, block] of Object.entries(c.action_library ?? {})) {
    if (dim === '_note') continue;
    for (const a of block.actions ?? []) {
      if (!('related_question' in a)) badRel.push(`${a.id}: 缺 related_question`);
      else if (a.related_question !== null && !qidSet.has(a.related_question)) {
        badRel.push(`${a.id} → ${a.related_question}`);
      }
    }
  }
  chk(badRel.length === 0, `action_library 的 related_question 都指向真实题目或 null${badRel.length ? ' 问题:' + badRel.join(', ') : ''}`);

  return { errors, okList };
}

// ── 入口 ────────────────────────────────────────────────────
const arg = process.argv[2];
if (!arg) {
  console.error('用法: node scripts/apply-config.mjs <文件路径> | - | --check');
  process.exit(2);
}

const checkOnly = arg === '--check';
let raw;
if (checkOnly) {
  raw = readFileSync(TARGET, 'utf8');
} else if (arg === '-') {
  raw = readFileSync(0, 'utf8'); // stdin
} else {
  raw = readFileSync(arg, 'utf8');
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`[apply-config] JSON 解析失败，未落盘：${err.message}`);
  process.exit(1);
}

const { errors, okList } = validate(parsed);
for (const o of okList) console.log(`  ✓ ${o}`);
if (errors.length) {
  console.error(`\n[apply-config] 校验失败 ${errors.length} 条，${checkOnly ? '' : '未落盘'}：`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(`\n[apply-config] 当前 config (v${parsed.meta.version}) 校验通过，共 ${okList.length} 条。`);
  process.exit(0);
}

// 备份旧的再写 —— 覆盖之前先留一份，改错了能对比
if (existsSync(TARGET)) {
  const old = JSON.parse(readFileSync(TARGET, 'utf8'));
  const backup = `${TARGET}.v${old.meta?.version ?? 'unknown'}.bak`;
  copyFileSync(TARGET, backup);
  console.log(`\n  旧版 v${old.meta?.version} 已备份到 ${backup.replace(ROOT + '/', '')}`);
}

// 统一格式：2 空格缩进 + 末尾换行，避免每次贴进来的格式差异污染 diff
writeFileSync(TARGET, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
console.log(`[apply-config] v${parsed.meta.version} 已落盘，校验通过 ${okList.length} 条。`);
console.log('  下一步：npm run verify（断言若因结构变化而红，那正是它们该做的事）');
