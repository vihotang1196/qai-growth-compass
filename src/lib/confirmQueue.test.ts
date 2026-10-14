import { describe, expect, it } from 'vitest';
import { createConfirmQueue, dialogKeyIntent } from './confirmQueue';

/** 让已经 resolve 的 promise 把 then 跑完 */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 记下一个 promise 现在是否已经有结果 —— 「还在等」与「resolve 成 false」要分得开 */
function track(p: Promise<boolean>) {
  const s: { done: boolean; value?: boolean } = { done: false };
  p.then((v) => {
    s.done = true;
    s.value = v;
  });
  return s;
}

describe('createConfirmQueue', () => {
  it('shows a request, and the answer is what the person chose', async () => {
    const q = createConfirmQueue<string>();
    const yes = track(q.ask('rotate'));
    expect(q.current()?.opts).toBe('rotate');
    q.settle(q.current()!.id, true);
    await flush();
    expect(yes).toEqual({ done: true, value: true });
    expect(q.current()).toBeNull();

    const no = track(q.ask('revoke'));
    q.settle(q.current()!.id, false);
    await flush();
    expect(no).toEqual({ done: true, value: false });
  });

  it('waits until the person answers (nothing is decided for them)', async () => {
    const q = createConfirmQueue<string>();
    const s = track(q.ask('rotate'));
    await flush();
    expect(s.done).toBe(false);
    expect(q.current()?.opts).toBe('rotate');
  });

  it('answers each request once: a second settle (double click, Enter then click) is ignored', async () => {
    const q = createConfirmQueue<string>();
    const s = track(q.ask('revoke'));
    const id = q.current()!.id;
    q.settle(id, false);
    q.settle(id, true);
    await flush();
    expect(s).toEqual({ done: true, value: false });
  });

  it('a late settle for an old request never answers the next one', async () => {
    const q = createConfirmQueue<string>();
    void q.ask('first');
    const oldId = q.current()!.id;
    q.settle(oldId, false);
    const second = track(q.ask('second'));
    q.settle(oldId, true);
    await flush();
    expect(second.done).toBe(false);
    expect(q.current()?.opts).toBe('second');
  });

  it('a second request while one is open waits its turn (first in, first shown)', async () => {
    const q = createConfirmQueue<string>();
    const a = track(q.ask('a'));
    const b = track(q.ask('b'));
    expect(q.current()?.opts).toBe('a');
    q.settle(q.current()!.id, true);
    expect(q.current()?.opts).toBe('b');
    q.settle(q.current()!.id, false);
    await flush();
    expect(a.value).toBe(true);
    expect(b.value).toBe(false);
    expect(q.current()).toBeNull();
  });

  it('cancelAll (the provider unmounts) answers every waiting request with "no" — nobody hangs', async () => {
    const q = createConfirmQueue<string>();
    const a = track(q.ask('a'));
    const b = track(q.ask('b'));
    q.cancelAll();
    await flush();
    expect(a).toEqual({ done: true, value: false });
    expect(b).toEqual({ done: true, value: false });
    expect(q.current()).toBeNull();
  });

  it('tells subscribers when what is shown changes, and stops after unsubscribe', () => {
    const q = createConfirmQueue<string>();
    let calls = 0;
    const off = q.subscribe(() => calls++);
    void q.ask('a');
    expect(calls).toBe(1);
    q.settle(q.current()!.id, true);
    expect(calls).toBe(2);
    q.settle(999, true); // nothing open with that id: no change, no notification
    expect(calls).toBe(2);
    off();
    void q.ask('b');
    expect(calls).toBe(2);
  });

  it('current() is stable between changes (useSyncExternalStore needs the same object back)', () => {
    const q = createConfirmQueue<string>();
    void q.ask('a');
    expect(q.current()).toBe(q.current());
  });
});

describe('dialogKeyIntent', () => {
  const k = (over: Partial<Parameters<typeof dialogKeyIntent>[0]>) =>
    dialogKeyIntent({ key: 'Enter', repeat: false, isComposing: false, onControl: false, ...over });

  it('Enter confirms', () => {
    expect(k({})).toBe('confirm');
  });

  it('Enter on a focused button is left to the button (Cancel cancels, Confirm confirms, X closes)', () => {
    expect(k({ onControl: true })).toBe('native');
  });

  it('a held-down Enter (auto-repeat from the key that opened the dialog) does nothing', () => {
    expect(k({ repeat: true })).toBe('swallow');
    expect(k({ repeat: true, onControl: true })).toBe('swallow');
  });

  it('Enter that finishes an IME composition is not a confirm', () => {
    expect(k({ isComposing: true })).toBe('native');
  });

  it('other keys are not handled here (Esc is the dialog library: cancel)', () => {
    expect(k({ key: 'Escape' })).toBe('native');
    expect(k({ key: ' ' })).toBe('native');
    expect(k({ key: 'Tab' })).toBe('native');
  });
});
