/**
 * @font-face 注入
 *
 * 为什么用 JS 注入而不是写死在 .css 里:字体托管在 BunnyCDN,base URL 由
 * VITE_CDN_FONT_BASE 提供,而 CSS 里无法读环境变量。这样 CDN 路径变更时
 * 只改环境变量,不用改代码、不用重新发版逻辑分支。
 *
 * 家族名规则见 brutalist.css 里的注释与 PROGRESS.md 0.14:
 *   'Noto Sans SC Subset'  ← 这里声明的 webfont(常用字)
 *   'Noto Sans SC'         ← PDF 渲染时 chromium.font() 装的完整字体(生僻字兜底)
 * 两者名字必须不同,否则兜底层失效。
 */

const CDN_BASE =
  import.meta.env.VITE_CDN_FONT_BASE ?? 'https://cdn.qiai.tech/fonts/';

/** 结尾补斜杠,避免环境变量写法不一致导致 URL 拼错 */
function base(): string {
  return CDN_BASE.endsWith('/') ? CDN_BASE : `${CDN_BASE}/`;
}

function faces(): string {
  const b = base();
  return `
@font-face {
  font-family: 'Sora';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url('${b}Sora[wght].woff2') format('woff2-variations');
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url('${b}PlusJakartaSans[wght].woff2') format('woff2-variations');
}
@font-face {
  font-family: 'Noto Sans SC Subset';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('${b}NotoSansSC-Regular.subset.woff2') format('woff2');
}
@font-face {
  font-family: 'Noto Sans SC Subset';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('${b}NotoSansSC-Bold.subset.woff2') format('woff2');
}
`;
}

let injected = false;

/** 在 React 挂载前调用一次 */
export function injectFontFaces(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;

  const preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.crossOrigin = 'anonymous';
  try {
    preconnect.href = new URL(base()).origin;
    document.head.appendChild(preconnect);
  } catch {
    // base URL 还没配好时不阻塞渲染,字体自然回落系统字体
  }

  const style = document.createElement('style');
  style.setAttribute('data-qai-fonts', '');
  style.textContent = faces();
  document.head.appendChild(style);
}

/** 供 /api/font-probe 与 PDF 渲染复用同一份 @font-face 定义 */
export function fontFaceCss(cdnBase?: string): string {
  if (!cdnBase) return faces();
  const b = cdnBase.endsWith('/') ? cdnBase : `${cdnBase}/`;
  return faces().replaceAll(base(), b);
}
