/**
 * webhook payload 解析的 Deno 测试。
 *
 * 跑法:cd supabase/functions && deno task test
 *
 * 这里只测纯逻辑 —— 归一化、降级、拒绝条件。数据库相关的幂等行为要靠
 * 真库验(见 PROGRESS.md Stage 3 的验收命令),不在这里假装测掉。
 */
import { assertEquals, assertObjectMatch } from '@std/assert';
import { parseWebhookPayload } from './webhookPayload.ts';

function ok(raw: unknown) {
  const r = parseWebhookPayload(raw);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r;
}

Deno.test('rejects a payload without ghl_contact_id', () => {
  for (const raw of [
    {},
    { phone: '0124361382' },
    { ghl_contact_id: '' },
    { ghl_contact_id: '   ' },
    { ghl_contact_id: 123 },
    { ghl_contact_id: null },
    // 故意不接受别名:配错字段名必须响亮失败,不能静默用错的 id
    { contact_id: 'abc' },
    { contactId: 'abc' },
  ]) {
    const r = parseWebhookPayload(raw);
    assertEquals(r.ok, false, `should reject: ${JSON.stringify(raw)}`);
  }
});

Deno.test('rejects non-object bodies', () => {
  for (const raw of [null, 'string', 42, [], undefined]) {
    assertEquals(parseWebhookPayload(raw).ok, false);
  }
});

Deno.test('400 response lists the received keys, never the values', () => {
  const r = parseWebhookPayload({ phone: '0124361382', email: 'a@b.com' });
  if (r.ok) throw new Error('expected failure');
  assertEquals(r.receivedKeys, ['email', 'phone']);
  // 值不能出现在错误信息里
  assertEquals(r.error.includes('0124361382'), false);
  assertEquals(r.error.includes('a@b.com'), false);
});

Deno.test('normalises a well-formed payload', () => {
  const r = ok({
    ghl_contact_id: 'ghl_abc123',
    phone: '012-436 1382',
    email: '  Foo@Bar.COM ',
    name: '  Tan Wei Ming  ',
    cohort_tag: '2026-08-kl',
  });
  assertObjectMatch(r.value, {
    ghl_contact_id: 'ghl_abc123',
    phone_e164: '+60124361382',
    phone_tail: '24361382',
    phone_raw: '012-436 1382',
    email_lower: 'foo@bar.com',
    name: 'Tan Wei Ming',
    cohort_tag: '2026-08-kl',
  });
  assertEquals(r.warnings, []);
});

Deno.test('degrades on an unparseable phone but keeps the record', () => {
  const r = ok({ ghl_contact_id: 'x', phone: '0l2-436 l382', email: 'a@b.com' });
  assertEquals(r.value.phone_e164, null);
  assertEquals(r.value.phone_tail, null);
  // 原值必须保留 —— Admin 标红后由人来修
  assertEquals(r.value.phone_raw, '0l2-436 l382');
  /**
   * 【钉 code,不逐字钉 context】context 的作用是「能定位 GHL 那边的字段长什么样」,
   * 所以断言它提到了长度、而且**不含号码本身**(号码是 PII,而 warnings 会显示在名单页上、
   * 也可能被导出;完整原值在 phone_raw 里本来就有)。
   */
  assertEquals(r.warnings.map((w) => w.code), ['phone_unparseable']);
  assertEquals(r.warnings[0].context?.includes('12'), true, r.warnings[0].context);
  assertEquals(r.warnings[0].context?.includes('0l2-436'), false, 'context 不该含号码原值');
});

Deno.test('full-width digits from a CJK IME still normalise', () => {
  const r = ok({ ghl_contact_id: 'x', phone: '０１２４３６１３８２' });
  assertEquals(r.value.phone_e164, '+60124361382');
  assertEquals(r.warnings, []);
});

Deno.test('warns when there is no contact channel at all', () => {
  const r = ok({ ghl_contact_id: 'x' });
  assertEquals(r.value.phone_e164, null);
  assertEquals(r.value.email_lower, null);
  assertEquals(r.warnings, [{ code: 'no_contact_channel' }]);
});

Deno.test('an unparseable phone with no email raises both warnings', () => {
  const r = ok({ ghl_contact_id: 'x', phone: '12345' });
  assertEquals(r.warnings.map((w) => w.code), ['phone_unparseable', 'no_contact_channel']);
});

Deno.test('blank and non-string optionals become null, not empty strings', () => {
  const r = ok({
    ghl_contact_id: 'x',
    phone: '   ',
    email: '',
    name: null,
    cohort_tag: 42,
    email_lower: 'ignored',
  });
  assertEquals(r.value.phone_raw, null);
  assertEquals(r.value.email_lower, null);
  assertEquals(r.value.name, null);
  assertEquals(r.value.cohort_tag, null);
});

Deno.test('extra unknown fields are ignored, not rejected', () => {
  const r = ok({
    ghl_contact_id: 'x',
    email: 'a@b.com',
    // GHL 的 webhook action 常常会多塞一堆字段,不能因此拒绝
    location_id: 'loc_1',
    workflow_id: 'wf_1',
    customData: { anything: true },
  });
  assertEquals(r.value.email_lower, 'a@b.com');
  assertEquals(r.warnings, []);
});

Deno.test('a Singapore number is not read as Malaysian', () => {
  const r = ok({ ghl_contact_id: 'x', phone: '+6591234567' });
  assertEquals(r.value.phone_e164, '+6591234567');
  assertEquals(r.value.phone_tail, '91234567');
});
