import { describe, expect, it } from 'vitest';
import { createSaveTracker, failedSummary, retryChoice, saveView } from './saveStatus';

/**
 * 保存失败时显示提示并可重试。
 *
 * 原来:失败的卡片写「点一下重选即可重试」,而 Radix 的 RadioGroup 只在点**没选中**的选项时才回调 ——
 * 同一个答案再点一次什么都不发生,想重试只能先改选别的、再改回来。
 * 那张卡滚出屏幕之后,页面上别处也没有提示,要到点「提交」才知道。
 */
describe('saveView — what a question card shows for its save state', () => {
  // 保存中 / 已保存:点选之后立刻显示,不等任何动画
  it('saving and saved show their badge straight away', () => {
    expect(saveView('saving')).toEqual({ badge: 'saving', failed: false, retry: false });
    expect(saveView('saved')).toEqual({ badge: 'saved', failed: false, retry: false });
    expect(saveView(undefined)).toEqual({ badge: null, failed: false, retry: false });
  });

  it('a failed save is shown on the card and offers a retry', () => {
    expect(saveView('error')).toEqual({ badge: null, failed: true, retry: true });
  });
});

describe('retryChoice — retry re-sends the option the learner picked', () => {
  it('returns the picked option for a failed question', () => {
    expect(retryChoice('Q3', { Q3: 2 }, { Q3: 'error' })).toBe(2);
  });

  // 选项 0 也是一个答案 —— 不能被当成「没有」
  it('option 0 is a real answer', () => {
    expect(retryChoice('P1', { P1: 0 }, { P1: 'error' })).toBe(0);
  });

  it('nothing to retry when the question did not fail', () => {
    expect(retryChoice('Q3', { Q3: 2 }, { Q3: 'saved' })).toBeNull();
    expect(retryChoice('Q3', { Q3: 2 }, { Q3: 'saving' })).toBeNull();
    expect(retryChoice('Q3', {}, { Q3: 'error' })).toBeNull();
  });
});

describe('failedSummary — a failure anywhere on the page is visible at the top', () => {
  const order = ['P1', 'P2', 'Q1', 'Q2', 'Q3'];

  it('counts the failures and points at the first one in question order', () => {
    expect(failedSummary(order, { Q2: 'error', P2: 'error', Q1: 'saved' })).toEqual({ count: 2, first: 'P2' });
  });

  it('is null when nothing failed', () => {
    expect(failedSummary(order, { P1: 'saved', Q1: 'saving' })).toBeNull();
  });

  // 配置里已经没有的题(旧答案)不算 —— 否则提示一个页面上找不到的题
  it('ignores ids that are not on the page', () => {
    expect(failedSummary(order, { OLD9: 'error' })).toBeNull();
  });
});

describe('createSaveTracker — only the latest save of a question decides what the card shows', () => {
  // 改选两次:新的那次失败先回来,旧的那次成功后回来 —— 旧的不能把卡片改成「已保存」
  it('an older response arriving after a newer one is ignored', () => {
    const tracker = createSaveTracker();
    const older = tracker.begin('Q1');
    const newer = tracker.begin('Q1');
    expect(tracker.isLatest('Q1', newer)).toBe(true);
    expect(tracker.isLatest('Q1', older)).toBe(false);
  });

  it('questions do not interfere with each other', () => {
    const tracker = createSaveTracker();
    const q1 = tracker.begin('Q1');
    tracker.begin('Q2');
    expect(tracker.isLatest('Q1', q1)).toBe(true);
  });
});
