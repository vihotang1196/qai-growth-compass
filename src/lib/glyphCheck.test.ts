import { describe, expect, it } from 'vitest';
import { classifyGlyphReport, needsAttention, type GlyphScan } from '../../api/_lib/glyphCheck';

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
  return { commonMissing: [], otherMissing: [], scanned: 500, ...over };
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
    const v = classifyGlyphReport(scan({ commonMissing: [YING], otherMissing: [RARE_A, RARE_B] }));
    expect(v.severity).toBe('critical');
  });

  it('only rare characters missing → partial (fallback gap, report still usable)', () => {
    const v = classifyGlyphReport(scan({ otherMissing: [RARE_A] }));
    expect(v.severity).toBe('partial');
    expect(v.message).toContain('GLYPH_PARTIAL');
  });

  it('a single rare character and fifty rare characters are both partial', () => {
    // 刻意不按数量分级:数量阈值是任意的,而且不指向任何动作。
    // 一个生僻姓名和五十个,要做的事都是「补字体」
    const one = classifyGlyphReport(scan({ otherMissing: [RARE_A] }));
    const many = classifyGlyphReport(scan({ otherMissing: Array.from({ length: 50 }, (_, i) => String(i)) }));
    expect(one.severity).toBe('partial');
    expect(many.severity).toBe('partial');
  });

  it('long missing lists are truncated in the message but the count is exact', () => {
    const chars = Array.from({ length: 40 }, (_, i) => String.fromCharCode(0x4e00 + i));
    const v = classifyGlyphReport(scan({ otherMissing: chars }));
    expect(v.message).toContain('40 character(s)');
    // 讯息进 pdf_last_error(有长度上限),不能把 40 个字全塞进去
    expect(v.message!.length).toBeLessThan(300);
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
});
