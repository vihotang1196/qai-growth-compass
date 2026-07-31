#!/usr/bin/env node
/**
 * 从完整的 Noto Sans SC 生成 subset woff2(PROGRESS.md 0.14 第二批)。
 *
 * 输入(不进 git,见 .gitignore):
 *   assets/fonts/NotoSansSC-Regular.otf   ← 从 CDN 拉一份到本地作 subset 源
 *   assets/fonts/NotoSansSC-Bold.otf      ← 只在本地存在,不上 CDN
 *
 * 实际字体来自 googlefonts/noto-cjk 的 Sans/SubsetOTF/SC/,是 **otf 不是 ttf**,
 * 静态单字重非可变字体。fontconfig 认 otf,符合兜底层要确定性的要求。
 *
 * 输出:
 *   build/fonts/NotoSansSC-Regular.subset.woff2
 *   build/fonts/NotoSansSC-Bold.subset.woff2
 *   → 生成后交给 BunnyCDN,前端与 PDF 都从 CDN 取
 *
 * 【为什么不写进 public/】Vite 会把 public/ 整个复制进 dist/,而字体是从 CDN 取的 ——
 * 放 public/ 会让 2.3MB 字体跟着每次部署走一遍,纯属死重量。build/ 已 gitignore。
 *
 * 依赖 fontTools。用项目内的 venv,不动系统 Python:
 *   python3 -m venv .venv && ./.venv/bin/pip install "fonttools[woff]" brotli
 * (.venv 已 gitignore)
 *
 * 覆盖范围:CJK 基本区 + 拉丁 + 数字 + 常用标点。
 * subset 之外的生僻字由 chromium.font() 装的完整字体兜底(PDF)或系统字体兜底(网页)。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = 'assets/fonts';
const OUT_DIR = 'build/fonts';
const BUILD_DIR = 'build';
const CODEPOINT_FILE = 'build/subset-codepoints.txt';
/** 优先用项目内 venv 的 pyftsubset,退回 PATH 上的 */
const PYFTSUBSET = existsSync('.venv/bin/pyftsubset') ? '.venv/bin/pyftsubset' : 'pyftsubset';

/**
 * 非汉字部分:基本拉丁 + 拉丁补充 + 常用标点 + 箭头 + 带圈数字 +
 * CJK 标点 + 假名 + 全角。这些量很小,整段收进来。
 */
const NON_CJK_RANGES = [
  'U+0020-007E',
  'U+00A0-00FF',
  'U+2000-206F',
  'U+2190-21FF',
  'U+2460-24FF',
  'U+3000-303F',
  'U+3040-309F',
  'U+30A0-30FF',
  'U+FF00-FFEF',
];

/**
 * 汉字部分【不收整个 CJK 基本区】。
 *
 * 基本区有 20,992 个码位,全收进来单个字重就是 3.3MB,两个字重 6.7MB ——
 * 手机首屏拉这个太重,而其中绝大多数字这辈子不会出现在报告里。
 *
 * 收两部分的并集:
 *   1. GB2312 可编码的 6,763 个常用汉字 —— 有明确标准依据,不靠某份来路不明的
 *      「常用 3500 字」频率表
 *   2. config 与 ui-strings 里实际出现的每一个汉字 —— 报告正文的词汇是固定的,
 *      必须 100% 覆盖,一个字都不能漏
 *
 * 两者之外的生僻字(主要出现在学员姓名与开放题原文)按既有兜底走:
 *   网页 → 系统中文字体;PDF → chromium.font() 装的完整 otf。
 */
const CJK_SOURCES = ['src/config/assessment-config.json', 'src/config/ui-strings.ts'];

/**
 * 【必须排除在 subset 之外的字】
 *
 * 这几个生僻字是字体探针与 Showcase 自检块用来验证「fontconfig 兜底层是否生效」的。
 * 它们出现在 ui-strings.ts 里,而 ui-strings.ts 又是 subset 的扫描源 ——
 * 于是第一版把它们收进了 subset,探针那一块被 subset 满足,
 * 【根本验不到兜底层】。测试字符串污染了它要测的东西。
 *
 * 所以这里显式排除,并在生成后断言:
 *   - config 里其余每个汉字都必须在 subset 内(一个都不能漏)
 *   - 这几个探针字必须【不在】subset 内(否则探针失去意义)
 * 两条任一不满足就构建失败。
 *
 * 注:䶮 U+4DAE 属于 CJK 扩展 A 区,本来就不在扫描范围内;
 * 其余四个在基本区,必须显式排除。
 */
const FALLBACK_PROBE_CHARS = '䶮龘靐齉麤';

function resolveInput(stem) {
  for (const ext of ['otf', 'ttf']) {
    const p = join(IN_DIR, `${stem}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

const mb = (p) => `${(statSync(p).size / 1048576).toFixed(2)} MB`;

/** GB2312 可编码的汉字码位。用 Python 的 codecs 枚举,不依赖任何外部频率表 */
function gb2312Codepoints() {
  const py = existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3';
  const out = execFileSync(
    py,
    [
      '-c',
      "import sys\n" +
        "for cp in range(0x4E00, 0xA000):\n" +
        "    try:\n" +
        "        chr(cp).encode('gb2312')\n" +
        "        sys.stdout.write('%X\\n' % cp)\n" +
        "    except Exception:\n" +
        "        pass\n",
    ],
    { encoding: 'utf8', maxBuffer: 1 << 22 },
  );
  return out.trim().split('\n').map((h) => parseInt(h, 16));
}

/**
 * config 与 ui-strings 里实际出现的汉字 —— 报告词汇必须 100% 覆盖。
 * 探针用的生僻字排除在外,理由见 FALLBACK_PROBE_CHARS。
 */
function usedCjkCodepoints() {
  const excluded = new Set([...FALLBACK_PROBE_CHARS].map((c) => c.codePointAt(0)));
  const set = new Set();
  for (const file of CJK_SOURCES) {
    const text = readFileSync(file, 'utf8');
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x4e00 && cp <= 0x9fff && !excluded.has(cp)) set.add(cp);
    }
  }
  return set;
}

/** 生成后校验:该有的一个不漏,该没有的一个不留 */
function verify(stem) {
  const file = join(OUT_DIR, `${stem}.subset.woff2`);
  const py = existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3';
  const script = [
    'import sys, json',
    'from fontTools.ttLib import TTFont',
    'f = TTFont(sys.argv[1])',
    'print(json.dumps(sorted(f.getBestCmap().keys())))',
  ].join('\n');
  const cmap = new Set(
    JSON.parse(execFileSync(py, ['-c', script, file], { encoding: 'utf8', maxBuffer: 1 << 24 })),
  );

  const missing = [...usedCjkCodepoints()].filter((cp) => !cmap.has(cp));
  const leaked = [...FALLBACK_PROBE_CHARS].filter((c) => cmap.has(c.codePointAt(0)));

  if (missing.length) {
    console.error(
      `[subset] FAILED ${stem}: config 里有 ${missing.length} 个汉字不在 subset 内 —— ` +
        missing.map((cp) => String.fromCodePoint(cp)).join(''),
    );
    return false;
  }
  if (leaked.length) {
    console.error(
      `[subset] FAILED ${stem}: 探针用的生僻字漏进了 subset —— ${leaked.join(' ')}。` +
        `这会让字体探针的兜底层测试失去意义(subset 就能满足它,验不到 fontconfig)。`,
    );
    return false;
  }
  console.log(`[subset] ${stem} 校验通过:${cmap.size} 个码位,config 无漏字,探针字未被收进。`);
  return true;
}

/** 拼出传给 pyftsubset 的完整码位清单文件 */
function buildCodepointFile() {
  const gb = gb2312Codepoints();
  const used = usedCjkCodepoints();
  const all = new Set(gb);
  let added = 0;
  for (const cp of used) if (!all.has(cp)) { all.add(cp); added += 1; }

  mkdirSync(BUILD_DIR, { recursive: true });
  const lines = [
    ...NON_CJK_RANGES,
    ...[...all].sort((a, b) => a - b).map((cp) => `U+${cp.toString(16).toUpperCase()}`),
  ];
  writeFileSync(CODEPOINT_FILE, lines.join('\n'));

  console.log(
    `[subset] 码位清单:GB2312 常用汉字 ${gb.length} 个` +
      ` + config/ui-strings 用到但不在 GB2312 里的 ${added} 个` +
      ` = 汉字 ${all.size} 个,另加 ${NON_CJK_RANGES.length} 段非汉字区间`,
  );
  return { total: all.size, added };
}

function subset(stem) {
  const input = resolveInput(stem);
  if (!input) {
    console.error(`[subset] MISSING: ${join(IN_DIR, stem)}.otf (or .ttf)`);
    console.error('         See PROGRESS.md 0.14 — put the original fonts there first.');
    return false;
  }
  const output = join(OUT_DIR, `${stem}.subset.woff2`);
  execFileSync(
    PYFTSUBSET,
    [
      input,
      `--output-file=${output}`,
      '--flavor=woff2',
      `--unicodes-file=${CODEPOINT_FILE}`,
      '--layout-features=*',
      '--desubroutinize',
      '--no-hinting',
      '--drop-tables+=DSIG',
    ],
    { stdio: 'inherit' },
  );
  console.log(`[subset] ${input} (${mb(input)}) → ${output} (${mb(output)})`);
  return true;
}

mkdirSync(OUT_DIR, { recursive: true });
buildCodepointFile();

let ok = true;
for (const stem of ['NotoSansSC-Regular', 'NotoSansSC-Bold']) {
  ok = subset(stem) && ok;
  if (ok) ok = verify(stem) && ok;
}

if (!ok) process.exit(1);
console.log('[subset] done — upload build/fonts/*.subset.woff2 to the CDN.');
