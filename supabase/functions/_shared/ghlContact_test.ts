import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlContactRequest } from './ghlContact.ts';

/** 假 client:只回「这个 session 属不属于测试批次」,形状与真实查询逐层一致 */
function fakeSupa(isTest: boolean) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { entitlement: { cohort: { is_test: isTest } } }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function withFetch(sent: { url: string; init?: RequestInit }[]): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init });
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof globalThis.fetch;
  Deno.env.set('GHL_PRIVATE_TOKEN', 't');
  Deno.env.set('GHL_LOCATION_ID', 'loc1');
  return () => {
    globalThis.fetch = real;
    Deno.env.delete('GHL_PRIVATE_TOKEN');
    Deno.env.delete('GHL_LOCATION_ID');
  };
}

Deno.test('【PUT 带 tags 数组一律抛,且到不了网络】', async () => {
  /**
   * 这条守的是这个项目里**唯一不可逆**的 GHL 错误:contact 的 PUT 接受 `tags` 数组,
   * 而那是**整体替换** —— 一次请求就能抹掉客户在 GHL 里其它所有标签,
   * 而那些标签是他们业务流程在用的。症状要等某条 workflow 不再触发才被发现,
   * 那时已经没有东西可以还原。
   *
   * 所以断言两件事:①抛 ②**一个请求都没发出去**(第二条才是真正要紧的)。
   */
  const sent: { url: string; init?: RequestInit }[] = [];
  const restore = withFetch(sent);
  try {
    const err = await assertRejects(() =>
      ghlContactRequest(fakeSupa(false), 's1', 'c1', '', {
        method: 'PUT',
        body: { tags: ['assessment_completed'] },
      }),
    );
    assertStringIncludes((err as Error).message, 'replaces ALL tags');
    assertEquals(sent.length, 0);
  } finally {
    restore();
  }
});

Deno.test('DELETE /tags 带 tags 是合法的增量移除 —— 不该被那条断言拦住', async () => {
  // 反向锁:把守卫写成「任何带 tags 的请求都拦」的话,标签就永远移不掉了
  const sent: { url: string; init?: RequestInit }[] = [];
  const restore = withFetch(sent);
  try {
    const out = await ghlContactRequest(fakeSupa(false), 's1', 'c1', '/tags', {
      method: 'DELETE',
      body: { tags: ['assessment_tier_spot'] },
    });
    assertEquals(out.sent, true);
    assertEquals(sent.length, 1);
    assertStringIncludes(sent[0].url, '/contacts/c1/tags');
  } finally {
    restore();
  }
});

Deno.test('字段那半的 PUT(customFields)照常走', async () => {
  const sent: { url: string; init?: RequestInit }[] = [];
  const restore = withFetch(sent);
  try {
    const out = await ghlContactRequest(fakeSupa(false), 's1', 'c1', '', {
      method: 'PUT',
      body: { customFields: [{ key: 'qai_assessment_tier', field_value: 'semi_auto' }] },
    });
    assertEquals(out.sent, true);
    assertEquals(sent.length, 1);
  } finally {
    restore();
  }
});

Deno.test('测试批次:一个请求都不发,而且是在传输层拦的', async () => {
  /**
   * 收口挪到这里的全部理由:它原本在 `syncToGhl` 里,而那是字段写回专用 ——
   * 新写一条出站路径(标签)**什么都不做**就绕过了它。
   * 现在任何经这个出口的调用都被覆盖,不论它是哪个功能。
   */
  const sent: { url: string; init?: RequestInit }[] = [];
  const restore = withFetch(sent);
  try {
    for (const [path, method] of [['', 'PUT'], ['/tags', 'POST'], ['/tags', 'DELETE']] as const) {
      const out = await ghlContactRequest(fakeSupa(true), 's1', 'c1', path, {
        method,
        body: { x: 1 },
      });
      assertEquals(out.sent, false);
      if (!out.sent) assertEquals(out.skipped, 'test_cohort');
    }
    assertEquals(sent.length, 0);
  } finally {
    restore();
  }
});

Deno.test('缺凭证:不发请求,并说清缺哪个', async () => {
  const sent: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    sent.push({ url: String(url) });
    return Promise.resolve(new Response('{}'));
  }) as typeof globalThis.fetch;
  Deno.env.delete('GHL_PRIVATE_TOKEN');
  Deno.env.set('GHL_LOCATION_ID', 'loc1');
  try {
    const out = await ghlContactRequest(fakeSupa(false), 's1', 'c1', '/tags', { method: 'POST' });
    assertEquals(out.sent, false);
    if (!out.sent && out.skipped === 'missing_credentials') {
      assertEquals(out.missing, ['GHL_PRIVATE_TOKEN']);
    } else {
      throw new Error(`expected missing_credentials, got ${JSON.stringify(out)}`);
    }
    assertEquals(sent.length, 0);
  } finally {
    globalThis.fetch = real;
    Deno.env.delete('GHL_LOCATION_ID');
  }
});

Deno.test('测试批次的判断【在凭证检查之前】—— 顺序反了会漏一种情况', async () => {
  /**
   * 凭证齐全但批次是测试的 → 必须跳过;凭证缺失且批次是测试的 → 也该报测试批次,
   * 因为那才是「为什么没发」的真实原因。顺序反了的话后一种会被记成
   * TRANSIENT 并**排进重试队列** —— 于是一条永远不该外发的记录会被反复重试。
   */
  const sent: { url: string; init?: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    sent.push({ url: String(url) });
    return Promise.resolve(new Response('{}'));
  }) as typeof globalThis.fetch;
  Deno.env.delete('GHL_PRIVATE_TOKEN');
  Deno.env.delete('GHL_LOCATION_ID');
  try {
    const out = await ghlContactRequest(fakeSupa(true), 's1', 'c1', '/tags', { method: 'POST' });
    assertEquals(out.sent, false);
    if (!out.sent) assertEquals(out.skipped, 'test_cohort');
    assertEquals(sent.length, 0);
  } finally {
    globalThis.fetch = real;
  }
});
