/**
 * 准入记录上的告警 —— **纯类型 + 纯函数**,同时给 Deno(写)与前端 Roster(读)用。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【这一族告警的共同语义:不阻塞客户,但必须可见】
 *
 * webhook 是**付款入口**。一条 payload 里有配置问题(批次 tag 拼错、号码格式怪、
 * 语言码不合法)时,拒绝整条记录的代价是「客户付了钱,系统里没有他」——
 * 那比问题本身重得多,而且要等他投诉才知道。
 *
 * 所以选择一律是「回落 + 记 warning」。**但那句话有个前提**:warning 得有人看见。
 * 而在 `assessment_entitlements.warnings` 这一列存在之前,它只在函数日志
 * 与被 GHL 吞掉的响应体里 —— 于是过去每一次选「warning 而不是拒绝」,
 * 实际选的都是**静默**。这个模块和那一列是为了让「不阻塞 + 可见」真正成立。
 *
 * 【为什么带 context】`lang_invalid` 不带上收到的那个值(`EN`),
 * 运营就不知道 GHL 那边到底填了什么,于是这条告警只能说明「有问题」,
 * 不能说明「去改哪里」—— 那正是[判断标准 9](#9-一条失败路径除了失败还要说清去哪找)。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const WARNING_CODES = [
  /** 号码给了但解析不出有效 E.164 —— 记录仍然入库,备用登录路径可能匹配不到 */
  'phone_unparseable',
  /** 既没手机也没邮箱 —— 备用路径永远匹配不到这个人 */
  'no_contact_channel',
  /** cohort_tag 给了但库里没有对应的 active 批次 —— 已回落到默认批次 */
  'cohort_tag_unknown',
  /** 连默认批次都不存在 —— cohort_id 为 null,基线统计不会工作 */
  'no_default_cohort',
  /** lang 给了但不是 zh / en —— 已回落到默认语言 */
  'lang_invalid',
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface EntitlementWarning {
  code: WarningCode;
  /** 定位用的上下文:收到的那个脏值、拼错的 tag。**不放 PII** */
  context?: string;
}

export function isWarningCode(v: unknown): v is WarningCode {
  return typeof v === 'string' && (WARNING_CODES as readonly string[]).includes(v);
}

/**
 * 从库里读出来的 jsonb 归一化成数组。
 *
 * 【认不出的一律丢掉,并且不抛】这一列是 jsonb,历史行是 null,
 * 而且以后可能被手工改过。一个坏值不该让整个名单页打不开 ——
 * 名单页是运营每天都要用的东西。
 */
export function parseWarnings(raw: unknown): EntitlementWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: EntitlementWarning[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && isWarningCode(item)) {
      // 兼容早期只有 code 的形状(那时 warnings 只进日志,但值有可能被人手工塞进来)
      out.push({ code: item });
      continue;
    }
    if (item && typeof item === 'object') {
      const code = (item as { code?: unknown }).code;
      if (!isWarningCode(code)) continue;
      const ctx = (item as { context?: unknown }).context;
      out.push(typeof ctx === 'string' && ctx ? { code, context: ctx } : { code });
    }
  }
  return out;
}

/**
 * 给前端用的 i18n key。
 *
 * 【为什么是 key 而不是文案】`src/**` 里禁止硬编码 CJK 字符串(`lint:cjk`),
 * 而这个模块被前端 import —— 文案必须待在 `ui-strings.ts`。
 * 这里只做「码 → key」的映射,而映射本身有一条用例钉住「每个码都有 key」。
 */
export function warningLabelKey(code: WarningCode): string {
  return `warn.${code}`;
}
