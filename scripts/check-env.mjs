#!/usr/bin/env node
/**
 * 环境变量清单 —— 从代码推导,不手写。
 *
 * 【这道检查的由来】Stage 4 端到端时踩了两个形态完全相同的坑:
 *   LOGIN_HASH_PEPPER 缺失 → server_misconfigured 500
 *   SESSION_SECRET   缺失 → server_misconfigured 500
 * 两个都在 Stage 1 的变量清单里标着「Stage 4 才用到,现在不要填」,
 * 而 Stage 4 合并时没有任何东西提醒去补 —— 那份清单是给 Stage 1 的。
 *
 * 这是同一个模式的第五次:检查的边界是手写的,而代码长到了边界外面。
 * 前四次分别是 tsc 不管 api/、check:dep-sync 只扫 _shared/、deploy 不经过任何门、
 * deno check 的目录清单手写。这次的「边界」是环境变量的需求在代码里,
 * 而配置在人的记忆里。
 *
 * 【为什么清单必须从代码推导】手写的清单下次加变量又会漏 —— 那正是这次出事的原因。
 *
 * 【能做到与做不到】
 *   ✅ 列出代码实际读取的每一个变量,以及它必须配在哪一侧
 *   ✅ 强制:Vercel 与前端需要的变量必须出现在 .env.example 里(那是给人抄的模板)
 *   ❌ 无法验证 Supabase secrets 上到底配了什么 —— 那需要 Management API 权限。
 *      所以那一部分只做「把清单摆出来」,配没配靠人对一眼。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const PRINT = process.argv.includes('--print');

/** Edge Functions 里这几个由平台注入,不需要手动配 */
const PLATFORM_INJECTED = new Set([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
]);

/** Vite 自带的,不是我们的配置 */
const VITE_BUILTINS = new Set(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR']);

const TARGETS = [
  {
    id: 'supabase',
    label: 'Supabase Edge Function secrets',
    how: 'supabase secrets set NAME="..."',
    roots: ['supabase/functions'],
    exts: ['.ts'],
    patterns: [/Deno\.env\.get\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g],
    /** 无法远程校验,只打印 */
    requireInEnvExample: false,
  },
  {
    id: 'vercel',
    label: 'Vercel 环境变量(服务端,绝不能带 VITE_ 前缀)',
    how: 'Vercel → Settings → Environment Variables',
    roots: ['api'],
    exts: ['.ts'],
    patterns: [
      /process\.env\.([A-Z0-9_]+)/g,
      /process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g,
    ],
    requireInEnvExample: true,
  },
  {
    id: 'frontend',
    label: '前端 bundle(会被打进客户端,只放可公开的值)',
    how: 'Vercel 环境变量,必须带 VITE_ 前缀',
    roots: ['src'],
    exts: ['.ts', '.tsx'],
    patterns: [/import\.meta\.env\.([A-Z0-9_]+)/g],
    requireInEnvExample: true,
  },
  {
    id: 'local',
    label: '本地构建脚本',
    how: '.env.local 或 shell',
    roots: ['scripts'],
    files: ['vite.config.ts'],
    exts: ['.ts', '.mjs'],
    patterns: [
      /process\.env\.([A-Z0-9_]+)/g,
      /process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g,
    ],
    requireInEnvExample: true,
  },
];

function walk(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}

/**
 * name → { files, everyReadHasDefault }
 *
 * 【为什么要区分「有默认值」】LOGIN_MIN_RESPONSE_MS 有默认值 1500,不配也能跑。
 * 把它和 SESSION_SECRET 一起标成「需要配置」是夸大 ——
 * 而一份夸大的清单会被人学着忽略,那就白做了。
 *
 * 判据(启发式,会误判):读取点后面紧跟 ?? 、|| 或三元的 ? 就算有兜底。
 * 只有【所有】读取点都有兜底才算可选。
 *
 * ⚠️ 这是启发式而不是语义分析,所以「可选 / 必须」这个标注可能错。
 * 它的用途是让清单不夸大,不是给出保证 —— 真正的保证在函数自己的
 * server_misconfigured 检查里(那里会列出实际缺失的变量名)。
 * `?.`(可选链)刻意【不】算兜底:那只说明访问是空安全的,不说明值可以缺。
 */
function collect(target) {
  const found = new Map();
  const files = [
    ...(target.roots ?? []).flatMap((r) => walk(r, target.exts)),
    ...(target.files ?? []),
  ];
  for (const file of files) {
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const re of target.patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const name = m[1];
        if (target.id === 'frontend' && VITE_BUILTINS.has(name)) continue;
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 16);
        const hasDefault = /^\s*(\?\?|\|\|)/.test(after) || /^\s*\?(?!\.)/.test(after);
        if (!found.has(name)) found.set(name, { files: new Set(), allDefaulted: true });
        const entry = found.get(name);
        entry.files.add(file);
        if (!hasDefault) entry.allDefaulted = false;
      }
    }
  }
  return found;
}

/** .env.example 里以 NAME= 形式出现的键 */
function envExampleKeys() {
  let text;
  try {
    text = readFileSync('.env.example', 'utf8');
  } catch {
    return null;
  }
  const keys = new Set();
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)\s*=/.exec(line.trim());
    if (m) keys.add(m[1]);
  }
  return keys;
}

const documented = envExampleKeys();
const errors = [];
const report = [];
let total = 0;

for (const target of TARGETS) {
  const found = collect(target);
  if (found.size === 0) continue;
  total += found.size;

  const lines = [];
  for (const name of [...found.keys()].sort()) {
    const entry = found.get(name);
    const users = [...entry.files].sort();
    const injected = target.id === 'supabase' && PLATFORM_INJECTED.has(name);
    const tag = injected ? '平台注入' : entry.allDefaulted ? '可选(有默认)' : '必须配置';
    lines.push(`    ${tag.padEnd(12)} ${name.padEnd(26)} ← ${users.join(', ')}`);

    // 有默认值的不强制进 .env.example —— 它不配也能跑
    if (target.requireInEnvExample && !entry.allDefaulted && documented && !documented.has(name)) {
      errors.push(
        `${name}(${target.label})被 ${users.join(', ')} 读取,但 .env.example 里没有它。` +
          `.env.example 是给人抄的模板,漏一个就等于让下一个人踩同样的坑。`,
      );
    }
  }
  report.push(`  ${target.label}\n    配置方式:${target.how}\n${lines.join('\n')}`);
}

if (documented === null) {
  errors.push('读不到 .env.example —— 无法校验 Vercel / 前端变量是否有文档');
}
if (total === 0) {
  errors.push('没有从代码里扫到任何环境变量读取点 —— 正则大概坏了,不当作通过');
}

if (errors.length || PRINT) {
  console.log('\n本次部署需要的环境变量(从代码推导,非手写清单):\n');
  console.log(report.join('\n\n'));
  console.log('');
}

if (errors.length) {
  console.error('[check-env] FAILED:');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(
  `[check-env] OK —— 从代码扫到 ${total} 个环境变量读取点,` +
    `Vercel / 前端所需的都在 .env.example 里。用 --print 看完整清单。`,
);
