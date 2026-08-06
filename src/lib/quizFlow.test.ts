import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { isComplete, nextStep, progress } from './quizFlow';
import { PROFILE_IDS, QUESTION_IDS, STEP_CASES } from './quizFlow.cases';

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

/**
 * 配置自身的完整性(Stage 6 断言,v3 更新)。
 *
 * 【为什么这些值得测】v3 计分是「每题按 option_count 归一化 → 维度内平均」。
 * 归一化的分母是 option_count-1,它必须与实际选项数组长度一致,否则某题的分数会静默偏。
 * 而「每维恰好 3 题」是维度平均的前提。改题库的人不会同时想到这些耦合 ——
 * 这几条断言就是让那种改动当场变红。
 */
describe('assessment-config structural assumptions', () => {
  const questions = config.questions;
  const dimensions = config.dimensions;

  // v3.0.0:15 题 / 5 维 / 每维 3 题(移除了 5 道 maturity 题)
  it('15 scored questions across 5 dimensions', () => {
    expect(questions).toHaveLength(15);
    expect(dimensions).toHaveLength(5);
    // 钉主版本而不是精确版本:结构由下面那些断言各自守着,精确版本会让每次内容改动
    // (如 v3.1.0 给 action 加 related_question)都误报。主版本变了才意味着结构可能变
    expect(config.meta.version.split('.')[0]).toBe('3');
  });

  it('the measure dimension is fully gone', () => {
    // 静默残留最危险:一道 dimension:"measure" 的题会被算进分数却没有对应维度
    expect(dimensions.map((d) => d.key)).not.toContain('measure');
    expect(questions.some((q) => q.dimension === 'measure')).toBe(false);
    expect(config.offer_routing).not.toHaveProperty('measure');
  });

  it('exactly 3 questions per dimension', () => {
    const perDimension = new Map<string, number>();
    for (const q of questions) perDimension.set(q.dimension, (perDimension.get(q.dimension) ?? 0) + 1);
    for (const d of dimensions) {
      expect(perDimension.get(d.key), `dimension ${d.key}`).toBe(3);
    }
    // 反向:没有配置外的维度 —— 一道题挂到打错的维度上,正向断言拦不住
    expect([...perDimension.keys()].sort()).toEqual(dimensions.map((d) => d.key).sort());
  });

  it('questions count == sum of all dimensions submodule counts (15 total)', () => {
    const total = dimensions.reduce((n, d) => n + d.submodules_zh.length, 0);
    expect(questions).toHaveLength(total);
  });

  /**
   * v3:每维 3 道题,submodule_index 0/1/2 各一道,【没有 maturity 题】。
   * 徽章渲染要按 submodule_index 取 submodules_zh 的下标,下标越界或重复会让徽章取错或取空。
   */
  it('per dimension: submodule index 0/1/2, no maturity question', () => {
    const byKey = new Map(dimensions.map((d) => [d.key, d]));
    for (const d of dimensions) {
      const mine = questions.filter((q) => q.dimension === d.key);
      const subIdx = mine.map((q) => q.submodule_index).sort((a, b) => a - b);
      expect(subIdx, `dimension ${d.key} submodule indices`).toEqual([0, 1, 2]);
      expect(subIdx.length, `dimension ${d.key} submodule count`).toBe(byKey.get(d.key)!.submodules_zh.length);
      // v3 移除了 maturity —— 不该有 submodule_index 为 null 的题
      expect(mine.some((q) => q.submodule_index === null), `${d.key} has a null submodule`).toBe(false);
    }
  });

  it('no question carries a maturity type any more', () => {
    // v2 用 type:'maturity' + submodule_index:null 标第 4 题。v3 全删了 ——
    // 残留一道会让它没有对应子模块,徽章表少一格或错位
    expect(questions.some((q) => 'type' in q)).toBe(false);
  });

  it('submodule counts match across locales', () => {
    for (const d of dimensions) {
      expect(d.submodules_zh.length, `${d.key}`).toBe(d.submodules_en.length);
    }
  });

  /**
   * v3 计分的核心前提:每题的 option_count 必须与实际选项数组长度一致。
   * 归一化分母是 option_count-1;对不上会让分数静默偏。这是 v3 取代「固定分母 12」的那条。
   */
  it('each question option_count matches its actual option list length, in both locales', () => {
    for (const q of questions) {
      expect(q.zh.options, `${q.id} zh`).toHaveLength(q.option_count);
      expect(q.en.options, `${q.id} en`).toHaveLength(q.option_count);
    }
  });

  it('every option_count is 3 or 4 and at least 2 (denominator guard)', () => {
    for (const q of questions) {
      expect([3, 4], `${q.id}`).toContain(q.option_count);
      expect(q.option_count, `${q.id}`).toBeGreaterThanOrEqual(2);
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
