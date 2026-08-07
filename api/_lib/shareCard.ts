/**
 * 分享卡的尺寸与元素 id —— **截图器和页面共用的唯一一份**。
 *
 * 【为什么放 api/_lib 而不是 src】真相源的方向是固定的:被两边共用的规范实现放
 * `api/_lib/`,`src/` 从这里导入,反过来不行(Vercel 只编译 /api 内的 TS)。
 * 见 PROGRESS.md「从这里开始」。
 *
 * 【为什么不能各写一份】截图器按 id 取元素,页面按同一个 id 渲。两边不一致的失败形态是
 * **截图器抛「找不到元素」**,而那句话不会告诉你是 id 拼错了还是页面没渲出来 ——
 * 排查会从「页面为什么没渲」开始,方向一开始就是错的。
 */

export interface ShareCardSize {
  /** DOM 元素 id;截图器用 `#${id}` 选 */
  id: string;
  w: number;
  h: number;
  /** Storage 对象路径的后缀,拼成 `${sessionId}${suffix}` */
  suffix: string;
}

/**
 * 方形 1080×1080:朋友圈与 WhatsApp 状态都吃这个比例。
 * 竖版 1080×1920:IG Story / 小红书。
 *
 * 两个尺寸同一次渲染产出 —— 同一次 `page.goto`,多一次 element screenshot,
 * 边际成本只有几百毫秒。**所以「要不要两个都做」不是一个成本问题。**
 */
export const SHARE_CARD_SIZES: readonly ShareCardSize[] = [
  { id: 'share-card-square', w: 1080, h: 1080, suffix: '-card.png' },
  { id: 'share-card-tall', w: 1080, h: 1920, suffix: '-card-tall.png' },
] as const;

/** 页面视口要装得下最高的那张,否则元素被裁 */
export const SHARE_CARD_VIEWPORT = {
  width: Math.max(...SHARE_CARD_SIZES.map((s) => s.w)),
  height: Math.max(...SHARE_CARD_SIZES.map((s) => s.h)),
};
