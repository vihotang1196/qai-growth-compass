import type { VercelRequest, VercelResponse } from '@vercel/node';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

/**
 * 中文字体探针 —— Stage 1 的硬验收项(PROGRESS.md 0.15)。
 *
 * Lambda 里的 Chromium 没有任何中文系统字体,不装兜底字体的话报告里全是方块。
 * 这个端点在真实的部署环境里渲一页中文并截图,让「字体到底行不行」在 Stage 1
 * 就有答案,而不是等 Stage 9 做完 PDF 才发现要推翻方案。
 *
 * 验两件事,缺一不可:
 *   1. 常用字走 CDN 上的 subset woff2  → 正常显示
 *   2. 生僻字(subset 里没有)回落到 chromium.font() 装的完整 Noto Sans SC
 *      → 也必须正常显示,不能是方块
 *
 * 第 2 条依赖 @font-face 家族名与系统字体家族名【不同】。若两者同名,
 * @font-face 会遮蔽系统字体,回落永远不会发生。见 PROGRESS.md 0.14 坑 1。
 *
 * 用法:GET /api/font-probe?secret=<INTERNAL_FN_SECRET>
 * 返回:image/png 截图,人眼看一下有没有方块。
 */

const COMMON = '盈利增长罗盘诊断报告';
// 这些字几乎不可能出现在常用 3500 字 subset 里 —— 专门用来触发系统字体回落
const RARE = '䶮 龘 靐 齉 麤 нет';
// 子模块标记不再验字符 —— 已改成纯 CSS 方块,不依赖字体收录。
// 见 src/styles/brutalist.css 的 .qai-mark。

function cdnBase(): string {
  const raw = process.env.CDN_FONT_BASE ?? 'https://cdn.qiai.tech/fonts/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function html(): string {
  const b = cdnBase();
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
</style></head><body>
  <div class="row"><div class="tag">1. common glyphs / subset woff2</div>
    <div class="big">${COMMON}</div>
    <div class="big bold">${COMMON}</div></div>
  <div class="row"><div class="tag">2. rare glyphs / fontconfig fallback</div>
    <div class="big">${RARE}</div>
    <div class="big bold">${RARE}</div></div>
  <div class="row"><div class="tag">3. latin + numerals</div>
    <div class="big">AI Growth Compass — 72 / 100</div></div>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.INTERNAL_FN_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let browser;
  try {
    // 系统级中文兜底:fontconfig 只认 ttf/otf,不认 woff2
    await chromium.font(`${cdnBase()}NotoSansSC-Regular.otf`);

    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 });
    await page.setContent(html(), { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');

    const png = await page.screenshot({ type: 'png', fullPage: true });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(png));
  } catch (err) {
    return res.status(500).json({
      error: 'probe_failed',
      message: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      cdnBase: cdnBase(),
    });
  } finally {
    await browser?.close();
  }
}
