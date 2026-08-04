import { assertEquals } from '@std/assert';
import { buildResendPayload } from './resendPayload.ts';

const base = {
  ghlContactId: 'ghl_1',
  magicLink: 'https://compass.qiai.tech/?t=abc',
  lang: 'zh' as const,
};

Deno.test('齐全时六个键都在', () => {
  assertEquals(
    buildResendPayload({ ...base, name: 'Tan', phoneE164: '+60124361382', emailLower: 'a@b.com' }),
    {
      contact_id: 'ghl_1',
      magic_link: 'https://compass.qiai.tech/?t=abc',
      lang: 'zh',
      name: 'Tan',
      phone: '+60124361382',
      email: 'a@b.com',
    },
  );
});

Deno.test('phone 为 null 时【没有 phone 这个键】,而不是 phone: null', () => {
  const p = buildResendPayload({ ...base, name: 'Tan', phoneE164: null, emailLower: 'a@b.com' });
  assertEquals('phone' in p, false);
  // 这一条是整个模块存在的理由:送 null 会让 GHL 的 Create Contact upsert
  // 把 contact 的手机号刷空,而手机号正是那条 workflow 发 WhatsApp 用的通道
  assertEquals(JSON.stringify(p).includes('null'), false);
});

Deno.test('email 为 null 时没有 email 键', () => {
  const p = buildResendPayload({ ...base, name: null, phoneE164: '+60124361382', emailLower: null });
  assertEquals('email' in p, false);
  assertEquals('name' in p, false);
});

Deno.test('三个可选项全 null 时只剩必带的三个键', () => {
  assertEquals(buildResendPayload({ ...base, name: null, phoneE164: null, emailLower: null }), {
    contact_id: 'ghl_1',
    magic_link: 'https://compass.qiai.tech/?t=abc',
    lang: 'zh',
  });
});

Deno.test('空字符串等同于 null,不带那个键', () => {
  const p = buildResendPayload({ ...base, name: '', phoneE164: '', emailLower: '' });
  assertEquals(Object.keys(p).sort(), ['contact_id', 'lang', 'magic_link']);
});

Deno.test('序列化结果里绝不出现 null —— 这是发给 GHL 之前的最后一道断言', () => {
  for (const name of [null, '', 'Tan']) {
    for (const phone of [null, '', '+60124361382']) {
      for (const email of [null, '', 'a@b.com']) {
        const json = JSON.stringify(
          buildResendPayload({ ...base, name, phoneE164: phone, emailLower: email }),
        );
        assertEquals(json.includes('null'), false, json);
      }
    }
  }
});
