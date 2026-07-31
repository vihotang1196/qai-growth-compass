/**
 * Vitest(Node 运行时)侧的号码用例。
 *
 * 同一组用例在 Deno 侧也要跑一遍:supabase/functions/_shared/phone_test.ts。
 * 两边消费的是同一个 phone.cases.ts,断言同一份 phone.ts 的输出。
 * 只有两边都绿,才算证明了「webhook 入库」与「登录查询」行为一致。
 */
import { describe, expect, it } from 'vitest';
import {
  EMAIL_CASES,
  NORMALIZE_CASES,
  PHONE_TAIL_CASES,
  TAIL_FROM_INPUT_CASES,
} from './phone.cases';
import { normalizeEmail, normalizePhone, phoneTail, tailFromInput } from './phone';

describe('normalizePhone', () => {
  for (const c of NORMALIZE_CASES) {
    it(`${JSON.stringify(c.input)} -> ${c.expected} (${c.why})`, () => {
      expect(normalizePhone(c.input)).toBe(c.expected);
    });
  }
});

describe('phoneTail', () => {
  for (const c of PHONE_TAIL_CASES) {
    it(`${JSON.stringify(c.input)} -> ${c.expected} (${c.why})`, () => {
      expect(phoneTail(c.input)).toBe(c.expected);
    });
  }
});

describe('tailFromInput', () => {
  for (const c of TAIL_FROM_INPUT_CASES) {
    it(`${JSON.stringify(c.input)} -> ${c.expected} (${c.why})`, () => {
      expect(tailFromInput(c.input)).toBe(c.expected);
    });
  }
});

describe('normalizeEmail', () => {
  for (const c of EMAIL_CASES) {
    it(`${JSON.stringify(c.input)} -> ${c.expected} (${c.why})`, () => {
      expect(normalizeEmail(c.input)).toBe(c.expected);
    });
  }
});

describe('cross-function invariants', () => {
  it('every normalized MY/SG number yields a tail that tailFromInput reproduces', () => {
    for (const c of NORMALIZE_CASES) {
      if (!c.expected) continue;
      // 归一化后的号码再喂回 tailFromInput,必须得到与 phoneTail 相同的结果。
      // 这是登录三级回退的前提:入库时算的 tail 与查询时算的 tail 必须一致。
      expect(tailFromInput(c.expected)).toBe(phoneTail(c.expected));
    }
  });

  it('normalizePhone is idempotent', () => {
    for (const c of NORMALIZE_CASES) {
      if (!c.expected) continue;
      expect(normalizePhone(c.expected)).toBe(c.expected);
    }
  });
});
