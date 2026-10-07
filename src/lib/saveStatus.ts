/**
 * 答题点选之后的保存状态怎么呈现 —— 纯函数,页面只照着画。
 *
 * 【原来的两个洞】失败时卡片变黄、写「点一下重选即可重试」—— 可同一个选项再点一次什么都不会发生
 * (Radix 的 RadioGroup 只在「没选中的选项被点」时才回调),对同一个答案并没有重试的路;
 * 而那张卡滚出屏幕之后,页面上别处没有任何提示,要到点「提交」时才知道。
 * 现在:卡片上有「重试」(重发学员选的那一项);页面顶部那条进度栏里有总提示,点一下去第一题。
 *
 * 【状态不等动画】徽章(保存中 / 已保存)与失败提示随状态立刻出现,不进任何淡入 ——
 * 转场只作用于页面与分段,不作用于这一层。
 */
export type SaveState = 'saving' | 'saved' | 'error';

export interface SaveView {
  /** 题目右上角的徽章;null = 不显示 */
  badge: 'saving' | 'saved' | null;
  /** 卡片要显示「没存上」 */
  failed: boolean;
  /** 卡片上有「重试」 */
  retry: boolean;
}

export function saveView(state: SaveState | undefined): SaveView {
  if (state === 'saving') return { badge: 'saving', failed: false, retry: false };
  if (state === 'saved') return { badge: 'saved', failed: false, retry: false };
  if (state === 'error') return { badge: null, failed: true, retry: true };
  return { badge: null, failed: false, retry: false };
}

/** 页面顶部的总提示:有几题没存上、先去哪一题(按题目顺序)。null = 没有失败的 */
export function failedSummary(
  order: readonly string[],
  saveState: Readonly<Record<string, SaveState>>,
): { count: number; first: string } | null {
  // 按页面上的题目顺序数 —— 配置里已经没有的旧 id 不算,否则提示一个找不到的题
  const failed = order.filter((id) => saveState[id] === 'error');
  return failed.length ? { count: failed.length, first: failed[0] } : null;
}

/** 重试时重新发送哪个选项 —— 学员选的那一个。不在失败状态就没有可重试的 */
export function retryChoice(
  id: string,
  answers: Readonly<Record<string, number>>,
  saveState: Readonly<Record<string, SaveState>>,
): number | null {
  if (saveState[id] !== 'error') return null;
  const picked = answers[id];
  // 选项 0 也是答案 —— 用 typeof 判,不用真假值
  return typeof picked === 'number' ? picked : null;
}

/**
 * 同一题连着改两次,两个保存请求同时在路上 —— 回来的顺序不一定是发出的顺序。
 * 只让**最后发出的那一个**决定这一题显示什么;更早的那个晚到了就不算。
 *
 * 原来每个回来的结果都直接写状态 —— 新的失败、旧的随后成功,卡片就显示「已保存」,
 * 而库里存的是旧的那个选项(失败被盖住了)。
 */
export interface SaveTracker {
  /** 发出一次保存,拿到它的号 */
  begin(id: string): number;
  /** 这个号还是不是这一题最新的那次 */
  isLatest(id: string, ticket: number): boolean;
}

export function createSaveTracker(): SaveTracker {
  let next = 0;
  const latest = new Map<string, number>();
  return {
    begin(id) {
      next += 1;
      latest.set(id, next);
      return next;
    },
    isLatest(id, ticket) {
      return latest.get(id) === ticket;
    },
  };
}
