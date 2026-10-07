import { describe, expect, it, vi } from 'vitest';
import { openFreshPdf } from './openPdf';

/**
 * 2026-10-07 第三次彩排:报告页的下载按钮第一次按「没反应」、第二次才打开。
 * 原因:点击之后先 await 取新签名链接,再 window.open —— 等的那一下超过了手机浏览器
 * 认为「这是用户点的」的时间窗,新窗口被当成弹窗拦掉(noopener 让 open 恒返回 null,代码察觉不到)。
 * 修法 D(Viho 定):拿到链接后在**当前页**跳转,不开新窗口 —— 当前页跳转不受弹窗拦截。
 * 浏览器层面的「第一次就能打开」要在真机上验;这里钉住的是「不开新窗口、用新签的那条」。
 */
function fakeNav() {
  return { assign: vi.fn(), open: vi.fn() };
}

const FRESH = {
  files: [
    { lang: 'en', url: 'https://example.supabase.co/storage/v1/object/sign/reports/s/en.pdf?token=NEW' },
    { lang: 'zh', url: null },
  ],
};

describe('openFreshPdf', () => {
  // 在当前页跳到新签的那条链接 —— 不开新窗口(开新窗口才会被弹窗拦截)
  it('navigates the current page to the freshly signed URL and never opens a new window', () => {
    const nav = fakeNav();
    expect(openFreshPdf(FRESH, 'en', nav)).toBe(true);
    expect(nav.assign).toHaveBeenCalledWith(FRESH.files[0].url);
    expect(nav.open).not.toHaveBeenCalled();
  });

  // 这种语言还没有可下载的文件 → 不跳,交给页面显示状态
  it('does nothing when that language has no downloadable file yet', () => {
    const nav = fakeNav();
    expect(openFreshPdf(FRESH, 'zh', nav)).toBe(false);
    expect(nav.assign).not.toHaveBeenCalled();
    expect(nav.open).not.toHaveBeenCalled();
  });
});
