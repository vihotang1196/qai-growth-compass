import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * 【告诉 twMerge 设计系统自己的边框宽度】tailwind.config.ts 加了 `borderWidth.brutal`(2px 墨边框),
 * 而 twMerge 默认不认识它,把 `border-brutal` 当成边框**颜色** —— 后面跟着 `border-line`(颜色)时就把前者当成被覆盖的删掉。
 * 结果:走 `cn()` 的 Button / Card / Input / Dialog / 标签……边框宽度全是 0(PROGRESS ⑦,2026-10-07 发现)。
 * 登记之后 `border-brutal` / `border-t-brutal` 等归到「边框宽度」那一组,只和别的宽度类冲突。
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { borderWidth: ['brutal'] },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
