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
  /** 探测串(常用字)里渲染失败的字符 */
  commonMissing: string[];
  /** 页面其余文本里渲染失败的字符(去重) */
  otherMissing: string[];
  /** 扫过的不重复字符总数,用于判断扫描本身是否有效 */
  scanned: number;
}

export type GlyphSeverity = 'ok' | 'partial' | 'critical' | 'inconclusive';

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
export function classifyGlyphReport(scan: GlyphScan): GlyphVerdict {
  if (scan.scanned === 0) {
    return {
      severity: 'inconclusive',
      message: 'GLYPH_INCONCLUSIVE: the glyph scan saw no characters — the check itself did not run',
    };
  }
  if (scan.commonMissing.length > 0) {
    return {
      severity: 'critical',
      message:
        `GLYPH_CRITICAL: common characters rendered as tofu (${scan.commonMissing.join('')}) — ` +
        'the CJK font almost certainly failed to load; every PDF from this deploy is affected',
    };
  }
  if (scan.otherMissing.length > 0) {
    return {
      severity: 'partial',
      message:
        `GLYPH_PARTIAL: ${scan.otherMissing.length} character(s) rendered as tofu ` +
        `(${scan.otherMissing.slice(0, 20).join('')}) — fontconfig fallback does not cover them`,
    };
  }
  return { severity: 'ok', message: null };
}

/** 严重到需要主动告警(Admin 名单页要能一眼看到)的级别 */
export function needsAttention(severity: GlyphSeverity): boolean {
  return severity === 'critical' || severity === 'inconclusive';
}
