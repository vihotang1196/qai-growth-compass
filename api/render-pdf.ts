import type { VercelRequest, VercelResponse } from '@vercel/node';
/**
 * ⚠️ 【这一行必须排在 `@sparticuz/chromium` 之前,顺序有意义】
 * 那个包在【模块顶层】就做环境探测并解压 NSS 库;lambdaEnv 的副作用要先于它执行,
 * 否则探测拿到的是未注入的环境,libnss3.so 不会被解压(实测就是这个)。
 * ESM 按 import 出现的顺序求值被导入模块,所以「写在上面」就是「先执行」。
 * scripts/check-api-imports.mjs 有一条规则守这个顺序 —— 它验证过会红。
 */
import { assertChromiumEnvReady, installFallbackFont } from './_lib/lambdaEnv.js';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readdirSync } from 'node:fs';
import {
  classifyGlyphReport,
  mergeGlyphScans,
  needsAttention,
  type GlyphScan,
} from './_lib/glyphCheck.js';
import { signRenderToken } from './_lib/renderToken.js';
import { MAX_PDF_ATTEMPTS } from './_lib/pdfState.js';
import { parseLang, type Lang } from './_lib/lang.js';
import { pdfObjectPath, shareCardObjectPath } from './_lib/reportFiles.js';
import { SHARE_CARD_SIZES, SHARE_CARD_VIEWPORT } from './_lib/shareCard.js';
import { pickSecretKeyFromPlainEnv } from './_lib/apiKeys.js';

/**
 * PDF 异步渲染(Stage 9)。内部接口,X-Internal-Secret 鉴权。
 *
 * POST { session_id, probe? }
 *   正常:渲染 → 存 Storage → 写 pdf_path / pdf_status='ready'
 *   probe=true:**同一条管线**,但不写 Storage、不动数据库,只回字形自检与体积
 *
 * 【probe 走同一条管线,不是平行的一份】这是这个项目反复踩到的那个坑:检查的执行路径
 * 比真实路径短,于是它绿着而线上错(雷达那次连踩三轮)。所以 probe 只是同一个
 * renderReport() 的一个参数 —— 它验的就是真实渲染,只是不落地。
 *
 * 【上限 3 次,超过 failed_permanent】pdf_attempts 由这里自增。不自动无限重试:
 * 渲染失败多半是内容或字体问题,重试一百次还是一样。
 */

/** 探测串:这几个字若渲不出,说明中文字体压根没加载(见 glyphCheck 的分级) */
const COMMON_PROBE = '盈利增长罗盘诊断报告';

/**
 * 变量名必须以【字面量】出现在 process.env.X 里,check:env 才扫得到 ——
 * 动态 process.env[name] 会让这几个变量从清单里消失,而漏掉的清单比没有清单更糟
 * (守卫原话)。所以这里逐个列出,不写通用取值器。
 */
const ENV = {
  INTERNAL_FN_SECRET: process.env.INTERNAL_FN_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APP_BASE_URL: process.env.APP_BASE_URL,
  CDN_FONT_BASE: process.env.CDN_FONT_BASE ?? 'https://cdn.qiai.tech/fonts/',
};

function env(name: keyof typeof ENV): string {
  const v = ENV[name];
  if (!v) throw new Error(`server_misconfigured: missing ${name}`);
  return v;
}

/**
 * 浏览器里跑的字形自检 —— 注入到页面上下文执行。
 *
 * 判三种结果,不是两种:
 *   ok    有墨迹且不等于 .notdef
 *   tofu  与 U+FFFF(保证无字形)的位图一致 → 字体匹配上了但缺这个字
 *   blank **一点墨迹都没有** → 没有字体覆盖它,兜底层整体失效
 *
 * 【为什么必须量墨迹而不是只比 .notdef】实测:兜底层没生效时容器里没有任何字体覆盖
 * 那些码位,浏览器连 .notdef 都画不出来 —— 渲染是纯空白。而空白的位图与 U+FFFF 不同,
 * 只比 .notdef 的话会判成 ok。那就成了「字全没显示但检查说没问题」。
 */
function scanGlyphsInPage(commonProbe: string): GlyphScan {
  const measure = document.createElement('canvas');
  const mctx = measure.getContext('2d');
  if (!mctx) return { commonMissing: [], otherTofu: [], otherBlank: [], scanned: 0 };

  const cs = getComputedStyle(document.body);
  const fontShorthand = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  mctx.font = fontShorthand;

  const fp = document.createElement('canvas');
  fp.width = 28;
  fp.height = 28;
  const fctx = fp.getContext('2d')!;

  /** 画一个字符,回 { 墨迹像素数, 位图指纹 } */
  const render = (ch: string): { ink: number; sig: string } => {
    fctx.clearRect(0, 0, 28, 28);
    // canvas 尺寸/清空后上下文状态会重置,每次都要重设 font
    fctx.font = fontShorthand;
    fctx.fillStyle = '#000';
    fctx.fillText(ch, 2, 21);
    const data = fctx.getImageData(0, 0, 28, 28).data;
    let ink = 0;
    let sig = '';
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) ink += 1; // alpha 阈值,躲开抗锯齿的极淡边缘
    }
    // 指纹只取 alpha 通道,足够区分形状且比全通道便宜
    for (let i = 3; i < data.length; i += 4) sig += data[i] > 8 ? '1' : '0';
    return { ink, sig };
  };

  /** U+FFFF 保证无字形 —— 它渲染出来的就是本环境 .notdef 的样子 */
  const ref = render('\uFFFF');

  const classify = (ch: string): 'ok' | 'tofu' | 'blank' => {
    const r = render(ch);
    if (r.ink === 0) return 'blank';
    // .notdef 自己有墨迹时才拿它比;若参照本身是空白,就无法区分 tofu,只能靠 ink
    if (ref.ink > 0 && r.sig === ref.sig) return 'tofu';
    return 'ok';
  };

  // 收集页面上所有可见文本的不重复非 ASCII 字符
  const chars = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    for (const ch of (node.textContent ?? '').trim()) {
      if (ch.charCodeAt(0) > 0x7f) chars.add(ch);
    }
    node = walker.nextNode();
  }

  const commonMissing = [...commonProbe].filter((ch) => classify(ch) !== 'ok');
  const otherTofu: string[] = [];
  const otherBlank: string[] = [];
  for (const ch of chars) {
    const verdict = classify(ch);
    if (verdict === 'tofu') otherTofu.push(ch);
    else if (verdict === 'blank') otherBlank.push(ch);
  }
  return { commonMissing, otherTofu, otherBlank, scanned: chars.size + commonProbe.length };
}

interface RenderOutcome {
  pdf: Buffer;
  glyph: ReturnType<typeof classifyGlyphReport>;
  scan: GlyphScan;
  /** 分享卡:失败不抛,只在 error 里留一句;images 为空即这一次没出来 */
  cards: { images: { suffix: string; png: Buffer }[]; error: string | null };
}

/**
 * 真实渲染管线。正常路径与 probe 共用这一个函数 —— 见文件头。
 */
/**
 * 扫当前这一页的字形。**等 document.fonts.ready 之后再扫** ——
 * 字体还没就位时扫出来的方块是假的。
 */
async function scanCurrentPage(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
): Promise<GlyphScan> {
  await page.evaluateHandle('document.fonts.ready');
  return (await page.evaluate(scanGlyphsInPage, COMMON_PROBE)) as GlyphScan;
}

/**
 * 截两张分享卡。**任何失败都在这里被吃掉**,只回一条 error 字符串。
 *
 * 尺寸与元素 id 来自 `_lib/shareCard`,页面那边读的是同一份 —— 两边各写一份的话,
 * 失败形态是截图器抛「找不到元素」,而那句话不会告诉你是 id 拼错还是页面没渲出来。
 */
async function renderShareCards(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  appBase: string,
  rt: string,
  /** 卡片渲的是报告页的内容(含档位名),所以它跟 PDF 用**同一个** lang —— 不是各自决定 */
  lang: Lang,
): Promise<{
  images: { suffix: string; png: Buffer }[];
  error: string | null;
  /** 卡页自己的字形扫描;渲染失败时为 null(那时也确实没扫到) */
  scan: GlyphScan | null;
}> {
  try {
    await page.setViewport({
      width: SHARE_CARD_VIEWPORT.width,
      height: SHARE_CARD_VIEWPORT.height,
      deviceScaleFactor: 1, // 卡片按 CSS 像素就是成品像素,不要 2x 再放大一倍
    });
    await page.goto(`${appBase}/share-card?rt=${encodeURIComponent(rt)}&lang=${lang}`, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    });
    // 与报告页同一个取向:等页面自己说画完了,不 sleep
    await page.waitForFunction('window.__CARD_READY__ === true', { timeout: 20_000 });

    /**
     * 【卡页也要扫】分享卡上线那天扫描没跟着动,于是「glyph: ok」从那天起就不完整了。
     * 缺一个字符是具体问题,**扫描范围小于渲染范围是结构问题** ——
     * 它让一个不完整的结论看起来完整。
     * 这里不是靠「记得加一行」保证的:renderReport 末尾会比对
     * 「导航过的路径」与「扫过的路径」,漏了会写进 verdict(见 GlyphCoverage)。
     */
    const scan = await scanCurrentPage(page);

    const images: { suffix: string; png: Buffer }[] = [];
    for (const size of SHARE_CARD_SIZES) {
      const el = await page.$(`#${size.id}`);
      if (!el) throw new Error(`share card element #${size.id} not found on /share-card`);
      const box = await el.boundingBox();
      // 尺寸不对就说出来 —— 一张 1080×0 的图上传成功、下载下来是空的,那种失败最难查
      if (!box || Math.round(box.width) !== size.w || Math.round(box.height) !== size.h) {
        throw new Error(
          `share card #${size.id} measured ${box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'null'}, expected ${size.w}×${size.h}`,
        );
      }
      images.push({ suffix: size.suffix, png: Buffer.from(await el.screenshot({ type: 'png' })) });
    }
    return { images, error: null, scan };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`share card render failed (PDF is unaffected): ${detail}`);
    return { images: [], error: detail.slice(0, 500), scan: null };
  }
}

async function renderReport(sessionId: string, lang: Lang): Promise<RenderOutcome> {
  const appBase = env('APP_BASE_URL').replace(/\/$/, '');
  const signedAtMs = Date.now();
  const rt = await signRenderToken(sessionId, env('INTERNAL_FN_SECRET'), signedAtMs);

  /**
   * 中文字体不打包进函数(8.3MB 会顶爆体积上限),运行时从 CDN 装进 fontconfig。
   * 这是 subset woff2 之外的**兜底层**:subset 只覆盖常用字,姓名里的生僻字靠这个。
   */
  /**
   * 【验证字体真的落地了 —— NSS 通了不代表这条路通】
   * chromium.font() 把文件下到 `$HOME/.fonts/`(HOME 默认 /tmp)。它 resolve 只代表
   * 下载流程走完,不代表文件可用:CDN 出网失败、写盘失败、或者早先某次留下一个 0 字节的
   * 残留文件(它见到 existsSync 就直接 resolve,不校验大小)都会让兜底层静默失效。
   * 实测症状:生僻字渲染成【纯空白】—— 容器里没有任何字体覆盖那些码位。
   */

  /**
   * 【开浏览器之前先直接问一次 API —— 把两件事分开】
   *
   * 页面跳到 /expired 只说明「取数被拒」,但拒在哪一层看不出来:令牌本身不被接受?
   * 还是页面没把 rt 传对、走进了 cookie 分支?一次服务端直连就能定性 ——
   * 用【同一个令牌】、同一条 URL,没有浏览器参与。
   *
   * 这比再加一轮页面侧日志有效:它把「令牌对不对」变成一个独立可判的事实。
   * 失败时直接抛,并把状态码与响应体带出来 —— 那才是能照着行动的信息,
   * 而不是「30000ms exceeded」。
   */
  const apiUrl = `${appBase}/api/assessment-report?rt=${encodeURIComponent(rt)}`;
  const preflight = await fetch(apiUrl, { method: 'GET' }).catch((e) => e as Error);
  if (preflight instanceof Error) {
    throw new Error(`preflight fetch to ${apiUrl} threw: ${preflight.message}`);
  }
  if (!preflight.ok) {
    const body = await preflight.text().catch(() => '');
    throw new Error(
      `render token rejected by the report API: HTTP ${preflight.status} — ${body.slice(0, 300)}. ` +
        `这是【端点层】的拒绝,与页面无关(没有浏览器参与)。` +
        `401 ⇒ 令牌验签失败或过期:核对 Vercel 与 Supabase 两侧的 INTERNAL_FN_SECRET 是否同值。` +
        `403 ⇒ 该 entitlement 已停用。409 ⇒ session 不存在。` +
        `token age at request: ${Math.round((Date.now() - signedAtMs) / 1000)}s(TTL 180s)。`,
    );
  }
  console.log(`preflight ok: report API accepted the render token (HTTP ${preflight.status})`);

  /**
   * 【launch 失败时把环境事实一起报出来,不要只报一句 launch failed】
   *
   * libnss3.so 那类错误的成因有好几种(基础镜像变了、.so 压缩包没进产物、
   * LD_LIBRARY_PATH 没设上),光看「起不来」无法区分,只能靠猜版本试 —— 而猜版本试
   * 正是这个项目一路在避免的。这里把 executablePath() 实际做了什么摊开:
   * 二进制在不在、库目录在不在、LD_LIBRARY_PATH 设没设、Node 版本是多少。
   * 下一次失败就是数据,不是又一轮猜。
   */
  /**
   * 事后校验:chromium 顶层探测是否真的生效(LD_LIBRARY_PATH 里应有 /tmp 的 lib 目录)。
   * 放在 executablePath() 之前 —— 与其让 launch 抛一句 libnss3.so,不如在这里直接说清
   * 是「注入没赶上」还是「探测逻辑变了」。
   */
  assertChromiumEnvReady();

  /**
   * 【顺序:先 executablePath(),再装字体】executablePath() 会解压 fonts.tar.br 到
   * /tmp/fonts —— 里面装着 fonts.conf 本身与 Open_Sans。而 lambdafs 见到 /tmp/fonts
   * 已存在就整个跳过解压,所以任何提前创建那个目录的动作都会让 fontconfig 一个字体都没有
   * (实测:四块全空,连拉丁字母都没了)。installFallbackFont 会断言 fonts.conf 已存在。
   */
  const execPath = await chromium.executablePath();

  const font = await installFallbackFont(
    (u) => chromium.font(u),
    `${env('CDN_FONT_BASE').replace(/\/$/, '')}/NotoSansSC-Regular.otf`,
  );
  console.log(
    `CJK fallback font ready: ${font.path} (${font.bytes} bytes). ` +
      `/tmp/fonts before=${JSON.stringify(font.dirBefore)} after=${JSON.stringify(font.dirAfter)}`,
  );
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: execPath,
      headless: true,
    });
  } catch (err) {
    const facts = {
      node: process.version,
      execPath,
      execExists: existsSync(execPath),
      ldLibraryPath: process.env.LD_LIBRARY_PATH ?? '(unset)',
      // executablePath() 应该把 .so 解压到 /tmp 下的某个目录并加进 LD_LIBRARY_PATH
      tmpEntries: existsSync('/tmp') ? readdirSync('/tmp').slice(0, 40) : [],
      libDirs: (process.env.LD_LIBRARY_PATH ?? '')
        .split(':')
        .filter(Boolean)
        .map((d) => ({ dir: d, exists: existsSync(d), files: existsSync(d) ? readdirSync(d).length : 0 })),
    };
    console.error(`chromium launch failed. facts=${JSON.stringify(facts)}`);
    throw new Error(
      `${err instanceof Error ? err.message : String(err)} || diagnostics=${JSON.stringify(facts)}`,
    );
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 2 });

    /**
     * ── 这次渲染到底访问了哪些页 ──
     *
     * 【为什么用运行时采集,而不是一份手写清单】分享卡上线那天,扫描代码没跟着动:
     * 它只跑在报告页上,而管线已经多渲了一页。于是「glyph: ok」从那天起就是不完整的结论。
     * 手写清单挡不住下一次 —— 再加一个渲染产物(OG image、别的尺寸),
     * 清单照样要靠人记得改,那就是同一个 bug 的下一次。
     *
     * framenavigated 采集的是**真的发生过的导航**。末尾比对「访问过」与「扫过」,
     * 漏了就写进 verdict(severity 变 incomplete),不需要任何人记得。
     * 这比加一道 grep `page.goto` 的构建门更准:门守的是源码写法,这个守的是实际行为。
     */
    const visited = new Set<string>();
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      try {
        const u = new URL(frame.url());
        // about:blank 与 devtools 之类不算产物
        if (u.protocol === 'http:' || u.protocol === 'https:') visited.add(u.pathname);
      } catch {
        // 拿不到合法 URL 就不记 —— 记一个垃圾值只会制造假缺口
      }
    });
    const scannedPaths = new Set<string>();
    const scans: GlyphScan[] = [];

    /**
     * 【把页面侧的事情记下来 —— 超时不是「等久一点」能解决的】
     * 30 秒等不到 __REPORT_READY__,调到 50 秒大概率还是等不到,只是把一个确定的失败
     * 变成一个更慢的失败。真正需要的是知道页面那边发生了什么:它报了什么错、哪个请求失败了。
     */
    const consoleLines: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (m) => {
      if (consoleLines.length < 40) consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 300));
    });
    page.on('pageerror', (e) => {
      if (consoleLines.length < 40) consoleLines.push(`[pageerror] ${e.message}`.slice(0, 300));
    });
    page.on('requestfailed', (r) => {
      if (failedRequests.length < 20) {
        failedRequests.push(`${r.method()} ${r.url().slice(0, 200)} — ${r.failure()?.errorText ?? 'unknown'}`);
      }
    });
    page.on('response', (r) => {
      // 只记非 2xx/3xx —— 报告页取数失败会让 __REPORT_READY__ 永不置位
      if (r.status() >= 400 && failedRequests.length < 20) {
        failedRequests.push(`${r.status()} ${r.url().slice(0, 200)}`);
      }
    });

    // 渲染令牌走 query;报告页把它透传给 /api/assessment-report
    await page.goto(`${appBase}/report?rt=${encodeURIComponent(rt)}&lang=${lang}`, {
      waitUntil: 'networkidle0',
      timeout: 45_000,
    });

    /**
     * 等报告自己说画完了 —— 不用 sleep,也不只靠 networkidle0(那不保证渲染完成)。
     * PentagonLoader 那个动画【不参与】这个信号,否则会截到动画中间的帧。
     */
    /**
     * 【同时盯「页面离开了报告路由」—— 不要等满 30 秒】
     *
     * 实测:渲染令牌被拒时页面在几秒内就跳到 /expired,而 waitForFunction 还在等一个
     * 【不可能发生】的事件,等满 30 秒才报「30000ms exceeded」——那句话本身零信息量,
     * 而且把一个明确的鉴权失败伪装成了超时。
     *
     * 所以两个条件竞速:信号置位 → 成功;URL 离开 /report → 立刻失败并报出实际落点。
     */
    const leftReport = page
      .waitForFunction("!location.pathname.startsWith('/report')", { timeout: 30_000 })
      .then(() => 'left' as const);
    const becameReady = page
      .waitForFunction('window.__REPORT_READY__ === true', { timeout: 30_000 })
      .then(() => 'ready' as const);

    try {
      const outcome = await Promise.race([becameReady, leftReport]);
      if (outcome === 'left') {
        const where = await page.evaluate(() => ({
          url: location.href,
          bodyText: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
        }));
        throw new Error(
          `report page navigated away to ${where.url} —— 报告页只在鉴权失败时跳走` +
            `(401/403 → /expired)。这不是超时,是渲染令牌没被接受。page=${JSON.stringify({ where, consoleLines, failedRequests })}`,
        );
      }
    } catch (err) {
      // 超时那一刻页面到底是什么状态 —— 这些才是能定位问题的东西
      const pageState = await page
        .evaluate(() => ({
          readyState: document.readyState,
          reportReady: (window as unknown as { __REPORT_READY__?: boolean }).__REPORT_READY__ ?? null,
          url: location.href,
          // 报告页三种状态各有可辨识的文字,据此判断它停在哪一屏
          bodyText: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
          hasLoader: !!document.querySelector('.qai-pentagon-edge'),
          fontsStatus: (document as unknown as { fonts?: { status?: string } }).fonts?.status ?? 'n/a',
        }))
        .catch((e) => ({ evaluateFailed: e instanceof Error ? e.message : String(e) }));

      const facts = { pageState, consoleLines, failedRequests };
      console.error(`__REPORT_READY__ timeout. facts=${JSON.stringify(facts)}`);
      throw new Error(
        `${err instanceof Error ? err.message : String(err)} || page=${JSON.stringify(facts)}`,
      );
    }
    scans.push(await scanCurrentPage(page));
    scannedPaths.add(new URL(page.url()).pathname);

    const pdf = Buffer.from(
      await page.pdf({
        format: 'a4',
        printBackground: true, // 布局主义靠墨边框与填充表意,不印背景会丢信息
        margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
      }),
    );

    /**
     * ── 分享卡:同一个浏览器实例里顺手截掉 ──
     *
     * 【为什么搭 PDF 的车而不是单开一条管线】另开一条要把字体安装、Lambda 环境注入、
     * chromium 启动整套再写一遍(判断标准 3),还要多付一次冷启动(约 16 秒)。
     * 搭车的边际成本只有一次 page.goto 加两次 element screenshot。
     * 附带好处:重试路径也白拿了 —— Admin 的「重新生成」和定时 sweep 都会连带重渲分享卡。
     *
     * 【失败被单独关在这里】分享卡是**附属品的附属品**:PDF 失败只是少个下载按钮,
     * 分享卡失败只是少张图。所以它抛出来的东西一律不许往外冒 ——
     * `cards.error` 只是一条记录,`pdf` 该怎么返回还怎么返回。
     * 这与整个异步化是同一个取向:主交付不受附属品拖累。
     */
    const cards = await renderShareCards(page, appBase, rt, lang);
    if (cards.scan) {
      scans.push(cards.scan);
      scannedPaths.add(new URL(page.url()).pathname);
    }

    /**
     * 【分级放到最后,因为它现在要看全部产物】
     * 以前 classify 紧跟报告页那次扫描 —— 那正是它只覆盖一页的原因。
     * 现在它拿到的是合并后的扫描结果 + 覆盖情况。
     */
    const scan = mergeGlyphScans(scans);
    const glyph = classifyGlyphReport(scan, {
      visited: [...visited],
      scanned: [...scannedPaths],
    });

    return { pdf, glyph, scan, cards };
  } finally {
    await browser.close();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let secret: string;
  try {
    secret = env('INTERNAL_FN_SECRET');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  /**
   * 【坏 body 要回 400,不能让函数崩】JSON.parse 抛出来会变成 FUNCTION_INVOCATION_FAILED,
   * 那是 500 —— 客户端看到的是「服务器挂了」而不是「你发的东西不对」,排查方向直接被带偏。
   * Vercel 的 req.body 是 getter,内容畸形时【访问它】就抛,所以连读取一并包进 try。
   */
  let body: Record<string, unknown>;
  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
      return res.status(400).json({ error: 'invalid_json', detail: 'body must be a JSON object' });
    }
    body = (raw as Record<string, unknown>) ?? {};
  } catch (err) {
    return res.status(400).json({
      error: 'invalid_json',
      detail: err instanceof Error ? err.message : 'body is not valid JSON',
    });
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
  const probe = body.probe === true;
  if (!sessionId) {
    return res.status(400).json({ error: 'missing session_id', detail: 'expected { session_id: "<uuid>" }' });
  }

  /**
   * 【`lang` 是必填,没有默认值】
   *
   * 一个 session 会有**两行** report_files(zh / en),而「渲哪一行」这件事只有调用方知道:
   * sweep 是逐行扫的,学员那个按钮是按他当前语言点的。
   *
   * ⚠️ **不能从 `entitlement.lang` 读** —— 那是「这个人现在偏好什么」,
   * 而这次渲的是「哪一份文件」。学员切到英文之后触发重渲中文版,
   * 从 entitlement 读会渲出**英文的中文版**:文件名说 zh,内容是 en,
   * 而两者都不会报错。
   *
   * 缺参数一律 400:这个端点只被我们自己的三个调用方打(finalize / sweep / 学员端点),
   * 而一个默认值会让「调用方忘了传」变成「静默渲成中文」。
   */
  const langParse = parseLang(body.lang);
  if (langParse.kind !== 'set') {
    return res.status(400).json({
      error: 'missing lang',
      detail:
        langParse.kind === 'invalid'
          ? `lang must be zh or en, received ${JSON.stringify(langParse.received)}`
          : 'expected { session_id, lang } — lang has no default: one session has one row per language',
    });
  }
  const lang: Lang = langParse.lang;

  /**
   * 【两代 secret key,新的优先】Disable 之后 legacy 不认;配好新 key 之前 legacy 还要能用。
   * 两个都没有才报错 —— 见 _lib/apiKeys.ts。
   */
  const secretKey = pickSecretKeyFromPlainEnv(ENV.SUPABASE_SECRET_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY);
  if (!secretKey) {
    console.error(
      'server_misconfigured: neither SUPABASE_SECRET_KEY nor SUPABASE_SERVICE_ROLE_KEY is set',
    );
    return res.status(500).json({ error: 'server_misconfigured' });
  }
  const supa = createClient(env('SUPABASE_URL'), secretKey, {
    auth: { persistSession: false },
  });

  // probe 不动数据库 —— 它只回答「这条管线现在健康吗」
  if (!probe) {
    const { data: row } = await supa
      .from('assessment_report_files')
      .select('pdf_attempts, pdf_status')
      .eq('session_id', sessionId)
      .eq('lang', lang)
      .maybeSingle();
    const attempts = (row?.pdf_attempts as number) ?? 0;
    if (attempts >= MAX_PDF_ATTEMPTS) {
      // 已经用完次数 —— 不再自动重试,等 Admin 手动重置。次数是【每种语言各自】的
      return res.status(409).json({ error: 'failed_permanent', attempts, lang });
    }
    /**
     * 【upsert 而不是 update】学员点「生成英文版」时那一行**还不存在**;
     * finalize 那次也是第一次。update 在没有行时是静默的 0 行影响 ——
     * 于是状态永远停在「什么都没有」,而渲染照常跑完、照常写 ready,
     * 中间那段「正在生成」对前端不可见。
     */
    await supa.from('assessment_report_files').upsert(
      {
        session_id: sessionId,
        lang,
        pdf_status: 'rendering',
        pdf_attempts: attempts + 1,
        pdf_status_at: new Date().toISOString(),
      },
      { onConflict: 'session_id,lang' },
    );
  }

  try {
    const { pdf, glyph, scan, cards } = await renderReport(sessionId, lang);

    if (probe) {
      // 同一条管线,只是不落地。post-deploy 的检查就跑这个
      return res.status(200).json({
        ok: true,
        probe: true,
        bytes: pdf.length,
        glyph: glyph.severity,
        glyphMessage: glyph.message,
        scanned: scan.scanned,
        // probe 不落地,但要回报分享卡这条支路健不健康 —— 不然 probe 说「管线没问题」时,
        // 它其实没有看过分享卡那一半
        cards: { rendered: cards.images.length, error: cards.error },
      });
    }

    const path = pdfObjectPath(sessionId, lang);
    const { error: upErr } = await supa.storage
      .from('reports')
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    /**
     * ── 分享卡落地 ──
     *
     * 【上传失败也不许抛】渲染那一步已经把失败关起来了,上传这一步同样要关 ——
     * 否则「PDF 都好了,因为一张图没传上去而整条 render_failed」就是把主交付
     * 绑在附属品上,方向和整个异步化正好相反。
     * 注意 reports bucket 的 mime 白名单原来只有 application/pdf,
     * image/png 是 20260808000100 那条迁移放开的 —— 迁移没应用的话这里会稳定失败,
     * 而 share_card_error 里会写着 Storage 的原话。
     */
    const cardPaths: { share_card_path: string | null; share_card_tall_path: string | null } = {
      share_card_path: null,
      share_card_tall_path: null,
    };
    let cardError = cards.error;
    for (const img of cards.images) {
      const cardPath = shareCardObjectPath(sessionId, lang, img.suffix);
      const { error: cardUpErr } = await supa.storage
        .from('reports')
        .upload(cardPath, img.png, { contentType: 'image/png', upsert: true });
      if (cardUpErr) {
        cardError = `share card upload failed for ${cardPath}: ${cardUpErr.message}`.slice(0, 500);
        console.error(cardError);
        continue;
      }
      if (img.suffix.includes('tall')) cardPaths.share_card_tall_path = cardPath;
      else cardPaths.share_card_path = cardPath;
    }

    /**
     * 【字形有问题仍然出 PDF】有方块的报告好过没有报告。严重程度只写进 pdf_last_error
     * 让 Admin 看得见 —— 那样问题会被我们主动发现,而不是等学员投诉。
     */
    await supa
      .from('assessment_report_files')
      .update({
        pdf_path: path,
        pdf_status: 'ready',
        pdf_status_at: new Date().toISOString(),
        pdf_last_error: glyph.message,
        ...cardPaths,
        // 成功时显式清空,免得上一次的错误一直挂着骗人
        share_card_error: cardError,
      })
      .eq('session_id', sessionId)
      .eq('lang', lang);

    if (needsAttention(glyph.severity)) {
      console.error(`PDF rendered for ${sessionId} but ${glyph.message}`);
    }
    if (cardError) console.error(`PDF ready for ${sessionId} but the share card did not make it: ${cardError}`);
    return res.status(200).json({
      ok: true,
      path,
      bytes: pdf.length,
      glyph: glyph.severity,
      cards: { ...cardPaths, error: cardError },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`render-pdf failed for ${sessionId}: ${detail}`);
    if (!probe) {
      const { data: row } = await supa
        .from('assessment_report_files')
        .select('pdf_attempts')
        .eq('session_id', sessionId)
        .eq('lang', lang)
        .maybeSingle();
      const attempts = (row?.pdf_attempts as number) ?? 1;
      await supa
        .from('assessment_report_files')
        .update({
          pdf_status: attempts >= MAX_PDF_ATTEMPTS ? 'failed_permanent' : 'failed',
          pdf_status_at: new Date().toISOString(),
          pdf_last_error: detail.slice(0, 1000),
        })
        .eq('session_id', sessionId)
        .eq('lang', lang);
    }
    return res.status(500).json({ error: 'render_failed', detail: detail.slice(0, 300) });
  }
}
