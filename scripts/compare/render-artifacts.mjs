// Render the report PDF and both share cards from a built dist, with a fixed report payload, the same way api/render-pdf.ts does.
// Usage: node render-artifacts.mjs --dist <dir> --payload <json> --out <dir>
// Steps copied from render-pdf.ts: report viewport 900x1400 @2x, wait __REPORT_READY__, page.pdf A4 + printBackground + same margins;
// share card viewport 1080x1920 @1x, wait __CARD_READY__, element screenshots of #share-card-square / #share-card-tall.
// /api/assessment-report is answered in-browser with the payload (locale set per language); nothing else under /api is allowed.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const DIST = arg('--dist');
const OUT = arg('--out');
const base = JSON.parse(readFileSync(arg('--payload'), 'utf8'));
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/api/')) { res.writeHead(404); res.end('{"error":"not in fixture"}'); return; }
  let file = join(DIST, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const appBase = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const log = [];
try {
  for (const lang of ['zh', 'en']) {
    const payload = { ...base, locale: lang };
    const page = await browser.newPage();
    const disallowed = [];
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin === appBase && u.pathname === '/api/assessment-report') {
        r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      } else if (u.origin === appBase && u.pathname.startsWith('/api/')) {
        disallowed.push(u.pathname);
        r.respond({ status: 404, contentType: 'application/json', body: '{"error":"not in fixture"}' });
      } else r.continue();
    });
    page.on('pageerror', (e) => log.push(`[${lang}] pageerror ${e instanceof Error ? e.message : e}`));
    page.on('console', (m) => { if (m.type() === 'error') log.push(`[${lang}] console ${m.text().slice(0, 200)}`); });

    await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 2 });
    await page.goto(`${appBase}/report?rt=local-fixture&lang=${lang}`, { waitUntil: 'networkidle0', timeout: 45_000 });
    await page.waitForFunction('window.__REPORT_READY__ === true', { timeout: 30_000 });
    const pdf = await page.pdf({ format: 'a4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
    writeFileSync(join(OUT, `report-${lang}.pdf`), pdf);

    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.goto(`${appBase}/share-card?rt=local-fixture&lang=${lang}`, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.waitForFunction('window.__CARD_READY__ === true', { timeout: 20_000 });
    for (const id of ['share-card-square', 'share-card-tall']) {
      const el = await page.$(`#${id}`);
      const box = await el.boundingBox();
      log.push(`[${lang}] ${id} ${Math.round(box.width)}x${Math.round(box.height)}`);
      await el.screenshot({ path: join(OUT, `card-${lang}-${id.replace('share-card-', '')}.png`) });
    }
    if (disallowed.length) log.push(`[${lang}] unexpected api calls: ${disallowed.join(', ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(OUT, 'render.log'), log.join('\n') + '\n');
console.log(log.join('\n'));
