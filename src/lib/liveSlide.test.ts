import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import config from '@/config/assessment-config.json';
import { LocaleProvider } from '@/lib/i18n';
import LiveSlide, {
  HEADLINE_MAIN_VMIN,
  HEADLINE_SUB_VMIN,
  LIVE_SLIDES,
  type LiveSlideKey,
} from '@/pages/admin/LiveSlide';
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

  it('the headline slide carries nothing from the other slides', () => {
    const html = visible(render('headline', 'KL Batch 3', false));
    expect(html).not.toContain(zh('live.slide.tier'));
  });
});

describe('the headline slide has exactly ONE main number', () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * 上一版把人数与平均分同尺寸并排,于是「1」和「4.3」被读成了「14.3」。
   *
   * 【为什么断言钉的是「同尺寸的元素只有一个」,而不是文本相邻】
   * 旧标记的可见文本是「1 已完成 4.3 平均总分」—— 两串数字在**文本里根本不相邻**,
   * 所以任何「相邻子串」式的断言都抓不到那个 bug(它是**视觉**相邻)。
   * 真正变了的是「有几个元素处在主尺寸这一层级」:旧版两个,新版一个。
   * 这条是唯一会因为那次回归而变红的断言。
   *
   * ⚠️ 仍然是**代理指标**(判断标准 10):静态标记看不到实际渲染出来的样子,
   * 它拦的是「层级又被拉平」这一类回归,拦不住「30vmin 在会场后排还是太小」。
   * ─────────────────────────────────────────────────────────────────────────────
   */
  const mainSizeHits = (html: string) =>
    html.match(new RegExp(`font-size:\\s*${HEADLINE_MAIN_VMIN}vmin`, 'g')) ?? [];

  it('only one element sits at the main size — the lock for the「14.3」misread', () => {
    expect(mainSizeHits(render('headline', 'KL Batch 3', false))).toHaveLength(1);
  });

  it('the main number is the average, not the head count', () => {
    /**
     * n=1 / avg=4.3 正是读错的那一组:真实批次只有 1 人。
     * 人数当主数字的话,全场最大的那个字会是一个背景信息。
     */
    const one = { ...AGG, n: 1, averageTotal: 4.3 };
    const html = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        null,
        createElement(LiveSlide, { slide: 'headline', aggregate: one, cohortName: 'KL', isTest: false }),
      ),
    );
    expect(html).toMatch(new RegExp(`font-size:\\s*${HEADLINE_MAIN_VMIN}vmin[^>]*>\\s*4\\.3`));
    expect(mainSizeHits(html)).toHaveLength(1);
    // 反向锁:人数**没有被删掉**,只是降级了。删掉也能让上面两条绿
    expect(visible(html)).toContain(zh('live.completedCount').replace('{n}', '1'));
  });

  it('the two sizes stay far apart — a ratio, not two literals', () => {
    /**
     * 钉比值而不是具体数字:以后有人微调字号不该让这条红,
     * 但把辅助行调到接近主数字(= 层级又被拉平)必须红。
     */
    expect(HEADLINE_MAIN_VMIN / HEADLINE_SUB_VMIN).toBeGreaterThanOrEqual(3);
  });

  it('no OTHER slide puts two different-unit numbers at one size', () => {
    /**
     * 其余三屏逐个看过:档位与最弱那两屏的数字**全是同一个单位**(人数)、
     * 各自贴着自己那一行的标签、纵向排列;雷达那屏的五个数各自钉在自己的顶点旁,
     * 也是同一个单位(0–5 分)。所以并排歧义只在第一屏存在。
     *
     * 这条把「主尺寸只出现一次」推广到全部四屏 —— 它拦的是
     * 「以后有人往别的屏加第二个大数字」。
     */
    for (const slide of LIVE_SLIDES) {
      expect(mainSizeHits(render(slide, 'KL Batch 3', false)).length, slide).toBeLessThanOrEqual(1);
    }
  });
});

describe('the count column is a column — the bar cannot push it around', () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * 上一版里条形与计数是**同级**、条形宽度是整行的百分比,于是 0 的行数字紧贴标签、
   * 非 0 的行数字被推到条形末端 —— 而这两屏的用途正是「扫一眼看哪一档最多」。
   *
   * 【断言钉的是那条轨道存在,不是像素位置】
   * jsdom 不做布局(`getBoundingClientRect()` 全是 0),所以「x 是否相同」
   * 在这个测试环境里**测不了**。轨道元素的存在是那个视觉性质的**结构载体**:
   * 去掉它,百分比就又回到整行、x 就又跟着数值跑。
   *
   * ⚠️ 这仍然是代理指标(判断标准 10)。真实的 x 位置是在浏览器里量过的
   * (五行的计数左边缘逐像素相同),那次是一次性观测,不在这个套件里。
   * ─────────────────────────────────────────────────────────────────────────────
   */
  const rowsOf = (html: string) => html.split('<div class="flex items-center"').slice(1);

  it('every bar sits inside a flex-1 track, on both bar slides', () => {
    for (const slide of ['tier', 'weakest'] as const) {
      const rows = rowsOf(render(slide, 'KL Batch 3', false));
      expect(rows.length, slide).toBeGreaterThanOrEqual(5);
      for (const row of rows) {
        /**
         * 轨道必须出现在**百分比**宽度之前 —— 顺序反了就说明条形又爬到轨道外面去了。
         *
         * 【只匹配百分比,不匹配任意宽度】第一版写的是 `width:\s*\d`,
         * 它先命中了标签的 `width:22vmin`(位置 70 < 轨道 133),于是断言红在
         * 一个与被测性质无关的元素上 —— 又一次断言边界错(判断标准 4)。
         */
        const track = row.indexOf('flex-1');
        const pct = row.search(/width:[\d.]+%/);
        expect(track, `${slide} track`).toBeGreaterThanOrEqual(0);
        expect(pct, `${slide} pct`).toBeGreaterThan(track);
      }
    }
  });

  it('the count keeps a fixed width and stays last in the row', () => {
    // 反向锁:轨道在但计数不再定宽的话,列还是会跟着数字宽度跑
    for (const row of rowsOf(render('tier', 'KL Batch 3', false))) {
      expect(row).toMatch(/width:9vmin/);
      expect(row.lastIndexOf('width:9vmin')).toBeGreaterThan(row.indexOf('flex-1'));
    }
  });

  it('a zero row draws no bar at all — not a 1px stub', () => {
    /**
     * 0 人却有一条一像素的条形,会让空档看起来像「有一点」。
     * 而 0 的行现在也不再让数字贴到标签上 —— 轨道仍然占着位。
     *
     * 【必须用有 0 行的数据】第一版用了 AGG(档位计数全是 3,**一个 0 都没有**),
     * 于是这条断言在验一个不存在的行 —— 断言与它声称验的数据对不上
     * (判断标准 8 的近邻:fixture 里没有那个情形,断言就什么都没验)。
     * 真实批次恰恰全是 0 行:1 个人只落在一档里。
     */
    const one = { ...AGG, n: 1, averageTotal: 4.3, tierCounts: { manual: 0, spot: 0, semi_auto: 0, systemic: 1, flywheel: 0 } };
    const html = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        null,
        createElement(LiveSlide, { slide: 'tier', aggregate: one, cohortName: 'KL', isTest: false }),
      ),
    );
    expect(html).toContain('width:0%');
    // 反向锁:那一档【有】人的行必须画出条形来
    expect(html).toContain('width:100%');
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
