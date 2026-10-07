import { useCallback, useLayoutEffect, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { runPageTransition } from './motion';

/**
 * 换页用这个,不直接用 navigate —— 支持 View Transitions 的浏览器里旧页淡出、新页淡入上移。
 *
 * 【flushSync】浏览器在回调返回时截新页;React 的更新默认是异步的,不 flush 的话截到的还是旧页。
 * 【回到顶部】新页从顶上开始 —— 答题页在最底下点「提交」,问卷页不该从中间出现。
 */
export function useTransitionNavigate(): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  return useCallback(
    (to: To, options?: NavigateOptions) => {
      runPageTransition(() => {
        flushSync(() => navigate(to, options));
        window.scrollTo(0, 0);
      });
    },
    [navigate],
  );
}

/** 这个浏览器能不能做「进入视口才淡入」—— 不能就什么都不藏(容器上不加 .qai-reveal-on) */
export const canReveal = typeof window !== 'undefined' && 'IntersectionObserver' in window;

/**
 * 页面内分段:容器里带 `data-reveal` 的块,进入视口时加上 `data-revealed`(只加一次)。
 * 隐藏态与动画都在 motion.css,只在系统允许动态效果时生效;这里只负责「什么时候算进来了」。
 * `ready`:内容真的画出来之后才开始看(答题页要等 bootstrap)。
 */
export function useReveal(container: RefObject<HTMLElement>, ready: boolean): void {
  /**
   * 【useLayoutEffect + 先量一遍】第一屏里已经看得见的块,在第一次绘制之前就标上 —— 它们的淡入
   * 就是这一页的进场,不能等观察器的第一次回调:那一下来得晚(页面在后台、帧被节流时
   * 实测要好几百毫秒)的话,第一屏会先空着。观察器只管屏幕外的块。
   */
  useLayoutEffect(() => {
    const root = container.current;
    if (!ready || !root || !canReveal) return;
    /**
     * 露出任何一部分就算进来。【不收窄判定区(rootMargin 负值)】那样更「讲究」,
     * 但页面最底下一块矮的,滚到底也可能进不了判定区 —— 永远是透明的。宁可早播,不能不出现。
     */
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-revealed', '');
        io.unobserve(entry.target);
      }
    });
    const viewport = window.innerHeight;
    root.querySelectorAll('[data-reveal]:not([data-revealed])').forEach((el) => {
      const box = el.getBoundingClientRect();
      if (box.top < viewport && box.bottom > 0) el.setAttribute('data-revealed', '');
      else io.observe(el);
    });
    return () => io.disconnect();
  }, [container, ready]);
}
