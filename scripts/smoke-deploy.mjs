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
 *
 * 【两类检查,两个退出码】
 *   deploy(默认)—— 「这次部署好没好」:代理、rewrite、bundle 里的 key、cron 可达
 *   config        —— 「线上配置对不对」:改它要人去 Dashboard 点,不是重新部署能修的
 *
 *   exit 0  全部通过
 *   exit 1  有 deploy 检查没过 —— 这次部署有问题
 *   exit 3  deploy 全过,只有 config 没过 —— 部署本身没问题,线上配置还没到位
 *   (exit 2 是用法错误,见下面 --base)
 *
 * 为什么要分:config 那几条的修法排在**前端上线之后**(例:关自助注册必须等新版
 * AdminLogin 上线,否则旧页面会把 422 原文显示出来)。如果它们和 deploy 检查共用
 * exit 1,前端上线后的验收就永远过不了 —— 而关注册又要等验收过了才做:死锁。
 * 分开之后,部署验收看「部署检查」那一行;config 那条照样红、照样非零,直到配置改对。
 * **它不会变成一条可以忽略的绿** —— 那正是「打印了但不判断」(判断标准 2)。
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

/**
 * 线上首页引用的那个模块脚本 —— 两条检查共用,只抓一次。
 * 失败时返回 `{ error }`,由调用方加 `unverified:` 前缀(措辞沿用原先那条 key 检查)。
 *
 * 【为什么从 bundle 取,而不是从本地环境变量取】要回答的是「线上这个页面**实际**
 * 连的是什么」—— 本地变量说的是「应该连什么」,那是两个东西。
 */
let bundlePromise = null;
function fetchBundle() {
  bundlePromise ??= (async () => {
    const htmlRes = await fetch(`${base}/`, { redirect: 'follow' });
    if (!htmlRes.ok) return { error: `首页 ${htmlRes.status}` };
    const html = await htmlRes.text();
    const m = /<script[^>]+src="([^"]+\.js)"/i.exec(html);
    if (!m) return { error: '首页 HTML 里找不到模块脚本' };
    const jsRes = await fetch(new URL(m[1], base).toString());
    if (!jsRes.ok) return { error: `bundle ${jsRes.status}` };
    return { js: await jsRes.text() };
  })();
  return bundlePromise;
}

const uniq = (matches) => [...new Set(matches ?? [])];

/** @type {{kind?: 'deploy'|'config', name: string, run: () => Promise<string|null>}[]} */
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
      const bundle = await fetchBundle();
      if (bundle.error) return `unverified:${bundle.error}`;
      const { js } = bundle;

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
  {
    /**
     * 【线上 Auth 关闭了自助注册】GET `/auth/v1/settings`(公开端点,零写入),
     * 断言 `disable_signup === true`。
     *
     * 为什么前端那层不够:AdminLogin 已经显式传 `shouldCreateUser: false`,
     * 但那只管得住**这个页面**。公开 key 就在 bundle 里,注册开着时任何人都能直接调
     * `/auth/v1/signup` 或 `/otp` 建 auth.users 行、让我们的发件身份发信。
     *
     * 【查的是哪个项目】Supabase URL 与公开 key 都从线上 bundle 里取 ——
     * 也就是后台登录页**实际在连**的那个项目。只打印 project ref,不打印 key。
     *
     * 【kind: config】它红的时候 exit 3,不是 1 —— 修法是去 Dashboard 关开关,
     * 而那一步按上线顺序排在前端上线之后。见文件头「两类检查,两个退出码」。
     */
    kind: 'config',
    name: '线上 Auth 关闭了自助注册(/auth/v1/settings → disable_signup === true)',
    async run() {
      const bundle = await fetchBundle();
      if (bundle.error) return `unverified:${bundle.error}`;

      const urls = uniq(bundle.js.match(/https:\/\/[a-z0-9]+\.supabase\.co/g));
      if (urls.length !== 1) {
        return `unverified:bundle 里有 ${urls.length} 个 Supabase URL,期望 1 个 —— 说不清后台连的是哪个项目`;
      }
      // 与上面那条 key 检查同一个优先级:新的 publishable 优先,legacy JWT 兜底
      const publishable = uniq(bundle.js.match(/sb_publishable_[A-Za-z0-9_-]+/g));
      const keys = publishable.length
        ? publishable
        : uniq(bundle.js.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g));
      if (keys.length !== 1) {
        return `unverified:bundle 里有 ${keys.length} 把公开 key 形状的串,期望 1 把`;
      }

      const ref = new URL(urls[0]).hostname.split('.')[0];
      const res = await fetch(`${urls[0]}/auth/v1/settings`, { headers: { apikey: keys[0] } });
      if (!res.ok) {
        return (
          `unverified:project ${ref} 的 /auth/v1/settings 回 ${res.status}` +
          `(401 多半是 bundle 里那把 key 已失效 —— 看上面那条 key 检查)`
        );
      }
      let settings;
      try {
        settings = await res.json();
      } catch {
        return `unverified:project ${ref} 的 /auth/v1/settings 不是 JSON`;
      }

      const value = settings?.disable_signup;
      if (value === true) return null;
      if (value === false) {
        return (
          `project ${ref} 开着自助注册(disable_signup=false)—— 任何人都能用公开 key\n` +
          `      建 auth.users 行、让我们的发件身份发信。\n` +
          `      修法:Dashboard → Authentication → 关掉「Allow new users to sign up」。\n` +
          `      ⚠️ 顺序:在新版 AdminLogin 上线之后(否则旧页面会把 422 原文显示出来),\n` +
          `      在接自定义 SMTP 之前。见 PROGRESS「线上 Auth 配置」。`
        );
      }
      /**
       * 兜底:既不是 true 也不是 false。**落在失败侧,而且用自己的字样** ——
       * 借「开着注册」的名字会让人去 Dashboard 查一件没发生的事,
       * 而落在通过侧就是这道检查自己被一次改名悄悄关掉了。
       */
      return (
        `无法判定:project ${ref} 的 disable_signup 是 ${JSON.stringify(value)},不是布尔值 ——\n` +
        `      字段可能改名了,这条检查可能要改。收到的键:${Object.keys(settings ?? {}).join(', ')}`
      );
    },
  },
];

/**
 * ── 每个 cron 端点从【公网】访问时是否到达我们的代码 ──
 *
 * 【它机械地验证什么】不带 Authorization 请求 `api/cron/` 下每一个函数的路由,
 * 断言拿到 **401 + JSON**。只有我们自己的代码会回这个组合,所以它是
 * 「请求到达了函数」的证据;`200 + text/html` 说明请求被静态产物接住了。
 *
 * 【它不验证什么 —— 这一句必须在】**它不验证 cron 在跑。**
 * Vercel 的 cron 执行历史里 200 就是成功,所以那也不算证据。
 * 要判断 cron 死活,只有**下游效果**算:被调用方的调用记录(本项目:Supabase 侧
 * `assessment-maintenance` 的 Invocations)或该函数自己的日志。
 *
 * 【为什么这段注释被改过三次】前两版都在这里写**叙事** ——
 * 第一版断言「这条日程会每天成功而从不运行」(被 Invocations 推翻),
 * 第二版拿「retention 从公网回 HTML」当反例(**后来不复现**,
 * Vercel Logs 显示它 401 + 函数执行 87ms)。
 * 那个起点其实是一次**截断的输出**(`head -3`)造成的观测失误。
 * 教训:**守卫的文本只写它机械验证的事实 + 下一步去哪看,不写因果叙事** ——
 * 叙事会过期,而过期的叙事会以「工具说的」的身份传给下一个人。见判断标准 14。
 *
 * 【它的实际用处】「人手动 curl 触发某个 cron」这条路全靠它 ——
 * 手动验收步骤要能跑,得先确认公网这条路是通的。
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
          `      ⚠️ 这【不能】推出 cron 没在跑:两者不一定是同一条路,而 Vercel 的 cron\n` +
          `      历史里 200 也是成功。要判断 cron 死活只看下游效果 ——\n` +
          `      被调用方的调用记录,或该函数自己的日志(Vercel Logs 里筛这个 Route)。\n` +
          `      这条红本身说明的是:手动 curl 触发这个端点行不通。\n` +
          `      body=${JSON.stringify(body.slice(0, 60))}`
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

const tally = { deploy: { failed: 0, total: 0 }, config: { failed: 0, total: 0 } };
for (const check of checks) {
  // 没写 kind 的一律按 deploy 算 —— 默认落在更严的那一侧(exit 1)
  const kind = check.kind === 'config' ? 'config' : 'deploy';
  const tag = kind === 'config' ? '[配置] ' : '';
  tally[kind].total += 1;
  let error;
  try {
    error = await check.run();
  } catch (err) {
    error = `请求本身失败:${err instanceof Error ? err.message : String(err)}`;
  }
  if (error) {
    tally[kind].failed += 1;
    console.error(`  ✗ ${tag}${check.name}\n      ${error}`);
  } else {
    console.log(`  ✓ ${tag}${check.name}`);
  }
}

const line = ({ failed, total }) => `${total - failed}/${total} 通过`;
console.log('');
console.log(`[smoke] 部署检查:${line(tally.deploy)}`);
console.log(`[smoke] 配置期望:${line(tally.config)}`);
if (tally.deploy.failed) {
  console.error(`[smoke] FAILED —— 部署检查有 ${tally.deploy.failed} 条未通过(exit 1)`);
  process.exit(1);
}
if (tally.config.failed) {
  console.error(
    `[smoke] 部署检查全部通过;配置期望有 ${tally.config.failed} 条未满足(exit 3)—— ` +
      `部署本身没问题,线上配置还没到位`,
  );
  process.exit(3);
}
console.log(`[smoke] OK —— ${checks.length}/${checks.length} 条通过。零写入,可反复跑。`);
