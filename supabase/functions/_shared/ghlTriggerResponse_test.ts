import { assertEquals } from '@std/assert';
import { triggerAccepted } from './ghlTriggerResponse.ts';

/** 两条都是实测抓到的真实响应体,不是构造的 */
const REAL_TRIGGER =
  '{"status":"Success: request sent to trigger execution server","id":"jgQ3xUHIHauEHadGtRmM"}';
const STALE_TRIGGER = '{"status":"Success: test request received"}';

Deno.test('真 trigger 的响应 → accepted', () => {
  assertEquals(triggerAccepted(REAL_TRIGGER), true);
});

Deno.test('失效 trigger 的响应 → 不 accepted', () => {
  // 这一条是整个模块存在的理由:两者状态码都是 200,只有响应体不同
  assertEquals(triggerAccepted(STALE_TRIGGER), false);
});

Deno.test('判据是 id 有无,与 status 文案无关', () => {
  // GHL 改文案不该让检测失效
  assertEquals(triggerAccepted('{"status":"anything at all","id":"abc"}'), true);
  assertEquals(triggerAccepted('{"id":"abc"}'), true);
  // 反过来:文案对但没有 id,一律不算
  assertEquals(
    triggerAccepted('{"status":"Success: request sent to trigger execution server"}'),
    false,
  );
});

Deno.test('畸形与边界输入一律 false,不抛异常', () => {
  for (const body of [
    '',
    'not json',
    'null',
    '[]',
    '[{"id":"abc"}]',
    '{}',
    '{"id":""}',
    '{"id":null}',
    '{"id":123}',
    '{"id":{"nested":"abc"}}',
    '{"ID":"abc"}',
  ]) {
    assertEquals(triggerAccepted(body), false, `body: ${body}`);
  }
});
