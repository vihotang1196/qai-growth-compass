#!/usr/bin/env node
/**
 * 后台在手机宽度下的版面检查(本地,真浏览器)—— 2026-10-14 加。
 *
 * 【守什么】英文后台在 390px 宽的手机上,顶上那排标签(最后一个「Live mode」)比屏幕宽,把整页撑到 461px;
 * 手机浏览器于是把「布局视口」也撑宽,页面上所有居中的 fixed 元素(确认框)都按 461 居中 —— 看起来偏右、右边被切掉。
 * vitest 这边只有 renderToStaticMarkup,量不到宽度,所以这一项用真浏览器量。
 *
 * 【查什么】中 / 英 × 390 / 360 宽,每一种:
 *   1. 页面不比屏幕宽:`innerWidth` 等于设定的宽度,`documentElement.scrollWidth` 不超过它(超了就列出最右边越界的元素)
 *   2. 点第一行的「换新链接」:确认框整个在屏幕里,左右留白相差不超过 1px(居中)
 *   3. 按 Esc 关掉:没有发出 rotate 请求
 *   4. 顶栏与标签那一排的每个按钮,字都在一行里(中文原来没撑宽,是因为字被挤成两行「学员名 / 单」—— 同一个问题的另一种样子)
 *
 * 【不连任何后端】要先起离线预览(.claude/launch.json 的 `compass-dev-offline`,VITE_SUPABASE_URL=http://127.0.0.1:9);
 * 登录状态是页面里一条本地占位 session(不是真 token),后台接口由页面里的假 fetch 回答(假名字、假电话),请求不出浏览器。
 *
 * 用法:node scripts/e2e/admin-mobile-layout.mjs [--base http://localhost:5174] [--shots <目录>]
 * Chrome:默认 macOS 的 Google Chrome;别的位置用 CHROME_PATH。
 * 退出码:全过 0;有一项不过 1;跑不起来(连不上预览、找不到元素)2。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'http://localhost:5174');
const SHOTS = arg('--shots', null);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROTATE_LABEL = { zh: '换新链接', en: 'New link' };
const CASES = ['zh', 'en'].flatMap((lang) => [390, 360].map((width) => ({ lang, width })));

/** 在页面脚本之前装好:本地占位 session + 假后台接口。只用假数据 */
function installFakes() {
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem(
    'sb-127-auth-token',
    JSON.stringify({
      access_token: 'local-preview-not-a-token',
      refresh_token: 'local-preview-not-a-token',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: now + 86400,
      user: {
        id: '00000000-0000-4000-8000-000000000000',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'preview@local.invalid',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-10-14T00:00:00Z',
      },
    }),
  );
  const cohort = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Demo cohort (fake)', is_test: false };
  const mk = (i, name, phone, email, total) => ({
    id: `e0000000-0000-4000-8000-00000000000${i}`, name, lang: 'zh', warnings: null,
    phone_e164: phone, phone_raw: phone, email_lower: email, status: total == null ? 'link_sent' : 'completed',
    first_login_at: '2026-10-12T11:00:00Z', completed_at: total == null ? null : '2026-10-12T12:30:00Z',
    link_sent_at: '2026-10-12T10:00:00Z', access_revoked_at: null, cohort,
    session: total == null ? null : {
      id: `s0000000-0000-4000-8000-00000000000${i}`, status: 'completed', attempt_no: 1,
      result: { total, tier: 'spot', weakest: ['capture', 'convert'] },
      files: [{ lang: 'zh', pdf_status: 'ready', pdf_path: 'x.pdf', pdf_attempts: 1, pdf_last_error: null, share_card_error: null }],
    },
  });
  const rows = [
    mk(1, 'Demo Tan Ah Kow Bin Abdullah', '+60123450001', 'ahkow.tan@example.test', 3.2),
    mk(2, 'Demo Lim Mei Ling', '+60123450002', 'meiling@example.test', null),
  ];
  window.__adminCalls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/assessment-admin')) {
      const body = JSON.parse(init?.body ?? '{}');
      window.__adminCalls.push(body.action);
      const reply = body.action === 'roster'
        ? { rows, testRows: 0, stats: { total: rows.length, unparseablePhones: 0, unparseableRatio: 0, thresholdExceeded: false } }
        : { ok: true, queued: true };
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
}

/**
 * 页面里量:宽度,以及越界的元素(只报最外一层,里面跟着越界的子元素不重复报)。
 * 越界按**屏幕宽度**算,不按 innerWidth —— 页面一旦被撑宽,浏览器连 innerWidth 一起撑大,按它量就什么都不越界了
 */
function measureWidth(vw) {
  const offenders = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('[data-radix-portal], [data-testid=confirm-dialog]')) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1) continue;
    // 自己在一个横向滚动的容器里(名单表格)不算 —— 那是容器里的滚动,不撑宽页面
    let p = e.parentElement;
    let scrolled = false;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { scrolled = true; break; }
      p = p.parentElement;
    }
    if (scrolled) continue;
    const pr = e.parentElement?.getBoundingClientRect();
    if (pr && pr.right > vw + 1) continue;
    offenders.push(`${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 24)}" right=${Math.round(r.right)}`);
  }
  // 顶栏与标签:每个按钮的字占几行(一段文字的 getClientRects 每行一个矩形)
  const wrapped = [];
  for (const b of document.querySelectorAll('main header button, main nav button')) {
    const range = document.createRange();
    range.selectNodeContents(b);
    const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
    if (tops.size > 1) wrapped.push(`"${b.textContent}" on ${tops.size} lines`);
  }
  return { innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 5), wrapped };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const results = [];
let broken = null;
try {
  for (const { lang, width } of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(installFakes);
    try {
      await page.goto(`${BASE}/admin?lang=${lang}`, { waitUntil: 'networkidle0', timeout: 30_000 });
    } catch (err) {
      broken = `cannot load ${BASE}/admin —— is the offline preview running? (${err instanceof Error ? err.message : err})`;
      break;
    }
    const label = ROTATE_LABEL[lang];
    const found = await page
      .waitForFunction((l) => [...document.querySelectorAll('button')].some((b) => b.textContent === l), { timeout: 10_000 }, label)
      .then(() => true)
      .catch(() => false);
    if (!found) {
      broken = `${lang}/${width}: roster did not render (no "${label}" button) —— body: ${(await page.evaluate(() => document.body.innerText)).slice(0, 160)}`;
      break;
    }
    const w = await page.evaluate(measureWidth, width);
    const tag = `${lang}-${width}`;
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: join(SHOTS, `admin-${tag}.png`) });
    }

    await page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.textContent === l).click(), label);
    const dialog = await page
      .waitForSelector('[data-testid=confirm-dialog]', { timeout: 5_000 })
      .then(() =>
        page.evaluate(() => {
          const r = document.querySelector('[data-testid=confirm-dialog]').getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
        }),
      )
      .catch(() => null);
    if (SHOTS && dialog) await page.screenshot({ path: join(SHOTS, `admin-${tag}-dialog.png`) });
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
    const calls = await page.evaluate(() => window.__adminCalls);

    const problems = [];
    if (w.innerWidth !== width) problems.push(`layout viewport is ${w.innerWidth}px on a ${width}px screen`);
    if (w.scrollWidth > width) problems.push(`page is ${w.scrollWidth}px wide`);
    if (w.offenders.length) problems.push(`sticks out: ${w.offenders.join('; ')}`);
    if (w.wrapped.length) problems.push(`label wraps: ${w.wrapped.join('; ')}`);
    if (!dialog) problems.push('confirm dialog did not open');
    else {
      if (dialog.left < 0 || dialog.right > width) problems.push(`dialog ${dialog.left}..${dialog.right} is not inside 0..${width}`);
      const skew = Math.abs(dialog.left - (width - dialog.right));
      if (skew > 1) problems.push(`dialog off-centre by ${skew}px (left gap ${dialog.left}, right gap ${width - dialog.right})`);
    }
    if (calls.includes('rotate')) problems.push('Escape sent a rotate request');
    results.push({ tag, problems });
    await page.close();
  }
} finally {
  await browser.close();
}

if (broken) {
  console.error(`[admin-mobile-layout] could not run: ${broken}`);
  process.exit(2);
}
for (const r of results) console.log(`  ${r.problems.length ? 'FAIL' : 'ok  '}  ${r.tag}${r.problems.length ? `  —— ${r.problems.join(' | ')}` : ''}`);
const failed = results.filter((r) => r.problems.length).length;
console.log(`\n[admin-mobile-layout] ${failed === 0 ? 'OK' : `${failed} of ${results.length} failed`} —— zh / en × 390 / 360${SHOTS ? `; screenshots in ${SHOTS}` : ''}`);
process.exit(failed === 0 ? 0 : 1);
