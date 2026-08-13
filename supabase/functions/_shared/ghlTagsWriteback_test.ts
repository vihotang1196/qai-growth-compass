import { assertEquals, assertStringIncludes } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncTagsToGhl } from './ghlTagsWriteback.ts';
import type { TagInput } from './ghlTags.ts';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 标签写回。**所有出站都走 stub 掉的 `globalThis.fetch`,一个真实请求都不发。**
 *
 * 这一份要钉的是三件会造成不可逆后果的事:
 *   ① 测试批次一个请求都不发(GHL 的标签是全局的,污染了很难清)
 *   ② 移除只碰我们命名空间内、且上次确实打过的标签(误删客户标签不可逆)
 *   ③ 什么都不用变时不发请求(省的是 GHL 的限流额度)
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Calls {
  requests: { method: string; url: string; body: unknown }[];
  updates: Record<string, unknown>[];
}

const emptyCalls = (): Calls => ({ requests: [], updates: [] });

/**
 * 假 client:cohort 查询(收口用)+ results 的读写。
 *
 * ⚠️ **`assessment_sessions` 那一支的形状必须与真实查询逐层一致。**
 * 第一版我写成了 `{ cohort: { is_test } }`,而 `isTestSessionCohort` 查的是
 * `entitlement:assessment_entitlements(cohort:assessment_cohorts(is_test))` ——
 * 少了 `entitlement` 那一层,于是收口读到 `undefined` 就判成「不是测试批次」,
 * 请求真的发了出去。**是「测试批次不发请求」那条断言把我的假货抓住的**,
 * 而如果那条断言写松一点(比如只看返回值 ok=false),这个假货会一直骗着我。
 */
function fakeSupa(calls: Calls, opts: { isTest?: boolean } = {}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'assessment_sessions'
                  ? { entitlement: { cohort: { is_test: opts.isTest === true } } }
                  : { ghl_sync_attempts: 0 },
              error: null,
            }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        calls.updates.push(patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient;
}

function withFetch(calls: Calls, status = 200, body = '{"succeeded":true}'): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.requests.push({
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof globalThis.fetch;
  const prevToken = Deno.env.get('GHL_PRIVATE_TOKEN');
  const prevLoc = Deno.env.get('GHL_LOCATION_ID');
  Deno.env.set('GHL_PRIVATE_TOKEN', 't');
  Deno.env.set('GHL_LOCATION_ID', 'loc1');
  return () => {
    globalThis.fetch = real;
    if (prevToken === undefined) Deno.env.delete('GHL_PRIVATE_TOKEN');
    else Deno.env.set('GHL_PRIVATE_TOKEN', prevToken);
    if (prevLoc === undefined) Deno.env.delete('GHL_LOCATION_ID');
    else Deno.env.set('GHL_LOCATION_ID', prevLoc);
  };
}

const INPUT: TagInput = {
  tier: 'semi_auto',
  weakestPrimary: 'capture',
  total: 3.2,
  responses: { consult_interest: 'no', priority_dimension: 'capture', monthly_marketing_budget: 0 },
};
/** 上面这个人应有的标签 */
const WANT = ['assessment_completed', 'assessment_tier_semi_auto', 'assessment_weak_capture'];

Deno.test('首次:该有的标签一次 POST 打上去,不发 DELETE', async () => {
  const calls = emptyCalls();
  const restore = withFetch(calls);
  try {
    const out = await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, null, 'test', 0);
    assertEquals(out.ok, true);
    assertEquals(out.added.sort(), [...WANT].sort());
    assertEquals(out.removed, []);
    assertEquals(calls.requests.length, 1);
    assertEquals(calls.requests[0].method, 'POST');
    assertStringIncludes(calls.requests[0].url, '/contacts/c1/tags');
    // ghl_tags_applied 存的是「现在应该是什么」,不是「这次加了什么」
    const last = calls.updates.at(-1)!;
    assertEquals(last.ghl_tags_synced, true);
    assertEquals(last.ghl_tags_applied, WANT);
  } finally {
    restore();
  }
});

Deno.test('档位变了:旧档位标签被 DELETE,新的被 POST', async () => {
  /**
   * 重答或重算后 spot → semi_auto。旧标签不移除的话一个人身上挂两个互斥档位,
   * **GHL 里两条 workflow 都会触发** —— 那是这条规则存在的全部理由。
   */
  const calls = emptyCalls();
  const restore = withFetch(calls);
  try {
    const applied = ['assessment_completed', 'assessment_tier_spot', 'assessment_weak_capture'];
    const out = await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, applied, 'test', 0);
    assertEquals(out.ok, true);
    assertEquals(out.added, ['assessment_tier_semi_auto']);
    assertEquals(out.removed, ['assessment_tier_spot']);
    assertEquals(calls.requests.map((r) => r.method), ['POST', 'DELETE']);
    assertEquals(calls.requests[1].body, { tags: ['assessment_tier_spot'] });
  } finally {
    restore();
  }
});

Deno.test('【绝不移除不是我们打的标签】客户自己的标签一个都不碰', async () => {
  /**
   * `ghl_tags_applied` 里如果混进了别的东西(手工改过、或者以后有人往这一列写别的),
   * 也只允许动 `assessment_` 前缀的。误删客户的标签**不可逆**,
   * 而且要等他某条 workflow 不触发了才会被发现。
   */
  const calls = emptyCalls();
  const restore = withFetch(calls);
  try {
    const applied = [...WANT, 'vip_customer', 'webinar_2026', 'assessment_hot_lead'];
    const out = await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, applied, 'test', 0);
    // hot_lead 是我们的、这次不该有 → 移除;vip_customer / webinar_2026 不是我们的 → 不碰
    assertEquals(out.removed, ['assessment_hot_lead']);
    const deletes = calls.requests.filter((r) => r.method === 'DELETE');
    assertEquals(deletes.length, 1);
    assertEquals(deletes[0].body, { tags: ['assessment_hot_lead'] });
  } finally {
    restore();
  }
});

Deno.test('什么都不用变:一个请求都不发,但把 synced 标上', async () => {
  // 重答而档位没变是最常见的情况 —— 那种情况下发空请求是白烧 GHL 的限流额度
  const calls = emptyCalls();
  const restore = withFetch(calls);
  try {
    const out = await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, WANT, 'test', 0);
    assertEquals(out.ok, true);
    assertEquals(out.attempted, false);
    assertEquals(calls.requests.length, 0);
    assertEquals(calls.updates.at(-1)!.ghl_tags_synced, true);
  } finally {
    restore();
  }
});

Deno.test('测试批次:一个请求都不发,记 CONFIG 而不是标 synced', async () => {
  /**
   * 这条是整份里最要紧的。给假 contact 打标签会在 GHL 里留下一堆
   * `assessment_*` 值挂在假联系人身上,而 GHL 的标签是**全局的**。
   *
   * 而且 **`ghl_tags_synced` 绝不能标 true** —— 那是在数据里说「同步成功了」。
   * 归 CONFIG:sweep 靠前缀跳过它,原因也留下了。
   */
  const calls = emptyCalls();
  const restore = withFetch(calls);
  try {
    const out = await syncTagsToGhl(fakeSupa(calls, { isTest: true }), 's1', 'c1', INPUT, null, 'test', 0);
    assertEquals(out.ok, false);
    assertEquals(calls.requests.length, 0);
    const patch = calls.updates.at(-1)!;
    assertEquals(patch.ghl_tags_synced, undefined);
    assertStringIncludes(String(patch.ghl_tags_last_error), 'CONFIG:');
    assertStringIncludes(String(patch.ghl_tags_last_error), 'test cohort');
    assertEquals(patch.ghl_tags_next_retry_at, null); // CONFIG 不排重试
  } finally {
    restore();
  }
});

Deno.test('429 归 TRANSIENT 并排退避;403 归 AUTH 不排', async () => {
  // 分类与字段写回共享:那三类只跟「重试有没有用」有关,跟写什么无关
  for (const [status, klass, retries] of [
    [429, 'TRANSIENT', true],
    [403, 'AUTH', false],
    [400, 'CONFIG', false],
  ] as const) {
    const calls = emptyCalls();
    const restore = withFetch(calls, status, 'nope');
    try {
      const out = await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, null, 'test', 0);
      assertEquals(out.ok, false, String(status));
      const patch = calls.updates.at(-1)!;
      assertStringIncludes(String(patch.ghl_tags_last_error), `${klass}:`);
      assertEquals(patch.ghl_tags_next_retry_at !== null, retries, `${status} 的退避`);
    } finally {
      restore();
    }
  }
});

Deno.test('派生有 problem 时不外发,记 CONFIG', async () => {
  /**
   * 脏取值硬打上去的后果是在 GHL 里创建一个永久的全局垃圾标签。
   * 重试同样的输入也不会变好 —— 所以是 CONFIG,不是 TRANSIENT。
   */
  const calls = emptyCalls();
  const restore = withFetch(calls);
  try {
    const out = await syncTagsToGhl(
      fakeSupa(calls),
      's1',
      'c1',
      { ...INPUT, tier: 'Semi_Auto' },
      null,
      'test',
      0,
    );
    assertEquals(out.ok, false);
    assertEquals(calls.requests.length, 0);
    assertStringIncludes(String(calls.updates.at(-1)!.ghl_tags_last_error), 'CONFIG: tag derivation');
  } finally {
    restore();
  }
});

Deno.test('失败时【不】写 ghl_tags_applied —— 它是下一次算差集的唯一依据', async () => {
  /**
   * 写了的话,这一列就与 GHL 的实际状态脱节:下一次差集会以为旧标签已经移掉了,
   * 于是那个互斥的档位标签永远留在客户身上。
   */
  const calls = emptyCalls();
  const restore = withFetch(calls, 500, 'boom');
  try {
    await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, null, 'test', 0);
    for (const patch of calls.updates) assertEquals('ghl_tags_applied' in patch, false);
  } finally {
    restore();
  }
});

Deno.test('POST 成功但 DELETE 失败:已加的算加了,applied 不落库', async () => {
  /**
   * 半成功是真实会发生的:两次调用之间限流。这时 `ghl_tags_applied` 不能落库 ——
   * 落了就等于宣称「现在的状态是这样」,而 DELETE 那半没成。
   * 下一次 sweep 会重算差集,那时旧标签仍在 applied 里,于是会再试一次移除。
   */
  const calls = emptyCalls();
  const real = globalThis.fetch;
  Deno.env.set('GHL_PRIVATE_TOKEN', 't');
  Deno.env.set('GHL_LOCATION_ID', 'loc1');
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.requests.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve(new Response(method === 'DELETE' ? 'rate limited' : 'ok', { status: method === 'DELETE' ? 429 : 200 }));
  }) as typeof globalThis.fetch;
  try {
    const applied = ['assessment_completed', 'assessment_tier_spot', 'assessment_weak_capture'];
    const out = await syncTagsToGhl(fakeSupa(calls), 's1', 'c1', INPUT, applied, 'test', 0);
    assertEquals(out.ok, false);
    assertEquals(out.added, ['assessment_tier_semi_auto']); // POST 那半确实成了
    assertEquals(out.removed, []);
    for (const patch of calls.updates) assertEquals('ghl_tags_applied' in patch, false);
  } finally {
    globalThis.fetch = real;
    Deno.env.delete('GHL_PRIVATE_TOKEN');
    Deno.env.delete('GHL_LOCATION_ID');
  }
});
