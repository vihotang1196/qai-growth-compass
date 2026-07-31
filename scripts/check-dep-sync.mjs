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
 * v3(本版):文件清单也不手写。
 *    supabase/functions/_shared/ 下所有 .ts 无条件纳入,再沿 import 图递归
 *    捞进被它们引用的项目内文件。清单为空则判失败,不当作通过。
 *
 * 结论:凡是「需要人记得去更新」的清单,迟早会漏。能从代码推出来的就别写。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const PKG = 'package.json';
const IMPORT_MAP = 'supabase/functions/deno.json';
const SHARED_DIR = 'supabase/functions/_shared';
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
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
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
const roots = walkTs(SHARED_DIR);
if (roots.length === 0) {
  errors.push(`${SHARED_DIR} 下没找到任何 .ts —— 目录挪了?不当作通过。`);
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

  // jsr: 的包不在 package.json 里(Node 侧用不到),校验到「精确版本」为止
  if (scheme === 'jsr') continue;

  const name = packageRoot(spec);
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!declared) {
    errors.push(
      `${spec}(${where} 在用): ${name} 映射成了 npm 包但不在 ${PKG} 的依赖里。` +
        `Deno 会装一个 Node 侧根本没有的版本。`,
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
