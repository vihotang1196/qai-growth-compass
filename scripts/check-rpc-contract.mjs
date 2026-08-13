#!/usr/bin/env node
/**
 * 守「代码调 RPC 的参数,必须有一条迁移定义得出来」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么需要这道门 —— 它是那次「webhook 差点坏」的机械版本】
 *
 * `feat/entitlement-warnings` 那条分支同时装着两样东西:
 *   ① `webhook` 改成按 **10 参**调用 `upsert_assessment_entitlement`
 *   ② 建那 10 参重载的迁移
 * 而那条分支**从没被合进 main** —— 于是两样一起缺、彼此一致,系统看起来正常。
 *
 * 但它只是**这一次**恰好一致。任何一侧单独合并、单独部署,结果都是
 * 「PostgREST 找不到那个重载 → 500」,而那是**付款入口**:
 * 新学员付了钱建不了准入记录。
 *
 * 那次真正救了我们的是「两样都缺」这个巧合,而不是任何一道检查。
 * 这道门把巧合换成事实:**调用方写了 `p_lang`,仓库里就必须有一条迁移定义 `p_lang`。**
 *
 * 【为什么只能静态查签名,不能查「有没有应用」】
 * 「那条迁移在生产库里跑过没有」需要连库才知道,而构建时没有库。
 * 所以这道门守的是**仓库内部的一致性**:代码与迁移文件对得上。
 * 「迁移有没有被应用」仍然靠部署顺序(`db push` → `deploy:functions`),
 * 那件事门守不了 —— **写在这里,不装作守得住**。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

// ── 1. 迁移里的函数定义:按文件名顺序,后面的覆盖前面的(迁移就是按这个顺序应用的)──
const definitions = new Map(); // name → { params:Set, file }
const dropped = new Map(); // name → 最后一次被 drop 的文件(仅用于报错时说清经过)
for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(MIG_DIR, f), 'utf8');
  for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi)) {
    dropped.set(m[1], f);
  }
  for (const m of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*\n\s*returns/gi,
  )) {
    const name = m[1];
    const params = new Set();
    for (const line of m[2].split(',')) {
      const t = line.trim();
      if (!t) continue;
      const pm = t.match(/^(\w+)\s+/);
      if (pm) params.add(pm[1]);
    }
    // 【后定义覆盖先定义】而 drop + create 是同一条迁移里的常态,所以只看最终形态
    definitions.set(name, { params, file: f });
  }
}

// ── 2. 代码里的调用 ────────────────────────────────────────────
const SCAN_DIRS = ['src', 'api', 'supabase/functions', 'scripts'];
const files = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p);
      } else if (/\.(ts|tsx|mjs)$/.test(e.name)) files.push(p);
    }
  };
  walk(abs);
}

const errors = [];
const checked = [];

for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (rel === 'scripts/check-rpc-contract.mjs') continue;
  const text = readFileSync(abs, 'utf8');

  for (const m of text.matchAll(/\.rpc\(\s*'(\w+)'\s*,\s*\{/g)) {
    const name = m[1];
    const lineNo = text.slice(0, m.index).split('\n').length;

    // 取那个对象字面量(括号配平),再抠出顶层的键
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const objBody = text.slice(m.index + m[0].length, i);
    const passed = new Set();
    let nest = 0;
    for (const line of objBody.split('\n')) {
      const stripped = line.replace(/\/\/.*$/, '');
      // 只取嵌套层级为 0 的键 —— 值里面的对象字面量不算参数
      if (nest === 0) {
        const km = stripped.match(/^\s*(\w+)\s*:/);
        if (km) passed.add(km[1]);
      }
      nest += (stripped.match(/[{[(]/g) ?? []).length - (stripped.match(/[}\])]/g) ?? []).length;
    }

    const def = definitions.get(name);
    if (!def) {
      errors.push(
        `${rel}:${lineNo} 调了 RPC \`${name}\`,但**没有任何迁移定义它**。` +
          (dropped.has(name) ? `(它在 ${dropped.get(name)} 里被 drop 过)` : ''),
      );
      continue;
    }
    const missing = [...passed].filter((p) => !def.params.has(p));
    const unused = [...def.params].filter((p) => !passed.has(p));
    if (missing.length) {
      errors.push(
        `${rel}:${lineNo} 给 \`${name}\` 传了迁移里不存在的参数:${missing.join(', ')}\n` +
          `      最终定义在 ${def.file},参数是:${[...def.params].join(', ')}\n` +
          `      这正是那次「webhook 差点坏」的形状:调用方与库的签名对不上 → PostgREST 找不到重载 → 500。`,
      );
    }
    if (unused.length) {
      /**
       * 反方向也要拦:SQL 那边的参数**没有默认值**,少传一个同样解析不到重载。
       * (真要加可选参数,就给它 SQL 默认值,那时这条会需要放宽 —— 到时候再说,
       * 而不是现在先留个宽口子。)
       */
      errors.push(
        `${rel}:${lineNo} 调 \`${name}\` 时漏了参数:${unused.join(', ')}\n` +
          `      定义在 ${def.file};那些参数没有 SQL 默认值,少传同样会解析不到重载。`,
      );
    }
    if (!missing.length && !unused.length) {
      checked.push(`${name}(${passed.size} 参)← ${rel}:${lineNo} ↔ ${def.file}`);
    }
  }
}

if (errors.length) {
  console.error(`[check-rpc-contract] FAILED —— ${errors.length} 处:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('');
  console.error('  ⚠️ 这道门只查【仓库内部一致性】。「那条迁移在生产库里跑过没有」需要连库才知道,');
  console.error('     所以部署顺序(db push → deploy:functions)仍然靠人 —— 门守不了那件事。');
  process.exit(1);
}

console.log(
  `[check-rpc-contract] OK —— ${checked.length} 处 RPC 调用与迁移里的签名一致:\n` +
    checked.map((c) => `             ${c}`).join('\n') +
    `\n           (只查仓库内部一致性;迁移有没有被应用要靠部署顺序,门守不了)`,
);
