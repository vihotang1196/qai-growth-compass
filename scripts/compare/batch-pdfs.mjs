// Render report PDFs (zh + en) for every test person with a result in snap.json, from one dist. Same steps as render-artifacts.mjs.
// Usage: node batch-pdfs.mjs --dist <dir> --snap <snap.json> --out <dir>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const puppeteer = require('puppeteer-core');

const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const DIST = arg('--dist');
const OUT = arg('--out');
mkdirSync(OUT, { recursive: true });
const snap = JSON.parse(readFileSync(arg('--snap'), 'utf8'));
const people = Object.entries(snap.reports)
  .filter(([, v]) => v.test)
  .map(([k, v]) => [k, JSON.parse(v.report)])
  .filter(([, r]) => r.result)
  .map(([k, r]) => [k, { ...r, survey: {}, files: ['zh', 'en'].map((l) => ({ lang: l, availability: 'absent', url: null, cardUrl: null, cardTallUrl: null })), pdfStatus: 'pending', pdfUrl: null, cardUrl: null, cardTallUrl: null }]);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(DIST, path);
  if (path.startsWith('/api/') || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const appBase = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let n = 0;
try {
  for (const [key, payload] of people) {
    for (const lang of ['zh', 'en']) {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.origin === appBase && u.pathname === '/api/assessment-report') r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...payload, locale: lang }) });
        else if (u.origin === appBase && u.pathname.startsWith('/api/')) r.respond({ status: 404, body: '{}' });
        else r.continue();
      });
      await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 2 });
      await page.goto(`${appBase}/report?rt=local-fixture&lang=${lang}`, { waitUntil: 'networkidle0', timeout: 45_000 });
      await page.waitForFunction('window.__REPORT_READY__ === true', { timeout: 30_000 });
      writeFileSync(join(OUT, `${key}-${lang}.pdf`), await page.pdf({ format: 'a4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } }));
      await page.close();
      n++;
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} PDFs from ${people.length} test people -> ${OUT}`);
