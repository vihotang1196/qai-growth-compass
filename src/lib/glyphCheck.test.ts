import { describe, expect, it } from 'vitest';
import {
  classifyGlyphReport,
  mergeGlyphScans,
  needsAttention,
  type GlyphScan,
} from '../../api/_lib/glyphCheck';

/**
 * 测试数据里的中日韩字符从【码位】构造,不写成字符串字面量。
 *
 * 这些字符【是】被测对象(要验的正是「中文字渲染失败时怎么分级」),但 src/** 的规矩是
 * 字面量一律英文。用 \u 转义没用 —— lint 规则看的是 AST 里 Literal.value,那已经是解码后的
 * 实际字符,转义只骗过肉眼。从码位构造后 Literal.value 是数字,规则与约定都不被绕过。
 */
const cp = (code: number) => String.fromCharCode(code);
const YING = cp(0x76c8); // U+76C8 —— 探测串里的常用字
const LI = cp(0x5229); // U+5229
const RARE_A = cp(0x4dae); // U+4DAE —— subset 里故意排除的生僻字
const RARE_B = cp(0x9f98); // U+9F98

function scan(over: Partial<GlyphScan> = {}): GlyphScan {
  return { commonMissing: [], otherTofu: [], otherBlank: [], scanned: 500, ...over };
}

describe('classifyGlyphReport — graded by cause, not by count', () => {
  it('clean scan → ok, no message', () => {
    expect(classifyGlyphReport(scan())).toEqual({ severity: 'ok', message: null });
  });

  it('common characters missing → critical (the font did not load)', () => {
    const v = classifyGlyphReport(scan({ commonMissing: [YING, LI] }));
    expect(v.severity).toBe('critical');
    expect(v.message).toContain('GLYPH_CRITICAL');
    // 讯息要点出实际字符,排查时才知道是哪一批
    expect(v.message).toContain(YING + LI);
  });

  it('critical wins even when other characters are also missing', () => {
    // 常用字都缺时,其余缺失只是同一个原因的副产品 —— 报最严重的那个成因
    const v = classifyGlyphReport(scan({ commonMissing: [YING], otherTofu: [RARE_A, RARE_B] }));
    expect(v.severity).toBe('critical');
  });

  it('only rare characters missing → partial (fallback gap, report still usable)', () => {
    const v = classifyGlyphReport(scan({ otherTofu: [RARE_A] }));
    expect(v.severity).toBe('partial');
    expect(v.message).toContain('GLYPH_PARTIAL');
  });

  it('a single rare character and fifty rare characters are both partial', () => {
    // 刻意不按数量分级:数量阈值是任意的,而且不指向任何动作。
    // 一个生僻姓名和五十个,要做的事都是「补字体」
    const one = classifyGlyphReport(scan({ otherTofu: [RARE_A] }));
    const many = classifyGlyphReport(scan({ otherTofu: Array.from({ length: 50 }, (_, i) => String(i)) }));
    expect(one.severity).toBe('partial');
    expect(many.severity).toBe('partial');
  });

  it('long missing lists are truncated in the message but the count is exact', () => {
    const chars = Array.from({ length: 40 }, (_, i) => String.fromCharCode(0x4e00 + i));
    const v = classifyGlyphReport(scan({ otherTofu: chars }));
    expect(v.message).toContain('40 character(s)');
    // 讯息进 pdf_last_error(有长度上限),不能把 40 个字全塞进去
    expect(v.message!.length).toBeLessThan(300);
  });

  it('blank glyphs are critical, not partial — the fallback layer is dead', () => {
    /**
     * 实测暴露的那一类:兜底层没生效时容器里没有任何字体覆盖那些码位,浏览器连 .notdef
     * 都画不出来,渲染是纯空白。而空白的位图与 U+FFFF 不同,只比 .notdef 会判成 ok ——
     * 「字全没显示但检查说没问题」。空白按系统性失败处理:它影响所有客户的所有生僻字。
     */
    const v = classifyGlyphReport(scan({ otherBlank: [RARE_A, RARE_B] }));
    expect(v.severity).toBe('critical');
    expect(v.severity).not.toBe('ok');
    expect(v.message).toContain('blank');
  });

  it('blank outranks tofu — a blank present makes it critical even with tofu around', () => {
    const v = classifyGlyphReport(scan({ otherTofu: [RARE_A], otherBlank: [RARE_B] }));
    expect(v.severity).toBe('critical');
  });

  it('common characters missing still outranks blank', () => {
    // 常用字都渲染不出是更早的失败:字体压根没加载
    const v = classifyGlyphReport(scan({ commonMissing: [YING], otherBlank: [RARE_A] }));
    expect(v.severity).toBe('critical');
    expect(v.message).toContain('common characters');
  });

  it('scanning nothing is inconclusive, never ok', () => {
    /**
     * 这条是这套检查最重要的一条:扫不到字符说明检查【自己】没跑起来。
     * 若把它当成 ok,就成了一个永远绿着的检查 —— 那正是我们在这个项目里
     * 反复踩到的「静默通过」,而且这次它守的是每一份客户拿到的 PDF。
     */
    const v = classifyGlyphReport(scan({ scanned: 0 }));
    expect(v.severity).toBe('inconclusive');
    expect(v.severity).not.toBe('ok');
    expect(v.message).toContain('did not run');
  });
});

describe('needsAttention', () => {
  it('critical and inconclusive need attention; partial and ok do not', () => {
    expect(needsAttention('critical')).toBe(true);
    // 检查没跑起来与检查报错同等重要 —— 两者都意味着「我们不知道 PDF 对不对」
    expect(needsAttention('inconclusive')).toBe(true);
    expect(needsAttention('partial')).toBe(false);
    expect(needsAttention('ok')).toBe(false);
  });

  it('incomplete needs attention too — a partial verdict read as a full one is the bug we just had', () => {
    expect(needsAttention('incomplete')).toBe(true);
  });
});

const clean: GlyphScan = { commonMissing: [], otherTofu: [], otherBlank: [], scanned: 40 };

describe('mergeGlyphScans keeps evidence from every page', () => {
  it('unions the character lists and sums the counts', () => {
    /**
     * 【为什么不是「取最严重的那一页」】缺字是逐字符的事实,不是页面的属性:
     * 报告页缺 A、分享卡缺 B,两个都要报出来。只留一页等于丢掉另一页的证据。
     */
    const a: GlyphScan = { commonMissing: ['A'], otherTofu: ['X'], otherBlank: [], scanned: 30 };
    const b: GlyphScan = { commonMissing: [], otherTofu: ['Y'], otherBlank: ['Z'], scanned: 12 };
    const m = mergeGlyphScans([a, b]);
    expect(m.commonMissing).toEqual(['A']);
    expect(m.otherTofu).toEqual(['X', 'Y']);
    expect(m.otherBlank).toEqual(['Z']);
    expect(m.scanned).toBe(42);
  });

  it('dedupes a character that both pages are missing', () => {
    const one: GlyphScan = { commonMissing: [], otherTofu: ['X'], otherBlank: [], scanned: 5 };
    expect(mergeGlyphScans([one, one]).otherTofu).toEqual(['X']);
  });

  it('an empty list of scans is inconclusive, not ok', () => {
    // 一页都没扫成 —— 那是「我们不知道」,不是「没问题」
    expect(classifyGlyphReport(mergeGlyphScans([])).severity).toBe('inconclusive');
  });
});

describe('a verdict must not claim more coverage than it has', () => {
  it('clean glyphs but an unscanned page is NOT ok', () => {
    /**
     * 这是分享卡那次的直接回归断言:管线渲了 /report 与 /share-card,
     * 扫描只跑在 /report 上 —— 于是 verdict 说 ok,而它根本没看过卡。
     * 缺一个字符是具体问题;**扫描范围小于渲染范围是结构问题**。
     */
    const v = classifyGlyphReport(clean, { visited: ['/report', '/share-card'], scanned: ['/report'] });
    expect(v.severity).toBe('incomplete');
    expect(v.message).toContain('/share-card');
  });

  it('says which page was missed, not just that something was', () => {
    // 「覆盖不全」没法照着行动,「/share-card 没被扫」可以 —— 判断标准 9
    const v = classifyGlyphReport(clean, { visited: ['/report', '/og-image'], scanned: ['/report'] });
    expect(v.message).toContain('/og-image');
    expect(v.message).not.toContain('/report,');
  });

  it('a real tofu finding still keeps its own severity, and still reports the gap', () => {
    /**
     * 缺口【无论如何】都要附在 message 上。只在「否则就是 ok」时才说的话,
     * 一旦同时有 tofu,缺口就被吞掉了 —— 而那正是「结论看起来完整」的老毛病。
     */
    const tofu: GlyphScan = { commonMissing: [], otherTofu: ['X'], otherBlank: [], scanned: 40 };
    const v = classifyGlyphReport(tofu, { visited: ['/report', '/share-card'], scanned: ['/report'] });
    expect(v.severity).toBe('partial');
    expect(v.message).toContain('GLYPH_PARTIAL');
    expect(v.message).toContain('/share-card');
  });

  it('full coverage is still plain ok', () => {
    // 反向锁:上面几条不是恒真 —— 扫遍了就该干净地 ok
    const v = classifyGlyphReport(clean, { visited: ['/report', '/share-card'], scanned: ['/report', '/share-card'] });
    expect(v.severity).toBe('ok');
    expect(v.message).toBeNull();
  });

  it('no coverage argument at all behaves exactly as before', () => {
    // 老调用点(probe 之类)不传 coverage,不能因此变成 incomplete
    expect(classifyGlyphReport(clean).severity).toBe('ok');
  });

  it('scanning a page that was never visited is not a gap', () => {
    // 只有「渲了却没扫」是问题;反过来不是
    expect(
      classifyGlyphReport(clean, { visited: ['/report'], scanned: ['/report', '/share-card'] }).severity,
    ).toBe('ok');
  });
});
