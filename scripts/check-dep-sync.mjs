#!/usr/bin/env node
/**
 * 跨运行时依赖一致性检查。
 *
 * 【为什么这道门必须存在】libphonenumber-js 的号码元数据随版本更新。
 * package.json 里是 1.13.x、Deno import map 里是 1.10.x 的话,同一份 phone.ts、
 * 同一个输入,两个运行时可能给出不同的 E.164。
 *
 * 那正好是这整套号码归一化要防的那类 bug:webhook 入库用一个版本、登录查询用
 * 另一个版本,号码存进去和查出来对不上,而代码看起来完全一致 —— 会去查数据、
 * 查索引、查归一化逻辑,唯独不会怀疑是库版本。这种 bug 能烧掉一整天。
 *
 * 【两次迭代都是在删手写清单】
 * v1:手写包名清单 SHARED = ['libphonenumber-js']。
 *    盲区 —— import map 少掉 'libphonenumber-js/max' 子路径条目时照样判通过,
 *    而那正是 phone.ts 实际 import 的 specifier。
 * v2:改成扫源码反推 specifier,但文件清单 SHARED_SOURCES 仍是手写的。
 *    盲区同一类,只是上移一层 —— 新增共享文件忘了加进清单,那个文件就没保护。
 * v3:文件清单也不手写。_shared/ 下所有 .ts 无条件纳入,再沿 import 图递归。
 *    盲区 —— 只扫 _shared/,而 Edge Function 本体(assessment-ghl-webhook/ 之类)
 *    不在其中。Stage 3 加第一个非 _shared 函数时这个洞就活了。
 * v4(本版):扫整个 supabase/functions/**。
 *    并把两条规则分开 —— 它们的适用范围本来就不同:
 *      A. 【所有】被 Edge Function 引用的裸 specifier 必须在 import map 里有
 *         精确版本的条目。这是 Deno 能不能解析的问题,对所有包都成立。
 *      B. package.json 的版本交叉校验【只对同时被 src/ 引用的 specifier 成立】。
 *         Node 侧根本不 import 的包(@supabase/supabase-js、@std/assert)不该被
 *         强塞进 package.json —— 那会让依赖清单谎报 Node 侧的真实需要。
 *
 * 结论:凡是「需要人记得去更新」的清单,迟早会漏。能从代码推出来的就别写。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

const PKG = 'package.json';
const IMPORT_MAP = 'supabase/functions/deno.json';
const FUNCTIONS_DIR = 'supabase/functions';
const CONFIG_TOML = 'supabase/config.toml';
/** config.toml 所在目录 —— import_map 的相对路径以它为基准 */
const CONFIG_DIR = 'supabase';
const SRC_ALIAS = { '@/': 'src/' };

/** 这些前缀的 specifier 不需要 import map 条目 */
const IGNORED_PREFIXES = ['node:', 'npm:', 'jsr:', 'http:', 'https:', 'data:'];

/** '@scope/pkg/sub' → '@scope/pkg';'pkg/sub' → 'pkg' */
function packageRoot(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** 抓 import / export ... from '<spec>' 与 import('<spec>') */
function specifiersIn(source) {
  const found = new Set();
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) found.add(m[1]);
  }
  return found;
}

function exists(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 相对 / 别名 specifier → 仓库内的实际文件路径;解析不到返回 null */
function resolveLocal(fromFile, spec) {
  let base;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    const alias = Object.keys(SRC_ALIAS).find((a) => spec.startsWith(a));
    if (!alias) return null;
    base = resolve(spec.replace(alias, SRC_ALIAS[alias]));
  }
  /**
   * `api/**` 的相对导入按约定写成显式 `.js`(Vercel 的 Node ESM 语义:
   * 运行时看到的是 tsc 产出的 .js),而磁盘上只有 `.ts`。
   * `check:api-imports` 早就按这条约定解析,而这里没有 ——
   * 于是第一个「api/_lib 内部互相导入、且被 Deno 再导出」的模块
   * (`reportFiles.ts`)让这道门报了「解析不到,不当作通过」。
   *
   * 它报得对:一个解析不到的 specifier 就是没走完 import 图。缺的是这条映射,
   * 而不是这道门太严。**两道门必须认同一套约定**,否则同一份代码在一处合法、
   * 在另一处报错,而人会开始怀疑门而不是代码。
   */
  const jsToTs = base.endsWith('.js') ? base.slice(0, -3) : null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  if (jsToTs) candidates.push(`${jsToTs}.ts`, `${jsToTs}.tsx`);
  for (const candidate of candidates) {
    if (exists(candidate)) return normalize(relative(process.cwd(), candidate));
  }
  return null;
}

function walkTs(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkTs(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const errors = [];

// ── 1. 自动发现共享源码:_shared/ 全部 + 沿 import 图递归 ──────────
const roots = walkTs(FUNCTIONS_DIR);
if (roots.length === 0) {
  errors.push(`${FUNCTIONS_DIR} 下没找到任何 .ts —— 目录挪了?不当作通过。`);
}

const visited = new Set(roots);
const queue = [...roots];
/** specifier → 哪些文件在用,报错时指得出来 */
const needed = new Map();
const unresolved = [];

while (queue.length) {
  const file = queue.shift();
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    errors.push(`${file}: 读不到`);
    continue;
  }
  for (const spec of specifiersIn(src)) {
    if (IGNORED_PREFIXES.some((p) => spec.startsWith(p))) continue;

    if (spec.startsWith('.') || Object.keys(SRC_ALIAS).some((a) => spec.startsWith(a))) {
      const local = resolveLocal(file, spec);
      if (!local) {
        unresolved.push(`${file} → ${spec}`);
        continue;
      }
      if (!visited.has(local)) {
        visited.add(local);
        queue.push(local);
      }
      continue;
    }

    if (!needed.has(spec)) needed.set(spec, []);
    needed.get(spec).push(file);
  }
}

if (unresolved.length) {
  errors.push(
    `以下相对 import 解析不到文件,import 图可能没走全 —— 不当作通过:\n    ` +
      unresolved.join('\n    '),
  );
}

// ── 2. 逐个 specifier 校验 import map 与 package.json ─────────────
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const imports = JSON.parse(readFileSync(IMPORT_MAP, 'utf8')).imports ?? {};

for (const [spec, users] of [...needed].sort(([a], [b]) => a.localeCompare(b))) {
  const where = users.join(', ');
  const target = imports[spec];

  // ── 规则 A:所有 specifier 都要有精确版本的 import map 条目 ──────
  if (!target) {
    errors.push(
      `${spec}(${where} 在用): ${IMPORT_MAP} 的 imports 里没有这个条目。` +
        `Deno 解析不了裸 specifier,该文件在 Edge Function 里会直接加载失败。`,
    );
    continue;
  }

  const m = /^(npm|jsr):(@[^/]+\/[^@]+|[^@/][^@]*)@([^/]+)(\/.*)?$/.exec(target);
  if (!m) {
    errors.push(
      `${spec}: 目标 "${target}" 不是 <npm|jsr>:<name>@<exact-version> 形式。` +
        `浮动版本会让两个运行时装到不同的代码。`,
    );
    continue;
  }
  const [, scheme, mappedName, mappedVersion] = m;

  if (mappedName !== packageRoot(spec)) {
    errors.push(`${spec}: 映射到了 "${mappedName}",与 specifier 的包名不符`);
    continue;
  }
  if (/^[\^~><=*]|\s|\|\|/.test(mappedVersion)) {
    errors.push(`${spec}: 目标版本 "${mappedVersion}" 含范围符,必须写死到 patch 位`);
    continue;
  }

  // ── 规则 B:只对同时被 src/ 引用的 specifier 交叉校验 package.json ──
  // Node 侧不 import 的包不该被强塞进 package.json,那会让依赖清单谎报真实需要。
  const usedFromSrc = users.some((f) => f.startsWith(`src${sep}`) || f.startsWith('src/'));
  if (!usedFromSrc) continue;

  if (scheme !== 'npm') {
    errors.push(
      `${spec}: 被 src/ 引用,但映射成了 ${scheme}: —— Node 侧解析不了非 npm 的 specifier`,
    );
    continue;
  }

  const name = packageRoot(spec);
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!declared) {
    errors.push(
      `${spec}(${where} 在用): ${name} 被 src/ 引用但不在 ${PKG} 的依赖里。`,
    );
    continue;
  }
  if (/^[\^~><=*]|\s|\|\|/.test(declared)) {
    errors.push(
      `${name}: ${PKG} 里的版本 "${declared}" 不是精确版本。` +
        `必须写死到 patch 位 —— 范围符会让两个运行时装到不同的号码元数据。`,
    );
    continue;
  }
  if (mappedVersion !== declared) {
    errors.push(
      `${name} 版本不一致:${PKG} = ${declared},${IMPORT_MAP} 的 "${spec}" = ${mappedVersion}`,
    );
  }
}

if (needed.size === 0 && errors.length === 0) {
  errors.push('共享源码里没扫到任何外部 specifier —— 正则大概坏了,不当作通过');
}

// ── 3. 反向:import map 里不许有没人用的条目 ────────────────────
// 【配置跟着实现走,不要提前于实现】
// 未使用的映射条目没有任何东西校验它 —— 它可以漂到另一个版本而不被发现,
// 等哪天有人 import 那个 specifier,就拿到一个与在用条目不同的版本。
// 这跟 vercel.json 给尚未存在的函数配 maxDuration 是同一类问题:
// 配置提前于实现,要么直接炸(Vercel 那样),要么静默腐烂(这里)。
if (roots.length > 0) {
  const unused = Object.keys(imports).filter((spec) => !needed.has(spec));
  if (unused.length) {
    errors.push(
      `${IMPORT_MAP} 里有 ${unused.length} 个没人用的 imports 条目:` +
        `${unused.join(', ')}。` +
        `配置跟着实现走 —— 等真的有文件 import 它时再加。` +
        `没人用的映射不受本守卫校验,会静默腐烂。`,
    );
  }
}


// ── 4. import map 必须能被 deploy 带上,不只是内容正确 ────────────
// 【这一节的由来】Stage 3 首次 deploy 失败:
//   Relative import path "@supabase/supabase-js" not prefixed with / or ./ or ../
// 而本检查当时是【绿的】—— 它验的是「import map 里有对应条目」,条目确实有;
// 但那份 map 在函数目录的上一层,CLI 查找时不会往上找,deploy 时压根没上传。
//
// 守卫验了配置内容正确,没验配置会不会到达运行时。这跟 api/ 没进 tsc -b、
// check:dep-sync 只扫 _shared/ 是同一类:检查的边界与实际执行的边界不重合。
//
// 所以这里补上可达性:每个函数目录都必须在 config.toml 里有
// [functions.<name>] 且 import_map 指向本检查所校验的那一份 map。
{
  /** 极简 TOML 读取:只需要 [functions.<name>] 段下的 key = "value" */
  function parseFunctionSections(toml) {
    const sections = new Map();
    let current = null;
    for (const rawLine of toml.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const sec = /^\[functions\.([A-Za-z0-9_-]+)\]$/.exec(line);
      if (sec) {
        current = sec[1];
        sections.set(current, {});
        continue;
      }
      if (/^\[/.test(line)) {
        current = null;
        continue;
      }
      if (!current) continue;
      const kv = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
      if (!kv) continue;
      let value = kv[2].trim();
      // 只在值不是引号开头时剥行尾注释,避免切坏含 # 的字符串
      if (!value.startsWith('"') && !value.startsWith("'")) {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      sections.set(current, {
        ...sections.get(current),
        [kv[1]]: value.replace(/^["']|["']$/g, ''),
      });
    }
    return sections;
  }

  let toml;
  try {
    toml = readFileSync(CONFIG_TOML, 'utf8');
  } catch {
    errors.push(`${CONFIG_TOML} 读不到 —— 每个 Edge Function 都要在这里声明 import_map`);
    toml = '';
  }

  if (toml) {
    const sections = parseFunctionSections(toml);
    // 函数目录 = supabase/functions 下的一级子目录,_shared 除外
    let funcDirs = [];
    try {
      funcDirs = readdirSync(FUNCTIONS_DIR).filter(
        (e) => e !== '_shared' && statSync(join(FUNCTIONS_DIR, e)).isDirectory(),
      );
    } catch {
      // 上面已经报过 FUNCTIONS_DIR 的问题
    }

    for (const name of funcDirs) {
      const cfg = sections.get(name);
      if (!cfg) {
        errors.push(
          `函数 ${name} 在 ${FUNCTIONS_DIR}/ 下存在,但 ${CONFIG_TOML} 里没有 ` +
            `[functions.${name}] 段。deploy 时它拿不到 import map,` +
            `裸 specifier 会解析失败;verify_jwt 也会静默用默认值 true。`,
        );
        continue;
      }
      if (!cfg.import_map) {
        errors.push(
          `[functions.${name}] 缺 import_map。我们的 map 在 ${IMPORT_MAP},` +
            `即函数目录的上一层 —— CLI 不会往上找,不显式声明就不会被上传。`,
        );
        continue;
      }
      const resolved = normalize(join(CONFIG_DIR, cfg.import_map));
      if (resolved !== normalize(IMPORT_MAP)) {
        errors.push(
          `[functions.${name}] 的 import_map 指向 ${resolved},` +
            `但本检查校验的是 ${IMPORT_MAP}。两者必须一致,` +
            `否则 deploy 用的是一份没人校验过的 map。`,
        );
        continue;
      }
      if (!exists(resolved)) {
        errors.push(`[functions.${name}] 的 import_map 指向的文件不存在:${resolved}`);
        continue;
      }
      if (cfg.verify_jwt === undefined) {
        errors.push(
          `[functions.${name}] 没有显式声明 verify_jwt。默认值是 true,` +
            `会让平台在函数代码运行之前拒掉没有 Supabase 身份的调用方(比如 GHL)。` +
            `要真为 true 也请写出来。`,
        );
      }
    }
  }
}

if (errors.length) {
  console.error('[check-dep-sync] FAILED —— 跨运行时依赖不一致:');
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    '\n同一份共享源码在两个运行时必须解析到同一个版本,' +
      '否则入库与查询会得到不同的结果。见 PROGRESS.md Stage 2。',
  );
  process.exit(1);
}

console.log(
  `[check-dep-sync] OK —— 自动发现 ${visited.size} 个共享源码文件、` +
    `${needed.size} 个外部 specifier,两侧一致:\n    ` +
    [...needed.keys()].sort().map((s) => `${s} → ${imports[s]}`).join('\n    '),
);
