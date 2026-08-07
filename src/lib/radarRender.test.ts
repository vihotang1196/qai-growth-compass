import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import RadarPentagon, { buildLabelAnchors, buildRadarAxes } from '@/components/RadarPentagon';

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

/**
 * 维度标签在五个顶点旁。
 *
 * 【这一组刻意分成两半】判断标准 8:从被测对象自己推导出来的断言只验「代码和自己一致」。
 * 所以顶点的方位(哪个在上、哪两个在下)用【写死的值】钉住 —— 换掉 angleFor 里的起始角
 * 或者旋转方向,它必须红;而「组件真的把这些值喂给了 DOM」另用 renderToStaticMarkup 验,
 * 那是判断标准 4 要的边界。少哪一半都会漏掉一整类改动。
 */
describe('radar labels sit at the five vertices', () => {
  const mine = { goal: 5, traffic: 2.8, capture: 3.6, convert: 5, value: 5 };

  it('five vertices split into one top, two sides, two bottom — with literal anchors', () => {
    const anchors = buildLabelAnchors(5);
    expect(anchors.length).toBe(5);

    // 正上方:文字居中,两行都抬到顶点之上(dy 全为负)
    expect(anchors[0].textAnchor).toBe('middle');
    expect(anchors[0].dyLabel).toBeLessThan(0);
    expect(anchors[0].dyValue).toBeLessThan(0);

    // 右上 / 右下:向右展开
    expect(anchors[1].textAnchor).toBe('start');
    expect(anchors[2].textAnchor).toBe('start');
    // 左下 / 左上:向左展开
    expect(anchors[3].textAnchor).toBe('end');
    expect(anchors[4].textAnchor).toBe('end');

    // 下方那两个必须整体压到顶点之下 —— 这正是「不按象限处理就会压到图形上」的那两个
    for (const i of [2, 3]) {
      expect(anchors[i].dyLabel).toBeGreaterThan(0);
      expect(anchors[i].dyValue).toBeGreaterThan(anchors[i].dyLabel);
    }

    // 侧面那两个夹住顶点:一行在上一行在下
    for (const i of [1, 4]) {
      expect(anchors[i].dyLabel).toBeLessThan(0);
      expect(anchors[i].dyValue).toBeGreaterThan(0);
    }
  });

  it('the top vertex is really the topmost and the bottom pair is really the lowest', () => {
    // 写死的方位判断:y 最小的必须是 0 号,最大的必须是 2 和 3
    const anchors = buildLabelAnchors(5);
    const ys = anchors.map((a) => a.y);
    expect(ys.indexOf(Math.min(...ys))).toBe(0);
    const lowestTwo = [...anchors.keys()].sort((a, b) => ys[b] - ys[a]).slice(0, 2).sort();
    expect(lowestTwo).toEqual([2, 3]);
  });

  it('labels are mirrored left/right, so nothing drifts off one side', () => {
    const anchors = buildLabelAnchors(5);
    // 1 与 4、2 与 3 关于中轴对称;0 在中轴上
    expect(anchors[0].x).toBeCloseTo((anchors[1].x + anchors[4].x) / 2, 6);
    expect(anchors[1].x + anchors[4].x).toBeCloseTo(anchors[2].x + anchors[3].x, 6);
  });

  it('every label and score reaches the DOM as SVG <text>, not an HTML overlay', () => {
    /**
     * 【为什么这条重要】PDF 走 page.pdf();HTML 定位的元素在打印时可能与图形错位,
     * SVG 内的文本会跟着图形一起缩放。所以「是不是 <text>」是可交付性的一部分,
     * 不是实现细节。
     */
    const html = render(mine, { ...mine });
    const anchors = buildLabelAnchors(5);

    // </svg> 之后只剩图例,任何维度名都不该出现在那里
    const svg = html.slice(0, html.indexOf('</svg>'));
    const afterSvg = html.slice(html.indexOf('</svg>'));

    for (const d of config.dimensions) {
      expect(svg).toContain(`>${d.key}<`); // labelOf 用的是 key
      expect(afterSvg).not.toContain(d.key);
    }

    // 分数也搬进来了(原来在图下方那排列表里)
    for (const key of Object.keys(mine)) {
      expect(svg).toContain(`>${(mine[key as keyof typeof mine]).toFixed(1)}<`);
    }

    // 锚点坐标与 text-anchor 真的落到了属性上
    for (const a of anchors) {
      expect(svg).toContain(`text-anchor="${a.textAnchor}"`);
      expect(svg).toContain(`y="${a.y}"`);
    }
  });

  it('the old HTML label list is gone (otherwise every name renders twice)', () => {
    const html = render(mine, { ...mine });
    for (const d of config.dimensions) {
      expect(html.split(`>${d.key}<`).length - 1).toBe(1);
    }
  });

  it('no dimension colour is painted into the radar at all', () => {
    /**
     * 雷达的数据线是黄 + 墨,维度色在这张图里没有对应物。原来那排列表的小方块
     * 是唯一的用色处,列表拿掉之后一个都不该剩 —— 剩下的就是辅助元素在跟数据线抢权重。
     * (check:dim 只拦 dim-* 类名与 --dim-* 变量,拦不住 style 里的字面色值,所以在这里拦)
     */
    const html = render(mine, { ...mine });
    for (const d of config.dimensions) {
      expect(html.toLowerCase()).not.toContain(d.color.toLowerCase());
    }
  });
});
