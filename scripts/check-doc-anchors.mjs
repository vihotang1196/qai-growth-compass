#!/usr/bin/env node
/**
 * 文档内部锚点检查 —— PROGRESS.md 是唯一真相源,它的目录不能骗人。
 *
 * 【为什么值得一道门】PROGRESS.md 现在有 30+ 条内部链接,而交接必读四节全靠它们导航。
 * 一个断锚不会有任何东西报错,只会让下一个人点过去落到文档开头 ——
 * 而那时他会以为那一节不存在。**真相源里的死链比缺一节更糟**:缺一节看得出来,
 * 死链看起来像文档在说「这里没有」。
 *
 * 【为什么它自己也是一次教训】这个检查以前是每轮手打一遍的临时脚本,
 * 而它的 slug 算法把标题里的下划线删掉了(GitHub 保留下划线)——
 * 于是 `#is_test…` 那条正确的链接被**假红**了一次。
 * 手打的检查会漂,而漂的方向没人盯着(判断标准 1 推论二:守卫误报和漏报一样坏)。
 * 所以它进了仓库、进了构建链,slug 算法也对齐了 GitHub 的实际行为。
 *
 * 【slug 算法】GitHub 的做法:转小写 → 去掉除 `-` `_` 与空白外的标点 → 空白转 `-`。
 * 重名标题会被加 `-1` / `-2` 后缀,所以本脚本**也把重名报出来** ——
 * 重名意味着链接指向哪一个取决于顺序,那种链接迟早会指错。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 扫哪些文档。PROGRESS.md 是重点,但 README / docs 同样不该有死链 */
const TARGETS = ['PROGRESS.md', 'README.md'];
const TARGET_DIRS = ['docs'];

function collectMarkdown() {
  const files = TARGETS.filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
  for (const dir of TARGET_DIRS) {
    let entries;
    try {
      entries = readdirSync(dir, { recursive: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, String(e));
      try {
        if (statSync(p).isFile() && p.endsWith('.md')) files.push(p);
      } catch {
        /* 目录或不可读,跳过 */
      }
    }
  }
  return files;
}

/**
 * GitHub 的标题 → 锚点。
 *
 * **保留 `-` 与 `_`**;其余标点(含 `.` `:` `/` `(` `)` `,` 全角标点 emoji)去掉。
 * 反引号、星号、波浪线属于 Markdown 强调标记,先剥掉再算。
 */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*~]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    // 【每个空白各转一个 `-`,不折叠】GitHub 不合并连续空白。
    // ` —— ` 去掉破折号后是两个空格 → `--`。第一版写成 /\s+/ 折叠成一个,
    // 于是把文档里 30 条正确链接全判成断锚 —— 门自己的算法漂了(判断标准 11)。
    .replace(/\s/g, '-');
}

/** 代码块里的 `#` 不是标题 —— 不剥掉的话 ```bash 里的注释会被当成标题 */
function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '));
}

const errors = [];
let checkedLinks = 0;
let checkedFiles = 0;

for (const file of collectMarkdown()) {
  const raw = readFileSync(file, 'utf8');
  const text = stripFences(raw);
  checkedFiles += 1;

  const seen = new Map();
  const anchors = new Set();
  const linked = new Set(
    [...text.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => decodeURIComponent(m[1])),
  );
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = slugify(m[1]);
    if (!slug) continue;
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    // GitHub 给重名加 -1 / -2;第一个不带后缀
    anchors.add(n === 1 ? slug : `${slug}-${n - 1}`);
  }

  /**
   * 【重名只在真的有链接指向它时才算错】
   * 文档里有好几组同名小节(`## 修法`、`## 未做 / 未验`),没人链接它们 ——
   * 为这个失败构建就是误报,而**误报会让人开始习惯性忽略这道门**,
   * 那正是它失效的方式(判断标准 1 推论二)。
   * 有链接指向的重名才是真问题:GitHub 解析到第一个,而作者想指的可能是第二个。
   */
  for (const [slug, n] of seen) {
    if (n > 1 && linked.has(slug)) {
      errors.push(
        `${file}: 有 ${n} 个标题的锚点都是 "#${slug}",而有链接指向它 —— ` +
          `GitHub 只会解析到第一个,作者想指的可能是另一个。改掉其中一个标题。`,
      );
    }
  }

  // 只看站内锚点(#...),跨文件与外链不在这道门的范围
  for (const m of text.matchAll(/\]\(#([^)\s]+)\)/g)) {
    checkedLinks += 1;
    const target = decodeURIComponent(m[1]);
    if (!anchors.has(target)) {
      const near = [...anchors].filter((a) => a.includes(target.slice(0, 8))).slice(0, 2);
      errors.push(
        `${relative('.', file)}: 链接 "#${target}" 找不到对应标题。` +
          (near.length ? ` 最接近的是:${near.map((a) => `#${a}`).join(' / ')}` : ''),
      );
    }
  }
}

if (errors.length) {
  console.error(`[check-doc-anchors] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(
    '\n  真相源里的死链比缺一节更糟:缺一节看得出来,死链看起来像文档在说「这里没有」。',
  );
  process.exit(1);
}

console.log(
  `[check-doc-anchors] OK —— ${checkedFiles} 个文档、${checkedLinks} 条站内锚点全部可解析,无重名标题。`,
);
