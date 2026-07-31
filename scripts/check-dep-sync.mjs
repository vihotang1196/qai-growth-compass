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
 * 【需要哪些 specifier 由源码反推,不靠手写清单】
 * 第一版是手写 SHARED = ['libphonenumber-js'],反向验证时发现盲区:
 * import map 里少了 'libphonenumber-js/max' 这个子路径条目时,守卫照样说 OK ——
 * 而 phone.ts 恰恰 import 的是 /max,Deno 根本解析不了。
 * 手写清单必然跟不上代码。所以改成扫共享源码里的裸 specifier,逐个要求
 * import map 有对应条目且版本与 package.json 一致。
 */
import { readFileSync } from 'node:fs';

const PKG = 'package.json';
const IMPORT_MAP = 'supabase/functions/deno.json';

/**
 * 会被 Edge Function 侧 import 的共享源码。
 * 新增共享文件时加进来 —— 漏加会让该文件的依赖失去保护,
 * 所以 supabase/functions/_shared/ 下的 re-export 必须与本清单对应。
 */
const SHARED_SOURCES = ['src/lib/phone.ts', 'src/lib/phone.cases.ts'];

/** 这些前缀不需要 import map 条目 */
const IGNORED_PREFIXES = ['node:', 'npm:', 'jsr:', 'http:', 'https:', '.', '/', '@/'];

/** '@scope/pkg/sub' → '@scope/pkg';'pkg/sub' → 'pkg' */
function packageRoot(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** 抓 import / export ... from '<spec>' 里的 specifier */
function bareSpecifiers(source) {
  const found = new Set();
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) {
    const spec = m[1];
    if (IGNORED_PREFIXES.some((p) => spec.startsWith(p))) continue;
    found.add(spec);
  }
  return found;
}

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const imports = JSON.parse(readFileSync(IMPORT_MAP, 'utf8')).imports ?? {};
const errors = [];

/** specifier → 哪个共享文件用到它,报错时指得出来 */
const needed = new Map();
for (const file of SHARED_SOURCES) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    errors.push(`${file}: 读不到 —— SHARED_SOURCES 里的路径过期了?`);
    continue;
  }
  for (const spec of bareSpecifiers(src)) {
    if (!needed.has(spec)) needed.set(spec, []);
    needed.get(spec).push(file);
  }
}

if (needed.size === 0 && errors.length === 0) {
  errors.push('共享源码里没扫到任何裸 specifier —— 正则或路径大概坏了,不当作通过');
}

for (const [spec, users] of needed) {
  const name = packageRoot(spec);
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  const where = users.join(', ');

  if (!declared) {
    errors.push(`${spec}(${where} 在用): ${name} 不在 ${PKG} 的依赖里`);
    continue;
  }
  if (/^[\^~><=*]|\s|\|\|/.test(declared)) {
    errors.push(
      `${name}: ${PKG} 里的版本 "${declared}" 不是精确版本。` +
        '必须写死到 patch 位 —— 范围符会让两个运行时装到不同的号码元数据。',
    );
    continue;
  }

  const target = imports[spec];
  if (!target) {
    errors.push(
      `${spec}(${where} 在用): ${IMPORT_MAP} 的 imports 里没有这个条目。` +
        'Deno 解析不了裸 specifier,该文件在 Edge Function 里会直接加载失败。',
    );
    continue;
  }

  const m = /^npm:(@[^/]+\/[^@]+|[^@/][^@]*)@([^/]+)(\/.*)?$/.exec(target);
  if (!m) {
    errors.push(`${spec}: 目标 "${target}" 不是 npm:<name>@<exact-version> 形式`);
    continue;
  }
  const [, mappedName, mappedVersion] = m;
  if (mappedName !== name) {
    errors.push(`${spec}: 映射到了 "${mappedName}",与 specifier 的包名 "${name}" 不符`);
    continue;
  }
  if (mappedVersion !== declared) {
    errors.push(
      `${name} 版本不一致:${PKG} = ${declared},${IMPORT_MAP} 的 "${spec}" = ${mappedVersion}`,
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

const summary = [...needed.keys()]
  .map((s) => `${s} → ${imports[s]}`)
  .join('\n    ');
console.log(`[check-dep-sync] OK —— ${needed.size} 个共享 specifier 两侧一致:\n    ${summary}`);
