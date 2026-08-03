import { assertEquals } from '@std/assert';
import { postAuthTarget, targetWithLang, type AuthState } from './postAuthTarget.ts';

const base: AuthState = { entitlementFound: true, revoked: false, sessionStatus: null };

Deno.test('token 对不上任何 entitlement → /expired', () => {
  assertEquals(postAuthTarget({ ...base, entitlementFound: false }), '/expired');
});

Deno.test('作废优先于一切,即使已答完也不给报告', () => {
  for (const status of ['in_progress', 'survey', 'completed', null] as const) {
    assertEquals(
      postAuthTarget({ entitlementFound: true, revoked: true, sessionStatus: status }),
      '/expired',
      `revoked + status=${status}`,
    );
  }
});

Deno.test('四个 session 状态各自的目标', () => {
  assertEquals(postAuthTarget({ ...base, sessionStatus: null }), '/quiz');
  assertEquals(postAuthTarget({ ...base, sessionStatus: 'in_progress' }), '/quiz');
  assertEquals(postAuthTarget({ ...base, sessionStatus: 'survey' }), '/survey');
  assertEquals(postAuthTarget({ ...base, sessionStatus: 'completed' }), '/report');
});

Deno.test('survey 态绝不能被推回 /quiz —— 那会让人重答 24 题', () => {
  // 这条是三值白名单会犯的错。单独立一条用例,不跟上面合并,
  // 因为它是产品事故而不是路由细节
  assertEquals(postAuthTarget({ ...base, sessionStatus: 'survey' }), '/survey');
});

Deno.test('completed 态绝不能被推回 /quiz', () => {
  assertEquals(postAuthTarget({ ...base, sessionStatus: 'completed' }), '/report');
});

Deno.test('targetWithLang 总是显式带上 lang', () => {
  assertEquals(targetWithLang('/quiz', 'zh'), '/quiz?lang=zh');
  assertEquals(targetWithLang('/report', 'en'), '/report?lang=en');
  assertEquals(targetWithLang('/expired', 'en'), '/expired?lang=en');
  assertEquals(targetWithLang('/survey', 'en'), '/survey?lang=en');
});
