import { describe, expect, it } from 'vitest';
import { isTestCohort } from '../../api/_lib/testCohort';

/**
 * 收口判断的纯部分。
 *
 * 【方向为什么是「只认 true」】这条断言比它看起来重要:反过来的话
 * (缺字段即视为测试),一次写漏 select 的查询会把**所有真实数据**都当成测试数据跳过 ——
 * 而那种「什么都不发了」的故障会安静地持续到有人投诉。
 * 所以未知一律「不是测试」= 照常发,与列的默认值同向。
 */
describe('isTestCohort only trusts an explicit true', () => {
  it('true means test', () => {
    expect(isTestCohort({ is_test: true })).toBe(true);
  });

  it('everything else means not test — the safe direction is "keep sending"', () => {
    expect(isTestCohort({ is_test: false })).toBe(false);
    expect(isTestCohort({ is_test: null })).toBe(false);
    expect(isTestCohort({})).toBe(false);
    expect(isTestCohort(null)).toBe(false);
    expect(isTestCohort(undefined)).toBe(false);
  });

  it('a missing select never turns into "skip everything"', () => {
    // 写漏 select 的形态就是这个:拿到的行里压根没有 cohort
    expect(isTestCohort((undefined as unknown) as { is_test?: boolean })).toBe(false);
  });
});
