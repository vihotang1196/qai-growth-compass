import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import { LocaleProvider } from '@/lib/i18n';
import { ShareCardView } from '@/pages/ShareCard';
import { SHARE_CARD_SIZES, SHARE_CARD_VIEWPORT } from '../../api/_lib/shareCard';

/**
 * 分享卡最重要的一条不是「长得好不好看」,是**卡上没有什么**。
 *
 * 放:总分、档位名、五边形形状、品牌。
 * 不放:各维度分数、维度名、最弱维度、任何金额、任何他自己填的内容。
 *
 * 理由是产品性的:那些是诊断,而诊断不该被公开对照。往上加任何一维的分数,
 * 这张卡就从「我测了个好玩的」变成「我把体检报告贴出来了」—— 后者没人愿意发,
 * 而愿意发正是这张卡存在的全部理由。
 *
 * 所以这一组断言是**回归防护**,不是形式:以后谁往卡上加一个字段,这里必须红。
 */

/** 每一维都取一个不会与总分/量表撞车的值,免得断言「没出现」时假绿 */
const DIMENSIONS: Record<string, number> = {
  goal: 4.7,
  traffic: 1.3,
  capture: 3.9,
  convert: 2.6,
  value: 4.1,
};
const TOTAL = 3.3;

const RESULT = {
  dimensions: DIMENSIONS,
  total: TOTAL,
  tier: 'flywheel',
  weakest: ['traffic', 'convert'] as [string, string],
  strongest: ['goal', 'value'] as [string, string],
};

/**
 * 只取【会被人看见的文字】。
 *
 * 【为什么必须剥掉标签】第一版直接在整段 HTML 上搜 "4.1",结果假红了 ——
 * 那个串出现在 SVG 多边形的坐标里(`260,44.1`)。而分享卡的成品是一张 PNG:
 * **只有渲染出来的文字才可能泄露**,属性里的数字谁也看不见。
 * 断言的边界要等于泄露的边界,不是「HTML 里有没有这几个字符」。
 */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function render(): string {
  return renderToStaticMarkup(
    createElement(LocaleProvider, null, createElement(ShareCardView, { result: RESULT })),
  );
}

describe('the share card carries the score and the shape', () => {
  it('shows the total', () => {
    expect(render()).toContain(TOTAL.toFixed(1));
  });

  it('shows the tier name, not the tier key', () => {
    const tier = config.tiers.find((t) => t.key === 'flywheel')!;
    expect(render()).toContain(tier.zh); // SSR 下 locale 落 zh
    expect(visibleText(render())).not.toContain('flywheel');
  });

  it('shows the brand', () => {
    expect(render()).toContain(config.meta.name_zh);
  });

  it('draws the radar — the shape is the whole point', () => {
    // 数据多边形必须在;网格环也在,所以至少 scale + 1 个 polygon,乘两张卡
    const polys = [...render().matchAll(/<polygon/g)].length;
    expect(polys).toBeGreaterThanOrEqual(2 * (config.meta.score_scale + 1));
  });

  it('draws no baseline — a share card is not a comparison', () => {
    expect(render()).not.toContain('stroke-dasharray');
  });
});

describe('the share card must not leak the diagnostic', () => {
  const html = visibleText(render());

  it('carries no per-dimension score', () => {
    for (const [key, score] of Object.entries(DIMENSIONS)) {
      expect(html, `${key}=${score} must not appear`).not.toContain(score.toFixed(1));
    }
  });

  it('carries no dimension name, in either language', () => {
    for (const d of config.dimensions) {
      expect(html, `${d.key} zh`).not.toContain(d.zh);
      expect(html, `${d.key} en`).not.toContain(d.en);
      expect(html, `${d.key} key`).not.toContain(d.key);
    }
  });

  it('does not single out the weakest dimensions', () => {
    // 「最弱」是整份报告里最敏感的一条,公开出去等于自曝短板
    for (const key of RESULT.weakest) expect(html).not.toContain(key);
  });

  it('carries no money at all', () => {
    /**
     * 货币符号从【码位】构造,不写成字符串字面量 —— 与 glyphCheck.test.ts 同一个做法。
     * 它们【是】被测对象(要验的正是「卡上不出现金额」),但 src/** 的规矩是字面量一律英文,
     * 而 lint 规则读的是 AST 里 Literal.value(已解码),\u 转义骗不过它。
     */
    const cp = (code: number) => String.fromCharCode(code);
    for (const token of ['RM', 'MYR', '$', cp(0xffe5), cp(0x5143)]) {
      expect(html, `money token ${token}`).not.toContain(token);
    }
  });
});

describe('the card itself is pure content — no UI controls', () => {
  /**
   * 【为什么这一组与 shareCardChrome.test.ts 是两半,不能只留一个】
   * 那一组挂 MemoryRouter 走真实路由,守的是**全局布局漏到卡上**(EN 按钮那次)。
   * 但 SSR 下 `/share-card` 的 ShareCard 渲出来是 `null`(数据是 useEffect 拉的)——
   * 所以那一组**根本没看到卡面本身**。卡面自己有没有混进交互元素,只能在这里断言。
   * 两半合起来才等于「截图里不会出现 UI 控件」。
   */
  const INTERACTIVE = ['<button', '<nav', '<a ', '<input', '<select', '<textarea', '<form'];

  it('carries no interactive element', () => {
    const html = render();
    for (const tag of INTERACTIVE) {
      expect(html, `${tag} must not appear on the card`).not.toContain(tag);
    }
  });

  it('carries no tabindex or click handler surface', () => {
    // 就算不是 button,一个可聚焦的东西也不该在一张要发朋友圈的图上
    expect(render()).not.toContain('tabindex');
  });
});

describe('the sizes are what the screenshotter expects', () => {
  it('renders one element per declared size, at that exact pixel box', () => {
    /**
     * 【为什么这条重要】截图器按 id 取元素,并且会核对 boundingBox 是否等于声明尺寸。
     * 页面这边尺寸写错的话,线上失败形态是「一张 1080×0 的图上传成功、下载下来是空的」——
     * 那种失败最难查。两边同取 SHARE_CARD_SIZES,这条守的是页面真的用了它。
     */
    const html = render();
    for (const size of SHARE_CARD_SIZES) {
      /**
       * 【必须取到那一个元素再看它的 style】第一版只是在整段 HTML 里搜
       * `width:1080px`,而两张卡宽度相同 —— 把方形卡改成 1000px 宽,那条断言照样绿。
       * 变异测出来的:断言的边界要落在【这一个元素】上,不是「页面上某处有这个串」。
       */
      const tag = html.match(new RegExp(`<div id="${size.id}"[^>]*>`));
      expect(tag, `element #${size.id} is missing`).not.toBeNull();
      const style = tag![0];
      expect(style, `#${size.id} width`).toContain(`width:${size.w}px`);
      expect(style, `#${size.id} height`).toContain(`height:${size.h}px`);
    }
  });

  it('the viewport is tall and wide enough for every card', () => {
    // 视口小于任何一张卡的话,元素会被裁 —— 而截出来的图看起来只是「构图怪」
    for (const size of SHARE_CARD_SIZES) {
      expect(SHARE_CARD_VIEWPORT.width).toBeGreaterThanOrEqual(size.w);
      expect(SHARE_CARD_VIEWPORT.height).toBeGreaterThanOrEqual(size.h);
    }
  });
});
