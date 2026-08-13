/**
 * 把魔法链接发给 GHL —— assessment-login-request 与 assessment-admin 共用。
 *
 * 【为什么抽出来】Stage 5 的后台「重发链接」需要同样的动作:拼 payload、POST 给
 * GHL 的 Inbound Webhook、判读响应、盖 link_sent_at。抽出来是为了不出现第二份
 * GHL POST 逻辑 —— 两份的话,以后改 payload 字段只改一处就成了静默的半修。
 *
 * 【两边的差别不在发送,在发送之前】备用路径要 IP 限流、60 秒节流、恒定耗时;
 * 后台不要那些(管理员知道自己在给谁发)。所以这里只负责「发」,
 * 判断该不该发是调用方的事。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { magicLink } from './token.ts';
import { buildResendPayload } from './resendPayload.ts';
import { triggerAccepted } from './ghlTriggerResponse.ts';
import { isTestEntitlement } from './testCohort.ts';
import { effectiveLang } from './lang.ts';

export interface SendTarget {
  id: string;
  ghl_contact_id: string;
  access_token: string;
  name: string | null;
  phone_e164: string | null;
  email_lower: string | null;
  status: string;
  /**
   * 这个人的语言(`assessment_entitlements.lang`)。
   *
   * ⚠️ **上一版这个参数是调用方传进来的,而 Admin 传的是【操作者界面的语言】** ——
   * 也就是「谁在后台点,决定客户收到什么语言的消息」。
   * 一个英文客户,运营在中文界面点了重发,他收到中文消息 ——
   * 而运营不会知道,因为他看到的是「已发送」。
   *
   * 与 `coalesce(p_lang,'zh')` 那个坑同一族:**系统的某个无关状态覆盖了本该属于用户的属性**。
   * 只是这次覆盖它的不是重试,是操作者的界面语言 —— 那个值跟收件人毫无关系。
   */
  lang: string | null;
}

export type SendOutcome =
  | { ok: true; queued: true }
  /** GHL 收下了但没进执行队列 —— trigger 不存在或 workflow 是 Draft */
  | { ok: true; queued: false; detail: string }
  | { ok: false; detail: string };

/**
 * 发送并盖 link_sent_at。
 *
 * 【link_sent_at 一定会盖,即使 queued 为 false】它记的是「我们发出去了」,
 * 而不是「对方收到了」。用它做 60 秒节流也是这个语义 —— 否则 GHL 侧出问题时
 * 节流会失效,变成可以无限触发。
 */
export async function sendMagicLink(
  supa: SupabaseClient,
  target: SendTarget,
  resendUrl: string,
  appBaseUrl: string,
): Promise<SendOutcome> {
  /**
   * 【语言只从 `target.lang` 来,没有第二个来源】签名里刻意**没有** lang 参数 ——
   * 有那个参数就还会有人从别处传一个进来(上一版就是这么坏的)。
   * 库里是脏值 / null 时回落默认,见 `effectiveLang`。
   */
  const lang = effectiveLang(target.lang);
  /**
   * ── 测试 / 演示批次一律不外发 ──
   *
   * 这个函数是**所有外发消息的唯一出口**(Admin 重发/换链接 + login-request 两个调用点)。
   * seed 的邮箱是 `@seed.invalid`、contact 在 GHL 里不存在,所以发出去只会失败 ——
   * 但「会失败」不是不发的理由,**不该对着假联系人发起动作**才是。
   * 与 syncToGhl 同一个收口位置:将来任何新的外发功能只要走这里,就自动被覆盖。
   */
  if (await isTestEntitlement(supa, target.id)) {
    console.log(`sendMagicLink skipped for entitlement ${target.id}: test cohort`);
    return { ok: false, detail: 'skipped: test cohort — no outbound message for demo data' };
  }

  const payload = buildResendPayload({
    ghlContactId: target.ghl_contact_id,
    magicLink: magicLink(appBaseUrl, target.access_token),
    name: target.name,
    phoneE164: target.phone_e164,
    emailLower: target.email_lower,
    lang,
  });

  let outcome: SendOutcome;
  try {
    const res = await fetch(resendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      outcome = { ok: false, detail: `GHL returned ${res.status}: ${body.slice(0, 200)}` };
    } else if (!triggerAccepted(body)) {
      // 排查顺序:先 workflow 有没有 Publish(Draft 在这里长得一模一样),再怀疑 URL
      outcome = {
        ok: true,
        queued: false,
        detail:
          'GHL accepted the POST but returned no trigger id — nothing was queued. ' +
          'Check (1) is the resend workflow published? Draft looks identical here. ' +
          '(2) is GHL_RESEND_WEBHOOK_URL stale?',
      };
    } else {
      outcome = { ok: true, queued: true };
    }
  } catch (err) {
    outcome = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  const patch: Record<string, unknown> = { link_sent_at: new Date().toISOString() };
  if (target.status === 'pending') patch.status = 'link_sent';
  const { error } = await supa.from('assessment_entitlements').update(patch).eq('id', target.id);
  if (error) console.error(`failed to stamp link_sent_at for ${target.id}: ${error.message}`);

  if (!outcome.ok) console.error(`resend failed for ${target.id}: ${outcome.detail}`);
  else if (!outcome.queued) console.error(`resend not queued for ${target.id}: ${outcome.detail}`);

  return outcome;
}
