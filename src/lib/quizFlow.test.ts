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

  // v2.0.0：20 题 / 5 维(移除了「测数据 / measure」)。分母 12 不变 —— 每维仍是 4 题 × 满分 3
  it('20 scored questions across 5 dimensions', () => {
    expect(questions).toHaveLength(20);
    expect(dimensions).toHaveLength(5);
    expect(config.meta.version).toBe('2.0.0');
  });

  it('the measure dimension is fully gone', () => {
    // 静默残留最危险:一道 dimension:"measure" 的题会被算进 raw_sum 却没有对应维度,
    // 或 offer_routing 留一个死 key。三处一起查
    expect(dimensions.map((d) => d.key)).not.toContain('measure');
    expect(questions.some((q) => q.dimension === 'measure')).toBe(false);
    expect(config.offer_routing).not.toHaveProperty('measure');
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

  /**
   * ── v2 新增的交叉引用(把 config 校验从 ad-hoc 脚本固化进 CI)──
   *
   * 这几条锁的是「两处必须一致」的地方。它们的失败形态都是静默的:改一处忘了改另一处,
   * 代码照跑,只是写回 GHL 的值不在域内、或报告尾部的 Offer 指向一个不存在的维度。
   * Stage 8 直接依赖这些对齐,所以在这里就锁住。
   */
  it('survey S1 option_to_dimension order == dimensions order', () => {
    // 不一致的话:客户点「造流量」,写回 GHL 的 priority 却是别的维度,
    // 而 assessment_mismatch 标签(priority != weakest)会因此系统性算错
    const orderKeys = [...dimensions].sort((a, b) => a.order - b.order).map((d) => d.key);
    const s1 = config.survey_questions.find((s) => s.id === 'S1')!.option_to_dimension;
    expect(s1).toEqual(orderKeys);
  });

  it('ghl_writeback tier / weakest domains align with tiers / dimensions', () => {
    const cf = config.ghl_writeback.custom_fields;
    const tierDomain = cf.find((f) => f.key === 'qai_assessment_tier')!.domain as string[];
    expect([...tierDomain].sort()).toEqual([...config.tiers.map((t) => t.key)].sort());
    const weakDomain = cf.find((f) => f.key === 'qai_assessment_weakest_1')!.domain as string[];
    expect([...weakDomain].sort()).toEqual([...dimensions.map((d) => d.key)].sort());
  });

  it('offer_routing covers all 5 dimensions and every product is defined', () => {
    const products = Object.keys(config.offer_routing.products);
    for (const d of dimensions) {
      const route = (config.offer_routing as unknown as Record<string, { product: string }>)[d.key];
      expect(route, `offer_routing.${d.key}`).toBeDefined();
      expect(products, `${d.key} product`).toContain(route.product);
    }
  });

  it('tiers cover 0.0-5.0 seamlessly at 1-decimal resolution, no overlap', () => {
    // 学员同时看得见分数和档位。区间有缝的话,某个分数会落不进任何档 → 档位空白;
    // 有重叠的话,同一分数落进两档 → 取哪个看实现顺序,不可预期。
    // 用「十分位整数」判断,避开浮点边界(2.1 存成 2.0999… 之类)
    const covered = new Set<number>();
    let overlap = false;
    for (const t of config.tiers) {
      for (let x = Math.round(t.min * 10); x <= Math.round(t.max * 10); x++) {
        if (covered.has(x)) overlap = true;
        covered.add(x);
      }
    }
    expect(overlap, 'tiers overlap').toBe(false);
    for (let x = 0; x <= 50; x++) {
      expect(covered.has(x), `score ${(x / 10).toFixed(1)} lands in no tier`).toBe(true);
    }
  });

  it('action_library: 5 actions per dimension + low/mid/high root_cause', () => {
    for (const d of dimensions) {
      const a = (config.action_library as unknown as Record<string, { actions: unknown[]; root_cause: Record<string, string> }>)[d.key];
      expect(a, `action_library.${d.key}`).toBeDefined();
      expect(a.actions, `${d.key} actions`).toHaveLength(5);
      for (const level of ['low', 'mid', 'high']) {
        expect(a.root_cause[level], `${d.key} root_cause.${level}`).toBeTruthy();
      }
    }
  });
});
