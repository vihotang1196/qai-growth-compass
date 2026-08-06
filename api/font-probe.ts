import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, timingSafeEqual } from 'node:crypto';
/**
 * ⚠️ 必须排在 @sparticuz/chromium 之前 —— 见 api/_lib/lambdaEnv.ts。
 * font-probe 与 render-pdf 起的是同一个 Chromium,缺 NSS 的问题一模一样;
 * 只修 render-pdf 的话,这个探针会继续 500,而它恰好是我们用来判断环境好坏的那把尺。
 */
import { assertChromiumEnvReady, installFallbackFont } from './_lib/lambdaEnv.js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

/**
 * 中文字体探针 —— Stage 1 的硬验收项(PROGRESS.md 0.15)。
 *
 * Lambda 里的 Chromium 没有任何中文系统字体,不装兜底字体的话报告里全是方块。
 * 这个端点在真实的部署环境里渲一页中文并截图,让「字体到底行不行」在 Stage 1
 * 就有答案,而不是等 Stage 9 做完 PDF 才发现要推翻方案。
 *
 * 验三件事:
 *   1. 常用字走 CDN 上的 subset woff2  → 正常显示
 *   2. 生僻字(subset 里【故意】没有,见 scripts/subset-fonts.mjs 的
 *      FALLBACK_PROBE_CHARS)回落到 chromium.font() 装的完整 otf → 也必须正常显示
 *   3. VITE_CDN_FONT_BASE 与 CDN_FONT_BASE 是否指向同一个地方
 *
 * 第 2 条依赖 @font-face 家族名与系统字体家族名【不同】。若两者同名,
 * @font-face 会遮蔽系统字体,回落永远不会发生。见 PROGRESS.md 0.14 坑 1。
 *
 * 用法:
 *   curl -sS -H "X-Internal-Secret: $INTERNAL_FN_SECRET" \
 *     "https://compass.qiai.tech/api/font-probe" -o probe.png
 *
 * 【secret 走 header 不走 query】query string 会落进 Vercel 访问日志、浏览器历史
 * 和任何中间代理的日志。与 GHL_RESEND_WEBHOOK_URL 同一条标准:是 secret 就别放 URL。
 */

const COMMON = '盈利增长罗盘诊断报告';
/**
 * 这几个字被 scripts/subset-fonts.mjs 显式排除在 subset 之外,
 * 并由该脚本断言「必须不在 subset 内」—— 所以它们在这里出现,
 * 就是真的在考 fontconfig 兜底层,不会被 subset 顺手满足。
 */
const RARE = '䶮 龘 靐 齉 麤';

function cdnBase(): string {
  const raw = process.env.CDN_FONT_BASE ?? 'https://cdn.qiai.tech/fonts/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** 定长比较,避免逐字符比较泄露前缀信息。先哈希以消除长度差异 */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

type BaseCheck = {
  status: 'match' | 'mismatch' | 'unverified';
  detail: string;
};

/**
 * 把前端 bundle 里烘进去的 VITE_CDN_FONT_BASE 抠出来,与服务端的 CDN_FONT_BASE 比对。
 *
 * 【为什么能做】两个值虽然一个在 bundle、一个在运行时,但它们属于【同一个部署】——
 * 探针可以 fetch 自己站点的 HTML 与 JS,Vite 在构建时已把 VITE_ 的值替换成字面量。
 * 所以这不是靠眼睛对照,是程序化比对。
 *
 * 【比较的是「生效值」而不是「环境变量有没有设」】任一侧没设都会回落到代码里的
 * 默认值,而真正要防的是「网页从一个 CDN 取字体、PDF 从另一个取」——
 * 只要两边生效值相同就没问题,与各自怎么拿到的无关。
 *
 * 【抓不到就报 unverified,绝不当作通过】—— 拿不出证据就说拿不出,
 * 不能让一个抓取失败伪装成一致。
 */
async function checkBundleBase(origin: string): Promise<BaseCheck> {
  const serverBase = cdnBase().replace(/\/$/, '');
  try {
    const htmlRes = await fetch(origin, { redirect: 'follow' });
    if (!htmlRes.ok) {
      return { status: 'unverified', detail: `HTML ${htmlRes.status}` };
    }
    const html = await htmlRes.text();
    const m = /<script[^>]+src="([^"]+\.js)"/i.exec(html);
    if (!m) return { status: 'unverified', detail: 'no module script in HTML' };

    const jsUrl = new URL(m[1], origin).toString();
    const jsRes = await fetch(jsUrl);
    if (!jsRes.ok) return { status: 'unverified', detail: `JS ${jsRes.status}` };
    const js = await jsRes.text();

    if (js.includes(serverBase)) {
      return { status: 'match', detail: serverBase };
    }
    const found = /https?:\/\/[^"'`\s]*?\/fonts/.exec(js);
    return {
      status: 'mismatch',
      detail: found ? `bundle=${found[0]}  server=${serverBase}` : `server=${serverBase}, bundle=?`,
    };
  } catch (err) {
    return {
      status: 'unverified',
      detail: err instanceof Error ? err.message.slice(0, 80) : 'fetch failed',
    };
  }
}

function html(base: BaseCheck): string {
  const b = cdnBase();
  const badge =
    base.status === 'match' ? 'MATCH' : base.status === 'mismatch' ? 'MISMATCH' : 'UNVERIFIED';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  /* 与前端 src/styles/fonts.ts 保持同一套家族名 */
  @font-face { font-family:'Noto Sans SC Subset'; font-weight:400; font-display:block;
               src:url('${b}NotoSansSC-Regular.subset.woff2') format('woff2'); }
  @font-face { font-family:'Noto Sans SC Subset'; font-weight:700; font-display:block;
               src:url('${b}NotoSansSC-Bold.subset.woff2') format('woff2'); }
  body { margin:0; padding:40px; background:#fff; color:#141414;
         font-family:'Plus Jakarta Sans','Noto Sans SC Subset','Noto Sans SC',sans-serif; }
  .row { border:2px solid #141414; padding:20px; margin-bottom:20px; box-shadow:4px 4px 0 #141414; }
  .tag { font-size:12px; letter-spacing:2px; text-transform:uppercase; opacity:.6; }
  .big { font-size:40px; line-height:1.4; }
  .bold { font-weight:700; }
  .mono { font-family:ui-monospace,Menlo,monospace; font-size:15px; line-height:1.7; word-break:break-all; }
  .badge { display:inline-block; border:2px solid #141414; padding:2px 10px; font-weight:700;
           background:${base.status === 'match' ? '#fed50a' : '#141414'};
           color:${base.status === 'match' ? '#141414' : '#fff'}; }
</style></head><body>
  <div class="row"><div class="tag">1. common glyphs / subset woff2</div>
    <div class="big">${COMMON}</div>
    <div class="big bold">${COMMON}</div></div>
  <div class="row"><div class="tag">2. rare glyphs / fontconfig fallback (excluded from subset by design)</div>
    <div class="big">${RARE}</div>
    <div class="big bold">${RARE}</div></div>
  <div class="row"><div class="tag">3. latin + numerals</div>
    <div class="big">AI Growth Compass — 72 / 100</div></div>
  <div class="row"><div class="tag">4. cdn base consistency</div>
    <div class="mono">
      <span class="badge">${badge}</span><br>
      CDN_FONT_BASE (server) = ${b}<br>
      ${base.status === 'match' ? 'bundle 里烘进的 VITE_CDN_FONT_BASE 与之相同' : base.detail}
    </div></div>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.INTERNAL_FN_SECRET;
  const provided = req.headers['x-internal-secret'];
  if (
    !expected ||
    typeof provided !== 'string' ||
    !secretMatches(provided, expected)
  ) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
  const host = req.headers.host ?? '';
  const baseCheck = await checkBundleBase(`${proto}://${host}`);

  let browser;
  try {
    // 系统级中文兜底:fontconfig 认 otf / ttf,不认 woff2
    assertChromiumEnvReady();
    // 与 render-pdf 共用一份:下载 + 复制进 fontconfig 真的会扫的目录 + 校验落地
    const font = await installFallbackFont((u) => chromium.font(u), `${cdnBase()}NotoSansSC-Regular.otf`);
    console.log(`CJK fallback font ready: ${font.path} (${font.bytes} bytes)`);

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
    await page.setContent(html(baseCheck), { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');

    const png = await page.screenshot({ type: 'png', fullPage: true });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    // 不用看图也能拿到结论,方便 curl -I 或脚本消费
    res.setHeader('X-Cdn-Base-Check', baseCheck.status);
    res.setHeader('X-Cdn-Base-Detail', baseCheck.detail.replace(/[^\x20-\x7e]/g, ''));
    return res.status(200).send(Buffer.from(png));
  } catch (err) {
    return res.status(500).json({
      error: 'probe_failed',
      message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      cdnBase: cdnBase(),
      cdnBaseCheck: baseCheck,
    });
  } finally {
    await browser?.close();
  }
}
