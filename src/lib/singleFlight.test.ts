import { describe, expect, it } from 'vitest';
import { createSingleFlight } from './singleFlight';

/**
 * 按钮防重复点击。
 *
 * 问卷页「提交」原来靠 React state 挡:`if (pending) return`。state 要等下一次渲染才变,
 * 同一帧里的两次点击读到的都是旧值 —— 两次都会发出 save + finalize。
 * 守卫必须在点击那一刻**同步**生效,而不是等渲染。
 */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSingleFlight — a second press while the first is still waiting does nothing', () => {
  it('a second press in the same tick does not run the action again', async () => {
    const flight = createSingleFlight();
    const gate = deferred();
    let calls = 0;
    const action = () => {
      calls += 1;
      return gate.promise;
    };

    const first = flight.run(action);
    const second = flight.run(action);

    expect(calls).toBe(1);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    gate.resolve();
    await first;
  });

  it('is busy from the moment of the press, before any re-render', async () => {
    const flight = createSingleFlight();
    const gate = deferred();
    const run = flight.run(() => gate.promise);
    expect(flight.busy).toBe(true);
    gate.resolve();
    await run;
    expect(flight.busy).toBe(false);
  });

  // 动作结束(成功或失败)之后要能再按 —— 否则一次网络失败就把按钮永久锁死
  it('can be pressed again after the action finishes, whether it succeeded or failed', async () => {
    const flight = createSingleFlight();
    const failing = deferred();
    const run1 = flight.run(() => failing.promise);
    failing.reject(new Error('network'));
    await expect(run1).rejects.toThrow('network');

    let calls = 0;
    await flight.run(async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });

  it('tells the button when it becomes busy and idle', async () => {
    const seen: boolean[] = [];
    const flight = createSingleFlight((busy) => seen.push(busy));
    const gate = deferred();
    const run = flight.run(() => gate.promise);
    flight.run(() => gate.promise); // 被忽略的那次不该再报一次 busy
    gate.resolve();
    await run;
    expect(seen).toEqual([true, false]);
  });
});
