import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { mapOption, mapOptions } from './optionMap';

describe('mapOption', () => {
  const table = ['goal', 'traffic', 'capture', 'convert', 'value'] as const;

  it('maps in-range indexes', () => {
    expect(mapOption(0, table)).toBe('goal');
    expect(mapOption(4, table)).toBe('value');
  });

  it('rejects out-of-range, negative, non-integer and NaN', () => {
    // 越界返回 null 而不是 undefined —— undefined 会被 `?? fallback` 静默吞掉,
    // null 是一个明确的「这个输入不合法」信号
    expect(mapOption(5, table)).toBeNull();
    expect(mapOption(-1, table)).toBeNull();
    expect(mapOption(1.5, table)).toBeNull();
    expect(mapOption(NaN, table)).toBeNull();
  });

  it('works for numeric tables too (value_map)', () => {
    expect(mapOption(1, [10, 35, 75, 150, 300])).toBe(35);
  });
});

describe('mapOptions (multi-select)', () => {
  const tools = ['ghl', 'crm', 'wa', 'meta', 'sheet', 'ai', 'none'] as const;

  it('maps a set of indexes', () => {
    expect(mapOptions([0, 2, 5], tools)).toEqual(['ghl', 'wa', 'ai']);
  });

  it('empty selection is a valid empty array, not null', () => {
    // S4 是 required:false —— 什么都不选是合法的,不能和「有非法下标」混为一谈
    expect(mapOptions([], tools)).toEqual([]);
  });

  it('one bad index fails the whole thing, it does not skip', () => {
    // 跳过坏的那个会让客户勾了 3 项、存进去 2 项,而客户不会知道
    expect(mapOptions([0, 99, 2], tools)).toBeNull();
    expect(mapOptions([0, -1], tools)).toBeNull();
  });

  it('duplicate indexes collapse', () => {
    expect(mapOptions([1, 1, 3], tools)).toEqual(['crm', 'meta']);
  });
});


/**
 * 真实 config 的映射表长度必须与选项数一致。
 * 不一致的话某个选项会映射到 null,而那要到客户真的选中它才暴露。
 */
describe('config option maps line up with their option lists', () => {
  it('S1 option_to_dimension length == option count', () => {
    const s1 = config.survey_questions.find((s) => s.id === 'S1')!;
    expect(s1.option_to_dimension!.length).toBe(s1.zh.options!.length);
  });

  it('S7 option_to_value length == option count', () => {
    const s7 = config.survey_questions.find((s) => s.id === 'S7')!;
    expect(s7.option_to_value!.length).toBe(s7.zh.options!.length);
  });

  it('every survey value_map length == option count', () => {
    for (const s of config.survey_questions) {
      if (!('value_map' in s) || !s.value_map) continue;
      expect(s.value_map.length, `${s.id} value_map`).toBe(s.zh.options!.length);
    }
  });
});
