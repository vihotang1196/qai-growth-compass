import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import config from '@/config/assessment-config.json';
import { LocaleProvider } from '@/lib/i18n';
import {
  attachLiveScaleKeys,
  LIVE_SCALE,
  LIVE_SCALE_STORAGE_KEY,
  nextScale,
  readStoredScale,
  type ScaleKey,
  writeStoredScale,
} from '@/lib/liveScale';
import LiveSlide, { LIVE_SLIDES, type LiveSlideKey } from '@/pages/admin/LiveSlide';

/**
 * 现场模式的整体字号:+ / − 每次 10%,70%–150%,0 复位,比例存在浏览器里。
 *
 * 【为什么要有】会场投影的分辨率、投影距离、后排远近都是到了现场才知道的,
 * 而 LiveSlide 的字号是写死的 vmin 常量 —— 原来的办法是「现场发现太小就改常量」,
 * 那要改代码、重新部署。这一组把它变成讲课的人在键盘上就能调的东西。
 *
 * 【只影响 LiveSlide】缩放是 LiveSlide 的一个参数,不是页面级样式;键盘监听只在现场模式挂载期间存在。
 * 学员页面不引用这个模块(下面有一条按文件扫的断言)。
 */

const k = (key: string, more: Partial<ScaleKey> = {}): ScaleKey => ({ key, ...more });

describe('plus / minus / zero on the live slide', () => {
  it('plus and minus move in 10% steps; the unshifted = key counts as plus', () => {
    expect(nextScale(100, k('+'))).toBe(110);
    expect(nextScale(100, k('-'))).toBe(90);
    // 美式键盘上「+」要按 Shift;不按 Shift 的那个键是「=」—— 讲课的人不会去想 Shift
    expect(nextScale(100, k('='))).toBe(110);
  });

  it('stops at 150% going up and 70% going down — no overshoot, no wrap-around', () => {
    let s: number = LIVE_SCALE.initial;
    for (let i = 0; i < 12; i++) s = nextScale(s, k('+')) ?? s;
    expect(s).toBe(150);
    // 到顶之后再按:仍然认这个键(角标会显示 150%,讲的人知道到头了),但值不再变
    expect(nextScale(150, k('+'))).toBe(150);

    for (let i = 0; i < 20; i++) s = nextScale(s, k('-')) ?? s;
    expect(s).toBe(70);
    expect(nextScale(70, k('-'))).toBe(70);
  });

  it('0 resets to 100% from anywhere in the range', () => {
    for (const s of [70, 90, 100, 130, 150]) expect(nextScale(s, k('0')), String(s)).toBe(100);
  });

  it('leaves Cmd / Ctrl / Alt combinations to the browser — its own zoom must keep working', () => {
    expect(nextScale(100, k('+', { metaKey: true }))).toBeNull();
    expect(nextScale(100, k('-', { ctrlKey: true }))).toBeNull();
    // Cmd/Ctrl+0 是浏览器的「恢复原始大小」—— 不能被这里吃掉
    expect(nextScale(130, k('0', { metaKey: true }))).toBeNull();
    expect(nextScale(100, k('=', { altKey: true }))).toBeNull();
  });

  it('ignores keys typed into a form field (the cohort picker sits right above the slide)', () => {
    expect(nextScale(100, k('+', { target: { tagName: 'INPUT' } }))).toBeNull();
    expect(nextScale(100, k('0', { target: { tagName: 'SELECT' } }))).toBeNull();
    expect(nextScale(100, k('-', { target: { tagName: 'TEXTAREA' } }))).toBeNull();
    expect(nextScale(100, k('+', { target: { tagName: 'DIV', isContentEditable: true } }))).toBeNull();
    // 反向锁:焦点在普通元素(按钮、页面本身)上时照常生效
    expect(nextScale(100, k('+', { target: { tagName: 'BUTTON' } }))).toBe(110);
  });

  it('other keys are not ours — the arrow keys keep switching slides', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'a', '1', 'Escape', 'Enter']) {
      expect(nextScale(100, k(key)), key).toBeNull();
    }
  });
});

describe('the chosen scale survives a reload', () => {
  function memStorage() {
    const m = new Map<string, string>();
    return {
      getItem: (key: string) => m.get(key) ?? null,
      setItem: (key: string, v: string) => void m.set(key, v),
    };
  }

  it('what was written is what comes back after a reload', () => {
    const s = memStorage();
    writeStoredScale(s, 130);
    expect(s.getItem(LIVE_SCALE_STORAGE_KEY)).toBe('130');
    expect(readStoredScale(s)).toBe(130);
  });

  it('a missing, garbled or out-of-range stored value falls back to something sane', () => {
    const with_ = (v: string | null) => ({ getItem: () => v });
    expect(readStoredScale(with_(null))).toBe(100);
    expect(readStoredScale(with_('abc'))).toBe(100);
    expect(readStoredScale(with_(''))).toBe(100);
    // 越界的值钳回范围内,不当成「没存过」—— 那个人想要的是「最大」,不是「复位」
    expect(readStoredScale(with_('999'))).toBe(150);
    expect(readStoredScale(with_('10'))).toBe(70);
    // 不在 10% 格子上的值吸回最近的格子,否则之后每一步都落在格子之间
    expect(readStoredScale(with_('124'))).toBe(120);
  });

  it('a storage that throws (private window, blocked site data) never breaks live mode', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readStoredScale(throwing)).toBe(100);
    expect(() => writeStoredScale(throwing, 120)).not.toThrow();
    expect(readStoredScale(null)).toBe(100);
    expect(() => writeStoredScale(undefined, 120)).not.toThrow();
  });
});

describe('only the live slide is affected', () => {
  function keydown(key: string): Event {
    const e = new Event('keydown');
    Object.defineProperty(e, 'key', { value: key });
    return e;
  }

  it('the key listener exists only while live mode is mounted — after leaving, + does nothing', () => {
    const target = new EventTarget();
    let current = 100;
    const seen: number[] = [];
    const detach = attachLiveScaleKeys(
      target,
      () => current,
      (n) => {
        current = n;
        seen.push(n);
      },
    );

    target.dispatchEvent(keydown('+'));
    target.dispatchEvent(keydown('+'));
    expect(current).toBe(120);

    // LiveMode 卸载时会调这个(切回名单页 / 看板,或离开后台)
    detach();
    target.dispatchEvent(keydown('+'));
    target.dispatchEvent(keydown('0'));
    expect(current).toBe(120);
    expect(seen).toEqual([110, 120]);
  });

  it('no student-facing page imports the scale module — only the live-mode screen does', () => {
    /**
     * 【按文件扫,不按记忆列】「只影响 LiveSlide」要成立,前提是没有别的页面挂这组按键、读这个比例。
     * 学员页面(Landing / Quiz / Survey / Report / ShareCard)以后有人顺手引用的话,这里会红。
     */
    const SRC = join(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(SRC);
    const importers = files
      .filter((f) => /from ['"](@\/lib\/liveScale|\.\.?\/(lib\/)?liveScale)['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .sort();
    expect(importers).toEqual(['pages/admin/LiveMode.tsx', 'pages/admin/LiveSlide.tsx']);
  });
});

describe('LiveSlide scales as a whole', () => {
  const AGG = {
    n: 23,
    averageTotal: 2.4,
    dimensionMeans: { goal: 2.9, traffic: 1.6, capture: 2.2, convert: 2.7, value: 2.5 },
    tierCounts: { manual: 4, spot: 9, semi_auto: 7, systemic: 3, flywheel: 0 },
    weakestCounts: { goal: 2, traffic: 10, capture: 6, convert: 3, value: 2 },
    questions: config.questions.map((q) => ({ id: q.id, counts: new Array(q.option_count).fill(1), answered: 1, topShare: 0.5, topIndex: 0 })),
    enoughForShares: true,
    minN: 10,
  };
  const render = (slide: LiveSlideKey, scale?: number, isTest = true) =>
    renderToStaticMarkup(
      createElement(
        LocaleProvider,
        null,
        createElement(LiveSlide, { slide, aggregate: AGG, cohortName: 'KL Batch 3', isTest, ...(scale === undefined ? {} : { scale }) }),
      ),
    );
  const vmins = (html: string) => [...html.matchAll(/(\d+(?:\.\d+)?)vmin/g)].map((m) => Number(m[1]));

  it('every vmin length on every slide moves by the same factor — none left behind', () => {
    for (const slide of LIVE_SLIDES) {
      const base = vmins(render(slide, 100));
      // 无事可做的断言长得和真断言一样:先确认这一屏确实有一批长度可比
      expect(base.length, slide).toBeGreaterThanOrEqual(6);
      for (const factor of [0.7, 1.5]) {
        const got = vmins(render(slide, factor * 100));
        expect(got.length, `${slide} @${factor}`).toBe(base.length);
        got.forEach((v, i) => expect(v, `${slide} @${factor} #${i}`).toBeCloseTo(base[i] * factor, 3));
      }
    }
  });

  it('the radar grows too — its report-page width cap and fixed-size legend scale with it', () => {
    /**
     * 雷达图组件是报告页的,带着 `max-w-xl`(36rem = 576px)与 12px 的图例。
     * 只缩放 vmin 的话,在 1920×1080 上按 + 雷达纹丝不动(它早就被 576px 卡住),
     * 图例在任何比例下都是 12px。所以这两样也要跟着同一个系数走。
     */
    const at100 = render('radar', 100);
    const at150 = render('radar', 150);
    expect(at100).toContain('36rem');
    expect(at150).toContain('54rem');
    expect(at100).toContain('0.75rem');
    expect(at150).toContain('1.125rem');
  });

  it('100% is exactly what LiveSlide rendered before there was a scale', () => {
    // 默认值就是 100%:没传这个参数的地方(以及今天之前所有看过的截图)不受影响
    for (const slide of LIVE_SLIDES) expect(render(slide), slide).toBe(render(slide, 100));
  });
});
