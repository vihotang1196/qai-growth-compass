/**
 * 网站自己的确认框背后那一层 —— 不碰 React、不碰 DOM,所以能单测(src/lib/confirmQueue.test.ts)。
 * 界面在 `src/components/ConfirmProvider.tsx`,调用方只用 `useConfirm()`。
 *
 * 【为什么是一个队列,而不是一个 useState】`window.confirm` 是同步的,调用方写
 * `if (!window.confirm(…)) return;`;换成网站的对话框之后变成 `if (!(await ask(…))) return;` ——
 * 一个要等人回答的 promise。这一层负责的就是那个 promise 的几条规矩:
 *   1. **每个请求只回答一次**:连点两下「确认」、回车之后又点了一下 → 第二次不算
 *   2. **晚到的回答不会落到下一个请求上**:回答按 id 对号,不是「回答当前那个」
 *   3. **同时来两个就排队**,先来的先显示(今天不会发生 —— 对话框开着时页面点不到;但出了也不乱)
 *   4. **没有人会一直等**:提供者卸载时,所有在等的请求都回答「不」—— 取消是安全的那一边
 */

export interface ConfirmRequest<T> {
  id: number;
  opts: T;
}

export interface ConfirmQueue<T> {
  /** 排一个请求;人回答之后 resolve(确认 = true,取消 / Esc / 关掉 = false) */
  ask(opts: T): Promise<boolean>;
  /** 现在该显示的那一个;两次变化之间返回同一个对象(useSyncExternalStore 要求) */
  current(): ConfirmRequest<T> | null;
  /** 回答 id 那一个;不是当前那一个(已经回答过 / 晚到)就什么都不做 */
  settle(id: number, ok: boolean): void;
  /** 全部回答「不」—— 提供者卸载时调 */
  cancelAll(): void;
  subscribe(listener: () => void): () => void;
}

export function createConfirmQueue<T>(): ConfirmQueue<T> {
  const waiting: Array<ConfirmRequest<T> & { resolve: (ok: boolean) => void }> = [];
  const listeners = new Set<() => void>();
  let nextId = 1;
  let shown: ConfirmRequest<T> | null = null;

  function publish() {
    const head = waiting[0];
    shown = head ? { id: head.id, opts: head.opts } : null;
    for (const l of listeners) l();
  }

  return {
    ask(opts) {
      return new Promise<boolean>((resolve) => {
        waiting.push({ id: nextId++, opts, resolve });
        if (waiting.length === 1) publish();
      });
    },
    current: () => shown,
    settle(id, ok) {
      if (waiting[0]?.id !== id) return;
      waiting.shift()!.resolve(ok);
      publish();
    },
    cancelAll() {
      if (waiting.length === 0) return;
      for (const r of waiting.splice(0)) r.resolve(false);
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type DialogKeyIntent = 'confirm' | 'swallow' | 'native';

/**
 * 对话框里按下一个键,该怎么办 —— **回车确认**的那条规矩。Esc 不在这里:那是对话框库(Radix)的,= 取消。
 *
 *   - 焦点在一个按钮上 → 交给按钮(`native`):焦点在「取消」上按回车就是取消,在 X 上就是关掉。
 *     打开时焦点放在「确认」上,所以什么都不动直接回车 = 确认
 *   - 焦点不在按钮上(点了一下对话框里的文字)→ 回车也是确认(`confirm`)
 *   - **按住不放的回车**(自动重复)→ 吞掉(`swallow`):用回车按下「停用」那一下要是没松手,
 *     重复出来的回车会落到刚出现的「确认」上 —— 那等于没问。只有松开再按的那一下才算回答
 *   - 输入法正在组字时的回车 → 不是确认(今天对话框里没有输入框;以后有了也不会误触)
 */
export function dialogKeyIntent(k: { key: string; repeat: boolean; isComposing: boolean; onControl: boolean }): DialogKeyIntent {
  if (k.key !== 'Enter' || k.isComposing) return 'native';
  if (k.repeat) return 'swallow';
  return k.onControl ? 'native' : 'confirm';
}
