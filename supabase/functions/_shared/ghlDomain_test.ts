import { assertEquals } from '@std/assert';
import { checkDomain, checkFields } from './ghlDomain.ts';

Deno.test('区间型 domain:0.0-5.0 的两端都收', () => {
  for (const v of [0, 2.8, 5]) assertEquals(checkDomain(v, '0.0-5.0'), { ok: true });
});

Deno.test('区间型 domain:越界与非数字都拒', () => {
  assertEquals(checkDomain(5.1, '0.0-5.0').ok, false);
  // 字符串 "4.0" 也拒 —— GHL 的 number 字段收字符串行为不确定
  assertEquals(checkDomain('4.0', '0.0-5.0').ok, false);
});

Deno.test('domain 本身写坏了要显式报,不能静默通过', () => {
  const v = checkDomain(3, '0.0—5.0');
  assertEquals(v.ok, false);
});

Deno.test('枚举型 domain', () => {
  assertEquals(checkDomain('systemic', ['manual', 'systemic']), { ok: true });
  assertEquals(checkDomain('nope', ['manual', 'systemic']).ok, false);
});

Deno.test('null domain 只查长度,超长不截断而是报错', () => {
  assertEquals(checkDomain('x'.repeat(200), null, 200), { ok: true });
  assertEquals(checkDomain('x'.repeat(201), null, 200).ok, false);
});

Deno.test('未声明的 key 一律拒绝', () => {
  const f = checkFields({ typo_key: 1 }, [{ key: 'real_key', domain: null }]);
  assertEquals(f.length, 1);
});
