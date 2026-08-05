import { useLocation } from 'react-router-dom';
import { useT } from '@/lib/i18n';

/**
 * 右上角常驻的中 / EN 切换(config.ui.language_toggle)。
 *
 * 【为什么只是个按钮 —— i18n 管道 Stage 1 就建好了】setLocale 已经做完整套:
 * 切 state + 写 localStorage(compass_lang)+ 更新 ?lang= URL 参数;取值器 t / tk
 * 已经按 locale 取值。所以这里不碰取值逻辑,只调 setLocale。
 *
 * 【文案是「要切去的那个语言」】common.lang 在中文界面显示 "EN"、英文界面显示 "中文" ——
 * 按钮上写的是点下去会变成的语言,不是当前语言。
 *
 * 【在后台与展示页隐藏】/admin 右上角已有「退出」按钮,固定定位会撞上;
 * 而且后台面向运营不面向客户。/_showcase 是开发演示页。其余客户页都显示。
 */
const HIDDEN_PREFIXES = ['/admin', '/_showcase'];

export default function LanguageToggle() {
  const { locale, setLocale, tk } = useT();
  const { pathname } = useLocation();

  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      // 固定右上角,z 高于答题页那条 sticky 进度条(z-10)
      className="fixed right-3 top-3 z-50 border-brutal border-line bg-paper px-3 py-1.5 font-head text-sm font-bold shadow-brutal-sm"
      aria-label={tk('common.langSwitch')}
    >
      {tk('common.lang')}
    </button>
  );
}
