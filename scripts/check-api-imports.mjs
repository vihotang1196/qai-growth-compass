#!/usr/bin/env node
/**
 * 守 `api/` 下的导入在【部署产物】里解析得到。
 *
 * 【为什么需要这道门】render-pdf.ts 从 `../src/lib/glyphCheck` 导入,函数在模块加载阶段就
 * ERR_MODULE_NOT_FOUND —— 而四道门全绿:
 *   tsc            按 moduleResolution:"bundler" 解析,允许省略扩展名、允许跨目录 → 过
 *   vite build     那个文件确实被打进前端 bundle → 过
 *   check:dep-sync 管的是 npm 依赖版本,不管跨目录相对导入 → 过
 *   Vercel 部署     不做静态导入分析 → 过
 * 没有任何一处在验「serverless function 的导入在运行时解析得到」。这个脚本就是那一处。
 *
 * 它编码的是两条【已从 Vercel 官方文档确认】的规则,不是猜测:
 *   1. TS 编译作用域 = /api 之内
 *      ("supports TypeScript files for server entrypoints and files inside of the
 *        /api directory")—— 所以相对导入的目标必须也在 api/ 里,否则不会被编译成 .js
 *   2. package.json 是 "type": "module" ⇒ ESM 要求显式扩展名
 *      —— 所以相对导入必须以 .js 结尾(.js 在 TS 里映射到同名 .ts 源文件)
 *
 * 顺带第三条:路径别名(@/…)在 Vercel 上不支持("aside from Path Mappings"),一并拦。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(ROOT, 'api');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|mts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** 抓 import / export ... from '…' 与动态 import('…') 的 specifier */
function specifiersOf(src) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

const errors = [];
const checked = [];

/**
 * 顺序规则:导入 `@sparticuz/chromium` 的文件,必须【更早】导入 `_lib/lambdaEnv`。
 *
 * 那个包在模块顶层就做环境探测并解压 NSS 库(libnss3.so)。Vercel 不按 AWS 的格式声明
 * AWS_EXECUTION_ENV,所以我们要在它之前注入 —— 见 api/_lib/lambdaEnv.ts 的完整说明。
 * ESM 按 import 出现顺序求值被导入模块的副作用,所以「写在上面」就是「先执行」;
 * 有人重排 import 就会静默失效:函数照样部署,只在运行时报一句 libnss3.so 找不到,
 * 而那条错误完全看不出与 import 顺序有关(我们为此烧了两轮)。
 */
const CHROMIUM_PKG = '@sparticuz/chromium';
const LAMBDA_ENV = '_lib/lambdaEnv';

for (const file of walk(API_DIR)) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');

  // 顺序规则先判(它看的是整份文件里两个 import 的相对位置)
  // 只认【真实的 import 语句】——第一版用 src.includes(包名),把注释里提到包名的文件
  // 也算成导入者,误报了 lambdaEnv.ts 自己。守卫误报会让人开始忽略它,和漏报一样坏。
  const chromiumAt = src.search(new RegExp(`from\\s*['"]${CHROMIUM_PKG.replace('/', '\\/')}['"]`));
  if (chromiumAt !== -1) {
    const envAt = src.search(new RegExp(`from\\s*['"][^'"]*${LAMBDA_ENV}[^'"]*['"]`));
    if (envAt === -1) {
      errors.push(
        `${rel}: 导入了 ${CHROMIUM_PKG} 但没有导入 ${LAMBDA_ENV} —— ` +
          `Vercel 不声明 AWS_EXECUTION_ENV,那个包顶层的探测会失败,libnss3.so 不会被解压。` +
          `见 api/_lib/lambdaEnv.ts。`,
      );
    } else if (chromiumAt !== -1 && envAt > chromiumAt) {
      errors.push(
        `${rel}: ${LAMBDA_ENV} 的 import 排在 ${CHROMIUM_PKG} 【之后】—— 顺序反了。` +
          `那个包在模块顶层就探测环境,注入必须先执行。ESM 按 import 出现顺序求值,` +
          `把 lambdaEnv 那行移到 chromium 之前。`,
      );
    }
  }

  for (const spec of specifiersOf(src)) {
    // 路径别名:Vercel 明确不支持 Path Mappings
    if (spec.startsWith('@/')) {
      errors.push(`${rel}: 用了路径别名 "${spec}" —— Vercel 的 Node runtime 不支持 Path Mappings,改成相对路径`);
      continue;
    }
    // 只管相对导入;npm 包与 node: 内置由 Vercel 自己装
    if (!spec.startsWith('.')) continue;

    checked.push(`${rel} → ${spec}`);

    /**
     * 规则 2:ESM 要求显式扩展名,而且必须是 `.js`(不能是 `.ts`)。
     *
     * ⚠️ **这条消息以前是错的。** 它把「不以 .js 结尾」一律说成「没有扩展名」,
     * 于是写了 `./lang.ts` 的人会看到「没有扩展名 —— 写成 ./lang.ts.js」——
     * 两句都不对,而后一句照做会得到一个不存在的路径。
     * 一道门的**提示错了比不提示更糟**:它把人推向一个更深的坑
     * (判断标准 14 推论三:守卫只写机械事实 + 下一步去哪看)。
     * 现在按实际情形分两种说法。
     */
    if (/\.tsx?$/.test(spec)) {
      errors.push(
        `${rel}: 相对导入 "${spec}" 用了 .ts 扩展名 —— **写成 "${spec.replace(/\.tsx?$/, '.js')}"**。\n` +
          `      理由不是风格:tsc 会直接报 TS5097(要开 allowImportingTsExtensions),` +
          `而那个选项要求 noEmit —— 与 Vercel「要产出 JS」冲突。\n` +
          `      运行时看到的是 tsc 产出的 .js,所以源码里写 .js 才是那条链上唯一自洽的写法。\n` +
          `      (Deno 侧读的是 .ts 源文件,靠 supabase/functions/deno.json 的 imports 映射解决,` +
          `不靠改这里的扩展名。)`,
      );
    } else if (!/\.(js|mjs|cjs|json)$/.test(spec)) {
      errors.push(
        `${rel}: 相对导入 "${spec}" 没有扩展名 —— package.json 是 "type": "module",` +
          `ESM 在运行时要求显式扩展名。写成 "${spec}.js"(.js 会映射到同名 .ts 源文件)。` +
          `tsc 的 moduleResolution:"bundler" 允许省略,所以它不会替你发现这个。`,
      );
    }

    // 规则 1:目标必须在 api/ 内(Vercel 只编译这里的 TS)
    const specNoExt = spec.replace(/\.(js|mjs|cjs)$/, '');
    const abs = resolve(dirname(file), specNoExt);
    if (!abs.startsWith(API_DIR + '/') && abs !== API_DIR) {
      errors.push(
        `${rel}: 相对导入 "${spec}" 指向 api/ 之外(${relative(ROOT, abs)}) —— ` +
          `Vercel 只编译 /api 内的 TypeScript,外面的 .ts 不会变成函数能加载的 .js。` +
          `把被导入的模块放进 api/_lib/,让 src/ 与 Deno 从那里导入(反过来不行)。`,
      );
      continue;
    }

    // 目标文件真的存在吗(.ts / .js / 目录 index)
    const candidates = [`${abs}.ts`, `${abs}.js`, `${abs}.mts`, `${abs}.mjs`, join(abs, 'index.ts'), join(abs, 'index.js'), abs];
    if (!candidates.some((c) => existsSync(c))) {
      errors.push(`${rel}: 相对导入 "${spec}" 找不到对应文件(试过 ${candidates.map((c) => relative(ROOT, c)).join(', ')})`);
    }
  }
}

if (errors.length) {
  console.error(`[check-api-imports] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(
  `[check-api-imports] OK —— api/ 下 ${checked.length} 条相对导入都在 api/ 内、都带扩展名、都解析得到。` +
    (checked.length ? `\n    ${checked.join('\n    ')}` : ''),
);
