#!/usr/bin/env node
/**
 * 守「前端调用的每个函数,代理都放行;代理放行的每个函数,都真的存在」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么有这道门】2026-10-07 冷启动实测时发现:报告页「生成 X 版 PDF」按钮调的
 * `assessment-report-file`,从 `e2b7041` 起就在前端里,而代理 `api/[...path].ts` 的
 * `ALLOWED` 一直没有它 —— 请求在代理那一层被回 404 not_found,从没到过函数。
 * 那张 `ALLOWED` 是**手写的覆盖清单**,代码长到了它外面而没有任何东西知道
 * (判断标准 12:让覆盖由运行时事实驱动)。这道门把「该放行哪些」从记忆换成两个事实的比对:
 *
 *   A. 前端实际调用的函数名(扫 `src/` 的 AST)
 *   B. 代理的 `ALLOWED`
 *   C. `supabase/functions/` 下实际存在的函数目录
 *
 * 报红的两种:
 *   ① A 有、B 没有 —— 前端调了、代理不放行(就是 report-file 那次)
 *   ② B 有、C 没有 —— 代理放行一个不存在的函数(改名 / 删函数忘了改清单)
 * 不报的:B 有、A 没有 —— webhook / cron / 内部调用的函数本来就不从浏览器来,属于正常。
 *
 * 【A 怎么来的 —— 不是手写的 helper 清单】
 *   - 字符串 / 模板字面量以 `/api/<名字>` 开头 → 那个名字
 *   - **自动发现 helper**:一个函数体里出现 `/api/${它自己的某个参数}`,它就是 helper
 *     (今天是 `src/lib/api.ts` 的 `postJson`);它的每个调用点上,那个参数位置必须是字符串字面量
 *   - 名字对应的是 Vercel 自己的路由文件(`api/<名字>.ts` 或 `api/<名字>/`)→ 不经代理,跳过
 *   扫的是 AST,所以**注释里提到的 `/api/...` 不算调用**(那会误报)。
 *
 * 【失败封闭】静态判定不了的写法一律报红,而不是放过:
 *   helper 调用点上的名字不是字面量;字面量正好是 `/api/` 而不在已识别的 helper 里(拼接)。
 *   与 `check:env` 禁止动态读环境变量是同一条理由 —— 判定不了就等于没守。
 *
 * 【盲区 —— 写在这里,不装作覆盖了】
 *   - 只扫 `src/**` 的 .ts / .tsx(不含测试)。`index.html`、`public/` 里的脚本、别的源站发来的请求不在内
 *   - helper 的识别要求 `/api/${参数}` 直接写在那个函数里;再包一层(helper 调 helper 且中间名字是变量)
 *     会在外层调用点上报「不是字面量」—— 那是封闭的方向,不是漏报
 *   - `new URL(name, '/api/')`、`['', 'api', name].join('/')` 这类构造抓不到(漏报)
 *   - ② 只看目录在不在,不看那个函数**部署了没有**(仓库里有 ≠ 线上有)—— 那一层靠 smoke
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const PROXY = 'api/[...path].ts';
const FUNCTIONS_DIR = 'supabase/functions';
const NAME = /^\/api\/([a-z0-9][a-z0-9-]*)(?:[/?#]|$)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const parse = (file, text) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/**
 * 从一组源文件里推出前端调用了哪些函数。纯函数(输入是 {file, text}),自检也只测它。
 * 返回 { calls: Map<name, string[]>, unresolved: string[], helpers: string[] }
 */
export function frontendCalls(sources) {
  const files = sources.map(({ file, text }) => ({ file, sf: parse(file, text) }));
  const calls = new Map();
  const unresolved = [];
  const add = (name, where) => calls.set(name, [...(calls.get(name) ?? []), where]);

  // ① 先找 helper:函数体里有 `/api/${参数}`
  const helpers = new Map(); // name -> param index
  const helperTemplates = new Set();
  for (const { sf } of files) {
    visit(sf, (node) => {
      const isFn = ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
      if (!isFn || !node.body) return;
      const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
      let fnName = node.name?.text;
      if (!fnName && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) fnName = node.parent.name.text;
      if (!fnName) return;
      visit(node.body, (inner) => {
        if (!ts.isTemplateExpression(inner) || inner.head.text !== '/api/') return;
        const first = inner.templateSpans[0]?.expression;
        if (first && ts.isIdentifier(first) && params.includes(first.text)) {
          helpers.set(fnName, params.indexOf(first.text));
          helperTemplates.add(inner);
        }
      });
    });
  }

  // ② 字面量调用 + helper 调用点
  for (const { file, sf } of files) {
    visit(sf, (node) => {
      const where = `${file}:${sf ? lineOf(sf, node) : '?'}`;
      let text = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) text = node.head.text;
      if (text !== null && text.startsWith('/api/')) {
        const m = NAME.exec(text);
        if (m) add(m[1], where);
        else if (!(ts.isTemplateExpression(node) && helperTemplates.has(node))) {
          unresolved.push(`${where}  "${text}…" —— 函数名不是字面量,静态判定不了`);
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) {
        const arg = node.arguments[helpers.get(node.expression.text)];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          add(arg.text.replace(/^\/+/, '').split(/[/?#]/)[0], where);
        } else {
          unresolved.push(`${where}  ${node.expression.text}(…) 的函数名参数不是字面量,静态判定不了`);
        }
      }
    });
  }
  return { calls, unresolved, helpers: [...helpers.keys()] };
}

/** 从代理源码里读 `const ALLOWED = new Set([...])` */
export function allowedOf(text) {
  const sf = parse(PROXY, text);
  let found = null;
  visit(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'ALLOWED') return;
    const init = node.initializer;
    const arr = init && ts.isNewExpression(init) ? init.arguments?.[0] : null;
    if (!arr || !ts.isArrayLiteralExpression(arr)) return;
    found = arr.elements.map((e) => (ts.isStringLiteral(e) ? e.text : null));
  });
  if (!found) throw new Error(`${PROXY}: 找不到 \`const ALLOWED = new Set([...])\` —— 这道门的前提变了,先改门`);
  if (found.includes(null)) throw new Error(`${PROXY}: ALLOWED 里有不是字符串字面量的元素 —— 静态判定不了`);
  return found;
}

/** 比对。返回报红的条目;纯函数 */
export function compare({ calls, allowed, functions, vercelRoutes }) {
  const problems = [];
  for (const [name, where] of calls) {
    if (vercelRoutes.has(name)) continue;
    if (!allowed.includes(name)) {
      problems.push(`① 前端调用了 ${name},代理的 ALLOWED 里没有 —— 请求会在代理那层被回 404 not_found\n     调用点:${where.join(', ')}`);
    }
  }
  for (const name of allowed) {
    if (!functions.has(name)) problems.push(`② ALLOWED 里有 ${name},但 ${FUNCTIONS_DIR}/${name}/index.ts 不存在`);
  }
  return problems;
}

/** 自检(判断标准 0 / 1):先证明它抓得到起因的形状、也认得出该放过的形状 */
function selfTest() {
  const src = [
    { file: 'lib/api.ts', text: 'export async function postJson(path: string, b: unknown) { return fetch(`/api/${path}`, { body: String(b) }); }' },
    { file: 'pages/A.tsx', text: "postJson('fn-auth', {}); fetch('/api/fn-file', { method: 'POST' }); const u = `/api/fn-report?x=${1}`;" },
    { file: 'lib/note.ts', text: '/** 走 `/api/fn-only-in-a-comment` */\nexport const x = 1;' },
  ];
  const { calls, unresolved } = frontendCalls(src);
  const got = [...calls.keys()].sort().join(',');
  const bad = [];
  if (got !== 'fn-auth,fn-file,fn-report') bad.push(`calls should be fn-auth,fn-file,fn-report, got ${got}`);
  if (unresolved.length) bad.push(`nothing should be unresolved, got ${unresolved.join(' | ')}`);
  const dyn = frontendCalls([src[0], { file: 'pages/B.tsx', text: "const n = 'x'; postJson(n, {}); fetch('/api/' + n);" }]);
  if (dyn.unresolved.length !== 2) bad.push(`two dynamic forms should be unresolved, got ${dyn.unresolved.length}`);
  const problems = compare({
    calls,
    allowed: ['fn-auth', 'fn-report', 'fn-webhook', 'fn-gone'],
    functions: new Set(['fn-auth', 'fn-report', 'fn-file', 'fn-webhook']),
    vercelRoutes: new Set(),
  });
  const kinds = problems.map((p) => p.slice(0, 1) + p.split(' ')[1]).sort().join(',');
  if (problems.length !== 2 || !problems.some((p) => p.includes('fn-file')) || !problems.some((p) => p.includes('fn-gone'))) {
    bad.push(`should flag exactly fn-file (①) and fn-gone (②), got ${kinds}`);
  }
  if (bad.length) {
    console.error(`[check-proxy-allowlist] 自检失败 —— 检测器本身有问题:\n  ${bad.join('\n  ')}`);
    process.exit(2);
  }
}

selfTest();

const sources = walk('src').map((file) => ({ file: relative('.', file), text: readFileSync(file, 'utf8') }));
const { calls, unresolved, helpers } = frontendCalls(sources);
const allowed = allowedOf(readFileSync(PROXY, 'utf8'));
const functions = new Set(
  readdirSync(FUNCTIONS_DIR).filter((d) => !d.startsWith('_') && existsSync(join(FUNCTIONS_DIR, d, 'index.ts'))),
);
const vercelRoutes = new Set(
  [...calls.keys()].filter((n) => existsSync(join('api', `${n}.ts`)) || existsSync(join('api', n))),
);

const problems = [...unresolved.map((u) => `③ ${u}`), ...compare({ calls, allowed, functions, vercelRoutes })];
if (problems.length) {
  console.error(`[check-proxy-allowlist] ${problems.length} 处问题:\n\n  ${problems.join('\n  ')}\n`);
  console.error(`  修法:前端要调的函数加进 ${PROXY} 的 ALLOWED;不存在的函数从 ALLOWED 里删掉。`);
  process.exit(1);
}
const notFromBrowser = allowed.filter((n) => !calls.has(n));
console.log(
  `[check-proxy-allowlist] OK —— 前端调用的 ${calls.size} 个函数都在 ALLOWED 里` +
    `(helper 自动发现:${helpers.join(', ') || '无'});ALLOWED 的 ${allowed.length} 个都在 ${FUNCTIONS_DIR}/ 下。` +
    (notFromBrowser.length ? ` ALLOWED 里前端没调用的:${notFromBrowser.join(', ')}(不报 —— 可能来自别处)。` : ''),
);
