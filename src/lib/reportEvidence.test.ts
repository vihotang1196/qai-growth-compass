import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { actionEvidence, evidencePair, type QuestionLike } from './reportEvidence';

const QUESTIONS = config.questions as unknown as QuestionLike[];
const T3 = QUESTIONS.find((q) => q.id === 'T3')!;

describe('evidencePair', () => {
  it('returns the chosen line and the top line', () => {
    const p = evidencePair(T3, 1, 'zh')!;
    expect(p.current).toBe(T3.zh.options[1]);
    expect(p.target).toBe(T3.zh.options[T3.zh.options.length - 1]);
    expect(p.atTarget).toBe(false);
  });

  it('flags atTarget when the top option is chosen', () => {
    const p = evidencePair(T3, T3.option_count - 1, 'zh')!;
    expect(p.atTarget).toBe(true);
    expect(p.current).toBe(p.target);
  });

  it('uses the en options under the en locale', () => {
    const p = evidencePair(T3, 0, 'en')!;
    expect(p.current).toBe(T3.en.options[0]);
  });

  it('returns null for a missing answer or an out-of-range index', () => {
    expect(evidencePair(T3, undefined, 'zh')).toBeNull();
    expect(evidencePair(T3, 99, 'zh')).toBeNull();
    expect(evidencePair(T3, -1, 'zh')).toBeNull();
    expect(evidencePair(undefined, 0, 'zh')).toBeNull();
  });

  it('works for a 4-option question too', () => {
    const t2 = QUESTIONS.find((q) => q.id === 'T2')!;
    expect(t2.option_count).toBe(4);
    const p = evidencePair(t2, 2, 'zh')!;
    expect(p.atTarget).toBe(false); // index 2 of 4 is not the top
    expect(p.target).toBe(t2.zh.options[3]);
  });
});

describe('actionEvidence', () => {
  const answers = { T2: 2, T1: 0 };

  it('resolves via related_question', () => {
    const p = actionEvidence('T2', QUESTIONS, answers, 'zh')!;
    expect(p.questionId).toBe('T2');
    expect(p.current).toBe(QUESTIONS.find((q) => q.id === 'T2')!.zh.options[2]);
  });

  it('returns null when related_question is null — no invented comparison', () => {
    expect(actionEvidence(null, QUESTIONS, answers, 'zh')).toBeNull();
    expect(actionEvidence(undefined, QUESTIONS, answers, 'zh')).toBeNull();
  });

  it('returns null when that question was not answered', () => {
    expect(actionEvidence('M1', QUESTIONS, answers, 'zh')).toBeNull();
  });
});

/**
 * 真实 config:每条 action 的 related_question 要么 null,要么指向存在的题。
 * 指向不存在的题会让对比行静默取不到内容(apply-config 也锁了这条,双保险)。
 */
describe('every related_question in config resolves', () => {
  it('null or a real question id', () => {
    const ids = new Set(QUESTIONS.map((q) => q.id));
    const lib = config.action_library as unknown as Record<
      string,
      { actions?: { id: string; related_question: string | null }[] }
    >;
    for (const [dim, block] of Object.entries(lib)) {
      if (dim === '_note' || !block.actions) continue;
      for (const a of block.actions) {
        if (a.related_question === null) continue;
        expect(ids.has(a.related_question), `${a.id} → ${a.related_question}`).toBe(true);
      }
    }
  });
});
