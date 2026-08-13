/**
 * 打印「去 GHL 后台建这些标签」的清单 —— **由 config 推导,不手抄**。
 *
 * 用法(Deno,因为 `tagUniverse` 与 Edge Function 共用一份实现):
 *   npm run tags:list
 *
 * 【为什么要有这个命令】这份清单原本手写在 PROGRESS 里,而它已经漂过一次:
 * 写着「`assessment_weak_*` 六个,共 15 个」,而维度只有 5 个、实际 14 个;
 * 阈值那两个数也还是 0–100 分制时代的。**而这份清单正是照着去建标签、
 * 配 workflow 条件的那一份** —— 照错的建,症状是 workflow 永远不触发,
 * 或者触发在错的人身上。
 *
 * 手抄一遍就会再漂一次,所以直接输出可以照着建的东西。
 */
import { tagUniverse } from '../supabase/functions/_shared/ghlTags.ts';
import config from '../src/config/assessment-config.json' with { type: 'json' };

const universe = tagUniverse();
const conditional = new Map(config.ghl_writeback.tags_conditional.map((c) => [c.tag, c]));

console.log(`GHL 标签清单 —— 共 ${universe.length} 个(由 config 推导)\n`);

const groups: [string, (t: string) => boolean][] = [
  ['每次完成都打', (t) => t === 'assessment_completed'],
  [`档位(tiers[].key,${config.tiers.length} 个 —— 互斥,重算时旧的会被移除)`, (t) => t.startsWith('assessment_tier_')],
  [`最弱环节(dimensions[].key,${config.dimensions.length} 个 —— 互斥,同上)`, (t) => t.startsWith('assessment_weak_')],
  ['有条件', (t) => conditional.has(t)],
];

for (const [title, match] of groups) {
  const list = universe.filter(match);
  if (!list.length) continue;
  console.log(`【${title}】`);
  for (const tag of list) {
    const c = conditional.get(tag);
    console.log(`  ${tag}${c ? `\n      条件:${c.when}${c.note ? `(${c.note})` : ''}` : ''}`);
  }
  console.log('');
}

const covered = groups.reduce((n, [, m]) => n + universe.filter(m).length, 0);
if (covered !== universe.length) {
  // 分组没覆盖全 → 这份清单会少列几个,而少列的后果是 GHL 里少建几个标签
  console.error(`⚠️ 分组只覆盖了 ${covered}/${universe.length} 个标签,以下没被归入任何一组:`);
  for (const t of universe.filter((t) => !groups.some(([, m]) => m(t)))) console.error(`   ${t}`);
  Deno.exit(1);
}
console.log('注:允许 API 自动创建标签的话,只需先建有条件那几个;否则全部建出来。');
