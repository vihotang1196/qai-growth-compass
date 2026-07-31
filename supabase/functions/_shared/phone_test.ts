/**
 * Deno(Edge Function 运行时)侧的号码用例。
 *
 * 跑法:cd supabase/functions && deno task test
 *
 * 【为什么要跑第二遍】「同一份源码」只保证源码一致,不保证行为一致。
 * libphonenumber 的号码元数据随版本变化,两个运行时若解析到不同版本,
 * 同一个输入可能得到不同的 E.164 —— webhook 入库用一个版本、登录查询用
 * 另一个版本,号码就对不上,而代码看起来完全一致。
 *
 * 所以这里消费的是与 Vitest 完全相同的 phone.cases.ts,断言同一份 phone.ts
 * 的输出。两边都绿才算验过。版本一致由 check:dep-sync 在构建阶段兜住。
 */
import { assertEquals } from '@std/assert';
import {
  EMAIL_CASES,
  NORMALIZE_CASES,
  PHONE_TAIL_CASES,
  TAIL_FROM_INPUT_CASES,
} from '../../../src/lib/phone.cases.ts';
import { normalizeEmail, normalizePhone, phoneTail, tailFromInput } from './phone.ts';

Deno.test('normalizePhone', () => {
  for (const c of NORMALIZE_CASES) {
    assertEquals(
      normalizePhone(c.input),
      c.expected,
      `${JSON.stringify(c.input)} (${c.why})`,
    );
  }
});

Deno.test('phoneTail', () => {
  for (const c of PHONE_TAIL_CASES) {
    assertEquals(phoneTail(c.input), c.expected, `${JSON.stringify(c.input)} (${c.why})`);
  }
});

Deno.test('tailFromInput', () => {
  for (const c of TAIL_FROM_INPUT_CASES) {
    assertEquals(tailFromInput(c.input), c.expected, `${JSON.stringify(c.input)} (${c.why})`);
  }
});

Deno.test('normalizeEmail', () => {
  for (const c of EMAIL_CASES) {
    assertEquals(normalizeEmail(c.input), c.expected, `${JSON.stringify(c.input)} (${c.why})`);
  }
});

Deno.test('cross-function invariants', () => {
  for (const c of NORMALIZE_CASES) {
    if (!c.expected) continue;
    assertEquals(tailFromInput(c.expected), phoneTail(c.expected), `tail agreement for ${c.expected}`);
    assertEquals(normalizePhone(c.expected), c.expected, `idempotent for ${c.expected}`);
  }
});
