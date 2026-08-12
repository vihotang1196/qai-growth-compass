import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import { LocaleProvider } from '@/lib/i18n';
import QuestionSpread, { type QuestionDistribution } from '@/pages/admin/QuestionSpread';

/**
 * 这一组守的是三件**用途**上的事,不是审美:
 *   ① 选项文本必须完整 —— 截掉的恰恰是区分相邻两档的那半句
 *   ② 人数不许被拆行 —— 数字与单位分开就不是一个数了
 *   ③ 默认只展开前 5 题 —— 这块是用来扫的,不是精读的
 */
const ALL = config.questions.map((q, i) => ({
  id: q.id,
  counts: new Array(q.option_count).fill(0).map((_, k) => (k === 0 ? 6 : 0)),
  answered: 6,
  topShare: null,
  topIndex: 0,
  _i: i,
})) as unknown as QuestionDistribution[];

function render(questions: QuestionDistribution[], defaultExpanded = false): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(QuestionSpread, { questions, defaultExpanded }),
    ),
  );
}

/** 只取会被人看见的文字 —— 与分享卡那组同一个理由 */
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('option labels are never truncated', () => {
  it('renders the whole option sentence, not a clipped prefix', () => {
    /**
     * 上一版用 `w-40 truncate`,于是长选项被截断 —— 而截掉的部分正是
     * 区分相邻两档的那半句(C2 的第 3、4 档差别全在后半句)。
     * 所以这里断言【完整那一句】出现在可见文字里。
     */
    const long = config.questions
      .flatMap((q) => q.zh.options)
      .reduce((a, b) => (b.length > a.length ? b : a));
    expect(long.length).toBeGreaterThan(12); // 先确认样本本身够长,否则这条恒真
    const html = visible(render(ALL, true));
    expect(html).toContain(long);
  });

  it('carries no truncate class in the option rows', () => {
    /**
     * ⚠️ **这条才是真正拦住截断的那一条,上面那条拦不住。**
     *
     * 变异测出来的:把标签改回 `w-40 truncate` 之后,「完整那一句出现在可见文字里」
     * **照样绿** —— 因为 CSS 截断不会把文字从 DOM 里删掉,它只是不显示。
     * `renderToStaticMarkup` 看不到 CSS,所以静态断言**原理上**验不了截断
     * (判断标准 10:用 CSS 表达的意图,没有渲染断言就要假设它没生效)。
     *
     * 所以这里只能退一步断言类名 —— 那是个**代理指标**,不是被测行为本身。
     * 写明这一点,免得下一个人以为上面那条更强的断言在做这件事。
     * 真正验截断要量渲染宽度,那需要浏览器 —— 目前靠 review 与肉眼。
     */
    expect(render(ALL, true)).not.toContain('truncate');
  });
});

describe('the count never splits across lines', () => {
  it('every count cell is nowrap and fixed width', () => {
    const html = render(ALL, true);
    // 「6 人」被拆成两行就是因为那一列既没定宽也没 nowrap
    expect(html).toContain('whitespace-nowrap');
    expect(html).toContain('w-14');
  });
});

describe('it is built to be scanned, not read', () => {
  it('shows only the first 5 questions by default', () => {
    const html = render(ALL);
    const shown = config.questions.filter((q) => html.includes(`>${q.id} ·`)).length;
    expect(shown).toBe(5);
  });

  it('offers to expand the rest, naming how many', () => {
    const html = visible(render(ALL));
    expect(html).toContain(String(config.questions.length - 5));
  });

  it('expanded shows every question', () => {
    const html = render(ALL, true);
    const shown = config.questions.filter((q) => html.includes(`>${q.id} ·`)).length;
    expect(shown).toBe(config.questions.length);
  });

  it('order is preserved — the server already sorted by concentration', () => {
    // 前端重排会毁掉「最一边倒的排最前」那条设计
    const html = render(ALL, true);
    const order = config.questions
      .map((q) => ({ id: q.id, at: html.indexOf(`>${q.id} ·`) }))
      .filter((x) => x.at >= 0);
    const sorted = [...order].sort((a, b) => a.at - b.at).map((x) => x.id);
    expect(sorted).toEqual(ALL.map((q) => q.id));
  });

  it('a zero count draws no bar at all', () => {
    // 0 人时留 1px 的假条形会让空档看起来像「有一点」
    const html = render([{ id: 'G1', counts: [0, 0, 0], answered: 0, topShare: null, topIndex: 0 }]);
    expect(html).not.toContain('min-width:3px');
  });
});
