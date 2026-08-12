import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { _resetFieldMapCache, getFieldMap } from './ghlFieldMap.ts';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `getFieldMap` 的三级读取链:内存缓存 → `app_settings` → 回源 GHL。
 *
 * 【为什么补这一份】入口审计发现 `_resetFieldMapCache()` 的注释写着「供测试」,
 * 而这个模块**根本没有测试文件** —— 那句注释在替一份不存在的覆盖作证。
 * 处理方式是**补上被服务的对象**,不是删掉服务者:这段缓存逻辑值得测,
 * 因为它错的方式都很安静(多打一次 GHL、或者一直用着过期的映射,
 * 两者都不会报错,只会让字段验证莫名其妙地失败)。
 *
 * 【为什么不需要 --allow-net】所有回源都走 stub 掉的 `globalThis.fetch`,
 * 一个真实请求都不发。env 只按名字放开了那两个 GHL 变量(见 deno.json)。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** GHL 的 customFields 响应形状(与 parseFieldMap 的假设一致) */
const GHL_BODY = JSON.stringify({
  customFields: [
    { id: 'uuid-tier', fieldKey: 'contact.qai_assessment_tier' },
    { id: 'uuid-total', fieldKey: 'contact.qai_assessment_total' },
  ],
});

interface FakeCalls {
  settingsReads: number;
  upserts: { key: string; value: unknown }[];
  fetches: string[];
}

/**
 * 假 Supabase client —— 只实现 getFieldMap 真正调用的那两条链:
 *   from('app_settings').select('value').eq('key', k).maybeSingle()
 *   from('app_settings').upsert(row, { onConflict })
 * 【不用 `any`,经 `unknown` 转到真类型】链上每一环都写出返回形状,
 * 免得以后改调用方式时这个假货悄悄还能跑
 * (那正是 `as any[]` 让 `?? {}` 藏了六处属性访问的那次教训)。
 *
 * 我第一版还是写了 `as any` + 一句「不用 any」的注释,**第九道门当场抓了** ——
 * 而它抓的是「注释在声称一件代码两行后就违反的事」,正是这道门加进来的理由。
 */
function fakeSupa(
  calls: FakeCalls,
  settings: { value: unknown } | null,
  opts: { readError?: string; upsertError?: string } = {},
) {
  const maybeSingle = () => {
    calls.settingsReads += 1;
    return Promise.resolve(
      opts.readError
        ? { data: null, error: { message: opts.readError } }
        : { data: settings, error: null },
    );
  };
  return {
    from: (table: string) => {
      assertEquals(table, 'app_settings');
      return {
        select: () => ({ eq: () => ({ maybeSingle }) }),
        upsert: (row: { key: string; value: unknown }) => {
          calls.upserts.push({ key: row.key, value: row.value });
          return Promise.resolve(
            opts.upsertError ? { error: { message: opts.upsertError } } : { error: null },
          );
        },
      };
    },
  } as unknown as SupabaseClient;
}

/** 装上 fetch stub + 凭证,返回一个恢复函数 */
function withGhl(
  calls: FakeCalls,
  reply: { status?: number; body?: string } | { throws: string },
  creds: { token?: string; location?: string } = { token: 't', location: 'loc1' },
): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    calls.fetches.push(String(url));
    if ('throws' in reply) return Promise.reject(new Error(reply.throws));
    return Promise.resolve(
      new Response(reply.body ?? GHL_BODY, { status: reply.status ?? 200 }),
    );
  }) as typeof globalThis.fetch;

  const prevToken = Deno.env.get('GHL_PRIVATE_TOKEN');
  const prevLoc = Deno.env.get('GHL_LOCATION_ID');
  if (creds.token) Deno.env.set('GHL_PRIVATE_TOKEN', creds.token);
  else Deno.env.delete('GHL_PRIVATE_TOKEN');
  if (creds.location) Deno.env.set('GHL_LOCATION_ID', creds.location);
  else Deno.env.delete('GHL_LOCATION_ID');

  return () => {
    globalThis.fetch = realFetch;
    if (prevToken === undefined) Deno.env.delete('GHL_PRIVATE_TOKEN');
    else Deno.env.set('GHL_PRIVATE_TOKEN', prevToken);
    if (prevLoc === undefined) Deno.env.delete('GHL_LOCATION_ID');
    else Deno.env.set('GHL_LOCATION_ID', prevLoc);
  };
}

const emptyCalls = (): FakeCalls => ({ settingsReads: 0, upserts: [], fetches: [] });

Deno.test('app_settings 里有映射时直接用,【不】回源 GHL', () => {
  /**
   * 这是这条链存在的理由:内存缓存做不到「刷新对所有实例生效」,
   * 所以 app_settings 是跨实例的那一层。它有值却还去打 GHL,
   * 等于每个冷启动都多一次外部请求 —— 而那不会报错,只会偶尔撞限流。
   */
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  return getFieldMap(fakeSupa(calls, { value: { qai_assessment_tier: 'from-db' } }), { nowMs: 1000 })
    .then((map) => {
      assertEquals(map, { qai_assessment_tier: 'from-db' });
      assertEquals(calls.fetches.length, 0);
    })
    .finally(restore);
});

Deno.test('TTL 内第二次调用不再读 app_settings —— 内存缓存真的生效', async () => {
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  try {
    const supa = fakeSupa(calls, { value: { a: '1' } });
    await getFieldMap(supa, { nowMs: 0 });
    assertEquals(calls.settingsReads, 1);
    await getFieldMap(supa, { nowMs: 9 * 60 * 1000 }); // 9 分钟 < 10 分钟 TTL
    assertEquals(calls.settingsReads, 1); // 没有第二次读
  } finally {
    restore();
  }
});

Deno.test('TTL 过期后重新读 app_settings —— 反向锁', async () => {
  /**
   * 没有这条,「永远用内存缓存」也能让上一条绿,而那意味着刷新永远不生效:
   * Admin 点了「刷新字段映射」,别的实例还在用旧的,而没有任何东西会说。
   */
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  try {
    const supa = fakeSupa(calls, { value: { a: '1' } });
    await getFieldMap(supa, { nowMs: 0 });
    await getFieldMap(supa, { nowMs: 10 * 60 * 1000 + 1 }); // 刚过 TTL
    assertEquals(calls.settingsReads, 2);
  } finally {
    restore();
  }
});

Deno.test('force=true 跳过缓存【和】app_settings,回源并写回', async () => {
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  try {
    const supa = fakeSupa(calls, { value: { stale: 'yes' } });
    await getFieldMap(supa, { nowMs: 0 }); // 先把内存缓存填上
    const map = await getFieldMap(supa, { force: true, nowMs: 1 });
    assertEquals(map, { qai_assessment_tier: 'uuid-tier', qai_assessment_total: 'uuid-total' });
    assertEquals(calls.fetches.length, 1);
    assertStringIncludes(calls.fetches[0], '/locations/loc1/customFields');
    // 回源结果必须写回 app_settings,否则「刷新对所有实例生效」不成立
    assertEquals(calls.upserts.length, 1);
    assertEquals(calls.upserts[0].key, 'ghl_field_map');
  } finally {
    restore();
  }
});

Deno.test('upsert 失败【不】抛 —— 拿到映射比写缓存重要', async () => {
  /**
   * 写缓存失败让整次写回崩掉,等于把一个「下次还得再查一遍」升级成一次故障。
   */
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  try {
    const supa = fakeSupa(calls, null, { upsertError: 'disk full' });
    const map = await getFieldMap(supa, { nowMs: 0 });
    assertEquals(map.qai_assessment_tier, 'uuid-tier');
  } finally {
    restore();
  }
});

Deno.test('app_settings 读失败要抛 —— syncToGhl 据此判 TRANSIENT', async () => {
  /**
   * 拿不到映射就无法验证字段是否被接受,**不能因此把 synced 标成 true**。
   * 所以这里必须抛,而不是回一个空映射。
   */
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  try {
    const err = await assertRejects(() =>
      getFieldMap(fakeSupa(calls, null, { readError: 'connection reset' }), { nowMs: 0 }),
    );
    assertStringIncludes((err as Error).message, 'app_settings read failed');
    assertEquals(calls.fetches.length, 0); // 读失败时不该继续回源
  } finally {
    restore();
  }
});

Deno.test('GHL 非 2xx 时抛,且带状态码 —— 分类器要靠它', async () => {
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, { status: 401, body: 'bad token' });
  try {
    const err = await assertRejects(() => getFieldMap(fakeSupa(calls, null), { nowMs: 0 }));
    assertStringIncludes((err as Error).message, 'GHL customFields fetch 401');
  } finally {
    restore();
  }
});

Deno.test('响应不是 JSON 时说清是这件事,而不是抛一个解析错误', async () => {
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, { body: '<html>gateway timeout</html>' });
  try {
    const err = await assertRejects(() => getFieldMap(fakeSupa(calls, null), { nowMs: 0 }));
    assertStringIncludes((err as Error).message, 'not JSON');
  } finally {
    restore();
  }
});

Deno.test('缺凭证时的措辞必须能被 classifyError 判成 config_missing', async () => {
  /**
   * 这条把两个模块的约定钉在一起:`errorKind.ts` 里有一条用例直接引用
   * 「GHL credentials missing for field-map fetch」这句**真实字面量**。
   * 措辞在这里改掉的话,那边会把它归成 `unexpected` ——
   * 于是排查方向从「去配变量」变成「不知道去哪」。
   */
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {}, { token: undefined, location: undefined });
  try {
    const err = await assertRejects(() => getFieldMap(fakeSupa(calls, null), { nowMs: 0 }));
    assertStringIncludes((err as Error).message, 'credentials missing');
    assertEquals(calls.fetches.length, 0);
  } finally {
    restore();
  }
});

Deno.test('_resetFieldMapCache 真的把缓存清了 —— 它自己的用例', async () => {
  /**
   * 这个函数在入口审计里是「为不存在的测试准备的钩子」。现在它有服务对象了,
   * 而这一条是它自己的:清完之后必须重新读 app_settings。
   */
  _resetFieldMapCache();
  const calls = emptyCalls();
  const restore = withGhl(calls, {});
  try {
    const supa = fakeSupa(calls, { value: { a: '1' } });
    await getFieldMap(supa, { nowMs: 0 });
    assertEquals(calls.settingsReads, 1);
    _resetFieldMapCache();
    await getFieldMap(supa, { nowMs: 1 }); // TTL 内,但缓存被清了
    assertEquals(calls.settingsReads, 2);
  } finally {
    restore();
  }
});
