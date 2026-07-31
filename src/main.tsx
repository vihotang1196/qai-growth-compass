import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { injectFontFaces } from '@/styles/fonts';
import { LocaleProvider } from '@/lib/i18n';
import App from './App';
import './index.css';

// @font-face 必须在首次渲染前注入,否则首屏会闪一次系统字体
injectFontFaces();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
