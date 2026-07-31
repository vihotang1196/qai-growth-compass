#!/usr/bin/env node
/**
 * 从完整的 Noto Sans SC 生成 subset woff2(PROGRESS.md 0.14 第二批)。
 *
 * 输入(不进 git,见 .gitignore):
 *   assets/fonts/NotoSansSC-Regular.[ttf|otf]
 *   assets/fonts/NotoSansSC-Bold.[ttf|otf]
 *
 * 输出:
 *   public/fonts/NotoSansSC-Regular.subset.woff2
 *   public/fonts/NotoSansSC-Bold.subset.woff2
 *   → 生成后交给 BunnyCDN,前端与 PDF 都从 CDN 取
 *
 * 依赖 Python 的 fonttools(pyftsubset):
 *   pip3 install "fonttools[woff]" brotli
 *
 * 覆盖范围:GB2312 一二级字库(约 6700 字)+ 拉丁 + 数字 + 常用标点。
 * subset 之外的生僻字由 chromium.font() 装的完整字体兜底(PDF)或系统字体兜底(网页)。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = 'assets/fonts';
const OUT_DIR = 'public/fonts';

/** 基本拉丁 + 拉丁补充 + 常用标点 + CJK 标点 + 全角 + CJK 统一表意文字基本区 */
const UNICODES = [
  'U+0020-007E',
  'U+00A0-00FF',
  'U+2000-206F',
  'U+2190-21FF',
  'U+2460-24FF',
  'U+3000-303F',
  'U+3040-309F',
  'U+30A0-30FF',
  'U+4E00-9FFF',
  'U+FF00-FFEF',
].join(',');

function resolveInput(stem) {
  for (const ext of ['ttf', 'otf']) {
    const p = join(IN_DIR, `${stem}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function subset(stem) {
  const input = resolveInput(stem);
  if (!input) {
    console.error(`[subset] MISSING: ${join(IN_DIR, stem)}.ttf (or .otf)`);
    console.error('         See PROGRESS.md 0.14 — put the original fonts there first.');
    return false;
  }
  const output = join(OUT_DIR, `${stem}.subset.woff2`);
  console.log(`[subset] ${input} → ${output}`);
  execFileSync(
    'pyftsubset',
    [
      input,
      `--output-file=${output}`,
      '--flavor=woff2',
      `--unicodes=${UNICODES}`,
      '--layout-features=*',
      '--desubroutinize',
      '--no-hinting',
      '--drop-tables+=DSIG',
    ],
    { stdio: 'inherit' },
  );
  return true;
}

mkdirSync(OUT_DIR, { recursive: true });

let ok = true;
for (const stem of ['NotoSansSC-Regular', 'NotoSansSC-Bold']) {
  ok = subset(stem) && ok;
}

if (!ok) process.exit(1);
console.log('[subset] done — upload public/fonts/*.subset.woff2 to the CDN.');
