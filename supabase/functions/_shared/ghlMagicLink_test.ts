import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAGIC_LINK_FIELD, sweepMagicLinks, syncMagicLinkToGhl } from './ghlMagicLink.ts';
import { _resetFieldMapCache } from './ghlFieldMap.ts';
import { magicLink } from './token.ts';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 换链接后把新链接写进 GHL 的 `qai_assessment_magic_link`(2026-10-14)。
 * **所有出站都走 stub 掉的 `globalThis.fetch`,一个真实请求都不发。**
 *
 * 要钉的几件事:
 *   ① 请求的确切形状:`PUT /contacts/{id}`,body 只有这一个字段,没有 tags
 *   ② 成功的唯一判据:GHL 回显的这个字段 = 新链接;只在库里的 token 仍是刚写的那个时才标 true
 *   ③ 测试批次一个请求都不发(按 entitlement 判 —— 换链接时没有 session 可言)
 *   ④ 链接里就是 token:它不进库里的错误列、不进日志
 *   ⑤ 补写只挑「换过、没写成、到期、不是 CONFIG/AUTH」的,并且用库里**当前**的 token
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BASE = 'https://compass.example';
const E1 = '11111111-1111-4111-8111-111111111111';
const TOKEN_NEW = 'NEWtokenNEWtokenNEWtokenNEWtokenNEWtokenNEW';
const TOKEN_OLD = 'OLDtokenOLDtokenOLDtokenOLDtokenOLDtokenOLD';
const FIELD_ID = 'fid-magic-link';

interface Op {
  m: string;
  a: unknown[];
}
interface Query {
  table: string;
  ops: Op[];
}

const op = (q: Query, m: string) => q.ops.find((o) => o.m === m);
const isUpdate = (q: Query) => q.table === 'assessment_entitlements' && !!op(q, 'update');
const patchOf = (q: Query) => op(q, 'update')!.a[0] as Record<string, unknown>;
const eqs = (q: Query) => q.ops.filter((o) => o.m === 'eq').map((o) => o.a);

/**
 * 假 client:任意链式调用都记下来,`await` 时交给 handler 回一个结果。
 * 这样被测代码换一种链式写法(多一个 `.select()`、少一个 `.maybeSingle()`)不会让假货悄悄失配 ——
 * handler 看的是表名与记下来的调用,断言也看它们。
 */
function fakeSupa(handler: (q: Query) => { data?: unknown; error?: unknown }, log: Query[]) {
  return {
    from(table: string) {
      const q: Query = { table, ops: [] };
      log.push(q);
      const builder: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
                Promise.resolve(handler(q))
                  .then((r) => ({ data: r.data ?? null, error: r.error ?? null }))
                  .then(res, rej);
            }
            return (...a: unknown[]) => {
              q.ops.push({ m: String(prop), a });
              return builder;
            };
          },
        },
      );
      return builder;
    },
  } as unknown as SupabaseClient;
}

interface World {
  isTest?: boolean;
  /** 「标 true」那条 update 命中几行(0 = token 在写的过程中又换了) */
  markedRows?: number;
  priorAttempts?: number;
  dueRows?: unknown[];
}

function handlerFor(w: World) {
  return (q: Query) => {
    const sel = op(q, 'select')?.a[0];
    if (q.table === 'app_settings') return { data: { value: { [MAGIC_LINK_FIELD]: FIELD_ID, qai_assessment_tier: 'fid-tier' } } };
    if (q.table !== 'assessment_entitlements') return { data: null };
    if (op(q, 'update')) {
      // 只有「标 true」那条带 .select():它要知道命中了几行
      return op(q, 'select') ? { data: Array.from({ length: w.markedRows ?? 1 }, () => ({ id: E1 })) } : { data: null };
    }
    if (typeof sel === 'string' && sel.includes('cohort:assessment_cohorts(is_test)')) {
      return { data: { cohort: { is_test: w.isTest === true } } };
    }
    if (typeof sel === 'string' && sel.trim() === 'ghl_link_attempts') return { data: { ghl_link_attempts: w.priorAttempts ?? 0 } };
    return { data: w.dueRows ?? [] };
  };
}

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** stub fetch + GHL 凭证 + console(为了断言 token 不进日志) */
function stubWorld(respond: (req: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const logs: string[] = [];
  const real = { fetch: globalThis.fetch, log: console.log, error: console.error };
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const req = { method: init?.method ?? 'GET', url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null };
    sent.push(req);
    return Promise.resolve(respond(req));
  }) as typeof globalThis.fetch;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => logs.push(a.map(String).join(' '));
  Deno.env.set('GHL_PRIVATE_TOKEN', 't');
  Deno.env.set('GHL_LOCATION_ID', 'loc1');
  _resetFieldMapCache();
  return {
    sent,
    logs,
    restore() {
      globalThis.fetch = real.fetch;
      console.log = real.log;
      console.error = real.error;
      Deno.env.delete('GHL_PRIVATE_TOKEN');
      Deno.env.delete('GHL_LOCATION_ID');
    },
  };
}

/** GHL 的 contact PUT 回显整个 contact 的 customFields(值是 value,id 是字段 UUID) */
const echo = (value: string) =>
  new Response(JSON.stringify({ contact: { id: 'c1', customFields: [{ id: 'fid-other', value: 'x' }, { id: FIELD_ID, value }] } }), {
    status: 200,
  });

const TARGET = { entitlementId: E1, contactId: 'c1', accessToken: TOKEN_NEW };

/** 「token 没出现在任何地方」:库里写的每一个值、每一行日志、返回值 */
function assertNoToken(log: Query[], logs: string[], out: unknown) {
  const everything = JSON.stringify(log.filter(isUpdate).map(patchOf)) + logs.join('\n') + JSON.stringify(out);
  for (const t of [TOKEN_NEW, TOKEN_OLD]) assert(!everything.includes(t), `token leaked: ${everything.slice(0, 400)}`);
}

Deno.test('写对了:PUT /contacts/{id},body 只有这一个字段;回显是新链接才标 true,且只在库里 token 仍是它时', async () => {
  const w = stubWorld(() => echo(magicLink(BASE, TOKEN_NEW)));
  const log: Query[] = [];
  try {
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({}), log), TARGET, BASE, 'test');
    assertEquals(out, { attempted: true, ok: true });
    assertEquals(w.sent.length, 1);
    assertEquals(w.sent[0].method, 'PUT');
    assert(w.sent[0].url.endsWith('/contacts/c1'), w.sent[0].url);
    assertEquals(w.sent[0].body, { customFields: [{ key: MAGIC_LINK_FIELD, field_value: magicLink(BASE, TOKEN_NEW) }] });

    const updates = log.filter(isUpdate);
    assertEquals(updates.length, 1);
    assertEquals(patchOf(updates[0]), { ghl_link_synced: true, ghl_link_last_error: null, ghl_link_next_retry_at: null });
    // 「标 true」以「库里的 token 还是刚写的那个」为条件 —— 连点两次换链接时,旧的那次不能把新的那次标掉
    assertEquals(eqs(updates[0]), [['id', E1], ['access_token', TOKEN_NEW]]);
    assertNoToken(log, w.logs, out);
  } finally {
    w.restore();
  }
});

Deno.test('测试批次:一个请求都不发,记 CONFIG(不重试),不标 true', async () => {
  const w = stubWorld(() => echo('unused'));
  const log: Query[] = [];
  try {
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({ isTest: true }), log), TARGET, BASE, 'test');
    assertEquals(w.sent.length, 0);
    assertEquals(out.ok, false);
    assertEquals(out.attempted, false);
    const p = patchOf(log.filter(isUpdate).at(-1)!);
    assertEquals(p.ghl_link_synced, false);
    assertStringIncludes(String(p.ghl_link_last_error), 'CONFIG: test cohort');
    assertEquals(p.ghl_link_next_retry_at, null);
  } finally {
    w.restore();
  }
});

Deno.test('200 但回显里没有这个字段(被 GHL 静默丢弃):CONFIG,不标 true', async () => {
  const w = stubWorld(() => new Response(JSON.stringify({ contact: { customFields: [{ id: 'fid-other', value: 'x' }] } }), { status: 200 }));
  const log: Query[] = [];
  try {
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({}), log), TARGET, BASE, 'test');
    assertEquals(out.ok, false);
    const patches = log.filter(isUpdate).map(patchOf);
    assert(!patches.some((p) => p.ghl_link_synced === true));
    assertStringIncludes(String(patches.at(-1)!.ghl_link_last_error), `CONFIG: `);
    assertStringIncludes(String(patches.at(-1)!.ghl_link_last_error), MAGIC_LINK_FIELD);
    assertEquals(patches.at(-1)!.ghl_link_next_retry_at, null);
  } finally {
    w.restore();
  }
});

Deno.test('回显的还是旧链接:CONFIG;错误列与日志里不出现新旧任何一个 token', async () => {
  const w = stubWorld(() => echo(magicLink(BASE, TOKEN_OLD)));
  const log: Query[] = [];
  try {
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({}), log), TARGET, BASE, 'test');
    assertEquals(out.ok, false);
    const last = patchOf(log.filter(isUpdate).at(-1)!);
    assertStringIncludes(String(last.ghl_link_last_error), 'CONFIG: ');
    assertStringIncludes(String(last.ghl_link_last_error), 'value mismatch');
    assertNoToken(log, w.logs, out);
  } finally {
    w.restore();
  }
});

Deno.test('5xx(响应体里带着 token):TRANSIENT,指数退避,次数 +1;token 被替换掉', async () => {
  const w = stubWorld(() => new Response(`upstream error near ${magicLink(BASE, TOKEN_NEW)}`, { status: 503 }));
  const log: Query[] = [];
  try {
    const before = Date.now();
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({ priorAttempts: 2 }), log), TARGET, BASE, 'test');
    assertEquals(out.ok, false);
    const last = patchOf(log.filter(isUpdate).at(-1)!);
    assertEquals(last.ghl_link_synced, false);
    assertEquals(last.ghl_link_attempts, 3);
    assertStringIncludes(String(last.ghl_link_last_error), 'TRANSIENT: HTTP 503');
    // 第 3 次失败 → 2^3 = 8 分钟后
    const due = Date.parse(String(last.ghl_link_next_retry_at)) - before;
    assert(due >= 8 * 60_000 - 1000 && due <= 8 * 60_000 + 5000, `next retry in ${due} ms`);
    assertNoToken(log, w.logs, out);
  } finally {
    w.restore();
  }
});

Deno.test('401:AUTH,不排重试', async () => {
  const w = stubWorld(() => new Response('{"message":"Unauthorized"}', { status: 401 }));
  const log: Query[] = [];
  try {
    await syncMagicLinkToGhl(fakeSupa(handlerFor({}), log), TARGET, BASE, 'test');
    const last = patchOf(log.filter(isUpdate).at(-1)!);
    assertStringIncludes(String(last.ghl_link_last_error), 'AUTH: HTTP 401');
    assertEquals(last.ghl_link_next_retry_at, null);
  } finally {
    w.restore();
  }
});

Deno.test('网络层抛错:TRANSIENT,排重试', async () => {
  const w = stubWorld(() => Promise.reject(new TypeError('fetch failed')));
  const log: Query[] = [];
  try {
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({}), log), TARGET, BASE, 'test');
    assertEquals(out.ok, false);
    const last = patchOf(log.filter(isUpdate).at(-1)!);
    assertStringIncludes(String(last.ghl_link_last_error), 'TRANSIENT: ');
    assert(last.ghl_link_next_retry_at !== null);
  } finally {
    w.restore();
  }
});

Deno.test('写的过程中 token 又换了(连点两次换链接):不报成功,置回 false 并立刻到期,由补写用当前 token 再写', async () => {
  const w = stubWorld(() => echo(magicLink(BASE, TOKEN_NEW)));
  const log: Query[] = [];
  try {
    const before = Date.now();
    const out = await syncMagicLinkToGhl(fakeSupa(handlerFor({ markedRows: 0 }), log), TARGET, BASE, 'test');
    assertEquals(out.ok, false);
    assertStringIncludes(String(out.detail), 'superseded');
    const last = patchOf(log.filter(isUpdate).at(-1)!);
    assertEquals(last.ghl_link_synced, false);
    assert(Date.parse(String(last.ghl_link_next_retry_at)) <= before + 1000);
    assertStringIncludes(String(last.ghl_link_last_error), 'TRANSIENT: ');
  } finally {
    w.restore();
  }
});

Deno.test('补写:只挑「没写成 + 到期 + 不是 CONFIG/AUTH」的,每一行用它自己库里当前的 token 拼链接', async () => {
  const TOKEN_C = 'CCCtokenCCCtokenCCCtokenCCCtokenCCCtokenCCC';
  const rows = [
    { id: 'a', ghl_contact_id: 'ca', access_token: TOKEN_NEW, ghl_link_last_error: null },
    { id: 'b', ghl_contact_id: 'cb', access_token: TOKEN_OLD, ghl_link_last_error: 'CONFIG: test cohort — skipped' },
    { id: 'c', ghl_contact_id: 'cc', access_token: TOKEN_C, ghl_link_last_error: 'TRANSIENT: HTTP 503' },
    { id: 'd', ghl_contact_id: 'cd', access_token: TOKEN_OLD, ghl_link_last_error: 'AUTH: HTTP 401' },
  ];
  const links = new Map([['ca', magicLink(BASE, TOKEN_NEW)], ['cc', magicLink(BASE, TOKEN_C)]]);
  const w = stubWorld((req) => echo(links.get(req.url.split('/').at(-1)!) ?? 'unknown'));
  const log: Query[] = [];
  try {
    const now = new Date().toISOString();
    const out = await sweepMagicLinks(fakeSupa(handlerFor({ dueRows: rows }), log), BASE, now, 50);

    // 选行的条件
    const pick = log.find((q) => q.table === 'assessment_entitlements' && op(q, 'select')?.a[0] !== undefined && !op(q, 'update') && eqs(q).some(([k]) => k === 'ghl_link_synced'))!;
    assertEquals(eqs(pick).find(([k]) => k === 'ghl_link_synced'), ['ghl_link_synced', false]);
    assertEquals(op(pick, 'or')!.a[0], `ghl_link_next_retry_at.is.null,ghl_link_next_retry_at.lte.${now}`);

    assertEquals(w.sent.map((s) => s.url.split('/').at(-1)), ['ca', 'cc']);
    assertEquals(w.sent.map((s) => (s.body as { customFields: { field_value: string }[] }).customFields[0].field_value), [
      magicLink(BASE, TOKEN_NEW),
      magicLink(BASE, TOKEN_C),
    ]);
    assertEquals(out.candidates, { raw: 4, due: 2 });
    assertEquals(out.tried, 2);
    assertEquals(out.synced, 2);
    assertEquals(out.capped, false);
    const everything = JSON.stringify(out) + w.logs.join('\n');
    for (const t of [TOKEN_NEW, TOKEN_OLD, TOKEN_C]) assert(!everything.includes(t), 'token leaked into the sweep output or logs');
  } finally {
    w.restore();
  }
});

Deno.test('补写:没有到期的行 → 一个请求都不发', async () => {
  const w = stubWorld(() => echo('unused'));
  const log: Query[] = [];
  try {
    const out = await sweepMagicLinks(fakeSupa(handlerFor({ dueRows: [] }), log), BASE, new Date().toISOString(), 50);
    assertEquals(w.sent.length, 0);
    assertEquals(out, { candidates: { raw: 0, due: 0 }, tried: 0, synced: 0, skippedTestCohort: 0, capped: false, results: [] });
  } finally {
    w.restore();
  }
});
