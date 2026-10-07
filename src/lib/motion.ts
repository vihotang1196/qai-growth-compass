/**
 * 页面切换与「减少动态效果」—— 纯逻辑;用到的环境(媒体查询、View Transitions)从参数进来,测试才能两边都喂。
 *
 * 【为什么用浏览器原生的 View Transitions,不引动画库】换页时浏览器自己截下旧页、
 * 在新页上面淡出它 —— React 卸载旧页之后不需要谁再「留着它播完」。不支持的浏览器直接无动画,
 * 跳转照常。动画本身写在 src/styles/motion.css。
 *
 * 【系统开了「减少动态效果」就不起转场】CSS 那一半也只在 `no-preference` 下生效(见 motion.css);
 * 这里再从 JS 这一半关掉 —— 否则浏览器仍会走一遍截图换页的流程(哪怕没有动画)。
 */
export interface MotionEnv {
  /** 系统开了「减少动态效果」(prefers-reduced-motion: reduce) */
  reducedMotion: boolean;
  /** 浏览器原生的 document.startViewTransition;不支持就是 undefined */
  startViewTransition?: (update: () => void) => unknown;
}

export function currentMotionEnv(): MotionEnv {
  if (typeof window === 'undefined') return { reducedMotion: true };
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  const startViewTransition =
    typeof doc.startViewTransition === 'function' ? doc.startViewTransition.bind(doc) : undefined;
  return { reducedMotion, startViewTransition };
}

/**
 * 换页:`update` 里做真正的跳转。跳转本身从不等动画 —— 浏览器截下旧页(一帧)就执行它,
 * 数据保存与请求在那之前早已发出。
 */
export function runPageTransition(update: () => void, env: MotionEnv = currentMotionEnv()): void {
  if (env.reducedMotion || !env.startViewTransition) {
    update();
    return;
  }
  const transition = env.startViewTransition(update) as { ready?: Promise<unknown> } | undefined;
  // 浏览器跳过转场(页面在后台、上一个还没播完)时 ready 会 reject —— 跳转照常完成,这里只是接住它
  transition?.ready?.catch(() => {});
}

/** 页面内滚动:减少动态效果时直接跳到位置,不平滑滚动 */
export function scrollBehavior(env: MotionEnv = currentMotionEnv()): ScrollBehavior {
  return env.reducedMotion ? 'auto' : 'smooth';
}
