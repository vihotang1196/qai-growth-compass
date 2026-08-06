import type { VercelRequest, VercelResponse } from '@vercel/node';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readdirSync } from 'node:fs';
import { classifyGlyphReport, needsAttention, type GlyphScan } from './_lib/glyphCheck.js';
import { signRenderToken } from './_lib/renderToken.js';

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

const MAX_ATTEMPTS = 3;
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
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  APP_BASE_URL: process.env.APP_BASE_URL,
  CDN_FONT_BASE: process.env.CDN_FONT_BASE ?? 'https://cdn.qiai.tech/fonts/',
};

function env(name: keyof typeof ENV): string {
  const v = ENV[name];
  if (!v) throw new Error(`server_misconfigured: missing ${name}`);
  return v;
}

/** 浏览器里跑的字形自检 —— 注入到页面上下文执行 */
function scanGlyphsInPage(commonProbe: string): GlyphScan {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { commonMissing: [], otherMissing: [], scanned: 0 };

  const cs = getComputedStyle(document.body);
  const fontShorthand = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.font = fontShorthand;

  /**
   * U+FFFF 保证没有字形,所以它渲染出来的【就是本环境 .notdef 的样子】。
   * 用它当参照,而不是硬编码一个「方块宽度」—— 不同字体的 .notdef 不一样。
   */
  const TOFU = '￿';
  const refWidth = ctx.measureText(TOFU).width;

  const fp = document.createElement('canvas');
  fp.width = 24;
  fp.height = 24;
  const fctx = fp.getContext('2d')!;
  const fingerprint = (ch: string): string => {
    fctx.clearRect(0, 0, 24, 24);
    // canvas 尺寸变更会重置上下文状态,所以每次都要重设 font
    fctx.font = fontShorthand;
    fctx.fillText(ch, 1, 18);
    return Array.from(fctx.getImageData(0, 0, 24, 24).data).join('');
  };
  const refFp = fingerprint(TOFU);

  /** 宽度先筛(便宜),命中的再比位图(准) —— 只有可疑字符付出昂贵的代价 */
  const isTofu = (ch: string): boolean =>
    ctx.measureText(ch).width === refWidth && fingerprint(ch) === refFp;

  // 收集页面上所有可见文本的不重复字符
  const chars = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    for (const ch of (node.textContent ?? '').trim()) {
      // 空白与 ASCII 不进检查:它们从来不是中文字体的问题,只会稀释信号
      if (ch.charCodeAt(0) > 0x7f) chars.add(ch);
    }
    node = walker.nextNode();
  }

  const commonMissing = [...commonProbe].filter(isTofu);
  const otherMissing = [...chars].filter((ch) => isTofu(ch));
  return { commonMissing, otherMissing, scanned: chars.size + commonProbe.length };
}

interface RenderOutcome {
  pdf: Buffer;
  glyph: ReturnType<typeof classifyGlyphReport>;
  scan: GlyphScan;
}

/**
 * 真实渲染管线。正常路径与 probe 共用这一个函数 —— 见文件头。
 */
async function renderReport(sessionId: string): Promise<RenderOutcome> {
  const appBase = env('APP_BASE_URL').replace(/\/$/, '');
  const rt = await signRenderToken(sessionId, env('INTERNAL_FN_SECRET'), Date.now());

  /**
   * 中文字体不打包进函数(8.3MB 会顶爆体积上限),运行时从 CDN 装进 fontconfig。
   * 这是 subset woff2 之外的**兜底层**:subset 只覆盖常用字,姓名里的生僻字靠这个。
   */
  await chromium.font(`${env('CDN_FONT_BASE').replace(/\/$/, '')}/NotoSansSC-Regular.otf`);

  /**
   * 【launch 失败时把环境事实一起报出来,不要只报一句 launch failed】
   *
   * libnss3.so 那类错误的成因有好几种(基础镜像变了、.so 压缩包没进产物、
   * LD_LIBRARY_PATH 没设上),光看「起不来」无法区分,只能靠猜版本试 —— 而猜版本试
   * 正是这个项目一路在避免的。这里把 executablePath() 实际做了什么摊开:
   * 二进制在不在、库目录在不在、LD_LIBRARY_PATH 设没设、Node 版本是多少。
   * 下一次失败就是数据,不是又一轮猜。
   */
  const execPath = await chromium.executablePath();
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

    // 渲染令牌走 query;报告页把它透传给 /api/assessment-report
    await page.goto(`${appBase}/report?rt=${encodeURIComponent(rt)}&lang=zh`, {
      waitUntil: 'networkidle0',
      timeout: 45_000,
    });

    /**
     * 等报告自己说画完了 —— 不用 sleep,也不只靠 networkidle0(那不保证渲染完成)。
     * PentagonLoader 那个动画【不参与】这个信号,否则会截到动画中间的帧。
     */
    await page.waitForFunction('window.__REPORT_READY__ === true', { timeout: 30_000 });
    await page.evaluateHandle('document.fonts.ready');

    const scan = (await page.evaluate(scanGlyphsInPage, COMMON_PROBE)) as GlyphScan;
    const glyph = classifyGlyphReport(scan);

    const pdf = Buffer.from(
      await page.pdf({
        format: 'a4',
        printBackground: true, // 布局主义靠墨边框与填充表意,不印背景会丢信息
        margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
      }),
    );
    return { pdf, glyph, scan };
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

  const supa = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  // probe 不动数据库 —— 它只回答「这条管线现在健康吗」
  if (!probe) {
    const { data: row } = await supa
      .from('assessment_results')
      .select('pdf_attempts, pdf_status')
      .eq('session_id', sessionId)
      .maybeSingle();
    const attempts = (row?.pdf_attempts as number) ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      // 已经用完次数 —— 不再自动重试,等 Admin 手动重置
      return res.status(409).json({ error: 'failed_permanent', attempts });
    }
    await supa
      .from('assessment_results')
      .update({ pdf_status: 'rendering', pdf_attempts: attempts + 1 })
      .eq('session_id', sessionId);
  }

  try {
    const { pdf, glyph, scan } = await renderReport(sessionId);

    if (probe) {
      // 同一条管线,只是不落地。post-deploy 的检查就跑这个
      return res.status(200).json({
        ok: true,
        probe: true,
        bytes: pdf.length,
        glyph: glyph.severity,
        glyphMessage: glyph.message,
        scanned: scan.scanned,
      });
    }

    const path = `${sessionId}.pdf`;
    const { error: upErr } = await supa.storage
      .from('reports')
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    /**
     * 【字形有问题仍然出 PDF】有方块的报告好过没有报告。严重程度只写进 pdf_last_error
     * 让 Admin 看得见 —— 那样问题会被我们主动发现,而不是等学员投诉。
     */
    await supa
      .from('assessment_results')
      .update({
        pdf_path: path,
        pdf_status: 'ready',
        pdf_last_error: glyph.message,
      })
      .eq('session_id', sessionId);

    if (needsAttention(glyph.severity)) {
      console.error(`PDF rendered for ${sessionId} but ${glyph.message}`);
    }
    return res.status(200).json({ ok: true, path, bytes: pdf.length, glyph: glyph.severity });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`render-pdf failed for ${sessionId}: ${detail}`);
    if (!probe) {
      const { data: row } = await supa
        .from('assessment_results')
        .select('pdf_attempts')
        .eq('session_id', sessionId)
        .maybeSingle();
      const attempts = (row?.pdf_attempts as number) ?? 1;
      await supa
        .from('assessment_results')
        .update({
          pdf_status: attempts >= MAX_ATTEMPTS ? 'failed_permanent' : 'failed',
          pdf_last_error: detail.slice(0, 1000),
        })
        .eq('session_id', sessionId);
    }
    return res.status(500).json({ error: 'render_failed', detail: detail.slice(0, 300) });
  }
}
