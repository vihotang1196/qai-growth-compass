#!/usr/bin/env node
/**
 * 守「src 里不再出现浏览器原生弹窗」—— `window.confirm` / `alert` / `prompt`。**第十八道门**(2026-10-14,Viho 的第 2 个优化)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要一道门】原生弹窗的样子由浏览器决定,不跟网站的设计走;手机上是一个系统框,
 * 而且一些内嵌浏览器(GHL / WhatsApp 里点开的链接)会直接吞掉它 —— `confirm` 静默返回 false,
 * 「换链接」「作废」点了没反应。网站自己的确认框在 `src/components/ConfirmProvider.tsx`(`useConfirm()`)。
 * 标本:改之前 `src/pages/admin/Roster.tsx` 里的两行 `window.confirm`(换链接、作废) —— 对着那时的代码跑,正好报这两行。
 *
 * 【判据】用 ESLint 的作用域分析,不用正则 —— 正则分不清「全局的 confirm」和「自己起名叫 confirm 的参数」。两条规则:
 *   - `no-restricted-globals`    引用全局的那个名字,调不调用都算:`confirm(…)`、`const c = confirm`、`onClick={alert}`
 *   - `no-restricted-properties` 从 window / globalThis / self / top / parent / frames 上取这三个,调不调用都算:
 *                                `window.confirm(…)`、`window['confirm'](…)`、`const { prompt } = window`
 *   同名的局部变量 / 参数 / 别的对象上的同名属性(`opts.confirm`)都放过 —— 那不是浏览器的弹窗。
 *   **没有用 ESLint 自带的 `no-alert`**:把它加上、再把它单独关掉跑自检,一条都不少报 —— 它管的调用上面两条全管了,
 *   留着只会让一行报两次。现在这两条各自关掉时,自检分别错 5 条、10 条。
 *
 * 【范围】`src/**` 的 .ts / .tsx,含测试。`api/` 与 `supabase/functions/` 跑在服务器上,没有这三个。
 * 代码里的 `// eslint-disable…` 在这道门里不生效(noInlineConfig)—— 要放行一处,得改这个文件,在评审里看得见。
 *
 * 【盲区 —— 写在这里,不装作覆盖了】
 *   - 绕一层再取:`const w = window; w.confirm(…)`、`(0, window.confirm)(…)` 里的 window 是一个普通变量 —— 不报
 *   - 字符串拼出来的属性名(`window['con' + 'firm']`)—— 不报
 *   - `window.print()`(Report.tsx 的「打印 / 存 PDF」)是浏览器的打印框,不在这三个里,也没有网站自己的替代 —— 刻意不管
 *
 * 【退出码】有命中 → 1;没有 → 0;自检失败(含「一个文件都没扫到」)→ 2。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { relative } from 'node:path';

const NAMES = ['alert', 'confirm', 'prompt'];
const HOSTS = ['window', 'globalThis', 'self', 'top', 'parent', 'frames'];
const MESSAGE = 'Use the site dialog instead: const ask = useConfirm() from src/components/ConfirmProvider.tsx.';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      linterOptions: { reportUnusedDisableDirectives: 'off', noInlineConfig: true },
      rules: {
        'no-restricted-globals': ['error', ...NAMES.map((name) => ({ name, message: MESSAGE }))],
        'no-restricted-properties': [
          'error',
          ...HOSTS.flatMap((object) => NAMES.map((property) => ({ object, property, message: MESSAGE }))),
        ],
      },
    },
  ],
});

/** 一段代码里有几处(按行去重:一行里写两次算一处) */
async function findNativeDialogs(code, filePath = 'src/__native_dialogs_self_test__.tsx') {
  const [result] = await eslint.lintText(code, { filePath });
  const fatal = result.messages.filter((m) => m.fatal);
  if (fatal.length) throw new Error(`parse error in ${filePath}: ${fatal[0].message}`);
  const byLine = new Map();
  for (const m of result.messages) if (!byLine.has(m.line)) byLine.set(m.line, m);
  return [...byLine.values()];
}

/**
 * 自检(判断标准 0 / 1):先证明它抓得到标本那一行的原样写法与它的几种变体,也证明它放过替代写法。
 * 跑不过就 exit 2。
 */
async function selfTest() {
  const mustFlag = [
    // 标本:改之前 Roster.tsx 的原样两行
    "if (action === 'rotate' && !window.confirm(tk('admin.confirmRotate'))) return;",
    "if (action === 'revoke' && !window.confirm(tk('admin.confirmRevoke'))) return;",
    "window.alert('saved');",
    "const v = window.prompt('name?');",
    "if (!confirm('sure?')) return;",
    "alert('x');",
    "globalThis.confirm('x');",
    "window['confirm']('x');",
    "window.confirm?.('x');",
    "self.alert('x');",
    'const c = window.confirm;',
    'const { prompt } = window;',
    'const f = confirm;',
    "export const B = () => <button onClick={() => alert('x')}>x</button>;",
    'export const C = () => <button onClick={alert}>x</button>;',
  ];
  const mustPass = [
    // 替代写法
    "const ask = useConfirm();\nif (!(await ask({ title: tk('admin.confirmRotate.title') }))) return;",
    // 同名参数 / 局部变量:不是浏览器的那个
    'function run(confirm: () => boolean) { return confirm(); }',
    'const alert = makeAlert(); alert.show();',
    // 别的对象上的同名属性、字符串、注释
    "const opts = { confirm: 'ok', prompt: 'p' }; use(opts.confirm, opts.prompt);",
    "tk('common.confirm'); tk('admin.password.confirm');",
    "const s = 'window.confirm is gone';",
    "// window.confirm('x')\n/* alert('x') */\nconst n = 1;",
    // 打印框不在这三个里(盲区里写明了)
    'window.print();',
  ];
  const bad = [];
  for (const s of mustFlag) if ((await findNativeDialogs(s)).length !== 1) bad.push(`should flag once:\n${s}`);
  for (const s of mustPass) if ((await findNativeDialogs(s)).length !== 0) bad.push(`should not flag:\n${s}`);
  if (bad.length) {
    console.error(`[check-native-dialogs] self-test failed —— the detector itself is wrong:\n\n${bad.join('\n\n')}`);
    process.exit(2);
  }
  return mustFlag.length + mustPass.length;
}

const selfCases = await selfTest();
const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
if (results.length === 0) {
  console.error('[check-native-dialogs] scanned 0 files under src/ —— the glob is wrong, not the code.');
  process.exit(2);
}

const findings = [];
for (const r of results) {
  const fatal = r.messages.find((m) => m.fatal);
  if (fatal) {
    console.error(`[check-native-dialogs] cannot parse ${relative('.', r.filePath)}: ${fatal.message}`);
    process.exit(2);
  }
  const seen = new Set();
  for (const m of r.messages) {
    if (seen.has(m.line)) continue;
    seen.add(m.line);
    findings.push({ file: relative('.', r.filePath), line: m.line, rule: m.ruleId });
  }
}

if (findings.length === 0) {
  console.log(
    `[check-native-dialogs] OK —— no window.confirm / alert / prompt in ${results.length} file(s) under src/ (self-test ${selfCases}/${selfCases}).`,
  );
  process.exit(0);
}

for (const f of findings) console.log(`  ${f.file}:${f.line}  (${f.rule})`);
console.log(
  `\n[check-native-dialogs] ${findings.length} native browser dialog(s) in src/.\n` +
    `  ${MESSAGE}\n` +
    `  Self-test ${selfCases}/${selfCases}.`,
);
process.exit(1);
