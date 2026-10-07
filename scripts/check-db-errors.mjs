#!/usr/bin/env node
/**
 * 找出「把 supabase-js 返回的 `error` 原样抛出去」的地方。**第十六道门**(2026-10-07 进构建链)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【它找什么】`const { error } = await supa…` 里的 `error` 是**普通对象**,不是 Error
 * (postgrest-js 2.110.8:`JSON.parse(body)`;只有 `.throwOnError()` 才 new PostgrestError)。
 * 原样 `throw` 它 → 没有堆栈;catch 处的 `err instanceof Error ? err.message : String(err)`
 * → 日志里只有 `[object Object]`。替代是 `api/_lib/dbError.ts` 的 `dbFail(ctx, error)`。
 *
 * 【判据】同一个文件里:
 *   ① 解构出来的 error 绑定:`{ …, error }` 或 `{ …, error: x }`(可跨行)
 *   ② `throw <那个绑定>`,或者 `throw <某个变量>.error`(`Promise.all` 的结果那种)
 *
 * 【盲区 —— 写在这里,不装作覆盖了】
 *   - **作用域不分**:绑定按文件收集。别处有个 `catch (error)` 再 `throw error` 也会被报(误报);
 *     反过来,换个名字转手(`const e = error; throw e`)抓不到(漏报)
 *   - **不分客户端**:auth / storage 的 `error` 是真 Error,原样抛没问题,但同名绑定一样会被报
 *   - `throw { ...error }`、`return Promise.reject(error)`、`reject(error)` 抓不到
 *   - 只扫 `api/` 与 `supabase/functions/` 下的 `.ts`(不含测试)。`src/` 不查 PostgREST(只调 Auth)
 *   - 抓的是「抛」;「只打印 .message 然后继续」与「error 根本没解构」(吞掉)不在它的判据里 ——
 *     那两类见 PROGRESS「PostgrestError 盘点」的清单
 *
 * 【退出码】有命中 → 1;没有 → 0;自检失败 → 2。
 * 2026-10-07 先作为**清单**用(判断标准 11 推论三):第一次全量跑报出 49 处;第 1、2 批迁完之后
 * 降到 0,第 4 批接进 `build`。从此新写一处 `if (error) throw error` 就过不了构建。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['api', 'supabase/functions'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('_test.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** 返回 [{ line, text }] —— 判据只在这一个函数里,自检也只测它 */
export function findThrows(src) {
  const bindings = new Set();
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=/g)) {
    for (const b of m[1].matchAll(/\berror\b(?:\s*:\s*([A-Za-z_$][\w$]*))?/g)) bindings.add(b[1] ?? 'error');
  }
  const hits = [];
  src.split('\n').forEach((text, i) => {
    const code = text.replace(/\/\/.*$/, '');
    if (/^\s*(\*|\/\*)/.test(code)) return;
    for (const m of code.matchAll(/\bthrow\s+([A-Za-z_$][\w$]*)(\.error)?\b/g)) {
      if (m[1] === 'new') continue;
      if (m[2] || bindings.has(m[1])) {
        hits.push({ line: i + 1, text: text.trim() });
        break;
      }
    }
  });
  return hits;
}

/**
 * 自检(判断标准 0 / 1):先证明它抓得到促使它诞生的那几种形状,也证明它放过替代写法。
 * 跑不过就 exit 2 —— 一个抓不到起因的检测器,报出来的数字没有意义。
 */
function selfTest() {
  const mustFlag = [
    "const { data, error } = await supa.from('t').select('*');\nif (error) throw error;",
    "const { data: ent, error: entError } = await supa\n  .from('t')\n  .select('*');\nif (entError) throw entError;",
    "const { error: insError } = await supa.from('t').insert({});\nif (raceError || !raced) throw insError;",
    'const {\n  data,\n  error: svErr,\n} = await supa.from(\'t\').select();\nif (svErr) throw svErr;',
    "const [fieldRes] = await Promise.all([q]);\nif (fieldRes.error) throw fieldRes.error;",
  ];
  const mustPass = [
    "const { data, error } = await supa.from('t').select('*');\nif (error) dbFail({ fn: 'f', op: 'o' }, error);",
    "const { error } = await supa.from('t').select('*');\nif (error) throw new Error(`read failed: ${error.message}`);",
    "const { data } = await supa.from('t').select('*');\nthrow e;",
    "const { error } = await x;\n// if (error) throw error;",
  ];
  const bad = [
    ...mustFlag.filter((s) => findThrows(s).length !== 1).map((s) => `should flag:\n${s}`),
    ...mustPass.filter((s) => findThrows(s).length !== 0).map((s) => `should not flag:\n${s}`),
  ];
  if (bad.length) {
    console.error(`[check-db-errors] self-test failed —— the detector itself is wrong:\n\n${bad.join('\n\n')}`);
    process.exit(2);
  }
  return mustFlag.length + mustPass.length;
}

const selfCases = selfTest();
const findings = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    for (const h of findThrows(readFileSync(file, 'utf8'))) findings.push({ file: relative('.', file), ...h });
  }
}

const byFile = new Map();
for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);

if (findings.length === 0) {
  console.log(`[check-db-errors] OK —— no supabase-js error is thrown as-is (self-test ${selfCases}/${selfCases}).`);
  process.exit(0);
}

for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.text}`);
console.log('');
for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${file}`);
console.log(
  `\n[check-db-errors] ${findings.length} place(s) in ${byFile.size} file(s) throw a supabase-js error as-is ` +
    `(a plain object: no stack, and catch sites log "[object Object]"). Replace with dbFail(ctx, error) ` +
    `from api/_lib/dbError.ts (Deno: supabase/functions/_shared/dbError.ts). Self-test ${selfCases}/${selfCases}.`,
);
process.exit(1);
