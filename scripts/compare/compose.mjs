// Side-by-side comparison sheet rendered by headless Chrome (no image tools on this machine).
// Usage: node compose.mjs out.png "Title" colWidth "Caption A=/abs/a.png" "Caption B=/abs/b.png" [--row] ...
// Images are laid out left to right; "--row" starts a new row.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const [out, title, colWidth, ...items] = process.argv.slice(2);
const rows = [[]];
for (const it of items) {
  if (it === '--row') { rows.push([]); continue; }
  const i = it.indexOf('=');
  rows.at(-1).push({ caption: it.slice(0, i), src: pathToFileURL(it.slice(i + 1)).href });
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#fff;font:15px -apple-system,'PingFang SC',sans-serif;color:#141414}
h1{font-size:20px;margin:0 0 16px} .row{display:flex;gap:24px;align-items:flex-start;margin-bottom:28px}
figure{margin:0;width:${colWidth}px} figcaption{font-weight:600;margin-bottom:8px;font-size:14px;white-space:pre-line}
img{width:100%;border:1px solid #bbb;display:block}
</style><h1>${esc(title)}</h1>${rows.map((r) => `<div class="row">${r.map((f) => `<figure><figcaption>${esc(f.caption)}</figcaption><img src="${f.src}"></figure>`).join('')}</div>`).join('')}`;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage();
const widest = Math.max(...rows.map((r) => r.length));
await page.setViewport({ width: 48 + widest * Number(colWidth) + (widest - 1) * 24, height: 800, deviceScaleFactor: 1 });
const tmp = out.replace(/\.png$/, '.html');
(await import('node:fs')).writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
