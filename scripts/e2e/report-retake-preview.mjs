#!/usr/bin/env node
/**
 * 报告页上的重填(第 3 步)—— 本地、真浏览器的检查与截图。2026-10-15 加。
 *
 * 【为什么要真浏览器】vitest 那边只有 renderToStaticMarkup:看得到 HTML,看不到点下去之后的事(确认框、请求、跳转)、
 * 看不到打印时藏没藏、手机宽度下撑没撑宽。这些在这里量。
 *
 * 【不连任何后端】先起离线预览(.claude/launch.json 的 `compass-dev-offline`,VITE_SUPABASE_URL=http://127.0.0.1:9)。
 * 报告 / 答题 / 报告文件三个接口由页面里的假 fetch 回答(假数据,按 config 现编的一份报告),请求不出浏览器;
 * 只有字体会从公网 CDN 下载。假后台记下每一次调用,断言「取消 = 一个请求都不发」靠它。
 *
 * 【查什么】六种状态(没历史 / 有历史 / 太快 / 满 6 份 / 链接作废 / 有没做完的重填)× 手机 390 / 电脑 1366,外加:
 *   - 重填:点 → 网站自己的确认框(不是浏览器的);Esc → 0 次 start_retake;再点 → 确认 → 1 次 → 到答题页,背景题标「上次的选择」
 *   - 放弃:点 → 确认框;取消 → 0 次;确认 → 1 次 abandon_retake → 顶上那条消失、最下方回到「重填测评」
 *   - 继续:→ 答题页
 *   - 历次:点第 1 次 → 请求带 attempt=1;顶上说明是第 1 次;没有「生成英文版」;回到最新
 *   - 链接作废:点重填 → 确认 → 403 → 按钮的位置说「已作废」(不跳 /expired)
 *   - PDF 渲染模式(?rt=):就算假后台回了那三个键,四块一个都不出现
 *   - 打印媒体:四块都是 display:none
 *   - 每一种状态:页面不比屏幕宽
 *
 * 用法:node scripts/e2e/report-retake-preview.mjs [--base http://localhost:5174] [--shots <目录>]
 * Chrome:默认 macOS 的 Google Chrome;别的位置用 CHROME_PATH。
 * 退出码:全过 0;有一项不过 1;跑不起来 2。
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'http://localhost:5174');
const SHOTS = arg('--shots', null);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = new URL('../..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(REPO, 'src/config/assessment-config.json'), 'utf8'));
const S = await import(join(REPO, 'src/config/ui-strings.ts')).catch(() => null);
/** 文案从 ui-strings 取(Node 22.6+ 能直接 import .ts;不能的话退回读源码里的那一行) */
const UI = S?.UI_STRINGS ?? null;
function ui(key, lang = 'zh') {
  if (UI) return UI[key][lang] ?? UI[key].zh;
  const src = readFileSync(join(REPO, 'src/config/ui-strings.ts'), 'utf8');
  const m = src.match(new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\{\\s*zh:\\s*'([^']*)'(?:,\\s*en:\\s*(?:'([^']*)'|"([^"]*)"))?`));
  if (!m) throw new Error(`ui string ${key} not found`);
  return lang === 'en' ? (m[2] ?? m[3] ?? m[1]) : m[1];
}

// ── 一份假报告(按 config 现编,不含任何真实数据)──────────────
const DIMS = config.dimensions.map((d) => d.key);
const PICK = { G1: 2, G2: 1, G3: 2, T1: 1, T2: 1, T3: 1, C1: 0, C2: 1, C3: 1, V1: 1, V2: 0, V3: 1, M1: 2, M2: 1, M3: 1 };
const submodules = {};
const evidence = {};
for (const d of DIMS) {
  const qs = config.questions.filter((q) => q.dimension === d).sort((a, b) => a.submodule_index - b.submodule_index);
  submodules[d] = qs.map((q) => +((PICK[q.id] / (q.option_count - 1)) * 5).toFixed(2));
  evidence[d] = qs.map((q) => ({ questionId: q.id, optionIndex: PICK[q.id] }));
}
const dimScore = Object.fromEntries(DIMS.map((d) => [d, +(submodules[d].reduce((a, b) => a + b, 0) / 3).toFixed(1)]));
const BASE_REPORT = {
  locale: 'zh',
  result: { dimensions: dimScore, total: 2.5, tier: 'spot', weakest: ['capture', 'convert'], strongest: ['goal', 'value'] },
  submodules,
  evidence,
  answersByQuestion: PICK,
  leadsPerMonth: 50,
  dealValue: 3000,
  survey: { priority_dimension: 'traffic' },
  baseline: { source: 'cohort', n: 21, means: Object.fromEntries(DIMS.map((d) => [d, 2.6])) },
  cohort: null,
  diagnostics: { baselineIncludesSelf: true, sessionStatus: 'completed' },
  files: [
    { lang: 'zh', availability: 'ready', url: 'about:blank', cardUrl: null, cardTallUrl: null },
    { lang: 'en', availability: 'absent', url: null, cardUrl: null, cardTallUrl: null },
  ],
  pdfStatus: 'ready',
  pdfUrl: 'about:blank',
  cardUrl: null,
  cardTallUrl: null,
};
const PREFILL = { fromAttempt: 2, profile: { P1: 2, P2: 1, P3: 1 }, survey: { S1: 1, S2: 2, S3: 1, S4: [0, 2], S5: 'demo', S7: 2 } };

const H = 3_600_000;
/** 六种状态。`attempts` 是完成了的那几份(编号、离现在几小时完成、总分、档位) */
const SCENARIOS = {
  none: { attempts: [[1, -72, 2.5, 'spot']], retake: { canStart: true, reason: null } },
  history: { attempts: [[2, -50, 3.1, 'semi_auto'], [1, -120, 2.5, 'spot']], retake: { canStart: true, reason: null } },
  too_soon: { attempts: [[2, -0.8, 3.1, 'semi_auto'], [1, -30, 2.5, 'spot']], retake: { canStart: false, reason: 'too_soon', nextInHours: 23.2 } },
  limit: { attempts: [[6, -30, 3.9, 'systemic'], [5, -60, 3.5, 'semi_auto'], [4, -90, 3.2, 'semi_auto'], [3, -120, 3.0, 'semi_auto'], [2, -150, 2.7, 'spot'], [1, -180, 2.5, 'spot']], retake: { canStart: false, reason: 'limit_reached' } },
  revoked: { attempts: [[1, -72, 2.5, 'spot']], retake: { canStart: true, reason: null }, startReply: 403 },
  open: { attempts: [[2, -50, 3.1, 'semi_auto'], [1, -120, 2.5, 'spot']], retake: { canStart: true, reason: null }, open: 3 },
};

/** 在页面脚本之前装好假后台。全部假数据;记下每一次调用 */
function installFakes(base, scenario, prefill) {
  const now = Date.now();
  const H = 3_600_000;
  const st = {
    attempts: scenario.attempts.map(([no, hoursAgo, total, tier]) => ({ no, completedAt: new Date(now + hoursAgo * H).toISOString(), total, tier })),
    open: scenario.open ?? null,
    calls: [],
  };
  window.__fake = st;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const retakeInfo = () => {
    if (st.open !== null) return { canStart: false, reason: 'open_attempt', nextAllowedAt: null, openAttempt: st.open, maxAttempts: 6, minHoursBetween: 24 };
    const r = scenario.retake;
    return {
      canStart: r.canStart,
      reason: r.reason,
      nextAllowedAt: r.nextInHours ? new Date(now + r.nextInHours * H).toISOString() : null,
      openAttempt: null,
      maxAttempts: 6,
      minHoursBetween: 24,
    };
  };
  const snap = (over) => ({ locale: 'zh', profile: {}, answers: {}, status: 'in_progress', complete: false, sessionId: 's-open', attemptNo: st.open, prefill, ...over });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    const u = new URL(String(url), location.origin);
    if (u.pathname === '/api/assessment-report') {
      const want = u.searchParams.get('attempt');
      st.calls.push(`report${want ? `?attempt=${want}` : ''}`);
      const latest = Math.max(...st.attempts.map((a) => a.no));
      const no = want ? Number(want) : latest;
      const a = st.attempts.find((x) => x.no === no);
      if (!a) return reply(404, { error: 'no_such_attempt' });
      const withKeys = scenario.renderModeKeys || !u.searchParams.has('rt');
      return reply(200, {
        ...base,
        result: { ...base.result, total: a.total, tier: a.tier },
        ...(withKeys ? { attempt: { no, completedAt: a.completedAt, isLatest: no === latest }, attempts: [...st.attempts].sort((x, y) => y.no - x.no), retake: retakeInfo() } : {}),
      });
    }
    if (u.pathname === '/api/assessment-quiz') {
      const body = JSON.parse(init?.body ?? '{}');
      st.calls.push(body.action);
      if (body.action === 'start_retake') {
        if (scenario.startReply === 403) return reply(403, { error: 'revoked' });
        st.open = Math.max(...st.attempts.map((a) => a.no)) + 1;
        return reply(200, snap({ attemptNo: st.open }));
      }
      if (body.action === 'abandon_retake') {
        const was = st.open;
        st.open = null;
        return was === null ? reply(409, { error: 'no_open_attempt' }) : reply(200, { ok: true, abandonedAttemptNo: was });
      }
      if (body.action === 'bootstrap') return reply(200, st.open !== null ? snap({}) : snap({ status: 'completed', attemptNo: 1, prefill: null }));
      return reply(200, snap({}));
    }
    if (u.pathname.startsWith('/api/')) {
      st.calls.push(u.pathname);
      return reply(200, { status: 'ready' });
    }
    return realFetch(url, init);
  };
}

const DEVICES = { mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { width: 1366, height: 900, deviceScaleFactor: 1 } };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const results = [];
const check = (tag, what, ok, seen) => results.push({ tag, what, ok: !!ok, seen });
let broken = null;

async function open(scenarioName, device, { lang = 'zh', path = null, scenarioOver = {} } = {}) {
  const page = await browser.newPage();
  await page.setViewport(DEVICES[device]);
  // 截图时不要停在淡入的半途;转场本身另查(类名在)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(installFakes, { ...BASE_REPORT, locale: lang }, { ...SCENARIOS[scenarioName], ...scenarioOver }, PREFILL);
  await page.goto(`${BASE}${path ?? `/report?lang=${lang}`}`, { waitUntil: 'networkidle0', timeout: 30_000 });
  return page;
}
/**
 * 【不分大小写】innerText 会套用 CSS 的 text-transform:按钮是 `uppercase`,英文的「Retake the assessment」读出来是
 * 「RETAKE THE ASSESSMENT」(中文不受影响)。第一次跑英文那两项就是这样红的 —— 页面是对的,比较方式错了。
 */
const text = (page) => page.evaluate(() => document.body.innerText.toLowerCase());
const waitText = (page, t, timeout = 8_000) =>
  page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x), { timeout }, t.toLowerCase()).then(() => true).catch(() => false);
const has = (t, x) => t.includes(x.toLowerCase());
const calls = (page) => page.evaluate(() => window.__fake.calls);
const width = (page) => page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
async function clickText(page, label) {
  const ok = await page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!ok) throw new Error(`no enabled button "${label}"`);
}
/**
 * 页面在最顶上时,这一行标题的字有没有压在右上角那个固定的语言按钮底下(判断标准 10:CSS 的意图要有渲染断言)。
 * 按字的实际位置量(Range 的每一行一个矩形),不按段落的盒子 —— 盒子本来就伸到按钮底下,字不该。
 */
async function underToggle(page, titleStart) {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.evaluate((start) => {
    const toggle = [...document.querySelectorAll('button')].find((b) => getComputedStyle(b).position === 'fixed');
    const p = [...document.querySelectorAll('p')].find((x) => x.textContent.trim().startsWith(start));
    if (!toggle || !p) return { missing: !toggle ? 'toggle' : 'title' };
    const t = toggle.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(p);
    const hits = [...range.getClientRects()].filter((r) => r.right > t.left && r.left < t.right && r.bottom > t.top && r.top < t.bottom);
    return { hits: hits.length, toggleLeft: Math.round(t.left), textRight: Math.round(Math.max(...[...range.getClientRects()].map((r) => r.right))) };
  }, titleStart);
}

/** 从「带走这份报告」那一节的顶上截到页面底 —— 重填那几块都在这一段 */
async function shotBottom(page, file) {
  if (!SHOTS) return;
  const top = await page.evaluate((title) => {
    const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.trim().toLowerCase() === title.toLowerCase());
    return h ? h.closest('section').getBoundingClientRect().top + window.scrollY - 16 : 0;
  }, ui('report.section.share', file.includes('-en') ? 'en' : 'zh'));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const w = page.viewport().width;
  await page.screenshot({ path: join(SHOTS, file), clip: { x: 0, y: top, width: w, height: h - top }, captureBeyondViewport: true });
}
async function shotTop(page, file) {
  if (!SHOTS) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, file) });
}

try {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const T = (k) => ui(k);
  // 能不能连上预览
  try {
    const p = await open('none', 'mobile');
    await p.close();
  } catch (err) {
    throw Object.assign(new Error(`cannot load ${BASE}/report —— is the offline preview running? (${err.message})`), { broken: true });
  }

  for (const device of ['mobile', 'desktop']) {
    // ── 没历史:一份,可以重填 ──
    {
      const tag = `${device}/none`;
      const page = await open('none', device);
      const ok = await waitText(page, T('report.retake.button'));
      check(tag, 'retake button shown', ok);
      const t = await text(page);
      check(tag, 'no history list with a single attempt', !has(t, T('report.history.title')));
      check(tag, 'attempts used line', has(t, T('report.retake.used').replace('{used}', '1').replace('{max}', '6')));
      const cls = await page.evaluate((l) => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l);
        return { btn: b?.className ?? '', staggered: !!b?.closest('.qai-stagger') };
      }, T('report.retake.button'));
      check(tag, 'press feedback (qai-lift) + page stagger kept', cls.btn.includes('qai-lift') && cls.staggered, cls);
      const w = await width(page);
      check(tag, 'page not wider than the screen', w.scroll <= w.inner, w);
      await shotBottom(page, `${device}-1-no-history.png`);

      // 点 → 确认框;Esc → 0 次;再点 → 确认 → 1 次 → 答题页,背景题标「上次的选择」
      await clickText(page, T('report.retake.button'));
      const dlg = await page.waitForSelector('[data-testid=confirm-dialog]', { timeout: 5_000 }).then(() => true).catch(() => false);
      check(tag, 'tap → the site\'s own confirm dialog', dlg);
      const dtext = await page.evaluate(() => document.querySelector('[data-testid=confirm-dialog]')?.innerText ?? '');
      check(tag, 'dialog says the four things (rule numbers filled in)', dtext.includes(T('report.retake.confirmTitle')) && dtext.includes('24') && !/\{\w+\}/.test(dtext), dtext.slice(0, 80));
      if (device === 'mobile') await shotTop(page, `${device}-8-confirm-dialog.png`);
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));
      check(tag, 'Esc → no start_retake sent', !(await calls(page)).includes('start_retake'), await calls(page));
      await clickText(page, T('report.retake.button'));
      await page.waitForSelector('[data-testid=confirm-dialog-confirm]', { timeout: 5_000 });
      await page.click('[data-testid=confirm-dialog-confirm]');
      const onQuiz = await page.waitForFunction(() => location.pathname === '/quiz', { timeout: 8_000 }).then(() => true).catch(() => false);
      const c = await calls(page);
      check(tag, 'confirm → exactly one start_retake → quiz page', onQuiz && c.filter((x) => x === 'start_retake').length === 1, c);
      const badges = await waitText(page, T('quiz.prefilled')).then(() => page.evaluate((l) => [...document.querySelectorAll('span,div')].filter((e) => e.children.length === 0 && e.textContent.trim() === l).length, T('quiz.prefilled')));
      check(tag, 'quiz: 3 background questions marked "from last time", nothing saved on arrival', badges === 3 && !(await calls(page)).includes('profile'), { badges, calls: await calls(page) });
      if (device === 'mobile') await shotTop(page, `${device}-9-quiz-prefilled.png`);
      await page.close();
    }

    // ── 有历史:两份,可以重填;点第 1 次看那一份 ──
    {
      const tag = `${device}/history`;
      const page = await open('history', device);
      await waitText(page, T('report.history.title'));
      const t = await text(page);
      check(tag, 'history list with both attempts', has(t, T('report.history.attempt').replace('{n}', '2')) && has(t, T('report.history.attempt').replace('{n}', '1')));
      check(tag, 'latest + viewing marked', has(t, T('report.history.latest')) && has(t, T('report.history.viewing')));
      check(tag, 'retake button on the latest', has(t, T('report.retake.button')));
      const w = await width(page);
      check(tag, 'page not wider than the screen', w.scroll <= w.inner, w);
      await shotBottom(page, `${device}-2-history.png`);
      await page.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(l)).click(), T('report.history.attempt').replace('{n}', '1'));
      const older = await waitText(page, T('report.history.viewingOld').split('{n}')[0]);
      const t2 = await text(page);
      const c = await calls(page);
      check(tag, 'tap attempt 1 → report fetched with attempt=1, note on top', older && c.includes('report?attempt=1') && new URL(page.url()).searchParams.get('attempt') === '1', c);
      check(tag, 'older attempt: no "generate the other language", a line saying why', !has(t2, ui('report.pdf.generateIn').replace('{lang}', ui('lang.name.en'))) && has(t2, T('report.history.onlyExisting')));
      check(tag, 'older attempt: no retake section (it lives on the latest)', !has(t2, T('report.retake.button')));
      const ov = await underToggle(page, T('report.history.viewingOld').split('{n}')[0]);
      check(tag, 'note title not under the language toggle', ov.hits === 0, ov);
      await shotTop(page, `${device}-7-older-attempt-top.png`);
      await shotBottom(page, `${device}-7-older-attempt-bottom.png`);
      await clickText(page, T('report.history.backToLatest'));
      const back = await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'), { timeout: 5_000 }).then(() => true).catch(() => false);
      check(tag, 'back to the latest', back && (await waitText(page, T('report.retake.button'))));
      await page.close();
    }

    // ── 太快 / 满 6 份 ──
    for (const [name, file, expectText] of [
      ['too_soon', '3-too-soon', T('report.retake.tooSoon').split('{wait}')[0].replace('{hours}', '24')],
      ['limit', '4-limit-reached', T('report.retake.limitReached').replace('{max}', '6').replace('{retakes}', '5')],
    ]) {
      const tag = `${device}/${name}`;
      const page = await open(name, device);
      await waitText(page, T('report.retake.button'));
      const t = await text(page);
      check(tag, 'reason written where the button is', has(t, expectText), t.slice(t.indexOf((T('report.retake.title')).toLowerCase()), t.indexOf((T('report.retake.title')).toLowerCase()) + 160));
      const disabled = await page.evaluate((l) => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l)?.disabled, T('report.retake.button'));
      check(tag, 'button greyed', disabled === true);
      if (name === 'too_soon') check(tag, 'says until when (Malaysia time) and how long', /\d{1,2}:\d{2}/.test(t) && has(t, ui('report.retake.waitHm').split('{h}')[1].split('{m}')[0].trim()));
      const w = await width(page);
      check(tag, 'page not wider than the screen', w.scroll <= w.inner, w);
      await shotBottom(page, `${device}-${file}.png`);
      await page.close();
    }

    // ── 链接作废:点重填 → 确认 → 403 → 按钮的位置说已作废(不跳走)──
    {
      const tag = `${device}/revoked`;
      const page = await open('revoked', device);
      await waitText(page, T('report.retake.button'));
      await clickText(page, T('report.retake.button'));
      await page.waitForSelector('[data-testid=confirm-dialog-confirm]', { timeout: 5_000 });
      await page.click('[data-testid=confirm-dialog-confirm]');
      const shown = await waitText(page, T('report.retake.revoked'));
      check(tag, '403 on start → "link deactivated" where the button is, still on the report', shown && new URL(page.url()).pathname === '/report');
      const disabled = await page.evaluate((l) => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l)?.disabled, T('report.retake.button'));
      check(tag, 'button greyed after that', disabled === true);
      await shotBottom(page, `${device}-5-revoked.png`);
      await page.close();
    }

    // ── 有一份没做完的重填:顶上 继续 / 放弃 ──
    {
      const tag = `${device}/open`;
      const page = await open('open', device);
      await waitText(page, T('report.retake.openTitle').replace('{n}', '3'));
      const t = await text(page);
      check(tag, 'banner on top with the attempt number', t.indexOf(T('report.retake.openTitle').replace('{n}', '3').toLowerCase()) < t.indexOf((ui('report.section.radar')).toLowerCase()));
      check(tag, 'bottom says "continue the retake", not "retake"', has(t, T('report.retake.continueLong')) && !has(t, T('report.retake.button')));
      const w = await width(page);
      check(tag, 'page not wider than the screen', w.scroll <= w.inner, w);
      const ov = await underToggle(page, T('report.retake.openTitle').split('{n}')[0]);
      check(tag, 'banner title not under the language toggle', ov.hits === 0, ov);
      await shotTop(page, `${device}-6-open-retake-top.png`);
      await shotBottom(page, `${device}-6-open-retake-bottom.png`);
      // 放弃:取消 → 0 次;确认 → 1 次 → 那条消失
      await clickText(page, T('report.retake.abandon'));
      await page.waitForSelector('[data-testid=confirm-dialog]', { timeout: 5_000 });
      const dtext = await page.evaluate(() => document.querySelector('[data-testid=confirm-dialog]').innerText);
      check(tag, 'discard → confirm dialog first', dtext.includes(T('report.retake.abandonTitle')));
      if (device === 'mobile') await shotTop(page, `${device}-8-abandon-dialog.png`);
      await clickText(page, ui('common.cancel'));
      await new Promise((r) => setTimeout(r, 300));
      check(tag, 'cancel → no abandon_retake sent', !(await calls(page)).includes('abandon_retake'));
      await clickText(page, T('report.retake.abandon'));
      await page.waitForSelector('[data-testid=confirm-dialog-confirm]', { timeout: 5_000 });
      await page.click('[data-testid=confirm-dialog-confirm]');
      const gone = await page
        .waitForFunction((x) => !document.body.innerText.includes(x), { timeout: 8_000 }, T('report.retake.openTitle').replace('{n}', '3'))
        .then(() => true)
        .catch(() => false);
      const c = await calls(page);
      check(tag, 'confirm → one abandon_retake → banner gone, "retake" back at the bottom', gone && c.filter((x) => x === 'abandon_retake').length === 1 && (await text(page)).includes(T('report.retake.button')), c);
      await page.close();
    }

    // 继续 → 答题页(另开一页,状态从头来)
    {
      const tag = `${device}/continue`;
      const page = await open('open', device);
      await waitText(page, T('report.retake.continue'));
      await clickText(page, T('report.retake.continue'));
      const onQuiz = await page.waitForFunction(() => location.pathname === '/quiz', { timeout: 8_000 }).then(() => true).catch(() => false);
      check(tag, 'continue → bootstrap → quiz page', onQuiz && (await calls(page)).includes('bootstrap'));
      await page.close();
    }
  }

  // ── 英文 ──
  for (const name of ['too_soon', 'open']) {
    const tag = `mobile/en/${name}`;
    const page = await open(name, 'mobile', { lang: 'en' });
    const key = name === 'open' ? 'report.retake.openTitle' : 'report.retake.button';
    const ok = await waitText(page, ui(key, 'en').replace('{n}', '3'));
    const t = await text(page);
    check(tag, 'English copy', ok && (name === 'open' ? has(t, ui('report.retake.continueLong', 'en')) : has(t, '(Malaysia time)')));
    check(tag, 'no Chinese in the retake parts', !/[\u4e00-\u9fff]/.test(t.slice(t.indexOf((ui('report.section.share', 'en')).toLowerCase()))), t.slice(t.indexOf((ui('report.section.share', 'en')).toLowerCase())).match(/[\u4e00-\u9fff]+/)?.[0]);
    if (name === 'open') {
      const ov = await underToggle(page, ui('report.retake.openTitle', 'en').split('{n}')[0]);
      check(tag, 'banner title not under the language toggle', ov.hits === 0, ov);
      await shotTop(page, `mobile-en-6-open-retake-top.png`);
    }
    await shotBottom(page, `mobile-en-${name}.png`);
    await page.close();
  }

  // ── PDF 渲染模式:假后台就算回了那三个键,四块一个都不出现 ──
  {
    const tag = 'render-mode';
    const page = await open('open', 'desktop', { path: '/report?rt=local-preview-not-a-token&lang=zh', scenarioOver: { renderModeKeys: true } });
    await page.waitForFunction(() => window.__REPORT_READY__ === true, { timeout: 10_000 }).catch(() => {});
    const t = await text(page);
    const leaked = ['report.retake.title', 'report.retake.openTitle', 'report.history.title', 'report.retake.button', 'report.retake.continue'].filter((k) => has(t, ui(k).replace('{n}', '3')));
    check(tag, 'none of the retake parts in PDF render mode (even though the payload carried the keys)', leaked.length === 0 && has(t, ui('report.section.radar')), leaked);
    await page.close();
  }

  // ── 打印:四块都不进纸 ──
  {
    const tag = 'print';
    const page = await open('open', 'desktop');
    await waitText(page, T('report.history.title'));
    await page.emulateMediaType('print');
    const shown = await page.evaluate((labels) => labels.filter((l) => {
      const el = [...document.querySelectorAll('h3, p')].find((x) => x.textContent.trim().startsWith(l));
      return el && el.offsetParent !== null;
    }), [T('report.retake.title'), T('report.history.title'), T('report.retake.openTitle').split('(')[0]]);
    check(tag, 'retake section, history, banner hidden when printing', shown.length === 0, shown);
    await page.close();
  }
} catch (err) {
  broken = err.broken ? err.message : `${err.message}\n${err.stack}`;
} finally {
  await browser.close();
}

if (broken) {
  console.error(`[report-retake-preview] could not run: ${broken}`);
  process.exit(2);
}
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.tag}: ${r.what}${r.ok ? '' : `  —— ${JSON.stringify(r.seen)}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n[report-retake-preview] ${failed === 0 ? 'OK' : `${failed} failed`} —— ${results.length - failed}/${results.length}${SHOTS ? `; screenshots in ${SHOTS}` : ''}`);
process.exit(failed === 0 ? 0 : 1);
