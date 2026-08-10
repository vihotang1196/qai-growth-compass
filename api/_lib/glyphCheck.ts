/**
 * ⚠️ 【为什么这份实现在 api/_lib 而不是 src/lib】Vercel 的 Node runtime **只编译
 * `/api` 目录内**的 TypeScript(官方文档原话:"supports TypeScript files for server
 * entrypoints and files inside of the /api directory")。放在 src/ 的 .ts 不会被编译成
 * 函数可加载的 .js —— 实测就是 ERR_MODULE_NOT_FOUND,而 tsc / vite build / dep-sync
 * 四道门全绿。所以规范实现放这里,src 与 Deno 从这里导入,而不是反过来。
 *
 * 同一原因:import 必须带显式扩展名(package.json 是 "type": "module")。
 * tsconfig.api.json 用 moduleResolution: "bundler",它【允许】省略扩展名 ——
 * 那正是 tsc 放行这个 bug 的原因。scripts/check-api-imports.mjs 现在守这条。
 */

/**
 * PDF 渲染的字形自检 —— 判定与分级的纯逻辑。
 *
 * 【为什么要这个,以及它与项目里其他验证的不同】字体探针、smoke、那五条 curl 都是
 * **一次性**的:跑一次,确认它当时是对的。而字体会在没人知道的时候坏掉 ——
 * subset 重新生成、CDN 换文件、Chromium 版本变。坏掉的表现是学员拿到一份满是方块的 PDF,
 * 而我们永远不会知道。
 *
 * 这是项目里第一个**持续性**的正确性检查:每份 PDF 自己报告「我渲染完整吗」。
 * 所以它的验收标准不是「跑通一次」,是「检出问题时会怎样」——见 classifyGlyphReport。
 */

/** 浏览器内测出来的原始结果:哪些字符渲染成了 .notdef(方块) */
export interface GlyphScan {
  /** 探测串(常用字)里渲染失败的字符 —— 方块或空白都算 */
  commonMissing: string[];
  /** 页面其余文本里渲染成【方块】(.notdef)的字符,去重 */
  otherTofu: string[];
  /**
   * 页面其余文本里渲染成【空白】(零墨迹)的字符,去重。
   *
   * 【为什么空白要与方块分开,而且更严重】原来只比对「和 U+FFFF 的 .notdef 一样」。
   * 实测发现字体兜底层没生效时,Lambda 容器里没有任何字体覆盖那些码位,浏览器连 .notdef
   * 都画不出来,渲染结果是**纯空白** —— 位图与 U+FFFF 不同,于是被判成 ok。
   * 一个「字全没显示但检查说没问题」的自检,正是我们最怕的那种永远绿的检查。
   *
   * 语义上:方块 = 字体匹配上了但缺这个字(逐字问题);空白 = 没有字体覆盖它
   * (兜底层整体失效,影响所有客户的所有生僻字)。所以空白按系统性失败处理。
   */
  otherBlank: string[];
  /** 扫过的不重复字符总数,用于判断扫描本身是否有效 */
  scanned: number;
}

export type GlyphSeverity = 'ok' | 'partial' | 'critical' | 'inconclusive' | 'incomplete';

/**
 * 这一次渲染**访问了哪些页**、其中**扫了哪些**。
 *
 * 【为什么需要这个,而不是一份手写的页面清单】分享卡上线那天,扫描代码没跟着动 ——
 * 它只跑在报告页上,而管线已经多渲了一页。于是「glyph: ok」从那天起就是**不完整的结论**,
 * 而看到 ok 的人会以为整份产物都验过了。
 *
 * 手写清单解决不了这件事:下一个渲染产物(OG image、别的尺寸)照样会漏,
 * 因为清单要靠人记得改 —— 那就是同一个 bug 的下一次。
 * 所以这里的输入是**运行时真的导航过的路径**,由 puppeteer 的 framenavigated 采集。
 * 加一页而忘了扫,verdict 自己会说出来,不需要任何人记得。
 */
export interface GlyphCoverage {
  /** 主 frame 实际导航到过的路径(去重) */
  visited: string[];
  /** 其中真的跑过扫描的 */
  scanned: string[];
}

/**
 * 多页扫描结果合并 —— 数组取并集、扫描数求和。
 *
 * 【为什么不是「取最严重的那一页」】缺字是逐字符的事实,不是页面的属性:
 * 报告页缺 A、分享卡缺 B,两个都要报出来。只留一页的结果等于丢掉另一页的证据。
 */
export function mergeGlyphScans(scans: GlyphScan[]): GlyphScan {
  const uniq = (xs: string[][]) => [...new Set(xs.flat())];
  return {
    commonMissing: uniq(scans.map((s) => s.commonMissing)),
    otherTofu: uniq(scans.map((s) => s.otherTofu)),
    otherBlank: uniq(scans.map((s) => s.otherBlank)),
    scanned: scans.reduce((n, s) => n + s.scanned, 0),
  };
}

/** 渲染过但没扫过的路径 */
function coverageGap(coverage?: GlyphCoverage): string[] {
  if (!coverage) return [];
  const scanned = new Set(coverage.scanned);
  return coverage.visited.filter((p) => !scanned.has(p));
}

export interface GlyphVerdict {
  severity: GlyphSeverity;
  /** 写进 pdf_last_error 的一行,带前缀便于 Admin 分组过滤 */
  message: string | null;
}

/**
 * 分级 —— **按成因分,不按数量分**。
 *
 * 按数量定阈值(「超过 5 个方块算严重」)是任意的,而且不指向任何动作。按成因分能直接
 * 说出该去修什么:
 *
 *   critical —— 连【常用字】都是方块 ⇒ 字体压根没加载(CDN 挂了 / 路径错 / chromium.font 失败)。
 *               这是要立刻知道的:每一份 PDF 都会是废的。
 *   partial  —— 常用字正常,个别字缺 ⇒ fontconfig 兜底层没覆盖到(多半是生僻姓名)。
 *               报告本身可用,补字体即可。
 *   inconclusive —— 一个字符都没扫到 ⇒ 检查本身没跑起来(注入失败 / 页面空)。
 *               【不能当成 ok】—— 那正是「静默通过」,是这套检查最该避免的失败形态。
 *
 * 【两种都仍然出 PDF】有方块的报告好过没有报告。严重程度只影响记录与告警,不影响交付。
 */
export function classifyGlyphReport(scan: GlyphScan, coverage?: GlyphCoverage): GlyphVerdict {
  const gap = coverageGap(coverage);
  /**
   * 覆盖缺口**无论如何都要附在 message 上**,不只在其他都干净时才说。
   * 只在「否则就是 ok」时才报的话,一旦同时有 tofu,缺口就被吞掉了 ——
   * 而那正是「结论看起来完整」的老毛病。
   */
  const gapNote =
    gap.length === 0
      ? ''
      : ` || GLYPH_COVERAGE_GAP: rendered but never scanned: ${gap.join(', ')} — ` +
        'this verdict does not cover the whole product. See api/_lib/glyphCheck.ts GlyphCoverage.';
  const withGap = (v: GlyphVerdict): GlyphVerdict =>
    gapNote ? { ...v, message: `${v.message ?? ''}${gapNote}` } : v;

  if (scan.scanned === 0) {
    return withGap({
      severity: 'inconclusive',
      message: 'GLYPH_INCONCLUSIVE: the glyph scan saw no characters — the check itself did not run',
    });
  }
  // 常用字都渲染不出 ⇒ 字体压根没加载,这个 deploy 出的每份 PDF 都废
  if (scan.commonMissing.length > 0) {
    return withGap({
      severity: 'critical',
      message:
        `GLYPH_CRITICAL: common characters did not render (${scan.commonMissing.join('')}) — ` +
        'the CJK font almost certainly failed to load; every PDF from this deploy is affected',
    });
  }
  // 空白 ⇒ 没有任何字体覆盖那些码位,兜底层整体失效(不是逐字缺字)
  if (scan.otherBlank.length > 0) {
    return withGap({
      severity: 'critical',
      message:
        `GLYPH_CRITICAL: ${scan.otherBlank.length} character(s) rendered as blank, no ink at all ` +
        `(${scan.otherBlank.slice(0, 20).join('')}) — blank is worse than tofu: tofu means the font ` +
        'matched but lacks the glyph, blank means no font covered it at all, i.e. the fontconfig ' +
        'fallback layer is not in effect. Every rare character for every customer is invisible.',
    });
  }
  // 只有方块 ⇒ 兜底层在,只是缺这几个字(多半生僻姓名)
  if (scan.otherTofu.length > 0) {
    return withGap({
      severity: 'partial',
      message:
        `GLYPH_PARTIAL: ${scan.otherTofu.length} character(s) rendered as tofu ` +
        `(${scan.otherTofu.slice(0, 20).join('')}) — fontconfig fallback does not cover them`,
    });
  }
  /**
   * 字形本身干净,但有页面没被扫过 —— **这不能叫 ok**。
   * 'incomplete' 与 'inconclusive' 是两件事:后者是扫描压根没跑,
   * 前者是跑了但没跑遍。分开命名,因为该修的东西不同。
   */
  if (gap.length > 0) {
    return {
      severity: 'incomplete',
      message:
        `GLYPH_INCOMPLETE: no glyph problem found, but the scan did not cover every page rendered` +
        gapNote,
    };
  }
  return { severity: 'ok', message: null };
}

/** 严重到需要主动告警(Admin 名单页要能一眼看到)的级别 */
export function needsAttention(severity: GlyphSeverity): boolean {
  // incomplete 也要告警:一个不完整的结论被当成完整的,正是分享卡这次的教训
  return severity === 'critical' || severity === 'inconclusive' || severity === 'incomplete';
}
