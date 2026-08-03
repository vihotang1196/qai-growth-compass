/**
 * assessment-auth —— 魔法链接登录。
 *
 * POST { token, lang }
 *   → 200 { target, lang } + Set-Cookie(30 天 httpOnly session)
 *   → 200 { target: '/expired' } 且【不下 cookie】:token 无效或已作废
 *
 * 【为什么无效 token 也回 200 而不是 401】前端拿到 target 就跳,不需要区分
 * 「token 错」与「token 被作废」——两者对客户都是同一句「这个链接已失效」。
 * 回 401 反而要在前端多写一条错误分支,而那条分支的行为与 /expired 一样。
 *
 * 【token 不轮换,但会被校验是否作废】access_revoked_at 非 null 一律拒绝。
 * 见 PROGRESS.md S4-C。
 *
 * 【跳转目标由 session 状态推导,不接受调用方传入】见 _shared/postAuthTarget.ts。
 * 请求体里没有任何字段能影响 target ——lang 只影响 query,不影响路径。
 */
import { serviceClient } from '../_shared/supa.ts';
import { postAuthTarget, targetWithLang, type SessionStatus } from '../_shared/postAuthTarget.ts';
import { sessionCookieHeader, signSession } from '../_shared/session.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function parseLang(v: unknown): 'zh' | 'en' {
  return v === 'en' ? 'en' : 'zh';
}

/** token 无效 / 作废时的统一回复:告诉前端去 /expired,不下 cookie */
function expired(lang: 'zh' | 'en'): Response {
  return json({ target: targetWithLang('/expired', lang), lang });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', expected: 'POST' }, 405);
  }

  const secret = Deno.env.get('SESSION_SECRET');
  if (!secret) {
    console.error('SESSION_SECRET is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
    body = raw as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const lang = parseLang(body.lang);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return expired(lang);

  try {
    const supa = serviceClient();

    // access_token 上有 unique 索引,这里是索引查找
    const { data: ent, error: entError } = await supa
      .from('assessment_entitlements')
      .select('id, access_revoked_at, first_login_at, status')
      .eq('access_token', token)
      .maybeSingle();
    if (entError) throw entError;

    if (!ent || ent.access_revoked_at !== null) {
      // 两种情况回同一个结果。作废的情况记一条日志,便于确认 Admin 的操作生效了
      if (ent) console.warn(`auth rejected: entitlement ${ent.id} was revoked`);
      return expired(lang);
    }

    // ── session:有则取,无则建 ────────────────────────────────
    const { data: existing, error: sesError } = await supa
      .from('assessment_sessions')
      .select('id, status')
      .eq('entitlement_id', ent.id)
      .maybeSingle();
    if (sesError) throw sesError;

    let sessionStatus: SessionStatus | null = null;
    if (existing) {
      sessionStatus = existing.status as SessionStatus;
    } else {
      const { error: insError } = await supa
        .from('assessment_sessions')
        .insert({ entitlement_id: ent.id, locale: lang });
      if (insError) {
        // 并发首次登录(客户连点两次链接):另一边刚建好。重查一次即可
        const { data: raced, error: raceError } = await supa
          .from('assessment_sessions')
          .select('status')
          .eq('entitlement_id', ent.id)
          .maybeSingle();
        if (raceError || !raced) throw insError;
        sessionStatus = raced.status as SessionStatus;
      } else {
        sessionStatus = 'in_progress';
      }
    }

    // ── 首次登录的时间戳与状态推进 ────────────────────────────
    // status 只往前走:completed 的人再登录不能被打回 started
    const patch: Record<string, unknown> = {};
    if (!ent.first_login_at) patch.first_login_at = new Date().toISOString();
    if (ent.status === 'pending' || ent.status === 'link_sent') patch.status = 'started';
    if (Object.keys(patch).length) {
      const { error } = await supa
        .from('assessment_entitlements')
        .update(patch)
        .eq('id', ent.id);
      // 这一步失败不该挡住登录 —— 它只影响 Admin 看到的时间线
      if (error) console.error(`failed to stamp first_login_at for ${ent.id}: ${error.message}`);
    }

    const target = postAuthTarget({
      entitlementFound: true,
      revoked: false,
      sessionStatus,
    });

    const cookie = await signSession(ent.id, secret, Date.now());
    return json(
      { target: targetWithLang(target, lang), lang },
      200,
      { 'Set-Cookie': sessionCookieHeader(cookie) },
    );
  } catch (err) {
    console.error(`auth failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});
