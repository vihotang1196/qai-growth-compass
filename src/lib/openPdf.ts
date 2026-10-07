/**
 * 报告页「下载 X 版 PDF」:拿到新签名的链接之后怎么打开。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么不开新窗口】2026-10-07 第三次彩排:按钮第一次按「没反应」、第二次才打开。
 * 点击之后要先 await 取一条新签名的链接(签名只活 1 小时,所以每次点击现取),
 * 然后才 window.open —— 等的那一下超过了手机浏览器认为「这是用户点的」的时间窗,
 * 新窗口被当成弹窗拦掉;`noopener` 又让 open 恒返回 null,代码察觉不到。
 * iPhone(Safari 与 iOS 上所有浏览器)最严,安卓 Chrome 宽一些。
 *
 * 【修法 D(Viho 定)】拿到链接后在**当前页**跳转(`location.assign`):
 *   - 弹窗拦截只针对新窗口,当前页跳转不会被拦 —— 等多久都一样
 *   - 链接每次都是新签的,没有过期问题
 *   - WhatsApp 等 App 内置浏览器对新窗口支持不一,当前页跳转最稳
 *   代价:会离开报告页,看完要按返回键回来(安卓 Chrome 遇到 PDF 多半是直接下载,页面不动)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface PdfNavigator {
  assign(url: string): void;
  open(url: string, target: string, features: string): unknown;
}

interface FilesPayload {
  files?: { lang: string; url: string | null }[];
}

/** 返回是否已经跳转;这种语言还没有可下载的文件就不跳 */
export function openFreshPdf(fresh: FilesPayload, lang: 'zh' | 'en', nav: PdfNavigator): boolean {
  const url = fresh.files?.find((f) => f.lang === lang)?.url;
  if (!url) return false;
  nav.assign(url);
  return true;
}
