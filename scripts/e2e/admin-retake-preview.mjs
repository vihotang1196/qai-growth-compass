#!/usr/bin/env node
/**
 * 重填第 4 步:后台的「第几次」/ 历次 / 看板的重填人数 —— 本地真浏览器检查(2026-10-16 加)。
 *
 * 【守什么】vitest 那边只有 renderToStaticMarkup:点不了按钮、量不了宽度。这里在真浏览器里点:
 *   1. 名单表头「第几次」紧跟在「完成时间」后面
 *   2. 只有一份的人:「第 1 次」,没有历次开关
 *   3. 重填过、还有一份没做完的人:「第 2 次」、「历次 3」(aria-expanded=false)、「重填中」(悬停提示「第 3 次还没做完」);总分是第 2 份的
 *   4. 点开历次:3 / 2 / 1 依次排列,「名单显示这一份」在第 2 份那一行;再点收起
 *   5. 历次里第 1 份的「查看报告」→ report_link 带的是**第 1 份**的 session id;主行的「查看报告」→ 第 2 份的
 *   6. 第 1 份「重新生成 zh」→ render_pdf {第 1 份, zh};第 1 份**没有**「重新生成 en」(另一种语言只给最新一份)
 *   7. 第 2 份(名单显示的那一份)「重新生成 en」→ render_pdf {第 2 份, en}
 *   8. 看板:全部批次「其中 0 人重填过」;测试批次「其中 1 人重填过」;旧版服务端(没有那个键)只写人数
 *   9. 现场模式那一屏没有「重填过」那一句(投影的一屏不加)
 *  10. 页面不比屏幕宽(名单表格在自己的横向滚动容器里)
 * 中 / 英 × 电脑 1366 / 手机 390。
 *
 * 【不连任何后端】要先起离线预览(.claude/launch.json 的 `compass-dev-offline`,VITE_SUPABASE_URL=http://127.0.0.1:9);
 * 登录状态是页面里一条本地占位 session(不是真 token),后台接口由页面里的假 fetch 回答(假名字、假电话),请求不出浏览器。
 *
 * 用法:node scripts/e2e/admin-retake-preview.mjs [--base http://localhost:5174] [--shots <目录>]
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
    colCompleted: '完成时间', colAttempt: '第几次', n: (n) => `第 ${n} 次`, history: (n) => `历次 ${n}`, open: '重填中', openTitle: (n) => `第 ${n} 次还没做完`,
    shown: '名单显示这一份', report: '查看报告', regen: (l) => `重新生成 ${l}`, retaken: (n) => `其中 ${n} 人重填过`, retakenPart: '人重填过',
    tabDash: '批次看板', tabLive: '现场模式', tabRoster: '学员名单',
  },
  en: {
    colCompleted: 'Completed', colAttempt: 'Attempt', n: (n) => `Attempt ${n}`, history: (n) => `All ${n}`, open: 'Retaking', openTitle: (n) => `Attempt ${n} not finished yet`,
    shown: 'Shown in the list', report: 'View report', regen: (l) => `Regenerate ${l}`, retaken: (n) => `${n} of them retook it`, retakenPart: 'retook it',
    tabDash: 'Cohort dashboard', tabLive: 'Live mode', tabRoster: 'Roster',
  },
};

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
        id: '00000000-0000-4000-8000-000000000000', aud: 'authenticated', role: 'authenticated',
        email: 'preview@local.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-10-14T00:00:00Z',
      },
    }),
  );
  const real = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Demo cohort (fake)', is_test: false };
  const test = { id: 'c0000000-0000-4000-8000-000000000002', name: 'SEED TEST (fake)', is_test: true };
  const file = (lang, pdf_status) => ({
    lang, pdf_status, pdf_path: pdf_status === 'ready' ? `x-${lang}.pdf` : null, pdf_attempts: 1,
    pdf_last_error: pdf_status === 'failed' ? 'fake render error' : null, share_card_error: null,
  });
  const attempt = (id, no, status, total, files, completed_at, created_at) => ({
    id, status, attempt_no: no, completed_at, created_at,
    result: total === null ? null : { total, tier: total >= 4 ? 'flywheel' : 'spot', weakest: ['capture', 'convert'] },
    files: total === null ? [] : files,
  });
  const one = attempt('s1000000-0000-4000-8000-000000000001', 1, 'completed', 3.2, [file('zh', 'ready')], '2026-10-12T12:30:00Z', '2026-10-12T12:10:00Z');
  const r1 = attempt('s2000000-0000-4000-8000-000000000001', 1, 'completed', 2.5, [file('zh', 'failed')], '2026-10-14T05:56:02Z', '2026-10-14T05:55:48Z');
  const r2 = attempt('s2000000-0000-4000-8000-000000000002', 2, 'completed', 5, [file('zh', 'ready')], '2026-10-15T06:32:29Z', '2026-10-15T06:32:09Z');
  const r3 = attempt('s2000000-0000-4000-8000-000000000003', 3, 'in_progress', null, [], null, '2026-10-16T06:40:54Z');
  const person = (i, name, cohort, attempts, session) => ({
    id: `e0000000-0000-4000-8000-00000000000${i}`, name, lang: 'zh', warnings: null,
    phone_e164: `+6012345000${i}`, phone_raw: `+6012345000${i}`, email_lower: `p${i}@example.test`,
    status: attempts.some((a) => a.status === 'completed') ? 'completed' : 'link_sent',
    first_login_at: attempts.length ? '2026-10-12T11:00:00Z' : null,
    completed_at: attempts.some((a) => a.status === 'completed') ? attempts[attempts.length - 1].completed_at : null,
    link_sent_at: '2026-10-12T10:00:00Z', access_revoked_at: null, cohort, session, attempts,
  });
  const rows = [
    person(1, 'Demo Once Only', real, [one], one),
    person(2, 'Demo Retaker', test, [r3, r2, r1], r2),
    person(3, 'Demo Not Started', real, [], null),
  ];
  const aggregate = (n) => ({
    n, averageTotal: 3.1, dimensionMeans: { goal: 3, traffic: 2.8, capture: 3.2, convert: 2.9, value: 3.4 },
    tierCounts: { spot: n }, weakestCounts: { capture: n }, questions: [], enoughForShares: n >= 10, minN: 10,
  });
  const cohorts = [real, test, { id: 'c0000000-0000-4000-8000-000000000003', name: 'Old server (fake)', is_test: false }].map((c) => ({ ...c, event_date: null }));
  window.__adminCalls = [];
  window.__opened = [];
  window.open = (url) => {
    window.__opened.push(String(url));
    return null;
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (String(url).includes('/api/assessment-admin')) {
      const body = JSON.parse(init?.body ?? '{}');
      window.__adminCalls.push(body);
      let reply;
      if (body.action === 'roster') {
        reply = { rows, testRows: 1, stats: { total: 2, unparseablePhones: 0, unparseableRatio: 0, thresholdExceeded: false } };
      } else if (body.action === 'cohort_dashboard') {
        const scope = body.cohort_id;
        const base = { scope, selectedIsTest: scope === test.id, selectedName: null, cohorts, aggregate: aggregate(scope === test.id ? 6 : 92) };
        // 第三个批次假装是旧版服务端:没有 retakenPeople 这个键
        reply = scope === cohorts[2].id ? base : { ...base, retakenPeople: scope === test.id ? 1 : 0 };
      } else if (body.action === 'report_link') {
        reply = { url: `about:blank#${body.session_id}`, expiresInSec: 180 };
      } else if (body.action === 'render_pdf') {
        reply = { ok: true, status: 200, detail: '' };
      } else {
        reply = { ok: true, queued: true };
      }
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
  };
}

const IDS = {
  r1: 's2000000-0000-4000-8000-000000000001',
  r2: 's2000000-0000-4000-8000-000000000002',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** innerText 会套用 CSS 的 uppercase(徽章是大写的)—— 英文按不分大小写比 */
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
      const ready = await page
        .waitForFunction((x) => [...document.querySelectorAll('th')].some((h) => h.textContent.trim() === x), { timeout: 10_000 }, t.colAttempt)
        .then(() => true)
        .catch(() => false);
      if (!ready) {
        broken = `${tag}: no "${t.colAttempt}" column —— body: ${(await page.evaluate(() => document.body.innerText)).slice(0, 200)}`;
        break;
      }

      // 1. 表头顺序
      const heads = await page.evaluate(() => [...document.querySelectorAll('thead th')].map((h) => h.textContent.trim()));
      check(tag, 'attempt column right after completed-at', heads.indexOf(t.colAttempt) === heads.indexOf(t.colCompleted) + 1, heads);

      const rowInfo = (name) =>
        page.evaluate(
          (nm, colAttempt, colTotal) => {
            const heads = [...document.querySelectorAll('thead th')].map((h) => h.textContent.trim());
            const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.querySelector('td')?.textContent.trim() === nm);
            if (!tr) return null;
            const tds = [...tr.querySelectorAll(':scope > td')];
            const cell = tds[heads.indexOf(colAttempt)];
            const toggle = cell.querySelector('button');
            return {
              attempt: cell.innerText.replace(/\s+/g, ' ').trim(),
              toggle: toggle ? { text: toggle.textContent.trim(), expanded: toggle.getAttribute('aria-expanded') } : null,
              openTitle: cell.querySelector('[title]')?.getAttribute('title') ?? null,
              cellWidth: Math.round(cell.getBoundingClientRect().width),
              total: tds[heads.indexOf(colTotal)].textContent.trim(),
            };
          },
          name,
          t.colAttempt,
          lang === 'zh' ? '总分' : 'Score',
        );

      // 2. 只有一份
      const once = await rowInfo('Demo Once Only');
      check(tag, 'one attempt: "attempt 1", no history toggle', once && once.attempt === t.n(1) && once.toggle === null, once);
      // 不到一份
      const none = await rowInfo('Demo Not Started');
      check(tag, 'not started: a dash', none && none.attempt === '—', none);

      // 测试行要先显示出来(「显示测试数据」)
      await page.evaluate((lbl) => {
        const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes(lbl));
        l?.querySelector('input')?.click();
      }, lang === 'zh' ? '测试' : 'test');
      await page.waitForFunction(() => document.body.innerText.includes('Demo Retaker'), { timeout: 5_000 }).catch(() => {});

      // 3. 重填过、还有一份没做完
      const ret = await rowInfo('Demo Retaker');
      check(
        tag,
        'retaker: attempt 2, "all 3" collapsed, retake 3 in progress, score of attempt 2',
        ret && has(ret.attempt, t.n(2)) && ret.toggle?.text === t.history(3) && ret.toggle.expanded === 'false' && has(ret.attempt, t.open)
          && ret.openTitle === t.openTitle(3) && ret.total === '5',
        ret,
      );

      // 4. 点开历次
      await page.evaluate((txt) => [...document.querySelectorAll('tbody button')].find((b) => b.textContent.trim() === txt).click(), t.history(3));
      await page.waitForSelector('[id^="history-"]', { timeout: 5_000 }).catch(() => {});
      const hist = await page.evaluate(() => {
        const td = document.querySelector('[id^="history-"]');
        if (!td) return null;
        const items = [...td.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim());
        return { items, colspan: td.getAttribute('colspan'), cells: td.closest('tbody').querySelector('tr').querySelectorAll(':scope > td').length };
      });
      check(
        tag,
        'history open: 3 / 2 / 1 in order, "shown" on attempt 2 only, full width',
        hist && hist.items.length === 3 && hist.items[0].startsWith(t.n(3)) && hist.items[1].startsWith(t.n(2)) && hist.items[2].startsWith(t.n(1))
          && has(hist.items[1], t.shown) && !has(hist.items[0], t.shown) && !has(hist.items[2], t.shown) && Number(hist.colspan) === hist.cells,
        hist,
      );
      const expanded = await page.evaluate((txt) => [...document.querySelectorAll('tbody button')].find((b) => b.textContent.trim() === txt)?.getAttribute('aria-expanded'), t.history(3));
      check(tag, 'toggle says expanded', expanded === 'true', expanded);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.evaluate(() => document.querySelector('[id^="history-"]').scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: join(SHOTS, `admin-retake-${tag}-roster.png`), fullPage: device === 'desktop' });
      }

      // 5–7. 历次里的按钮作用在那一份上
      const clickInLine = (no, label) =>
        page.evaluate(
          (prefix, lbl) => {
            const li = [...document.querySelectorAll('[id^="history-"] li')].find((x) => x.innerText.trim().startsWith(prefix));
            const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent.trim() === lbl);
            if (!b) return false;
            b.click();
            return true;
          },
          t.n(no),
          label,
        );
      const lastCall = async (action) => {
        await sleep(400);
        const calls = await page.evaluate(() => window.__adminCalls);
        return [...calls].reverse().find((c) => c.action === action) ?? null;
      };
      const lineButtons = (no) =>
        page.evaluate((prefix) => {
          const li = [...document.querySelectorAll('[id^="history-"] li')].find((x) => x.innerText.trim().startsWith(prefix));
          return li ? [...li.querySelectorAll('button')].map((b) => b.textContent.trim()) : null;
        }, t.n(no));

      check(tag, 'attempt 1 "view report" clicked', await clickInLine(1, t.report));
      const rl1 = await lastCall('report_link');
      check(tag, '… asks for attempt 1\'s session', rl1?.session_id === IDS.r1, rl1);

      const b1 = await lineButtons(1);
      check(tag, 'attempt 1 offers regen zh (failed) but not en (never had it)', b1 && b1.includes(t.regen('zh')) && !b1.includes(t.regen('en')), b1);
      check(tag, 'attempt 1 "regen zh" clicked', await clickInLine(1, t.regen('zh')));
      const rp1 = await lastCall('render_pdf');
      check(tag, '… re-renders attempt 1, zh', rp1?.session_id === IDS.r1 && rp1?.lang === 'zh', rp1);

      // render_pdf 之后名单重新加载:历次仍开着(状态在父层)
      await page.waitForSelector('[id^="history-"]', { timeout: 5_000 }).catch(() => {});
      const b2 = await lineButtons(2);
      check(tag, 'attempt 2 (shown) offers regen en (absent)', b2 && b2.includes(t.regen('en')), b2);
      check(tag, 'attempt 2 "regen en" clicked', await clickInLine(2, t.regen('en')));
      const rp2 = await lastCall('render_pdf');
      check(tag, '… re-renders attempt 2, en', rp2?.session_id === IDS.r2 && rp2?.lang === 'en', rp2);
      const b3 = await lineButtons(3);
      check(tag, 'the open attempt has no buttons', Array.isArray(b3) && b3.length === 0, b3);

      // 主行的「查看报告」→ 第 2 份
      await page.evaluate((lbl) => {
        const tr = [...document.querySelectorAll('tbody tr')].find((r) => r.querySelector('td')?.textContent.trim() === 'Demo Retaker');
        [...tr.querySelectorAll(':scope > td:last-child button')].find((b) => b.textContent.trim() === lbl).click();
      }, t.report);
      const rlMain = await lastCall('report_link');
      check(tag, 'main row "view report" asks for attempt 2 (the shown one)', rlMain?.session_id === IDS.r2, rlMain);

      // 再点一次收起
      await page.evaluate((txt) => [...document.querySelectorAll('tbody button')].find((b) => b.textContent.trim() === txt).click(), t.history(3));
      await sleep(200);
      check(tag, 'toggle closes it again', !(await page.$('[id^="history-"]')));

      // 10. 宽度
      const w = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
      check(tag, 'page not wider than the screen', w.scroll <= vp.width, w);

      // 8. 看板
      await page.evaluate((lbl) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === lbl).click(), t.tabDash);
      await page.waitForFunction(() => !!document.querySelector('select'), { timeout: 5_000 }).catch(() => {});
      await sleep(400);
      const dashText = () => page.evaluate(() => document.body.innerText);
      check(tag, 'dashboard, all cohorts: "0 retook it"', (await dashText()).includes(t.retaken(0)));
      const pick = async (id) => {
        await page.select('main select', id);
        await sleep(500);
      };
      await pick('c0000000-0000-4000-8000-000000000002');
      check(tag, 'dashboard, test cohort: "1 retook it"', (await dashText()).includes(t.retaken(1)));
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `admin-retake-${tag}-dashboard.png`) });
      await pick('c0000000-0000-4000-8000-000000000003');
      const old = await dashText();
      check(tag, 'dashboard, older server without the count: head count only', !old.includes(t.retakenPart) && /92/.test(old));

      // 9. 现场模式
      await page.evaluate((lbl) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === lbl).click(), t.tabLive);
      await sleep(600);
      check(tag, 'live mode slide has no retake line', !(await dashText()).includes(t.retakenPart));
      const w2 = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
      check(tag, 'dashboard / live: page not wider than the screen', w2.scroll <= vp.width, w2);

      await page.close();
    }
    if (broken) break;
  }
} finally {
  await browser.close();
}

if (broken) {
  console.error(`[admin-retake-preview] could not run: ${broken}`);
  process.exit(2);
}
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.tag}  ${r.what}${r.ok ? '' : `  —— ${JSON.stringify(r.seen)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[admin-retake-preview] ${failed === 0 ? 'OK' : `${failed} failed`} —— ${results.length - failed}/${results.length}${SHOTS ? `; screenshots in ${SHOTS}` : ''}`);
process.exit(failed === 0 ? 0 : 1);
