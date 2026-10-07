import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type ChildNode, type Container, type Declaration } from 'postcss';
import { describe, expect, it } from 'vitest';
import { runPageTransition, type MotionEnv } from './motion';

/**
 * 系统开启「减少动态效果」(prefers-reduced-motion: reduce)时,关闭全部动画,只保留即时反馈。
 *
 * 两半都要钉:JS 那一半(换页时不起 View Transition),CSS 那一半(motion.css 里的每一条
 * 都只在 `prefers-reduced-motion: no-preference` 下生效)。只钉一半的话,另一半照样会动。
 */
const MOTION_CSS = readFileSync(fileURLToPath(new URL('../styles/motion.css', import.meta.url)), 'utf8');

function fakeEnv(reducedMotion: boolean) {
  const started: Array<() => void> = [];
  const env: MotionEnv = {
    reducedMotion,
    startViewTransition: (update) => {
      started.push(update);
      update();
    },
  };
  return { env, started };
}

describe('runPageTransition', () => {
  it('with reduced motion: navigates directly, never starts a view transition', () => {
    const { env, started } = fakeEnv(true);
    let navigated = 0;
    runPageTransition(() => (navigated += 1), env);
    expect(started).toHaveLength(0);
    expect(navigated).toBe(1);
  });

  it('without reduced motion and with View Transitions: the navigation runs inside one', () => {
    const { env, started } = fakeEnv(false);
    let navigated = 0;
    runPageTransition(() => (navigated += 1), env);
    expect(started).toHaveLength(1);
    expect(navigated).toBe(1);
  });

  /**
   * 浏览器跳过转场(页面在后台、或上一个还没播完)时,`ready` 会 reject —— 跳转照常完成,
   * 但没人接的话就是一条「Uncaught (in promise) InvalidStateError」。本地预览里实测出现过 4 次。
   */
  it('a skipped transition (ready rejects) is not an unhandled rejection', async () => {
    let navigated = 0;
    runPageTransition(() => (navigated += 1), {
      reducedMotion: false,
      startViewTransition: (update) => {
        update();
        return { ready: Promise.reject(new Error('Transition was aborted because of invalid state')) };
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(navigated).toBe(1);
  });

  // 不支持的浏览器直接无动画 —— 跳转照常
  it('without View Transitions: navigates directly', () => {
    let navigated = 0;
    runPageTransition(() => (navigated += 1), { reducedMotion: false });
    expect(navigated).toBe(1);
  });
});

/** 一条声明所在的 @media 链(由内到外) */
function mediaParams(node: ChildNode): string[] {
  const out: string[] = [];
  let parent: Container | undefined = node.parent as Container | undefined;
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule' && (parent as postcss.AtRule).name === 'media') {
      out.push((parent as postcss.AtRule).params);
    }
    parent = parent.parent as Container | undefined;
  }
  return out;
}

function insideKeyframes(node: ChildNode): boolean {
  let parent: Container | undefined = node.parent as Container | undefined;
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule' && /keyframes$/.test((parent as postcss.AtRule).name)) return true;
    parent = parent.parent as Container | undefined;
  }
  return false;
}

function where(decl: Declaration): string {
  const rule = decl.parent as postcss.Rule;
  return `${rule.selector ?? '?'} { ${decl.prop}: ${decl.value} }`;
}

describe('motion.css only moves when the system allows motion', () => {
  /**
   * 判据:motion.css 里每一条声明,要么在 `@keyframes` 里(那是定义,不是应用),
   * 要么在 `@media print` 里(打印 / PDF 只做「关掉」),
   * 其余**全部**在 `@media (prefers-reduced-motion: no-preference)` 里。
   * 隐藏态(opacity: 0)也算 —— 它放在外面的话,开了减少动态效果的人会看到一片空白。
   */
  it('every declaration outside @keyframes and print is under prefers-reduced-motion: no-preference', () => {
    const outside: string[] = [];
    postcss.parse(MOTION_CSS).walkDecls((decl) => {
      if (insideKeyframes(decl)) return;
      const media = mediaParams(decl);
      if (media.some((m) => /\bprint\b/.test(m))) return;
      if (media.some((m) => /prefers-reduced-motion:\s*no-preference/.test(m))) return;
      outside.push(where(decl));
    });
    expect(outside).toEqual([]);
  });

  // PDF 渲染器用打印媒体出 PDF —— 报告块一块都不能停在淡入的中途
  it('print turns the report and page entrances off', () => {
    const printSelectors: string[] = [];
    postcss.parse(MOTION_CSS).walkAtRules('media', (at) => {
      if (!/\bprint\b/.test(at.params)) return;
      at.walkRules((rule) => {
        if (rule.nodes.some((d) => d.type === 'decl' && d.prop === 'animation' && /none/.test(d.value))) {
          printSelectors.push(...rule.selectors.map((s) => s.trim()));
        }
      });
    });
    expect(printSelectors).toEqual(expect.arrayContaining(['.qai-enter', '.qai-stagger > *', '[data-reveal]']));
  });

  // 报告页:块与块间隔约 50 毫秒,总时长不超过 600 毫秒
  it('report blocks: 50 ms apart, the last one done within 600 ms', () => {
    let duration = 0;
    const delays: number[] = [];
    postcss.parse(MOTION_CSS).walkRules((rule) => {
      if (!rule.selector.startsWith('.qai-stagger >')) return;
      if (mediaParams(rule).some((m) => /\bprint\b/.test(m))) return;
      rule.walkDecls((d) => {
        if (d.prop === 'animation') duration = Number(/(\d+)ms/.exec(d.value)?.[1] ?? NaN);
        if (d.prop === 'animation-delay') delays.push(Number(/(\d+)ms/.exec(d.value)?.[1] ?? NaN));
      });
    });
    const sorted = [...delays].sort((a, b) => a - b);
    expect(sorted.length).toBeGreaterThan(0);
    sorted.forEach((d, i) => expect(d).toBe((i + 1) * 50));
    expect(Math.max(...sorted) + duration).toBeLessThanOrEqual(600);
  });
});
