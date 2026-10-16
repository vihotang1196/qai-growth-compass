#!/usr/bin/env node
/**
 * 后台「重填开关」—— 本地真浏览器检查(重填第 5 步的准备,2026-10-16 加)。
 *
 * 【守什么】vitest 那边只有 renderToStaticMarkup 与注入的假确认框:点不了真按钮、按不了 Esc、量不了宽度。这里在真浏览器里:
 *   1. 顶栏有「重填开关」;打开后台**不**多发请求 —— 点开面板才读(开发模式 StrictMode 下读两遍,生产一遍)
 *   2. 关着(一行都没有):说「关闭」,只给「开放重填」,切换记录说「还没有切换过」,并说明关闭只拦新的、测试批次不受影响
 *   3. 点「开放重填」→ 网站自己的确认框(标题是「开放」那一句);按 Esc → 一个设开关的请求都没发,仍是关
 *   4. 再点、按确认 → 正好一个请求 `{ action: 'retake_switch_set', open: true }`(布尔,不是「切换」)→ 说「开放」,按钮变「关闭重填」,记录一行
 *   5. 点「关闭重填」→ 确认框说「已经开始的照样能做完或放弃」→ 确认 → `{ open: false }` → 说「关闭」,记录两行、新的在前
 *   6. 读不到(接口 500):说「读不到、学员按关闭处理」,只给「关闭重填」,不说「没切换过」
 *   7. 设的时候失败(500):显示错误,并重读一次
 *   8. 页面与确认框都不比屏幕宽;「关闭」收起面板
 * 中 / 英 × 电脑 1366 / 手机 390。
 *
 * 【不连任何后端】要先起离线预览(.claude/launch.json 的 `compass-dev-offline`,VITE_SUPABASE_URL=http://127.0.0.1:9);
 * 登录状态是页面里一条本地占位 session(不是真 token),后台接口由页面里的假 fetch 回答,请求不出浏览器。
 *
 * 用法:node scripts/e2e/admin-retake-switch-preview.mjs [--base http://localhost:5174] [--shots <目录>]
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

const T = {
  zh: {
    header: '重填开关', closed: '现在:关闭', open: '现在:开放', unreadable: '读不到开关现在的状态',
    scope: '关闭只拦「开始新的重填」', turnOn: '开放重填', turnOff: '关闭重填', empty: '还没有切换过',
    confirmOn: '对真实学员开放重填?', confirmOff: '关闭真实学员的重填?', offBody: '已经开始的那一份照样能做完或放弃',
    histOn: '开放', histOff: '关闭', reload: '重新读取', close: '关闭',
  },
  en: {
    header: 'Retake switch', closed: 'Now: CLOSED', open: 'Now: OPEN', unreadable: 'Cannot read the switch right now',
    scope: 'Closing only stops new retakes from starting', turnOn: 'Open retakes', turnOff: 'Close retakes', empty: 'Never changed',
    confirmOn: 'Open retakes to real students?', confirmOff: 'Close retakes for real students?', offBody: 'can still be finished or discarded',
    histOn: 'Opened', histOff: 'Closed', reload: 'Reload', close: 'Close',
  },
};

/** 在页面脚本之前装好:本地占位 session + 假后台接口(开关是一张只追加的假表)。只用假数据 */
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
        id: '00000000-0000-4000-8000-000000000000', aud: 'authenticated', role: 'authenticated',
        email: 'preview@local.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-10-14T00:00:00Z',
      },
    }),
  );
  window.__adminCalls = [];
  window.__switchRows = [];
  window.__failRead = false;
  window.__failSet = false;
  const state = () => ({ open: window.__switchRows[0]?.open === true, readable: true, recent: window.__switchRows.slice(0, 20) });
  const realFetch = window.fetch.bind(window);
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/assessment-admin')) {
      const body = JSON.parse(init?.body ?? '{}');
      window.__adminCalls.push(body);
      if (body.action === 'roster') return reply({ rows: [], testRows: 0, stats: { total: 0, unparseablePhones: 0, unparseableRatio: 0, thresholdExceeded: false } });
      if (body.action === 'retake_switch') return window.__failRead ? reply({ error: 'internal_error', kind: 'query_failed', code: '42P01' }, 500) : reply(state());
      if (body.action === 'retake_switch_set') {
        if (typeof body.open !== 'boolean') return reply({ error: 'open must be true or false' }, 400);
        if (window.__failSet) return reply({ error: 'internal_error', kind: 'query_failed', code: '42501' }, 500);
        window.__switchRows.unshift({ open: body.open, by: 'preview@local.invalid', at: new Date().toISOString() });
        return reply(state());
      }
      return reply({ ok: true });
    }
    return realFetch(url, init);
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** innerText 会套用 CSS 的 uppercase(按钮、标题是大写的)—— 英文按不分大小写比 */
const has = (text, x) => text.toLowerCase().includes(x.toLowerCase());

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const results = [];
let broken = null;
const check = (tag, what, ok, seen) => results.push({ tag, what, ok: !!ok, seen });

try {
  for (const lang of ['zh', 'en']) {
    for (const [device, vp] of [
      ['desktop', { width: 1366, height: 900 }],
      ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ]) {
      const t = T[lang];
      const tag = `${lang}-${device}`;
      const page = await browser.newPage();
      await page.setViewport(vp);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.evaluateOnNewDocument(installFakes);
      try {
        await page.goto(`${BASE}/admin?lang=${lang}`, { waitUntil: 'networkidle0', timeout: 30_000 });
      } catch (err) {
        broken = `cannot load ${BASE}/admin —— is the offline preview running? (${err instanceof Error ? err.message : err})`;
        break;
      }
      const btn = (label, root = 'main') =>
        page.evaluate(
          (lbl, r) => {
            const b = [...document.querySelectorAll(`${r} button`)].find((x) => x.textContent.trim().toLowerCase() === lbl.toLowerCase());
            return b ? { disabled: b.disabled, busy: b.getAttribute('aria-busy') } : null;
          },
          label,
          root,
        );
      const click = (label, root = 'main') =>
        page.evaluate(
          (lbl, r) => {
            const b = [...document.querySelectorAll(`${r} button`)].find((x) => x.textContent.trim().toLowerCase() === lbl.toLowerCase());
            if (!b) return false;
            b.click();
            return true;
          },
          label,
          root,
        );
      const calls = (action) => page.evaluate((a) => window.__adminCalls.filter((c) => c.action === a), action);
      const panelText = () =>
        page.evaluate(() => {
          const s = document.querySelector('[data-switch-status]');
          return s ? s.closest('div.space-y-4')?.innerText ?? s.parentElement.innerText : null;
        });
      const status = () => page.evaluate(() => document.querySelector('[data-switch-status]')?.getAttribute('data-switch-status') ?? null);
      const waitStatus = (want) =>
        page.waitForFunction((w) => document.querySelector('[data-switch-status]')?.getAttribute('data-switch-status') === w, { timeout: 5_000 }, want).then(() => true).catch(() => false);
      const dialog = () =>
        page.evaluate(() => {
          const d = document.querySelector('[data-testid="confirm-dialog"]');
          if (!d) return null;
          const r = d.getBoundingClientRect();
          return { text: d.innerText, left: Math.round(r.left), right: Math.round(r.right) };
        });
      const waitDialog = (open) =>
        page.waitForFunction((o) => !!document.querySelector('[data-testid="confirm-dialog"]') === o, { timeout: 5_000 }, open).then(() => true).catch(() => false);

      const ready = await page
        .waitForFunction((x) => [...document.querySelectorAll('header button')].some((b) => b.textContent.trim().toLowerCase() === x.toLowerCase()), { timeout: 10_000 }, t.header)
        .then(() => true)
        .catch(() => false);
      if (!ready) {
        broken = `${tag}: no "${t.header}" button —— body: ${(await page.evaluate(() => document.body.innerText)).slice(0, 200)}`;
        break;
      }

      // 1. 进后台不读开关
      await sleep(300);
      check(tag, 'admin load sends no retake_switch request', (await calls('retake_switch')).length === 0, await calls('retake_switch'));
      check(tag, 'panel hidden until opened', (await status()) === null);

      // 2. 打开:关着
      await click(t.header, 'header');
      const closed = await waitStatus('closed');
      const p0 = (await panelText()) ?? '';
      // 开发模式的 StrictMode 会把挂载时的 effect 跑两遍(生产一遍)—— 这里只要求「点开之后才读」
      check(tag, 'opened: read now, says closed', closed && (await calls('retake_switch')).length >= 1 && has(p0, t.closed), p0.slice(0, 120));
      check(tag, 'closed: offers only "open"', (await btn(t.turnOn)) && !(await btn(t.turnOff)));
      check(tag, 'closed: scope note + "never changed"', has(p0, t.scope) && has(p0, t.empty), p0);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `retake-switch-${tag}-closed.png`) });
      }

      // 3. 开放 → Esc
      await click(t.turnOn);
      check(tag, 'open: confirm dialog shows', await waitDialog(true));
      const d1 = await dialog();
      check(tag, 'open: dialog asks about opening', d1 && has(d1.text, t.confirmOn), d1?.text);
      check(tag, 'dialog fits the screen', d1 && d1.left >= 0 && d1.right <= vp.width, d1);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `retake-switch-${tag}-confirm-on.png`) });
      check(tag, 'nothing sent while the dialog is open', (await calls('retake_switch_set')).length === 0);
      await page.keyboard.press('Escape');
      check(tag, 'Esc closes the dialog', await waitDialog(false));
      await sleep(300);
      check(tag, 'Esc: no set request, still closed', (await calls('retake_switch_set')).length === 0 && (await status()) === 'closed');

      // 4. 开放 → 确认
      await click(t.turnOn);
      await waitDialog(true);
      check(tag, 'confirm button clicked', await click(t.turnOn, '[data-testid="confirm-dialog"]'));
      const opened = await waitStatus('open');
      const sets1 = await calls('retake_switch_set');
      check(tag, 'exactly one request, { open: true } as a boolean', sets1.length === 1 && sets1[0].open === true && Object.keys(sets1[0]).sort().join() === 'action,open', sets1);
      const p1 = (await panelText()) ?? '';
      check(tag, 'now says open, offers only "close", one history line', opened && has(p1, t.open) && (await btn(t.turnOff)) && !(await btn(t.turnOn)) && has(p1, 'preview@local.invalid'), p1);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `retake-switch-${tag}-open.png`) });

      // 5. 关闭 → 确认
      await click(t.turnOff);
      await waitDialog(true);
      const d2 = await dialog();
      check(tag, 'close: dialog asks about closing and says started ones can finish or be discarded', d2 && has(d2.text, t.confirmOff) && has(d2.text, t.offBody), d2?.text);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `retake-switch-${tag}-confirm-off.png`) });
      await click(t.turnOff, '[data-testid="confirm-dialog"]');
      const closedAgain = await waitStatus('closed');
      const sets2 = await calls('retake_switch_set');
      check(tag, 'second request is { open: false }', closedAgain && sets2.length === 2 && sets2[1].open === false, sets2);
      const lines = await page.evaluate(() => [...document.querySelectorAll('[data-switch-status]')].flatMap((s) => [...s.closest('div.space-y-4').querySelectorAll('li')].map((li) => li.innerText.trim())));
      check(tag, 'two history lines, newest (closed) first', lines.length === 2 && has(lines[0], t.histOff) && has(lines[1], t.histOn), lines);

      // 6. 读不到
      await page.evaluate(() => (window.__failRead = true));
      await click(t.reload);
      const unread = await waitStatus('unreadable');
      const p3 = (await panelText()) ?? '';
      check(tag, 'unreadable: says so, offers only "close", no "never changed"', unread && has(p3, t.unreadable) && (await btn(t.turnOff)) && !(await btn(t.turnOn)) && !has(p3, t.empty), p3);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `retake-switch-${tag}-unreadable.png`) });

      // 7. 设的时候失败
      await page.evaluate(() => {
        window.__failRead = false;
        window.__failSet = true;
      });
      await click(t.reload);
      await waitStatus('closed');
      const readsBefore = (await calls('retake_switch')).length;
      await click(t.turnOn);
      await waitDialog(true);
      await click(t.turnOn, '[data-testid="confirm-dialog"]');
      await page.waitForFunction(() => !!document.querySelector('[role="alert"]'), { timeout: 5_000 }).catch(() => {});
      const alert = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? null);
      check(tag, 'set failed: error shown, state re-read, still closed', alert?.includes('42501') && (await calls('retake_switch')).length === readsBefore + 1 && (await status()) === 'closed', { alert });
      await page.evaluate(() => (window.__failSet = false));

      // 8. 宽度、收起
      const w = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
      check(tag, 'page not wider than the screen', w.scroll <= vp.width, w);
      const closeLabel = lang === 'zh' ? '关闭' : 'Close';
      await page.evaluate((lbl) => {
        const s = document.querySelector('[data-switch-status]');
        const b = [...s.closest('div.space-y-4').querySelectorAll('button')].find((x) => x.textContent.trim().toLowerCase() === lbl.toLowerCase());
        b?.click();
      }, closeLabel);
      await sleep(300);
      check(tag, '"close" hides the panel', (await status()) === null);
      await page.close();
    }
    if (broken) break;
  }
} finally {
  await browser.close();
}

if (broken) {
  console.error(`✗ ${broken}`);
  process.exit(2);
}
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} [${r.tag}] ${r.what}${r.ok ? '' : `  —— ${JSON.stringify(r.seen)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
