import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import type { RetakePrefill } from '@/lib/quizApi';
import { prefillToSave, quizInitial, surveyInitial, type SurveyQuestionShape } from '@/lib/retakePrefill';

/**
 * 重填时答题页 / 问卷页的初始值(Viho 的第 3 个决定,docs/retake-design.md):
 * 背景题与问卷 = 上一次的回答,可以直接沿用或修改;15 道正式题从空白开始;
 * 预填**只是初始值** —— 提交时才算答了,所以背景题要在「提交」那一下真的存进这一份。
 *
 * 预填的形状照抄 2026-10-15 生产上 start_retake 回的 prefill(scripts/e2e/retake-step2-walkthrough.mjs 的输出)。
 */
const PROFILE_IDS = config.profile_questions.map((p) => p.id);
const SURVEY = config.survey_questions as unknown as SurveyQuestionShape[];
const PREFILL: RetakePrefill = {
  fromAttempt: 1,
  profile: { P1: 2, P2: 1, P3: 1 },
  survey: { S1: 1, S2: 2, S3: 1, S4: [0, 2], S5: 'seed-test e2e: config stamp + retake step 1', S6: 'seed-test', S7: 2 },
};

describe('quizInitial —— the quiz page of a new attempt', () => {
  it('background questions start as last time, marked as not yet answered in this attempt', () => {
    const r = quizInitial({ profile: {}, answers: {}, prefill: PREFILL }, PROFILE_IDS);
    expect(r.answers).toEqual({ P1: 2, P2: 1, P3: 1 });
    expect(r.prefilled.sort()).toEqual(['P1', 'P2', 'P3']);
  });

  it('the 15 questions never come from the prefill — not even if a question id sneaks into it', () => {
    const r = quizInitial({ profile: {}, answers: {}, prefill: { ...PREFILL, profile: { ...PREFILL.profile, G1: 3 } } }, PROFILE_IDS);
    expect(r.answers).not.toHaveProperty('G1');
    expect(r.prefilled).not.toContain('G1');
  });

  it('what this attempt already saved wins over the prefill (coming back to an unfinished retake)', () => {
    const r = quizInitial({ profile: { P1: 0 }, answers: { G1: 1 }, prefill: PREFILL }, PROFILE_IDS);
    expect(r.answers).toEqual({ P1: 0, P2: 1, P3: 1, G1: 1 });
    expect(r.prefilled.sort()).toEqual(['P2', 'P3']);
  });

  it('first attempt (no prefill) → exactly what the server has', () => {
    expect(quizInitial({ profile: { P1: 1 }, answers: { G1: 0 }, prefill: null }, PROFILE_IDS)).toEqual({ answers: { P1: 1, G1: 0 }, prefilled: [] });
    expect(quizInitial({ profile: {}, answers: {} }, PROFILE_IDS)).toEqual({ answers: {}, prefilled: [] });
  });
});

describe('prefillToSave —— what the submit button stores for the student', () => {
  it('prefilled values the student kept (never re-chosen, never saved) are saved on submit', () => {
    const answers = { P1: 2, P2: 1, P3: 1, G1: 2 };
    expect(prefillToSave(new Set(['P1', 'P2', 'P3']), answers, { G1: 'saved' })).toEqual({ P1: 2, P2: 1, P3: 1 });
  });

  it('a value already saved (or on its way) is not sent again', () => {
    const answers = { P1: 2, P2: 4, P3: 1 };
    expect(prefillToSave(new Set(['P1', 'P3']), answers, { P2: 'saved', P3: 'saving' })).toEqual({ P1: 2 });
  });

  it('nothing prefilled → nothing to save', () => {
    expect(prefillToSave(new Set(), { P1: 1 }, {})).toEqual({});
  });
});

describe('surveyInitial —— the survey page of a new attempt', () => {
  it('starts as last time (every shape: single, multi, text)', () => {
    expect(surveyInitial(PREFILL, SURVEY)).toEqual(PREFILL.survey);
  });

  it('drops anything that does not fit today\'s questions instead of guessing', () => {
    const r = surveyInitial(
      { fromAttempt: 1, profile: {}, survey: { S1: 9, S2: 'two', S4: [0, 99], S5: 5, S7: 1.5, X9: 1, S3: 3 } },
      SURVEY,
    );
    expect(r).toEqual({ S3: 3 });
  });

  it('no prefill → blank', () => {
    expect(surveyInitial(null, SURVEY)).toEqual({});
    expect(surveyInitial(undefined, SURVEY)).toEqual({});
  });
});
