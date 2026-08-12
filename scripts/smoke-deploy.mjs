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

import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

/**
 * 我们自己签发的 session cookie 名。
 * 必须与 supabase/functions/_shared/session.ts 的 SESSION_COOKIE
 * 以及 api/[...path].ts 的 FORWARDED_COOKIES 一致。
 */
const SESSION_COOKIE = 'compass_session';

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
      /**
       * 【按 cookie 名判定,不按有无判定】
       *
       * 第一版写的是「有任何 Set-Cookie 就算失败」,结果被 Supabase 边缘层的
       * `__cf_bm`(Cloudflare bot 管理)撞红 —— 那跟我们的 session 毫无关系。
       *
       * 断言写宽了会产出假红,而假红比没有断言更糟:它会让人开始怀疑整个 smoke,
       * 然后跳过它。真正的不变量只有一条 —— 无效 token 不能创建 session。
       */
      const ours = (res.headers.getSetCookie?.() ?? []).filter((c) =>
        c.trimStart().startsWith(`${SESSION_COOKIE}=`),
      );
      if (ours.length) return `无效 token 却签发了 session:${ours.join(' | ')}`;
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
  {
    /**
     * 【线上 bundle 里烘的 anon key 是不是当前那把】
     *
     * `VITE_SUPABASE_ANON_KEY` 是 **build-time** 的:Vite 构建时把它替换成字面量,
     * 编译进 dist。所以轮换 key 之后【只改 Vercel 环境变量是不够的,必须重新构建部署】。
     *
     * 【为什么必须有这条检查】漏了重新构建的症状是 **Admin 登录坏掉**,
     * 而不是任何一处报「key 旧了」—— 前端拿着一把已失效的 anon key 去 Supabase Auth,
     * 得到的是一个语义无关的鉴权错误。那属于「配置改了但产物没改」那一族,
     * 与 `supabase secrets set` 成功但函数没重载、以及本文件开头那次代理 404 同形:
     * **两个东西属于同一个部署,却各自按不同的时刻取值。**
     *
     * 手法照抄 `api/font-probe.ts` 的 checkBundleBase:抓自己站点的 HTML → 模块脚本 →
     * 在 JS 里找那个字面量。anon key 本来就是要发到浏览器的公开凭证,
     * 拿它做比对不额外泄露任何东西(**service_role 绝不能这样比**)。
     *
     * 【拿不到本地值时报 unverified,不算通过】没设 SUPABASE_ANON_KEY 就说拿不出证据 ——
     * 让一次「没法比」伪装成「比过了」正是这套检查最该避免的事。
     */
    name: '线上 bundle 里烘的公开 key = 当前的 publishable / anon key(换 key 后必须重新构建)',
    async run() {
      /**
       * 【比对对象跟着迁移走】迁移后前端用的是 publishable key,变量名和值都变了。
       * 这条检查不跟着改的话,它会在迁移完成后开始【假红】——
       * 而一条会假红的检查很快就会被人习惯性忽略,那正是它失效的方式
       * (判断标准 1 的推论二:守卫误报和漏报一样坏)。
       * 两代都接受,新的优先 —— 与运行时那几处同一个顺序。
       */
      const expected = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
      if (!expected) {
        return (
          'unverified:本地既没有 SUPABASE_PUBLISHABLE_KEY 也没有 SUPABASE_ANON_KEY,无法比对 —— ' +
          '这不算通过。换 key 之后请带上它再跑一次。'
        );
      }
      const htmlRes = await fetch(`${base}/`, { redirect: 'follow' });
      if (!htmlRes.ok) return `unverified:首页 ${htmlRes.status}`;
      const html = await htmlRes.text();
      const m = /<script[^>]+src="([^"]+\.js)"/i.exec(html);
      if (!m) return 'unverified:首页 HTML 里找不到模块脚本';

      const jsUrl = new URL(m[1], base).toString();
      const jsRes = await fetch(jsUrl);
      if (!jsRes.ok) return `unverified:bundle ${jsRes.status}`;
      const js = await jsRes.text();

      if (js.includes(expected)) return null;
      /**
       * 【不匹配时报什么,是这条检查唯一容易做废的地方】
       *
       * 第一版报的是两边各头 12 个字符 —— 而 JWT 的头部对同一个 alg 是【完全一样的】,
       * 于是输出成了 `bundle=eyJhbGciOiJI… local=eyJhbGciOiJI…`:
       * 门确实红了,可它说的话没法照着行动(判断标准 9)。
       * 是真跑了一次红路径才发现的,不是读代码读出来的。
       *
       * 现在报两样:
       *   fp —— sha256 前 8 位。永远能区分,而且不泄露 key 的任何片段。
       *          修完重新部署再跑一次,两个 fp 相等就是好了。
       *   iat —— 从 JWT payload 解出来的签发时间(base64url,公开元数据)。
       *          它直接说明【哪一把是旧的】,而那才是这条错误要回答的问题。
       */
      /**
       * 【两代 key 的形状不同,都要能抓到】legacy 是三段 JWT;
       * 新 key 是 `sb_publishable_…`。只认 JWT 的话,迁移后这条错误会说
       * 「没找到 JWT 形状的串」—— 那句话把「bundle 里是新 key」误报成「抓不到」。
       */
      const bundled =
        /sb_publishable_[A-Za-z0-9_-]+/.exec(js)?.[0] ??
        /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(js)?.[0] ??
        null;
      const fp = (v) => createHash('sha256').update(v).digest('hex').slice(0, 8);
      /** legacy JWT 能解出签发日,新 key 不是 JWT —— 解不出就说 n/a,不装作有 */
      const issued = (v) => {
        if (!v || !v.startsWith('eyJ')) return 'n/a';
        try {
          const payload = JSON.parse(Buffer.from(v.split('.')[1], 'base64url').toString());
          return payload.iat ? new Date(payload.iat * 1000).toISOString().slice(0, 10) : '?';
        } catch {
          return '?';
        }
      };
      const kind = (v) => (v?.startsWith('sb_publishable_') ? 'publishable' : v ? 'legacy' : '?');
      return (
        `bundle 里的公开 key 与本地的不一致 —— 多半是改了环境变量但没重新构建部署。` +
        `bundle: ${kind(bundled)} fp=${bundled ? fp(bundled) : '(抓不到)'} iat=${issued(bundled)} | ` +
        `local: ${kind(expected)} fp=${fp(expected)} iat=${issued(expected)}`
      );
    },
  },
];

/**
 * ── 每个 cron 端点从【公网】访问时是否到达我们的代码 ──
 *
 * ⚠️ **这一组证明的是「公网可达」,不是「cron 在跑」。两者不是一回事。**
 *
 * 【为什么必须把这句话写在最前面】这一组的第一版把判据写成「函数有没有执行」,
 * 并在失败信息里断言「所以这条日程会每天成功而从不运行」——**那个推断被观测推翻了**:
 * `/api/cron/retention` 从公网 curl 确实回 `200 + text/html`,
 * 而 Supabase 侧 `assessment-maintenance` 的 Invocations 显示它**连续五天每天准点跑过**
 * (排期 `17 3 * * *` UTC,记录在 11:17 UTC+8 —— 时区正好对上)。
 * 所以 Vercel Cron 走的那条路与公网 curl 不是同一条,而当时我们两个都基于那个错推断
 * 往下走了好几步。见判断标准 14。
 *
 * 【那它还有什么用】它捕捉的是一个**差异**:`pdf-sweep` 回 401 JSON,
 * 而同目录的 `retention` 回 200 HTML。**同一个目录两个函数表现不同不是设计出来的状态** ——
 * 那本身值得查,即使后果不是「cron 没跑」。而且这是「人手动触发」时会走的那条路,
 * 我给出的手动验收步骤全靠它。
 *
 * 【判据:未鉴权时回 401 JSON】不带 Authorization 时只有我们自己的代码会回 401 + JSON。
 * 满足零写入原则(401 走不到任何副作用),也不需要任何凭据。
 *
 * 【要验「cron 真的在跑」,只有下游效果算证据】Vercel 的 cron 历史里 200 是成功,
 * 所以那不算;算的是被调用方的调用记录(本例:`assessment-maintenance` 的 Invocations)
 * 或那个函数自己的日志。**那是观测,这一组是推理。**
 *
 * 【覆盖范围从文件系统推导,不手写】新增一个 cron 函数会自动被这一组覆盖 ——
 * 手写清单的话,下一个 cron 照样会漏(判断标准 12)。
 */
const cronFiles = readdirSync(new URL('../api/cron/', import.meta.url))
  .filter((f) => f.endsWith('.ts'))
  .sort();

if (cronFiles.length === 0) {
  // 一条都没发现,本身就是问题 —— 而不是「没什么要检查的」
  checks.push({
    name: 'cron 端点清单非空',
    async run() {
      return 'api/cron/ 下一个 .ts 都没有 —— 要么目录挪了,要么这段发现逻辑坏了';
    },
  });
}

for (const file of cronFiles) {
  const route = `/api/cron/${file.replace(/\.ts$/, '')}`;
  checks.push({
    name: `${route} 从公网可达(未鉴权 → 401 JSON,不是 200 HTML)`,
    async run() {
      const res = await fetch(`${base}${route}`);
      const ct = res.headers.get('content-type') ?? '';
      const body = (await res.text()).slice(0, 200);

      if (res.status === 200 && ct.includes('text/html')) {
        return (
          `200 + text/html —— 这条路径从公网没有到达函数,请求被静态产物接住了。\n` +
          `      ⚠️ 【这不代表 cron 没在跑】retention 就是反例:它从公网回 HTML,` +
          `而被调用方的 Invocations 显示它连续五天准点执行。Vercel Cron 走的不是这条路。\n` +
          `      要判断 cron 死活,看【下游效果】——被调用方的调用记录,或该函数自己的日志。` +
          `Vercel 的 cron 历史里 200 也是成功,那不算证据。\n` +
          `      这条红说明的是:同目录其他 cron 回 401 JSON 而这条回 HTML,` +
          `而那不是设计出来的状态;另外你手动 curl 触发这个端点是行不通的。` +
          `body=${JSON.stringify(body.slice(0, 60))}`
        );
      }
      if (res.status === 401 && ct.includes('application/json')) return null;
      if (res.status === 500 && ct.includes('application/json')) {
        // 我们自己的 server_misconfigured 也证明函数执行了,但要说出来
        return `500 JSON —— 函数执行到了,但配置缺失(多半是 CRON_SECRET 没配):${body}`;
      }
      return `期望 401 JSON,实际 ${res.status} ${ct} —— body=${JSON.stringify(body.slice(0, 120))}`;
    },
  });
}

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
