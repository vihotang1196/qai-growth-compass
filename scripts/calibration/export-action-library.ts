/**
 * 课后校准 ⑤ —— 把 action_library 的全部文案(中英)导出成便于审阅的两份文件:
 *
 *   docs/review/action-library-review.md   按维度排好、一条一个勾选框,适合通读
 *   docs/review/action-library-review.csv  一行一条,带「语气要改吗 / 改成」两列空栏,适合在 Excel / Numbers 里逐条标
 *
 *   npm run calib:actions
 *
 * 不读数据库。**真相源仍是 src/config/assessment-config.json** —— 这两份是快照,文件头写着 config 版本与
 * action_library 内容的指纹;改了文案(`npm run config:apply`)之后重跑一次,指纹会变。
 * 审阅结果不要写回这两份文件当真相 —— 定下来的改动改进 config。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './lib.ts';

const LIB = config.action_library as unknown as Record<string, unknown> & { _note: string };
const fingerprint = createHash('sha256').update(JSON.stringify(LIB)).digest('hex').slice(0, 12);
const DIFF: Record<string, string> = { low: '低', medium: '中', high: '高' };
const BANDS = [
  { key: 'low', zh: 'low(该维 < 2.0)' },
  { key: 'mid', zh: 'mid(2.0–3.5)' },
  { key: 'high', zh: 'high(> 3.5)' },
] as const;

interface Action {
  id: string;
  zh: string;
  en?: string;
  difficulty: string;
  impact: string;
  roi_rank: number;
  applies_below: number;
  related_question: string | null;
}
interface Entry {
  root_cause: Record<string, string>;
  actions: Action[];
}

const NO_EN = '(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)';
const md: string[] = [];
const csv: string[][] = [['编号', '维度', '类型', '档位 / 排序', '条件', '中文', 'English', '语气要改吗(留空 = 不用改)', '改成 / 意见']];

md.push(
  '# action_library 文案审阅稿',
  '',
  `> 生成自 \`src/config/assessment-config.json\`(config ${config.meta.version},action_library 指纹 \`${fingerprint}\`),${new Date().toISOString().slice(0, 10)}。`,
  '> **这是快照,不是真相源。** 改文案改 config(`npm run config:apply`),然后 `npm run calib:actions` 重新生成这份。',
  '> 同目录的 `action-library-review.csv` 是同样的内容,一行一条,方便在表格里逐条标。',
  '',
  '**这些文案出现在哪**:',
  '- **根因**(每维三档,按该维得分取一档)→ 报告「最该先补的两环」板块,只给最弱的两维显示',
  '- **30 天行动**(每维 5 条)→ 报告「接下来 30 天做这 3 件」板块:从最弱两维里挑「该维得分 < 适用上限」的,按排序取前 3 条;',
  '  有「对应题」的那条会显示「现在:你选的选项 → 目标:那题的最高一档」',
  '',
  '**怎么标**:读的时候问一句「这像不像我会对学员说的话」。不对的,在那一条的 `[ ]` 里打 x,后面写改成什么(或者只写哪里不对)。',
  '',
  `内部说明(不渲染给学员):${LIB._note}`,
  '',
);

for (const d of config.dimensions) {
  const e = (LIB as unknown as Record<string, Entry>)[d.key];
  if (!e) continue;
  md.push(`## ${d.zh}(${d.en} · \`${d.key}\`)`, '', '### 根因', '');
  for (const b of BANDS) {
    const zh = e.root_cause[b.key] ?? '(缺)';
    md.push(`- **${d.key}.root_cause.${b.key}** · ${b.zh}`, `  - 中文:${zh}`, `  - English:${NO_EN}`, '  - [ ] 语气要改 —— 改成 / 意见:', '');
    csv.push([`${d.key}.root_cause.${b.key}`, d.zh, '根因', b.key, b.zh, zh, '', '', '']);
  }
  md.push('### 30 天行动', '');
  for (const a of [...e.actions].sort((x, y) => x.roi_rank - y.roi_rank)) {
    const cond = `该维 < ${a.applies_below} 时可选`;
    const meta = `排序 ${a.roi_rank} · 难度 ${DIFF[a.difficulty] ?? a.difficulty} · 影响 ${DIFF[a.impact] ?? a.impact} · ${cond} · 对应题 ${a.related_question ?? '无(不显示前后对比)'}`;
    md.push(`- **${a.id}** · ${meta}`, `  - 中文:${a.zh}`, `  - English:${a.en ?? NO_EN}`, '  - [ ] 语气要改 —— 改成 / 意见:', '');
    csv.push([a.id, d.zh, '行动', `排序 ${a.roi_rank}`, `${cond};难度 ${DIFF[a.difficulty] ?? a.difficulty} / 影响 ${DIFF[a.impact] ?? a.impact};对应题 ${a.related_question ?? '无'}`, a.zh, a.en ?? '', '', '']);
  }
}

const OUT = join(ROOT, 'docs', 'review');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'action-library-review.md'), md.join('\n'));
// UTF-8 BOM:Excel 靠它认出 UTF-8,否则中文是乱码(与 supabase/functions/_shared/csv.ts 同一条理由)
const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
writeFileSync(join(OUT, 'action-library-review.csv'), '﻿' + csv.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');

const actions = csv.filter((r) => r[2] === '行动').length;
const roots = csv.filter((r) => r[2] === '根因').length;
console.log(`action_library 审阅稿:根因 ${roots} 条(只有中文)+ 行动 ${actions} 条(中英)→ docs/review/action-library-review.md / .csv(指纹 ${fingerprint})`);
