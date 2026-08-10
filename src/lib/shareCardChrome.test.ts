import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '@/lib/i18n';
import { AppRoutes } from '@/App';

/**
 * `/share-card` 必须渲成**纯内容**:没有导航、没有语言切换、没有任何交互元素。
 *
 * 【为什么断言必须落在真实的路由树上,而不是 ShareCardView 上】
 * EN 按钮那次,**卡本身一个字都没错** —— `LanguageToggle` 渲在 `<Routes>` 之外,
 * 靠自己一份 `HIDDEN_PREFIXES` 黑名单决定哪里不显示,而 `/share-card` 不在名单里。
 * 只断言卡组件的话,那次会绿着过去。所以这里挂 MemoryRouter 走真实路由
 * (判断标准 4:断言的边界必须等于执行路径)。
 *
 * 【这条断言的价值不在这一次】是以后有人往 PublicShell 里加页脚 / toast /
 * cookie 提示时,它会先红 —— 而改全局布局的人通常不会想到分享卡。
 */

function renderAt(path: string): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(AppRoutes)),
    ),
  );
}

/** 会被截进图、又明显不属于一张卡片的东西 */
const INTERACTIVE = ['<button', '<nav', '<a ', '<input', '<select', '<textarea', '<form'];

describe('/share-card renders as pure content', () => {
  it('has no interactive element at all', () => {
    const html = renderAt('/share-card');
    for (const tag of INTERACTIVE) {
      expect(html, `${tag} must not appear on /share-card`).not.toContain(tag);
    }
  });

  it('specifically carries no language toggle', () => {
    /**
     * 单独立一条,不与上面合并 —— 上面那条是通用规则,这条是**已经发生过的事故**:
     * 右上角那个 EN 被截进了方形卡。产品事故值得有自己的名字,
     * 否则下一个人只会看到「某条通用断言红了」。
     */
    const html = renderAt('/share-card');
    expect(html).not.toContain('aria-label');
    expect(html).not.toContain('fixed right-3 top-3');
  });
});

describe('the reverse lock: chrome is still there where it belongs', () => {
  it('a customer-facing page does keep the language toggle', () => {
    /**
     * 没有这条,「把 LanguageToggle 整个删掉」也能让上面全绿 ——
     * 那就把一个真实功能删掉了,而断言还在庆祝(判断标准 1 的反向验证要求)。
     */
    const html = renderAt('/report');
    expect(html).toContain('fixed right-3 top-3');
    expect(html).toContain('<button');
  });

  it('the admin route still has no floating toggle', () => {
    // 原来靠 HIDDEN_PREFIXES 保证,现在靠「不在 PublicShell 里」保证 —— 行为不能变
    expect(renderAt('/admin')).not.toContain('fixed right-3 top-3');
  });

  it('the showcase route still has no floating toggle', () => {
    expect(renderAt('/_showcase')).not.toContain('fixed right-3 top-3');
  });
});
