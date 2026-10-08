/**
 * 现场模式(LiveSlide)的整体字号:讲课的人在键盘上按 + / − 每次 10%,70%–150%,按 0 复位;
 * 比例存在浏览器里,刷新后保持。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要有】LiveSlide 的字号是写死的 vmin 常量,而会场的投影分辨率、投影距离、
 * 后排有多远都要到了现场才知道。原来的办法是「现场发现太小就改常量」—— 那要改代码、重新部署。
 * 这里把它变成讲课的人当场就能调的东西。
 *
 * 【只影响 LiveSlide】
 *   - 比例是 LiveSlide 的一个参数(`scale`),乘在它自己的每一个长度上 —— 不是页面级样式,
 *     不碰 `html` / `body` 的字号,所以别的页面没有可能被带着变
 *   - 键盘监听由 LiveMode 在挂载时挂上、卸载时摘掉(`attachLiveScaleKeys` 返回的那个函数)
 *   - 学员页面不引用这个模块 —— `liveScale.test.ts` 按文件扫,有人引用就红
 *
 * 【整数百分比,不是小数】70、80 … 150。小数一路加 0.1 会累积出 1.2000000000000002 这种值,
 * 存进 localStorage、显示在角标上都难看,而且「到顶」的判断会差一点点。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const LIVE_SCALE = { min: 70, max: 150, step: 10, initial: 100 } as const;

/** 与界面语言那一项(`compass_lang`)分开 —— 两件事各存各的 */
export const LIVE_SCALE_STORAGE_KEY = 'compass_live_scale';

/** KeyboardEvent 里用得到的那几项;写成接口是为了在没有 DOM 的测试里也能造 */
export interface ScaleKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

/** 吸到 10% 的格子上并钳在范围内 */
function clampScale(n: number): number {
  const snapped = Math.round(n / LIVE_SCALE.step) * LIVE_SCALE.step;
  return Math.min(LIVE_SCALE.max, Math.max(LIVE_SCALE.min, snapped));
}

/**
 * 焦点在可输入的东西上时不响应 —— 批次下拉框就在投影面正上方,
 * 在里面按 0 不该把字号复位。
 */
function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  return typeof t.tagName === 'string' && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName.toUpperCase());
}

/**
 * 一次按键之后的比例;**不是我们的键就回 null**(调用方据此什么都不做)。
 *
 * - `+` 与 `=`:美式键盘上 + 要按 Shift,不按 Shift 的那个键是 =,讲课的人不会去想 Shift
 * - `-`:主键盘与小键盘的减号 `key` 都是 '-'
 * - `0`:复位到 100%
 * - **带 Cmd / Ctrl / Alt 的一律不认**:Cmd/Ctrl + / − / 0 是浏览器自己的缩放,那条路要一直能走
 * - 到顶 / 到底时仍然认这个键、返回边界值 —— 角标会显示 150% / 70%,讲的人知道到头了
 */
export function nextScale(current: number, e: ScaleKey): number | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  const cur = clampScale(current);
  if (e.key === '+' || e.key === '=') return clampScale(cur + LIVE_SCALE.step);
  if (e.key === '-') return clampScale(cur - LIVE_SCALE.step);
  if (e.key === '0') return LIVE_SCALE.initial;
  return null;
}

/**
 * 读存下来的比例。拿不到(没存过、存的是垃圾、隐私窗口里 localStorage 直接抛)一律回 100% ——
 * 现场模式不能因为一个偏好项打不开。越界的值钳回范围内,不当成「没存过」:
 * 那个人想要的是「最大」,不是「复位」。
 */
export function readStoredScale(storage: Pick<Storage, 'getItem'> | null | undefined): number {
  try {
    const raw = storage?.getItem(LIVE_SCALE_STORAGE_KEY);
    if (raw === null || raw === undefined || raw.trim() === '') return LIVE_SCALE.initial;
    const n = Number(raw);
    return Number.isFinite(n) ? clampScale(n) : LIVE_SCALE.initial;
  } catch {
    return LIVE_SCALE.initial;
  }
}

/** 写不进去(隐私窗口、存储被禁)就算了 —— 这一次会话里照样生效,只是刷新后不保持 */
export function writeStoredScale(storage: Pick<Storage, 'setItem'> | null | undefined, value: number): void {
  try {
    storage?.setItem(LIVE_SCALE_STORAGE_KEY, String(clampScale(value)));
  } catch {
    // 见上
  }
}

/**
 * 一个 vmin 长度乘上比例。保留三位小数:2.4 × 1.1 这种乘法会带出浮点尾巴,
 * 而这个字符串直接进 style —— 测试也按它比对。
 */
export function scaled(vmin: number, scale: number): string {
  return `${Math.round(vmin * scale * 10) / 1000}vmin`;
}

/**
 * 把 + / − / 0 挂到一个事件源上(LiveMode 传 `window`),返回摘掉它的函数。
 *
 * 【为什么不直接写在 LiveMode 的 useEffect 里】那样「卸载之后按 + 不再有反应」只能在浏览器里验;
 * 抽出来之后,没有 DOM 的测试里也能拿一个 EventTarget 证明它 —— 那正是「只影响 LiveSlide」的一半。
 */
export function attachLiveScaleKeys(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  current: () => number,
  onChange: (next: number) => void,
): () => void {
  const onKey = (e: Event) => {
    const next = nextScale(current(), e as unknown as ScaleKey);
    if (next !== null) onChange(next);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
