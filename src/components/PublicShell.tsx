import { Outlet } from 'react-router-dom';
import LanguageToggle from '@/components/LanguageToggle';

/**
 * 面向客户的页面共用的外壳 —— **全局 UI 一律挂在这里,而不是挂在 Routes 外面**。
 *
 * 【为什么要有这一层:默认不带 chrome】
 * 上一版 `LanguageToggle` 渲在 `<Routes>` 之外(浮在所有页面上),靠它自己一份
 * `HIDDEN_PREFIXES = ['/admin', '/_showcase']` 来决定哪里不显示。
 * 然后 `/share-card` 这条新路由出现了 —— **不在那份名单里,于是 EN 按钮被截进了分享卡**。
 * 发到朋友圈的图上带一个 UI 控件,看起来像截屏而不是设计好的卡片,
 * 而这张卡的全部目的就是让人愿意展示。
 *
 * 这是[判断标准 12](PROGRESS.md) 的又一例:覆盖(这里是「不覆盖」)范围手写在组件里,
 * 而路由长到了名单外面。所以把默认方向反过来:
 *
 *   之前:全局渲染 + 一份「哪里不要」的黑名单 → 新路由默认【带】chrome
 *   现在:只在这一层渲染 + 人面向的路由显式套进来 → 新路由默认【不带】chrome
 *
 * 好处不在这一次,在下一次:**以后往这里加页脚 / toast 容器 / cookie 提示,
 * 都不可能漏到 /share-card 上**,因为那条路由压根不在这一层里 —— 不需要谁记得。
 */
export default function PublicShell() {
  return (
    <>
      <LanguageToggle />
      <Outlet />
    </>
  );
}
