/**
 * 后台「换链接」:换 token → 把新链接写进 GHL 的字段 → 触发重发(2026-10-14 从 assessment-admin 挪出来,为了可测)。
 *
 * 【rotate = 轮换 token,并清空 access_revoked_at】(原注释,随代码挪过来)
 * S4-C 原本写的是「置 access_revoked_at = now()、生成新 token、触发重发」,
 * 那两件事放在一起是自相矛盾的:校验时 access_revoked_at 非 null 一律拒绝,所以新发的链接也会被拒。
 * 达成意图(旧链接失效、新链接可用)只需要换 token —— 旧 token 不再匹配任何行,自然就死了。
 * 所以这里【清空】它:一个之前被停用的人,rotate 之后应该能重新进来。
 *
 * 【2026-10-14 加的:写回魔法链接字段】见 `ghlMagicLink.ts` 文件头。这里只管顺序:
 *   1. 新 token、清停用、`ghl_link_synced = false` 在**同一条** update 里 ——
 *      分两条的话,中间失败会留下「token 换了、却没人知道字段要重写」的行,补写永远挑不到它
 *   2. 先写字段、再触发重发:重发之后别的工作流读到的已经是新链接
 *   3. 写字段失败**不挡**重发:学员照样收到新链接(重发工作流用的是 webhook 里带的链接),字段由补写兜
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateAccessToken } from './token.ts';
import { sendMagicLink, type SendOutcome, type SendTarget } from './resendLink.ts';
import { syncMagicLinkToGhl, type LinkSyncOutcome } from './ghlMagicLink.ts';
import { dbFail } from './dbError.ts';

/** 只为可测:默认值就是生产行为 */
export interface RotateDeps {
  newToken: () => string;
  syncLink: typeof syncMagicLinkToGhl;
  send: typeof sendMagicLink;
}

export const ROTATE_DEPS: RotateDeps = { newToken: generateAccessToken, syncLink: syncMagicLinkToGhl, send: sendMagicLink };

export async function rotateAndSend(
  supa: SupabaseClient,
  target: SendTarget,
  urls: { resendUrl: string; appBaseUrl: string },
  deps: RotateDeps = ROTATE_DEPS,
): Promise<{ target: SendTarget; linkField: LinkSyncOutcome; outcome: SendOutcome }> {
  const token = deps.newToken();
  const { error } = await supa
    .from('assessment_entitlements')
    .update({ access_token: token, access_revoked_at: null, ghl_link_synced: false })
    .eq('id', target.id);
  if (error) dbFail({ fn: 'rotateAndSend', op: 'assessment_entitlements.update access_token (rotate)', entitlement: target.id }, error);
  const rotated: SendTarget = { ...target, access_token: token };

  const linkField = await deps.syncLink(
    supa,
    { entitlementId: target.id, contactId: target.ghl_contact_id, accessToken: token },
    urls.appBaseUrl,
    'rotate',
  );
  const outcome = await deps.send(supa, rotated, urls.resendUrl, urls.appBaseUrl);
  return { target: rotated, linkField, outcome };
}
