/**
 * 按钮防重复点击 —— 一个动作还在等服务器时,再按一次什么都不做。
 *
 * 【为什么不用 React state 挡】页面原来是 `if (pending) return`。state 要等下一次渲染才变,
 * 同一帧里的两次点击读到的都是旧的 false —— 两次都放行(问卷「提交」会发两遍 save + finalize)。
 * 这里的标记是普通变量,点击那一刻同步生效;state 只用来画按钮(`onBusyChange`)。
 *
 * 动作结束(成功或失败)就放开 —— 一次网络失败不能把按钮永久锁死。
 */
export interface SingleFlight {
  /** 这一刻有没有动作在跑 —— 同步可读,不等渲染 */
  readonly busy: boolean;
  /** 开始一个动作;已经有一个在跑就忽略并回 null。动作的失败原样传出去 */
  run(action: () => Promise<unknown> | unknown): Promise<unknown> | null;
}

export function createSingleFlight(onBusyChange?: (busy: boolean) => void): SingleFlight {
  let inFlight = false;
  return {
    get busy() {
      return inFlight;
    },
    run(action) {
      if (inFlight) return null;
      inFlight = true;
      onBusyChange?.(true);
      let settled: Promise<unknown>;
      try {
        settled = Promise.resolve(action());
      } catch (err) {
        settled = Promise.reject(err);
      }
      return settled.finally(() => {
        inFlight = false;
        onBusyChange?.(false);
      });
    },
  };
}
