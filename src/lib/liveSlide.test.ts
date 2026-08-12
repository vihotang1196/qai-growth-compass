import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import { LocaleProvider } from '@/lib/i18n';
import LiveSlide, { LIVE_SLIDES, type LiveSlideKey } from '@/pages/admin/LiveSlide';
import { UI_STRINGS } from '@/config/ui-strings';

const zh = (k: keyof typeof UI_STRINGS) => UI_STRINGS[k].zh;

const AGG = {
  n: 15,
  averageTotal: 3.3,
  dimensionMeans: { goal: 4.7, traffic: 1.3, capture: 3.9, convert: 2.6, value: 4.1 },
  tierCounts: { manual: 3, spot: 3, semi_auto: 3, systemic: 3, flywheel: 3 },
  weakestCounts: { goal: 1, traffic: 9, capture: 4, convert: 8, value: 8 },
  questions: config.questions.map((q) => ({
    id: q.id,
    counts: new Array(q.option_count).fill(1),
    answered: q.option_count,
    topShare: 0.5,
    topIndex: 0,
  })),
  enoughForShares: true,
  minN: 10,
};

function render(slide: LiveSlideKey, cohortName: string | null, isTest: boolean): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(LiveSlide, { slide, aggregate: AGG, cohortName, isTest }),
    ),
  );
}

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('every slide is safe to project on its own', () => {
  it('the cohort name is on EVERY slide, not just the first', () => {
    /**
     * 任何一屏都可能是被投出去的那一屏 —— 讲的人可能直接跳到第三屏开始讲。
     * 一条提示条会被滚出视野,而投影时没人往上滚。
     */
    for (const slide of LIVE_SLIDES) {
      expect(visible(render(slide, 'KL Batch 3', false)), slide).toContain('KL Batch 3');
    }
  });

  it('the test-cohort banner is on EVERY slide too', () => {
    for (const slide of LIVE_SLIDES) {
      expect(visible(render(slide, 'SEED TEST DATA', true)), slide).toContain(zh('live.testBanner'));
    }
  });

  it('a real cohort shows no banner — reverse lock', () => {
    // 没有这条,「永远显示警告」也能让上面那条绿,而那会让警告失去意义
    for (const slide of LIVE_SLIDES) {
      expect(visible(render(slide, 'KL Batch 3', false)), slide).not.toContain(zh('live.testBanner'));
    }
  });

  it('"all cohorts" is named explicitly, never left blank', () => {
    // 空标题的投影等于「不知道这是谁的数据」
    expect(visible(render('headline', null, false))).toContain(zh('live.allCohorts'));
  });
});

describe('the projection surface can never carry open text or per-question detail', () => {
  it('no question id or option text appears on any slide', () => {
    /**
     * 每题选项分布刻意不进现场模式:15 题 × 3~4 个选项,投出来后排看不清。
     * 而它在 payload 里【是有的】(复用 cohort_dashboard),所以这条断言有意义。
     */
    for (const slide of LIVE_SLIDES) {
      const html = visible(render(slide, 'KL Batch 3', false));
      for (const q of config.questions) {
        expect(html, `${slide} / ${q.id}`).not.toContain(q.zh.q);
      }
    }
  });

  it('carries no interactive element — it is a projection, not a page', () => {
    for (const slide of LIVE_SLIDES) {
      const html = render(slide, 'KL Batch 3', false);
      for (const tag of ['<button', '<a ', '<input', '<select']) {
        expect(html, `${slide} / ${tag}`).not.toContain(tag);
      }
    }
  });
});

describe('sized for a room, not a screen', () => {
  it('uses vmin, not rem, for the big numbers', () => {
    /**
     * ⚠️ 这是**代理指标**:静态标记看不到实际渲染尺寸(判断标准 10)。
     * 它只能拦住「有人把 vmin 换回 rem/px」这一类回归,
     * 拦不住「vmin 数值太小以致后排看不清」—— 那要真投一次才知道。
     */
    const html = render('headline', 'KL Batch 3', false);
    expect(html).toContain('vmin');
    expect(html).not.toMatch(/font-size:\s*\d+(\.\d+)?rem/);
  });

  it('the headline slide shows only two numbers', () => {
    // 一屏三四个数字是这个模块的形态,不是妥协
    const html = visible(render('headline', 'KL Batch 3', false));
    expect(html).toContain('15');
    expect(html).toContain('3.3');
    // 档位/最弱那些数字不该出现在这一屏
    expect(html).not.toContain(zh('live.slide.tier'));
  });
});

describe('n=0 says so instead of drawing empty charts', () => {
  it('shows the empty message on every slide', () => {
    const empty = { ...AGG, n: 0, averageTotal: null };
    for (const slide of LIVE_SLIDES) {
      const html = renderToStaticMarkup(
        createElement(
          LocaleProvider,
          null,
          createElement(LiveSlide, { slide, aggregate: empty, cohortName: 'X', isTest: false }),
        ),
      );
      expect(visible(html), slide).toContain(zh('live.empty'));
    }
  });
});
