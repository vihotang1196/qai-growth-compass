import { assertEquals, assertRejects } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rotateAndSend, type RotateDeps } from './rotateLink.ts';
import type { SendTarget } from './resendLink.ts';

/**
 * 后台「换链接」(2026-10-14 加写回魔法链接字段)。要钉的是**顺序与原子性**:
 *   ① 新 token、清掉停用标记、`ghl_link_synced = false` 在**同一条** update 里 ——
 *      分两条的话,中间失败会留下「token 换了、却没人知道字段要重写」的行,补写永远挑不到它
 *   ② 先写字段、再触发重发:重发之后别的工作流读到的已经是新链接
 *   ③ 写字段失败**不挡**重发:学员照样收到新链接,字段由补写兜
 *   ④ 换 token 那条 update 失败:什么都不写、什么都不发
 */

const E1 = '11111111-1111-4111-8111-111111111111';
const TARGET: SendTarget = {
  id: E1,
  ghl_contact_id: 'c1',
  access_token: 'OLDtokenOLDtokenOLDtokenOLDtokenOLDtokenOLD',
  name: null,
  phone_e164: null,
  email_lower: null,
  status: 'link_sent',
  lang: 'zh',
};
const NEW = 'NEWtokenNEWtokenNEWtokenNEWtokenNEWtokenNEW';
const URLS = { resendUrl: 'https://hooks.example/resend', appBaseUrl: 'https://compass.example' };

function world(opts: { updateError?: boolean; syncOk?: boolean } = {}) {
  const events: string[] = [];
  const updates: { patch: Record<string, unknown>; eq: unknown[][] }[] = [];
  const supa = {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const u = { patch, eq: [] as unknown[][] };
        updates.push(u);
        events.push(`update ${table}`);
        const chain = {
          eq: (...a: unknown[]) => {
            u.eq.push(a);
            return chain;
          },
          then: (res: (v: unknown) => unknown) =>
            res({ data: null, error: opts.updateError ? { message: 'boom', code: '57014' } : null }),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  const deps: RotateDeps = {
    newToken: () => NEW,
    syncLink: (_s, t, base) => {
      events.push(`syncLink ${t.entitlementId} ${t.contactId} ${t.accessToken} ${base}`);
      return Promise.resolve(opts.syncOk === false ? { attempted: true, ok: false, detail: 'TRANSIENT' } : { attempted: true, ok: true });
    },
    send: (_s, t, resendUrl, base) => {
      events.push(`send ${t.id} ${t.access_token} ${resendUrl} ${base}`);
      return Promise.resolve({ ok: true, queued: true });
    },
  };
  return { supa, deps, events, updates };
}

Deno.test('同一条 update:新 token + 清停用 + ghl_link_synced=false,按 id', async () => {
  const w = world();
  await rotateAndSend(w.supa, TARGET, URLS, w.deps);
  assertEquals(w.updates.length, 1);
  assertEquals(w.updates[0].patch, { access_token: NEW, access_revoked_at: null, ghl_link_synced: false });
  assertEquals(w.updates[0].eq, [['id', E1]]);
});

Deno.test('顺序:换 token → 用新 token 写字段 → 用新 token 触发重发', async () => {
  const w = world();
  const out = await rotateAndSend(w.supa, TARGET, URLS, w.deps);
  assertEquals(w.events, [
    'update assessment_entitlements',
    `syncLink ${E1} c1 ${NEW} ${URLS.appBaseUrl}`,
    `send ${E1} ${NEW} ${URLS.resendUrl} ${URLS.appBaseUrl}`,
  ]);
  assertEquals(out.linkField, { attempted: true, ok: true });
  assertEquals(out.outcome, { ok: true, queued: true });
});

Deno.test('写字段失败不挡重发;返回里两件事各自的结果', async () => {
  const w = world({ syncOk: false });
  const out = await rotateAndSend(w.supa, TARGET, URLS, w.deps);
  assertEquals(w.events.at(-1), `send ${E1} ${NEW} ${URLS.resendUrl} ${URLS.appBaseUrl}`);
  assertEquals(out.linkField.ok, false);
  assertEquals(out.outcome.ok, true);
});

Deno.test('换 token 那条 update 失败:抛,字段不写、消息不发', async () => {
  const w = world({ updateError: true });
  await assertRejects(() => rotateAndSend(w.supa, TARGET, URLS, w.deps));
  assertEquals(w.events, ['update assessment_entitlements']);
});
