/**
 * GHL webhook payload 的解析与归一化 —— 纯函数,不碰数据库、不碰环境变量。
 *
 * 拆出来是为了能测:webhook 的正确性几乎全在「脏输入怎么归一化、什么情况下
 * 降级、什么情况下拒绝」这几件事上,而这些都不需要数据库就能验。
 * 测试见 webhookPayload_test.ts。
 */
import { normalizeEmail, normalizePhone, phoneTail } from './phone.ts';

/** 唯一必填字段。故意不接受 contact_id / contactId 之类的别名 —— 见下方注释 */
export const REQUIRED_FIELD = 'ghl_contact_id';

export interface NormalizedEntitlement {
  ghl_contact_id: string;
  phone_e164: string | null;
  phone_tail: string | null;
  phone_raw: string | null;
  email_lower: string | null;
  name: string | null;
  /** 批次标识,用于匹配 assessment_cohorts.source_tag;为 null 时落默认批次 */
  cohort_tag: string | null;
}

export type Warning =
  /** 号码给了但解析不出有效 E.164 —— 记录仍然入库,Admin 标红由人修 */
  | 'phone_unparseable'
  /** 既没手机也没邮箱 —— 备用路径永远匹配不到这个人 */
  | 'no_contact_channel';

export type ParseResult =
  | { ok: true; value: NormalizedEntitlement; warnings: Warning[] }
  | { ok: false; error: string; receivedKeys: string[] };

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * 解析 payload。
 *
 * 【只认 ghl_contact_id 一个名字,不接受别名】
 * 宽容地接受 contact_id / contactId 会让「GHL 那边字段映射配错」变成静默行为 ——
 * 我们收到一个能用的 id,但它可能不是 contact id 而是别的什么。
 * 只认一个名字 + 400 时把收到的 key 列表回给对方,配错的话第一次测试就能定位。
 * 这是 setup 期该有的响亮失败,不是运行期的容错。
 *
 * 【除它之外全部可选,缺了就降级】
 * 不因为一个烂号码或缺失的邮箱丢掉整条准入记录 —— 客户已经付过钱了。
 * 缺联系方式只发 warning,不拒绝:GHL 侧的字段映射可能只是漏了一个,
 * 而拒绝会让一个付过款的人拿不到准入记录,那个代价更大。
 */
export function parseWebhookPayload(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'body must be a JSON object', receivedKeys: [] };
  }
  const body = raw as Record<string, unknown>;
  const receivedKeys = Object.keys(body).sort();

  const contactId = str(body[REQUIRED_FIELD]);
  if (!contactId) {
    return {
      ok: false,
      error: `missing required field "${REQUIRED_FIELD}" (non-empty string)`,
      receivedKeys,
    };
  }

  const phoneRaw = str(body.phone);
  const phoneE164 = normalizePhone(phoneRaw);
  const emailLower = normalizeEmail(str(body.email));

  const warnings: Warning[] = [];
  if (phoneRaw && !phoneE164) warnings.push('phone_unparseable');
  if (!phoneE164 && !emailLower) warnings.push('no_contact_channel');

  return {
    ok: true,
    warnings,
    value: {
      ghl_contact_id: contactId,
      phone_e164: phoneE164,
      phone_tail: phoneTail(phoneE164),
      // 解析成功也保留原值:Admin 排查「客户说他填的是另一个号」时用得上
      phone_raw: phoneRaw,
      email_lower: emailLower,
      name: str(body.name),
      cohort_tag: str(body.cohort_tag),
    },
  };
}

/**
 * 【可变列白名单不在这里】
 *
 * 冲突时哪些列允许被覆盖、哪些刻意不动,唯一定义在
 * supabase/migrations/20260731000300_upsert_entitlement_fn.sql 的
 * `on conflict do update set` 里。
 *
 * 早先这里有一份 MUTABLE_ON_CONFLICT 常量与一个 mutableFields() ——
 * 与 SQL 各存一份、靠人同步。改用原子 upsert 之后已删除:
 * 同一份东西存两处本身就是 bug 源,加一致性守卫只是给它上保险。
 */
