/**
 * Supabase API key 的两代格式,以及各自该怎么发 —— **纯函数,三个运行时共用**。
 *
 * (放在 `api/_lib/` 是因为 Vercel 只编译 `/api` 内的 TS;Deno 侧经
 * `supabase/functions/_shared/apiKeys.ts` 一行 re-export 取用。见 renderToken 的先例。)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么必须有这个模块,而不是就地改两处 header】
 *
 * legacy 的 anon / service_role **是 JWT**,历来同时发在两个头上:
 *     apikey: <key>
 *     Authorization: Bearer <key>
 *
 * 新的 publishable / secret key **不是 JWT**,官方明确:
 * **不能放在 `Authorization: Bearer` 里,只能走 `apikey`**。
 *
 * 项目里手写这两个头的地方有两处(代理与 retention cron)。两处各改一遍,
 * 就是两份「怎么判断这是哪一代 key」的判断 —— 而它们迟早会对不上
 * (判断标准 3)。更要紧的是:这个判断错了的失败形态是**鉴权被拒**,
 * 而鉴权被拒的错误信息从来不会说「你把 key 放错头了」。
 *
 * 【为什么要同时支持两代,而不是一刀切】
 * 迁移必须能滚动进行:先部署这份代码(仍然吃 legacy,什么都不变)→ 再配新 key
 * → 重新构建部署 → 验 → 才按 Disable。而 Disable 是**可逆**的,坏了要能开回来 ——
 * 开回来之后这份代码得照样能跑。一刀切的代码会让「开回来」这条退路失效。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type SupabaseKeyKind = 'legacy_jwt' | 'new_format';

/**
 * 这把 key 是哪一代。
 *
 * 【按前缀判,不按能不能解析成 JWT】新 key 的前缀是官方约定的
 * (`sb_publishable_` / `sb_secret_`),而「像不像 JWT」是个模糊判断 ——
 * 一个畸形的 legacy key 也不像 JWT,但它绝不该被当成新 key 去掉 Authorization 头。
 * 认不出来的一律当 legacy:那是保守方向,发多一个头不会让 legacy 失败,
 * 而少发一个头会让 legacy 直接被拒。
 */
export function classifySupabaseKey(key: string): SupabaseKeyKind {
  return key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')
    ? 'new_format'
    : 'legacy_jwt';
}

/**
 * 发这把 key 该带哪些头。
 *
 * legacy → `apikey` + `Authorization: Bearer`(历来如此,网关两个都认)
 * new    → **只有 `apikey`**;新 key 不是 JWT,放进 Bearer 会被拒
 */
export function supabaseKeyHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key };
  if (classifySupabaseKey(key) === 'legacy_jwt') {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

/**
 * 从 Edge Function 的环境里挑出服务端密钥。
 *
 * 【`SUPABASE_SECRET_KEYS` 是 JSON,不是字符串】平台注入的是一个**按名字索引的对象**,
 * 默认那把叫 `default`。所以不能像 `SUPABASE_SERVICE_ROLE_KEY` 那样直接用。
 *
 * 【顺序:新的优先,legacy 兜底】按下 Disable 之后 legacy 就不认了,所以新的必须优先;
 * 而在配好新 key 之前(以及 Disable 被开回来时)legacy 还得能用。
 * 两代都拿不到时回 `null`,由调用方抛出带上下文的错误 —— 这里不抛,
 * 因为「哪个变量缺了」的诊断信息属于调用点。
 *
 * @param secretKeysRaw `Deno.env.get('SUPABASE_SECRET_KEYS')` 的原始值
 * @param legacy        `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
 * @param name          要取哪一把,默认 `default`
 */
export function pickSecretKey(
  secretKeysRaw: string | undefined | null,
  legacy: string | undefined | null,
  name = 'default',
): string | null {
  if (secretKeysRaw) {
    try {
      const parsed: unknown = JSON.parse(secretKeysRaw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const picked = (parsed as Record<string, unknown>)[name];
        if (typeof picked === 'string' && picked.length > 0) return picked;
      }
    } catch {
      /**
       * 【解析失败不抛,回落 legacy】平台哪天改了这个变量的形状,
       * 我们不该因此整个函数起不来 —— 那会让一个格式变化变成全站故障。
       * 回落之后行为退化成迁移前,而 Disable 之后的失败会由调用方报出来。
       */
    }
  }
  return legacy && legacy.length > 0 ? legacy : null;
}

/**
 * 客户端 / 服务端的公开 key:新的优先,legacy 兜底。
 *
 * 与 `pickSecretKey` 同一个理由,只是公开 key 是普通字符串,不需要解 JSON。
 */
export function pickPublishableKey(
  publishable: string | undefined | null,
  anon: string | undefined | null,
): string | null {
  if (publishable && publishable.length > 0) return publishable;
  return anon && anon.length > 0 ? anon : null;
}

/**
 * Vercel 侧的 secret key:**两个变量都是普通字符串**,不像 Edge Function 那边是 JSON。
 *
 * 单独一个函数而不是复用 `pickSecretKey`,是因为形状确实不同 ——
 * 硬塞进同一个函数就要在里面判「这是 JSON 还是字符串」,
 * 而那种「看起来像什么就当什么」的判断正是这个项目一直在避免的。
 */
export function pickSecretKeyFromPlainEnv(
  secret: string | undefined | null,
  legacy: string | undefined | null,
): string | null {
  if (secret && secret.length > 0) return secret;
  return legacy && legacy.length > 0 ? legacy : null;
}
