import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';

/**
 * 断言推到【最终产物】:渲染真实组件,读 DOM 里 <polygon> 的 points 属性。
 * 之后就只剩浏览器了。
 *
 * 【为什么必须推到这一层】前两次断言都绿着而线上错:
 *   第一次 —— 测试重写了一份轴构造的副本,守的不是渲染路径;
 *   第二次 —— 测试停在 polygonPoints(中间层),没验「组件到底把什么喂给了 <polygon>」。
 * 两次都是「断言的边界比实际执行路径短」。这一层用 renderToStaticMarkup 拿真实输出,
 * 不需要 jsdom(react-dom 已在依赖里),边界推到了 SVG 属性本身。
 */
const SCALE = config.meta.score_scale;

/** 从渲染出的 SVG 里取出所有 <polygon> 的 points */
function polygonPointsFromMarkup(html: string): string[] {
  return [...html.matchAll(/<polygon[^>]*\spoints="([^"]*)"/g)].map((m) => m[1]);
}

function render(
  mine: Record<string, number>,
  baselineMeans: Record<string, number>,
  baselineN = 2,
): string {
  const axes = buildRadarAxes(config.dimensions, mine, baselineMeans, (k) => k);
  return renderToStaticMarkup(
    createElement(RadarPentagon, {
      axes,
      scale: SCALE,
      selfLabel: 'self',
      baselineLabel: 'baseline',
      baselineN,
      noBaselineLabel: 'no baseline yet',
    }),
  );
}

describe('radar renders: with baseline === mine, the two data polygons are identical in the DOM', () => {
  const mine = { goal: 5, traffic: 2.8, capture: 3.6, convert: 5, value: 5 };

  it('the self and baseline polygons carry the same points attribute', () => {
    const html = render(mine, { ...mine });
    const polys = polygonPointsFromMarkup(html);

    /**
     * 组件里的 <polygon> 有三类:scale 个网格环 + 基准 + 本人。
     * 网格环是同心正五边形(与数据无关),数据那两个在最后。
     */
    expect(polys.length).toBe(SCALE + 2);
    const [baselinePts, selfPts] = polys.slice(-2);
    expect(baselinePts).toBe(selfPts);
  });

  it('different data still renders different polygons (the assertion can fail)', () => {
    // 反向锁:上面那条不是恒真。基准不同就必须画出不同的形状
    const html = render(mine, { goal: 1, traffic: 1, capture: 1, convert: 1, value: 1 });
    const polys = polygonPointsFromMarkup(html);
    const [baselinePts, selfPts] = polys.slice(-2);
    expect(baselinePts).not.toBe(selfPts);
  });

  it('the grid never competes with the data: no ring is drawn as dark as the data strokes', () => {
    /**
     * 【实测暴露的那个误读】最外圈原来是 opacity 0.9 / 2px 的深墨满格五边形,与基准虚线
     * (同为深墨)难以区分 —— 于是它被当成了基准线,而真正的基准恰好与本人重合、
     * 压在黄边下看不见,结论就成了「基准比我高很多」。网格是背景,不能与数据竞争。
     */
    const html = render(mine, { ...mine });
    const ringOpacities = [...html.matchAll(/stroke-opacity="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ringOpacities.length).toBeGreaterThan(0);
    for (const o of ringOpacities) expect(o).toBeLessThanOrEqual(0.35);
  });

  it('with a single sample the baseline polygon is not drawn at all', () => {
    /**
     * n=1 时基准均值【定义上】等于本人分数。画一条必然重合的线零信息,
     * 而且正是它与网格混淆才产生了那次误读。改为不画 + 图例说明原因。
     */
    const html = render(mine, { ...mine }, 1);
    const polys = polygonPointsFromMarkup(html);
    expect(polys.length).toBe(SCALE + 1); // 网格 + 本人,没有基准
    expect(html).toContain('no baseline yet');
  });
});
