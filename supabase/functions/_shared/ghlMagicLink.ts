/**
 * 换链接之后,把新链接写进 GHL 的 `qai_assessment_magic_link`(2026-10-14)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要写】这个字段平时由 GHL 自己写(表单 → Custom Webhook 调罗盘 → Update Contact Field)。
 * 后台「换链接」作废旧 token 之后,没有任何东西更新它 —— 它存着一条失效的链接,
 * 而 Viho 在 GHL 里查实:**有工作流在消息里用 `{{contact.qai_assessment_magic_link}}`**。
 * 换过链接的人会从那条工作流收到坏链接。PROGRESS「换链接后写回魔法链接字段」。
 *
 * 【沿用字段写回的规矩(`ghlWriteback.ts`),记账在 entitlement 上】
 *   - 测试批次跳过 —— 在传输层,按 entitlement 判(`ghlContactRequestForEntitlement`)
 *   - 成功不信 200,验回显:GHL 回显的这个字段**就是这条新链接**才标 `ghl_link_synced = true`
 *   - CONFIG / AUTH 不重试;TRANSIENT 指数退避(2^n 分钟,上限 6 小时),`assessment-ghl-resync` 补
 *   - `ghl_link_synced` 的 null = 从没换过链接(字段是 GHL 自己写的那条,对的)。只有换链接把它置成 false ——
 *     所以补写碰不到任何没换过链接的人
 *
 * 【与字段写回不同的一处:链接里就是 token】
 * 字段写回核对失败时,原因里会带「发的值 / 收到的值」;那两个值在这里是两条带 token 的链接。
 * 所以写进库(`ghl_link_last_error`)和日志之前,把 token 换掉、把「值不符」换成不带值的说法。
 * GHL 的错误响应体也过一遍 —— 它可能把请求里的值回显出来。
 *
 * 【连点两次换链接】每次写完,只在「库里的 token 还是我刚写的那个」时才标 true;
 * 不是的话置回 false、立刻到期 —— 补写用库里**当前**的 token 再写一次。
 * 不这样的话,先发后到的旧写入会让字段停在旧链接上,而库里却说「已同步」。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlContactRequestForEntitlement, type ContactRequestResult } from './ghlContact.ts';
import { getFieldMap } from './ghlFieldMap.ts';
import { classifyGhlError, verifyWrittenFields, type GhlErrorClass } from './ghlVerify.ts';
import { magicLink } from './token.ts';
import { dbFail, dbLogLine } from './dbError.ts';

export const MAGIC_LINK_FIELD = 'qai_assessment_magic_link';

export interface LinkTarget {
  entitlementId: string;
  contactId: string;
  /** 库里**当前**的 token —— 写的就是它拼出来的链接 */
  accessToken: string;
}

export interface LinkSyncOutcome {
  attempted: boolean;
  ok: boolean;
  /** 不含 token */
  detail?: string;
}

const REDACTED = '<token>';

/** 把 token 从任何要落库 / 进日志的文本里换掉 */
function redact(text: string, token: string): string {
  return token ? text.split(token).join(REDACTED) : text;
}

export async function syncMagicLinkToGhl(
  supa: SupabaseClient,
  target: LinkTarget,
  appBaseUrl: string,
  logTag: string,
): Promise<LinkSyncOutcome> {
  const { entitlementId, contactId, accessToken } = target;
  const link = magicLink(appBaseUrl, accessToken);
  const payload = { [MAGIC_LINK_FIELD]: link };
  const fail = async (klass: GhlErrorClass, detail: string, attempted: boolean): Promise<LinkSyncOutcome> => {
    // 所有失败的原因都从这里过:GHL 的错误响应体、抛出的异常文本 —— 任何一个都可能带着链接
    const safe = redact(detail, accessToken);
    await recordLinkFailure(supa, entitlementId, klass, safe, logTag);
    return { attempted, ok: false, detail: `${klass}: ${safe}`.slice(0, 300) };
  };

  let sent: ContactRequestResult;
  try {
    sent = await ghlContactRequestForEntitlement(supa, entitlementId, contactId, '', {
      method: 'PUT',
      body: { customFields: [{ key: MAGIC_LINK_FIELD, field_value: link }] },
    });
  } catch (err) {
    return fail('TRANSIENT', `fetch threw — ${err instanceof Error ? err.message : String(err)}`, true);
  }

  if (!sent.sent) {
    // 测试批次:CONFIG(重试一万次也不该发),与字段写回同一个归类
    if (sent.skipped === 'test_cohort') return fail('CONFIG', 'test cohort — magic link write intentionally skipped', false);
    return fail('TRANSIENT', `GHL credentials missing (${sent.missing.join(', ')})`, false);
  }

  if (!sent.ok) {
    return fail(classifyGhlError(sent.status), `HTTP ${sent.status} — ${sent.text.slice(0, 300)}`, true);
  }

  // ── 200:不信状态码,验回显 ──
  let body: unknown;
  try {
    body = JSON.parse(sent.text);
  } catch {
    return fail('TRANSIENT', 'contact update returned non-JSON', true);
  }
  const responseFields = (body as { contact?: { customFields?: unknown } })?.contact?.customFields ??
    (body as { customFields?: unknown })?.customFields;

  let verdict;
  try {
    let fieldMap = await getFieldMap(supa);
    verdict = verifyWrittenFields(payload, fieldMap, responseFields);
    // 自愈:映射里没有这个 key(缓存旧了)→ 强制回源一次再验
    if (!verdict.ok && verdict.missing.some((m) => m.reason.includes('field map'))) {
      fieldMap = await getFieldMap(supa, { force: true });
      verdict = verifyWrittenFields(payload, fieldMap, responseFields);
    }
  } catch (err) {
    // 拿不到映射就验不了 —— 绝不因此标 true
    return fail('TRANSIENT', `field map unavailable — ${err instanceof Error ? err.message : String(err)}`, true);
  }
  if (!verdict.ok) {
    // 「值不符」的原因里带着两条链接(= token),换成不带值的说法
    const detail = verdict.missing
      .map((m) => `${m.key} (${m.reason.startsWith('value mismatch') ? 'value mismatch — values not logged, they carry the access token' : m.reason})`)
      .join('; ');
    return fail('CONFIG', `field not accepted by GHL — ${detail}`, true);
  }

  // ── GHL 上确实是这条新链接了;库里的 token 还是它,才标 true ──
  const { data: marked, error } = await supa
    .from('assessment_entitlements')
    .update({ ghl_link_synced: true, ghl_link_last_error: null, ghl_link_next_retry_at: null })
    .eq('id', entitlementId)
    .eq('access_token', accessToken)
    .select('id');
  if (error) {
    // GHL 那边已经对了,只是账没记上:下次补写会再写一次同样的值,无害
    console.error(dbLogLine({ fn: `syncMagicLinkToGhl/${logTag}`, op: 'assessment_entitlements.update (mark ghl_link_synced)', entitlement: entitlementId }, error));
    return { attempted: true, ok: true, detail: 'written and verified, but the bookkeeping update failed' };
  }
  if (!marked || (marked as unknown[]).length === 0) {
    // 写的过程中 token 又换了(连点两次换链接):GHL 上可能是哪一条不确定 —— 立刻到期,补写用当前 token 再写
    const { error: supErr } = await supa
      .from('assessment_entitlements')
      .update({
        ghl_link_synced: false,
        ghl_link_last_error: 'TRANSIENT: superseded — the token changed while writing; the sweep writes the current link',
        ghl_link_next_retry_at: new Date().toISOString(),
      })
      .eq('id', entitlementId);
    if (supErr) console.error(dbLogLine({ fn: `syncMagicLinkToGhl/${logTag}`, op: 'assessment_entitlements.update (superseded)', entitlement: entitlementId }, supErr));
    console.log(`[${logTag}] magic link write for entitlement ${entitlementId} superseded by a newer token`);
    return { attempted: true, ok: false, detail: 'superseded: the token changed while writing — the sweep writes the current link' };
  }
  console.log(`[${logTag}] GHL magic link field verified for entitlement ${entitlementId}`);
  return { attempted: true, ok: true };
}

/** 与 `ghlWriteback.ts` 的 `recordFailure` 同一套规矩,记在 entitlement 上。`detail` 已经去掉了 token */
async function recordLinkFailure(
  supa: SupabaseClient,
  entitlementId: string,
  klass: GhlErrorClass,
  detail: string,
  logTag: string,
): Promise<void> {
  console.error(`${klass}: [${logTag}] magic link field, entitlement ${entitlementId}: ${detail}`);
  const { data, error: readErr } = await supa
    .from('assessment_entitlements')
    .select('ghl_link_attempts')
    .eq('id', entitlementId)
    .maybeSingle();
  if (readErr) {
    console.error(dbLogLine({ fn: `syncMagicLinkToGhl/${logTag}`, op: 'assessment_entitlements.select ghl_link_attempts', entitlement: entitlementId }, readErr));
  }
  const attempts = ((data?.ghl_link_attempts as number) ?? 0) + 1;
  const { error } = await supa
    .from('assessment_entitlements')
    .update({
      ghl_link_synced: false,
      ghl_link_attempts: attempts,
      ghl_link_last_error: `${klass}: ${detail}`.slice(0, 1000),
      ghl_link_next_retry_at:
        klass === 'TRANSIENT' ? new Date(Date.now() + Math.min(2 ** attempts, 360) * 60_000).toISOString() : null,
    })
    .eq('id', entitlementId);
  if (error) console.error(dbLogLine({ fn: `syncMagicLinkToGhl/${logTag}`, op: 'assessment_entitlements.update (record link failure)', entitlement: entitlementId }, error));
}

export interface LinkSweepSummary {
  /** raw = 查询命中;due = 去掉 CONFIG/AUTH 之后 */
  candidates: { raw: number; due: number };
  tried: number;
  synced: number;
  skippedTestCohort: number;
  capped: boolean;
  /** 不含 token、不含 contact id */
  results: { entitlement_id: string; ok: boolean; detail?: string }[];
}

const permanent = (err: string | null) => !!err && /^(CONFIG|AUTH):/.test(err);

/**
 * 补写(`assessment-ghl-resync` 每 15 分钟调一次):换过链接、没写成、到期、不是 CONFIG/AUTH 的,
 * **用库里当前的 token** 再写一次 —— 永远写当前那条,不写当时那条。
 */
export async function sweepMagicLinks(
  supa: SupabaseClient,
  appBaseUrl: string,
  nowIso: string,
  cap: number,
): Promise<LinkSweepSummary> {
  const { data, error } = await supa
    .from('assessment_entitlements')
    .select('id, ghl_contact_id, access_token, ghl_link_last_error')
    .eq('ghl_link_synced', false)
    .or(`ghl_link_next_retry_at.is.null,ghl_link_next_retry_at.lte.${nowIso}`)
    .limit(cap + 1);
  if (error) dbFail({ fn: 'sweepMagicLinks', op: 'assessment_entitlements.select (magic links due)' }, error);
  const rows = (data ?? []) as { id: string; ghl_contact_id: string; access_token: string; ghl_link_last_error: string | null }[];
  const due = rows.filter((r) => !permanent(r.ghl_link_last_error));
  const capped = due.length > cap;

  const results: LinkSweepSummary['results'] = [];
  for (const r of due.slice(0, cap)) {
    const out = await syncMagicLinkToGhl(supa, { entitlementId: r.id, contactId: r.ghl_contact_id, accessToken: r.access_token }, appBaseUrl, 'resync');
    results.push({ entitlement_id: r.id, ok: out.ok, ...(out.detail ? { detail: out.detail } : {}) });
  }
  return {
    candidates: { raw: rows.length, due: due.length },
    tried: results.length,
    synced: results.filter((r) => r.ok).length,
    skippedTestCohort: results.filter((r) => r.detail?.includes('test cohort')).length,
    capped,
    results,
  };
}
