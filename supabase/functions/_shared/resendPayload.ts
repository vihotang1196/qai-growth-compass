/**
 * 重发链接时发给 GHL Inbound Webhook 的 payload —— 纯函数。
 *
 * 【为什么值为 null 的键要整个省掉,而不是送显式 null】
 * GHL 那条 workflow 的第一个 action 是 Create Contact,而 Create Contact 是 upsert:
 * 映射了哪个字段就覆盖哪个字段。我们的 phone / email / name 都可能是 null ——
 * 只有邮箱的学员 phone 就是 null。
 *
 * 如果 null 会覆盖,那么给这种学员重发一次链接,会把 GHL contact 的手机号刷空,
 * 而手机号正是那条 workflow 用来发 WhatsApp 的通道 —— 这条 workflow 会亲手拆掉
 * 自己的发送通道。症状是「WhatsApp 没发出去」,没人会往这一步查;而且我们库里
 * 那个号码也是 null,补不回来。
 *
 * 省掉键是我们这一侧唯一能控制的部分,而且控制得彻底:如果 GHL 把「缺失键」
 * 当作「不改」,风险从根上消失,不依赖它的 null 语义。
 * 详见 docs/ghl-setup.md 3.4.1。
 */

export interface ResendSource {
  ghlContactId: string;
  magicLink: string;
  name: string | null;
  phoneE164: string | null;
  emailLower: string | null;
  lang: 'zh' | 'en';
}

/** 一定存在的两个键 + 一定存在的 lang;其余按有值才带 */
export function buildResendPayload(src: ResendSource): Record<string, string> {
  const payload: Record<string, string> = {
    contact_id: src.ghlContactId,
    magic_link: src.magicLink,
    lang: src.lang,
  };
  if (src.name) payload.name = src.name;
  if (src.phoneE164) payload.phone = src.phoneE164;
  if (src.emailLower) payload.email = src.emailLower;
  return payload;
}
