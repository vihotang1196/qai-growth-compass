import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import {
  HIGH_INTENT_VALUES,
  isHighIntent,
  isPriorityMismatch,
  priorityAlignment,
} from '../../api/_lib/surveySignals';

describe('isPriorityMismatch matches the definition the report already uses', () => {
  it('flags a priority that is not the weakest dimension', () => {
    expect(isPriorityMismatch('goal', ['traffic', 'convert'])).toBe(true);
  });

  it('does not flag a priority that IS the weakest', () => {
    expect(isPriorityMismatch('traffic', ['traffic', 'convert'])).toBe(false);
  });

  it('flags the second-weakest too — the definition is weakest[0], not "in weakest"', () => {
    /**
     * 报告页第 7 板块已经按 `!== weakest[0]` 高亮了。改成「不在最弱两维里」
     * 在业务上更纯,但会让【已经发出去的报告与后台对不上】——
     * 那是一次产品决定,不是顺手改一个比较符。
     */
    expect(isPriorityMismatch('convert', ['traffic', 'convert'])).toBe(true);
  });

  it('a missing priority is not a mismatch — he did not pick a direction', () => {
    for (const bad of [null, undefined, '', 123, {}]) {
      expect(isPriorityMismatch(bad, ['traffic', 'convert']), String(bad)).toBe(false);
    }
  });

  it('a missing weakest is not a mismatch either', () => {
    // 没算出结果的人不该出现在「方向选错了」的名单里
    expect(isPriorityMismatch('goal', null)).toBe(false);
    expect(isPriorityMismatch('goal', [])).toBe(false);
  });
});

describe('priorityAlignment splits mismatched into two kinds', () => {
  it('aligned / second_weakest / mismatched', () => {
    expect(priorityAlignment('traffic', ['traffic', 'convert'])).toBe('aligned');
    expect(priorityAlignment('convert', ['traffic', 'convert'])).toBe('second_weakest');
    expect(priorityAlignment('goal', ['traffic', 'convert'])).toBe('mismatched');
  });

  it('the boolean stays consistent with the report — second_weakest is still a mismatch', () => {
    // 三分是为了沟通分层,不是为了改判定。两者必须对得上
    const weakest = ['traffic', 'convert'];
    for (const p of ['traffic', 'convert', 'goal']) {
      const align = priorityAlignment(p, weakest);
      expect(isPriorityMismatch(p, weakest)).toBe(align !== 'aligned');
    }
  });

  it('returns null when there is nothing to compare', () => {
    expect(priorityAlignment(null, ['traffic'])).toBeNull();
    expect(priorityAlignment('goal', [])).toBeNull();
  });
});

describe('isHighIntent = the first two S7 options', () => {
  it('takes asap and later, rejects self and no', () => {
    expect(isHighIntent('asap')).toBe(true);
    expect(isHighIntent('later')).toBe(true);
    expect(isHighIntent('self')).toBe(false);
    expect(isHighIntent('no')).toBe(false);
  });

  it('an unrecognised value is not high intent — never push a "no" to sales', () => {
    for (const bad of [null, undefined, '', 'ASAP', 0, {}]) {
      expect(isHighIntent(bad), String(bad)).toBe(false);
    }
  });

  it('the two values really are the first two options in config', () => {
    /**
     * 「前两项」是产品说法;代码里是两个字面量。这条把它和 config 对上 ——
     * 以后有人调整 S7 的选项顺序,这里会红(而不是名单静静地变成另一批人)。
     */
    const s7 = config.survey_questions.find((q) => q.id === 'S7') as unknown as {
      option_to_value: string[];
    };
    expect(s7.option_to_value.slice(0, 2)).toEqual([...HIGH_INTENT_VALUES]);
  });
});
