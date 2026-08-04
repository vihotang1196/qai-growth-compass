#!/usr/bin/env node
/**
 * 部署后冒烟检查 —— 验证 /api 代理链真的通。
 *
 * 用法:
 *   node scripts/smoke-deploy.mjs --base https://compass.qiai.tech
 *   npm run smoke -- --base https://compass.qiai.tech
 *
 * 【为什么必须有这个,而且必须在部署后跑】
 * `api/[...path].ts` 这条链**没有任何本地检查能覆盖**:
 *   - 本地 `vite dev` 走 VITE_API_PROXY,那个文件根本不参与
 *   - 构建链五道门是静态检查,不发请求
 *   - `deploy` 只保证部署成功,不保证代理能用
 * 所以「本地全绿 + 部署成功」与「代理能用」之间原本是零检查 ——
 * 第一版的路径解析错误(assessment-auth 明明在白名单里却 404)正是这么漏到生产的。
 *
 * 这跟之前六次「守卫覆盖不到」不同:那六次是边界画小了,补一下就能覆盖;
 * 这次是**本地根本没有能覆盖它的地方**,要真跑起来才测得到。
 * 所以答案不是再加一道构建门,而是把检查移到部署之后。
 *
 * 【选用例的原则:零写入】
 * 冒烟检查会在生产上跑,所以每一条都不能留下数据。用无效 token 走 auth ——
 * 那只做一次索引查询然后返回 /expired,不建 session、不下 cookie、不写任何表。
 * 刻意【不】测 assessment-login-request 的 POST:那会写一行 login_attempts
 * 并消耗 IP 限流额度。改用 GET 换 405,同样能证明代理解析出了正确的函数名。
 */

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const base = (baseIdx >= 0 ? args[baseIdx + 1] : process.env.APP_BASE_URL ?? '')?.replace(/\/$/, '');

if (!base) {
  console.error('用法: node scripts/smoke-deploy.mjs --base https://compass.qiai.tech');
  process.exit(2);
}

/** @type {{name: string, run: () => Promise<string|null>}[]} */
const checks = [
  {
    name: '代理把 GET 转给 assessment-auth(证明函数名解析正确)',
    async run() {
      const res = await fetch(`${base}/api/assessment-auth`, { method: 'GET' });
      const body = await res.text();
      if (res.status === 404) {
        return `404 —— 代理没解析出函数名。这正是第一版的失败形态。响应:${body.slice(0, 120)}`;
      }
      if (res.status !== 405) return `期望 405,实际 ${res.status}:${body.slice(0, 120)}`;
      return null;
    },
  },
  {
    name: '代理把 GET 转给 assessment-login-request',
    async run() {
      const res = await fetch(`${base}/api/assessment-login-request`, { method: 'GET' });
      if (res.status === 404) return '404 —— 函数名没解析出来或不在白名单里';
      if (res.status !== 405) return `期望 405,实际 ${res.status}`;
      return null;
    },
  },
  {
    name: '无效 token 走完整链路:代理 → 函数 → 数据库 → /expired,且不下 cookie',
    async run() {
      const res = await fetch(`${base}/api/assessment-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'smoke-test-token-that-does-not-exist', lang: 'zh' }),
      });
      const text = await res.text();
      if (res.status !== 200) return `期望 200,实际 ${res.status}:${text.slice(0, 160)}`;

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        // 拿到 HTML 说明 SPA 的 rewrite 把 /api 也吃掉了
        return `响应不是 JSON —— vercel.json 的 rewrite 可能把 /api 也重写到 index.html 了。前 120 字:${text.slice(0, 120)}`;
      }
      if (parsed.target !== '/expired?lang=zh') {
        return `期望 target=/expired?lang=zh,实际 ${JSON.stringify(parsed)}`;
      }
      // 无效 token 绝不能下 session cookie
      const setCookie = res.headers.getSetCookie?.() ?? [];
      if (setCookie.length) return `无效 token 却下了 cookie:${setCookie.join(' | ')}`;
      return null;
    },
  },
  {
    name: '白名单外的函数名 → 404 JSON(不是 SPA 的 HTML)',
    async run() {
      const res = await fetch(`${base}/api/definitely-not-a-real-function`, { method: 'POST' });
      if (res.status !== 404) return `期望 404,实际 ${res.status}`;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) {
        return `期望 JSON,实际 content-type=${ct} —— rewrite 可能把 /api 吃掉了`;
      }
      return null;
    },
  },
  {
    name: '前端首页能加载(SPA rewrite 正常)',
    async run() {
      const res = await fetch(`${base}/`);
      if (!res.ok) return `期望 2xx,实际 ${res.status}`;
      const html = await res.text();
      if (!html.includes('<div id="root">')) return '首页 HTML 里没有 #root,构建产物可能不对';
      return null;
    },
  },
];

console.log(`\n冒烟检查 → ${base}\n`);

let failed = 0;
for (const check of checks) {
  let error;
  try {
    error = await check.run();
  } catch (err) {
    error = `请求本身失败:${err instanceof Error ? err.message : String(err)}`;
  }
  if (error) {
    failed += 1;
    console.error(`  ✗ ${check.name}\n      ${error}`);
  } else {
    console.log(`  ✓ ${check.name}`);
  }
}

console.log('');
if (failed) {
  console.error(`[smoke] FAILED —— ${failed}/${checks.length} 条未通过`);
  process.exit(1);
}
console.log(`[smoke] OK —— ${checks.length}/${checks.length} 条通过。零写入,可反复跑。`);
