import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { injectFontFaces } from '@/styles/fonts';
import { LocaleProvider } from '@/lib/i18n';
import App from './App';
import './index.css';

// @font-face 必须在首次渲染前注入,否则首屏会闪一次系统字体
injectFontFaces();

/**
 * 【让 iPhone 上的「按下」看得见】iOS 的 WebKit(Safari 与 iPhone 上的 Chrome)默认不对触摸应用 :active ——
 * 页面上注册过一个 touchstart 监听才会。按钮的按压效果(.qai-lift:active)全靠它。
 * passive:不拦滚动。
 */
document.addEventListener('touchstart', () => {}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
