// Full-page screenshots of the student and admin pages from a built dist, phone and desktop, Chinese UI.
// Usage: node shoot-pages.mjs --dist <dir> --payload <report json> --out <dir>
// Every /api/* call is answered in the browser with fixed fake data; nothing leaves the machine except font downloads from the public CDN.
// Admin uses a local placeholder session (not a real token). Reduced motion so nothing is caught mid-animation.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const config = require('./src/config/assessment-config.json');

const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const DIST = arg('--dist');
const OUT = arg('--out');
const report = { ...JSON.parse(readFileSync(arg('--payload'), 'utf8')), locale: 'zh' };
mkdirSync(OUT, { recursive: true });

// ── fixed fake data ────────────────────────────────────────────
const profile = Object.fromEntries(config.profile_questions.map((p) => [p.id, 1]));
const someAnswers = Object.fromEntries(config.questions.slice(0, 4).map((q) => [q.id, 1]));
const quizSnap = { locale: 'zh', profile, answers: someAnswers, status: 'in_progress', complete: false, sessionId: 's0000000-0000-4000-8000-000000000001' };
const surveySnap = { ...quizSnap, answers: Object.fromEntries(config.questions.map((q) => [q.id, 1])), status: 'survey', complete: true };
const cohort = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Demo cohort (fake)', is_test: false };
const mk = (i, name, phone, email, total, tier) => ({
  id: `e0000000-0000-4000-8000-00000000000${i}`, name, lang: 'zh', warnings: null,
  phone_e164: phone, phone_raw: phone, email_lower: email, status: total == null ? 'link_sent' : 'completed',
  first_login_at: '2026-10-12T11:00:00Z', completed_at: total == null ? null : '2026-10-12T12:30:00Z',
  link_sent_at: '2026-10-12T10:00:00Z', access_revoked_at: null, cohort,
  session: total == null ? null : {
    id: `s0000000-0000-4000-8000-00000000000${i}`, status: 'completed', attempt_no: 1,
    result: { total, tier, weakest: ['capture', 'convert'] },
    files: [{ lang: 'zh', pdf_status: 'ready', pdf_path: 'x.pdf', pdf_attempts: 1, pdf_last_error: null, share_card_error: null }],
  },
});
const rows = [
  mk(1, 'Demo Tan Ah Kow', '+60123450001', 'ahkow.tan@example.test', 3.2, 'semi_auto'),
  mk(2, 'Demo Lim Mei Ling', '+60123450002', 'meiling@example.test', 1.4, 'manual'),
  mk(3, 'Demo Wong Kar Wai', '+60198887777', 'kw.wong@example.test', null, null),
  mk(4, 'Demo Siti Aminah', '+60112223333', 'siti.aminah@example.test', 2.2, 'spot'),
];
const dims = config.dimensions.map((d) => d.key);
const dashboard = {
  scope: 'all', selectedIsTest: false, selectedName: null,
  cohorts: [{ ...cohort, event_date: '2026-10-13' }],
  aggregate: {
    n: 42, averageTotal: 1.6,
    dimensionMeans: Object.fromEntries(dims.map((k, i) => [k, [2.1, 1.4, 1.2, 1.8, 1.5][i % 5]])),
    tierCounts: Object.fromEntries(config.tiers.map((t, i) => [t.key, [26, 9, 4, 2, 1][i] ?? 0])),
    weakestCounts: Object.fromEntries(dims.map((k, i) => [k, [3, 9, 14, 6, 10][i % 5]])),
    questions: config.questions.map((q, i) => {
      const counts = Array.from({ length: q.option_count }, (_, j) => ((i + 3) * (j + 2)) % 17 + 2);
      const answered = counts.reduce((a, b) => a + b, 0);
      const top = Math.max(...counts);
      return { id: q.id, counts, answered, topShare: Math.round((top / answered) * 100) / 100, topIndex: counts.indexOf(top) };
    }),
    enoughForShares: true, minN: 5,
  },
};

function installSession() {
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem('sb-127-auth-token', JSON.stringify({
    access_token: 'local-preview-not-a-token', refresh_token: 'local-preview-not-a-token', token_type: 'bearer',
    expires_in: 86400, expires_at: now + 86400,
    user: { id: '00000000-0000-4000-8000-000000000000', aud: 'authenticated', role: 'authenticated', email: 'preview@local.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-10-14T00:00:00Z' },
  }));
}

// ── static server for the dist ─────────────────────────────────
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

function answer(r) {
  const u = new URL(r.url());
  if (u.origin !== appBase || !u.pathname.startsWith('/api/')) return r.continue();
  const body = (() => { try { return JSON.parse(r.postData() ?? '{}'); } catch { return {}; } })();
  const json = (obj) => r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
  switch (u.pathname) {
    case '/api/assessment-quiz': return json(r.url().includes('survey') ? surveySnap : globalThis.__quizMode === 'survey' ? surveySnap : quizSnap);
    case '/api/assessment-report': return json(report);
    case '/api/assessment-admin':
      if (body.action === 'roster') return json({ rows, testRows: 0, stats: { total: rows.length, unparseablePhones: 0, unparseableRatio: 0, thresholdExceeded: false } });
      if (body.action === 'cohort_dashboard') return json(dashboard);
      return json({ ok: true, queued: true });
    default: return r.respond({ status: 404, contentType: 'application/json', body: '{"error":"not in fixture"}' });
  }
}

const VIEWPORTS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1366, height: 900, deviceScaleFactor: 1 },
};
const PAGES = [
  { name: 'landing', path: '/', ready: 'input' },
  { name: 'quiz', path: '/quiz', ready: 'main button', mode: 'quiz' },
  { name: 'survey', path: '/survey', ready: 'main button', mode: 'survey' },
  { name: 'report', path: '/report', ready: () => window.__REPORT_READY__ === true },
  { name: 'admin-roster', path: '/admin', ready: '[data-testid=admin-roster-search]', admin: true },
  { name: 'live-mode', path: '/admin', ready: '[data-testid=admin-roster-search]', admin: true, tab: '现场模式' },
];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const log = [];
try {
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    for (const p of PAGES) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.setViewport(vp);
      globalThis.__quizMode = p.mode;
      await page.setRequestInterception(true);
      page.on('request', answer);
      page.on('pageerror', (e) => log.push(`[${vpName}/${p.name}] pageerror ${e instanceof Error ? e.message : e}`));
      if (p.admin) await page.evaluateOnNewDocument(installSession);
      await page.goto(`${appBase}${p.path}?lang=zh`, { waitUntil: 'networkidle0', timeout: 45_000 });
      if (typeof p.ready === 'function') await page.waitForFunction(p.ready, { timeout: 20_000 });
      else await page.waitForSelector(p.ready, { timeout: 20_000 });
      if (p.tab) {
        await page.evaluate((t) => [...document.querySelectorAll('nav button')].find((b) => b.textContent === t).click(), p.tab);
        await page.waitForNetworkIdle({ idleTime: 500 });
      }
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 800));
      const where = await page.evaluate(() => location.pathname);
      log.push(`[${vpName}/${p.name}] at ${where}`);
      await page.screenshot({ path: join(OUT, `${p.name}-${vpName}.png`) });
      await page.screenshot({ path: join(OUT, `${p.name}-${vpName}-full.png`), fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(OUT, 'shoot.log'), log.join('\n') + '\n');
console.log(log.join('\n'));
