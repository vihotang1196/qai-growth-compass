import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { isComplete, nextStep, progress, scoreForOption } from './quizFlow';
import { PROFILE_IDS, QUESTION_IDS, SCORE_CASES, STEP_CASES } from './quizFlow.cases';

describe('nextStep', () => {
  for (const c of STEP_CASES) {
    it(c.name, () => {
      expect(nextStep(PROFILE_IDS, QUESTION_IDS, new Set(c.answered))).toEqual(c.expected);
    });
  }
});

describe('isComplete', () => {
  it('true only when everything is answered', () => {
    const all = [...PROFILE_IDS, ...QUESTION_IDS];
    expect(isComplete(PROFILE_IDS, QUESTION_IDS, new Set(all))).toBe(true);
  });

  it('count matches but a stale answer is in the mix → not complete', () => {
    // 9 条答案对上 9 道题,但其中一条是已删除题目的 —— 按数量判断会误认为答完
    const answered = new Set(['P1', 'P2', 'P3', 'G1', 'G2', 'G3', 'G4', 'M1', 'X_DELETED']);
    expect(answered.size).toBe([...PROFILE_IDS, ...QUESTION_IDS].length);
    expect(isComplete(PROFILE_IDS, QUESTION_IDS, answered)).toBe(false);
  });

  it('a gap → not complete', () => {
    const answered = new Set(['P1', 'P2', 'P3', 'G1', 'G2', 'G4', 'M1', 'M2']);
    expect(isComplete(PROFILE_IDS, QUESTION_IDS, answered)).toBe(false);
  });
});

describe('progress', () => {
  it('from zero to full', () => {
    expect(progress(PROFILE_IDS, QUESTION_IDS, new Set())).toEqual({ done: 0, total: 9, pct: 0 });
    expect(progress(PROFILE_IDS, QUESTION_IDS, new Set(['P1', 'P2', 'P3']))).toEqual({
      done: 3,
      total: 9,
      pct: 33,
    });
  });

  it('stale answers cannot push progress past 100%', () => {
    const answered = new Set([...PROFILE_IDS, ...QUESTION_IDS, 'X_DELETED', 'Y_DELETED']);
    expect(progress(PROFILE_IDS, QUESTION_IDS, answered)).toEqual({ done: 9, total: 9, pct: 100 });
  });
});

describe('scoreForOption', () => {
  for (const c of SCORE_CASES) {
    it(`${c.optionIndex} of [${c.optionValues}] → ${c.expected} (${c.why})`, () => {
      expect(scoreForOption(c.optionIndex, c.optionValues)).toBe(c.expected);
    });
  }
});

/**
 * 配置自身的完整性。
 *
 * 【为什么这些值得测】计分公式是 `(raw_sum / 12) * 100`,**分母 12 写死在配置里**,
 * 它成立的前提是「每维 4 题 × 每题满分 3」。改配置的人不会同时想到那个分母 ——
 * 加一道题、删一道题、或者某题少一个选项,都会让那一维的分数无声偏移。
 * 这几条断言就是让那种改动当场变红。
 */
describe('assessment-config structural assumptions', () => {
  const questions = config.questions;
  const dimensions = config.dimensions;
  const optionValues = config.scoring.option_values;

  it('24 scored questions across 6 dimensions', () => {
    expect(questions).toHaveLength(24);
    expect(dimensions).toHaveLength(6);
  });

  it('exactly 4 questions per dimension — otherwise the /12 denominator is wrong', () => {
    // 维度的标识字段是 key,不是 id
    const perDimension = new Map<string, number>();
    for (const q of questions) perDimension.set(q.dimension, (perDimension.get(q.dimension) ?? 0) + 1);
    for (const d of dimensions) {
      expect(perDimension.get(d.key), `dimension ${d.key}`).toBe(4);
    }
    // 反向:没有配置外的维度 —— 一道题挂到打错的维度上,正向断言拦不住
    expect([...perDimension.keys()].sort()).toEqual(dimensions.map((d) => d.key).sort());
  });

  /**
   * 每维的 4 题不是同质的,结构是【3 道子模块题 + 1 道成熟度题】:
   *   submodule_index 0 / 1 / 2  → 对应 submodules_zh 的三项,报告里出徽章
   *   submodule_index null       → type: 'maturity',不挂子模块
   *
   * Stage 8 的徽章渲染要按 submodule_index 取 submodules_zh 的下标,
   * 所以这个结构必须锁住:下标越界或重复都会让某个子模块的徽章取错或取空,
   * 而那要到 Stage 8 生成报告时才看得见。
   */
  it('per dimension: 3 submodule questions (index 0/1/2) + 1 maturity question', () => {
    const byKey = new Map(dimensions.map((d) => [d.key, d]));
    for (const d of dimensions) {
      const mine = questions.filter((q) => q.dimension === d.key);
      const subIdx = mine
        .filter((q) => q.submodule_index !== null)
        .map((q) => q.submodule_index)
        .sort();
      // 0/1/2 各恰好一道 —— 重复会让一个子模块没有对应题
      expect(subIdx, `dimension ${d.key} submodule indices`).toEqual([0, 1, 2]);
      expect(subIdx.length, `dimension ${d.key} submodule count`).toBe(byKey.get(d.key)!.submodules_zh.length);

      const maturity = mine.filter((q) => q.submodule_index === null);
      expect(maturity, `dimension ${d.key} maturity question`).toHaveLength(1);
      expect(maturity[0].type, `${maturity[0].id}`).toBe('maturity');
    }
  });

  it('having a type and having a null submodule_index select the same questions', () => {
    // 两个字段各自表达同一件事。分叉了的话,一处代码按 type 判断、
    // 另一处按 submodule_index 判断,行为就会不一致
    const withType = questions.filter((q) => q.type !== undefined).map((q) => q.id);
    const nullIndex = questions.filter((q) => q.submodule_index === null).map((q) => q.id);
    expect(withType).toEqual(nullIndex);
  });

  it('submodule counts match across locales', () => {
    for (const d of dimensions) {
      expect(d.submodules_zh.length, `${d.key}`).toBe(d.submodules_en.length);
    }
  });

  it('denominator 12 = 4 questions x max option value 3', () => {
    const maxOption = Math.max(...optionValues);
    expect(4 * maxOption).toBe(12);
  });

  it('each question has option_values-many options in both locales', () => {
    for (const q of questions) {
      expect(q.zh.options, `${q.id} zh`).toHaveLength(optionValues.length);
      expect(q.en.options, `${q.id} en`).toHaveLength(optionValues.length);
    }
  });

  it('question ids are unique', () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('profile: 3 questions, none scored, option counts match across locales', () => {
    const profile = config.profile_questions;
    expect(profile).toHaveLength(3);
    for (const p of profile) {
      expect(p.scored, `${p.id} must not be scored`).toBe(false);
      expect(p.zh.options.length, `${p.id} option counts across locales`).toBe(p.en.options.length);
    }
  });

  it('profile questions with value_map: length matches option count', () => {
    // P2 的 value_map 是用来把「20–50 条」换算成一个数值(35)做成本模型的。
    // 长度不一致的话某个选项会映射到 undefined,而那会一路流进成本估算
    for (const p of config.profile_questions) {
      if (!('value_map' in p) || !p.value_map) continue;
      expect(p.value_map.length, `${p.id} value_map`).toBe(p.zh.options.length);
    }
  });
});
