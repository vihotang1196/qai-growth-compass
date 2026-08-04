/**
 * assessment-login-request —— 备用路径:重发魔法链接。
 *
 * POST { identifier, lang }  identifier = 手机号或邮箱
 *   → 200 { status: 'sent' }    命中、命中但被 60s 节流、完全未命中 —— 三种情况【完全一样】
 *   → 200 { status: 'locked' }  该 IP 触发限流
 *
 * 【不做 OTP】能收到链接本身就是身份验证。猜中号码的人拿不到任何内容,
 * 因为链接只会发到该记录已登记的手机与邮箱。
 *
 * 【为什么「被节流」也回 'sent' 而不是 'throttled'】
 * 节流只可能发生在命中的时候 —— 回一个可区分的 'throttled' 等于告诉对方
 * 「这个号码在名单里」。连试两次就能枚举名单。所以命中/未命中/被节流一律回同一个
 * status,客户看到的也是同一句话。
 * 'locked' 可以区分,因为它按 IP 判定,与「这个标识是否存在」无关,不泄露名单。
 *
 * 【恒定耗时】命中要多查一次库并 POST 给 GHL,未命中只查一次 —— 耗时差能反推名单。
 * 所以响应前补齐到一个固定下限,且下限必须设在最慢那条路径之上。
 * 实际耗时超过下限时会打 warn:那说明下限太低,差异又回来了。
 */
import { serviceClient } from '../_shared/supa.ts';
import { normalizeEmail, normalizePhone, tailFromInput } from '../_shared/phone.ts';
import { magicLink } from '../_shared/token.ts';
import { hashIdentifier } from '../_shared/identifierHash.ts';
import { DEFAULT_RATE_LIMIT, evaluateRateLimit, lookbackMs } from '../_shared/rateLimit.ts';
import { buildResendPayload } from '../_shared/resendPayload.ts';
import { triggerAccepted } from '../_shared/ghlTriggerResponse.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
/** 同一记录的重发间隔 */
const RESEND_COOLDOWN_MS = 60_000;
/** 响应耗时下限的默认值。GHL 的 POST 通常几百毫秒,留足余量 */
const DEFAULT_MIN_RESPONSE_MS = 1500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Matched {
  id: string;
  ghl_contact_id: string;
  access_token: string;
  access_revoked_at: string | null;
  name: string | null;
  phone_e164: string | null;
  email_lower: string | null;
  link_sent_at: string | null;
  status: string;
}

const SELECT_COLS =
  'id, ghl_contact_id, access_token, access_revoked_at, name, phone_e164, email_lower, link_sent_at, status';

/**
 * 三级回退匹配。命中多于 1 条一律【视为未命中】。
 *
 * phone_tail 是 8 位,跨国可能碰撞;email_lower 没有 unique 约束,GHL 里同一个邮箱
 * 挂在两个 contact 上是可能的(同一人重复报名、公司共用邮箱)。
 * 两种情况下都有多个 access_token,发哪一个都可能把 A 的报告链接发给 B ——
 * 宁可让客户联系我们。
 */
async function matchEntitlement(
  supa: ReturnType<typeof serviceClient>,
  identifier: string,
): Promise<{ hit: Matched | null; ambiguousEmail: string | null }> {
  if (identifier.includes('@')) {
    const email = normalizeEmail(identifier);
    if (!email) return { hit: null, ambiguousEmail: null };
    const { data, error } = await supa
      .from('assessment_entitlements')
      .select(SELECT_COLS)
      .eq('email_lower', email)
      .limit(2);
    if (error) throw error;
    if ((data?.length ?? 0) > 1) return { hit: null, ambiguousEmail: email };
    return { hit: (data?.[0] as Matched) ?? null, ambiguousEmail: null };
  }

  // 第 1 级:E.164 精确匹配
  const e164 = normalizePhone(identifier);
  if (e164) {
    const { data, error } = await supa
      .from('assessment_entitlements')
      .select(SELECT_COLS)
      .eq('phone_e164', e164)
      .limit(2);
    if (error) throw error;
    if (data?.length === 1) return { hit: data[0] as Matched, ambiguousEmail: null };
    if ((data?.length ?? 0) > 1) return { hit: null, ambiguousEmail: null };
  }

  // 第 2 级:tail 容错匹配。少于 8 位数字的输入不进这一级(防碰撞)
  const tail = tailFromInput(identifier);
  if (!tail) return { hit: null, ambiguousEmail: null };
  const { data, error } = await supa
    .from('assessment_entitlements')
    .select(SELECT_COLS)
    .eq('phone_tail', tail)
    .limit(2);
  if (error) throw error;
  if (data?.length === 1) return { hit: data[0] as Matched, ambiguousEmail: null };
  // 第 3 级:命中 >1 条 → 视为未命中
  return { hit: null, ambiguousEmail: null };
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const minMs = Number(Deno.env.get('LOGIN_MIN_RESPONSE_MS') ?? DEFAULT_MIN_RESPONSE_MS);

  /** 所有出口都经过这里,保证耗时下限对每条路径都生效 */
  const respond = async (body: unknown): Promise<Response> => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) {
      await sleep(minMs - elapsed);
    } else {
      console.warn(
        `login-request took ${elapsed}ms, over the ${minMs}ms floor — ` +
          `raise LOGIN_MIN_RESPONSE_MS, otherwise hit/miss timing is distinguishable again`,
      );
    }
    return json(body);
  };

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', expected: 'POST' }, 405);
  }

  const pepper = Deno.env.get('LOGIN_HASH_PEPPER');
  const resendUrl = Deno.env.get('GHL_RESEND_WEBHOOK_URL');
  const appBaseUrl = Deno.env.get('APP_BASE_URL');
  if (!pepper || !resendUrl || !appBaseUrl) {
    console.error('missing LOGIN_HASH_PEPPER / GHL_RESEND_WEBHOOK_URL / APP_BASE_URL');
    return json({ error: 'server_misconfigured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not object');
    body = raw as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const lang = body.lang === 'en' ? 'en' : 'zh';
  // 代理钉的 X-Client-Ip 优先;直连时退回 x-forwarded-for 的第一段
  const ip =
    req.headers.get('X-Client-Ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  try {
    const supa = serviceClient();

    // ── 1. IP 限流 ────────────────────────────────────────────
    const since = new Date(Date.now() - lookbackMs()).toISOString();
    const { data: attempts, error: attemptsError } = await supa
      .from('assessment_login_attempts')
      .select('created_at')
      .eq('ip', ip)
      .gte('created_at', since);
    if (attemptsError) throw attemptsError;

    const verdict = evaluateRateLimit(
      (attempts ?? []).map((a) => new Date(a.created_at as string).getTime()),
      Date.now(),
      DEFAULT_RATE_LIMIT,
    );

    const identifierHash = identifier ? await hashIdentifier(identifier, pepper) : null;

    if (verdict.locked) {
      // 被锁的尝试也记录 —— 连续猛试会把锁刷新到更晚
      await supa
        .from('assessment_login_attempts')
        .insert({ ip, identifier_hash: identifierHash, succeeded: false });
      return await respond({ status: 'locked' });
    }

    // ── 2. 匹配 ───────────────────────────────────────────────
    const { hit, ambiguousEmail } = identifier
      ? await matchEntitlement(supa, identifier)
      : { hit: null, ambiguousEmail: null };

    if (ambiguousEmail) {
      // S4-A:Admin 要能看到「疑似重复 contact」。带上 email 是刻意的 ——
      // 这条日志的唯一用途就是让人去 GHL 里把重复的 contact 合掉
      console.warn(
        `resend skipped: email ${ambiguousEmail} matches more than one entitlement ` +
          `(duplicate GHL contacts?) — treated as no match, nothing sent`,
      );
    }

    // 作废的记录不重发。跟未命中同样处理,不给出任何区别
    const sendable = hit && hit.access_revoked_at === null ? hit : null;

    await supa
      .from('assessment_login_attempts')
      .insert({ ip, identifier_hash: identifierHash, succeeded: sendable !== null });

    // ── 3. 60 秒节流 + 发送 ───────────────────────────────────
    if (sendable) {
      const lastSent = sendable.link_sent_at ? new Date(sendable.link_sent_at).getTime() : 0;
      const withinCooldown = Date.now() - lastSent < RESEND_COOLDOWN_MS;

      if (!withinCooldown) {
        const payload = buildResendPayload({
          ghlContactId: sendable.ghl_contact_id,
          magicLink: magicLink(appBaseUrl, sendable.access_token),
          name: sendable.name,
          phoneE164: sendable.phone_e164,
          emailLower: sendable.email_lower,
          lang,
        });

        // 【两层判读,分别对应两种不同的故障】
        //   非 2xx        → 网络故障 / GHL 宕机
        //   200 但无 id   → trigger 不存在(URL 过期、UUID 变了)。状态码看不出来:
        //                   假 trigger 也回 200,差别只在响应体有没有 id。
        //                   见 _shared/ghlTriggerResponse.ts
        //
        // 【能证明与不能证明,别混】有 id 只能证明「对面有 workflow 接住了、进了执行
        // 队列」。**不能**证明消息送达 —— workflow 可能是 Draft、可能中途某个 action
        // 报错、可能 contact 没有可用号码。要闭环到送达只能靠 workflow 回调,没建。
        const res = await fetch(resendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const resBody = await res.text().catch(() => '');

        if (!res.ok) {
          console.error(
            `GHL resend webhook returned ${res.status} for entitlement ${sendable.id}: ` +
              resBody.slice(0, 200),
          );
        } else if (!triggerAccepted(resBody)) {
          console.error(
            `GHL accepted the POST but returned no trigger id for entitlement ${sendable.id} — ` +
              `GHL_RESEND_WEBHOOK_URL is probably stale (trigger deleted or UUID changed). ` +
              `Nothing was queued. Response: ${resBody.slice(0, 200)}`,
          );
        }

        const patch: Record<string, unknown> = { link_sent_at: new Date().toISOString() };
        if (sendable.status === 'pending') patch.status = 'link_sent';
        const { error } = await supa
          .from('assessment_entitlements')
          .update(patch)
          .eq('id', sendable.id);
        if (error) console.error(`failed to stamp link_sent_at for ${sendable.id}: ${error.message}`);
      }
    }

    // 命中、命中但被节流、未命中 —— 到这里回的是同一个东西
    return await respond({ status: 'sent' });
  } catch (err) {
    console.error(`login-request failed: ${err instanceof Error ? err.message : String(err)}`);
    // 500 也要过耗时下限:否则「服务端出错」这条路径的耗时会短得离谱,
    // 反而成了一个可观测的旁路
    return await respond({ status: 'sent' });
  }
});
