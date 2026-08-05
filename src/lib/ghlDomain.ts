/**
 * GHL 写回前的 domain 校验。
 *
 * config 的 `ghl_writeback.custom_fields[].domain` 有【三种形态】,这是关键:
 *
 *   枚举数组  ["manual","spot",...]   值必须在数组里
 *   区间字符串 "0.0-5.0"               数值必须落在闭区间内
 *   null                              不校验(自由文本,如 goal_90d)
 *
 * 【为什么必须分开处理】只做 `Array.isArray(domain) && domain.includes(v)` 的话,
 * 区间型 domain 会走到 else 分支 —— 取决于 else 怎么写,结果是
 * **永远校验失败**(总分永远写不进 GHL)或者**永远跳过**(等于没校验)。
 * 两种都是静默的:GHL 那边只是少一个字段值,workflow 静默不匹配。
 *
 * config 里 `custom_fields_note` 明确要求「不在域内的报 CONFIG 类错误,不要静默写入」,
 * 所以这里的失败是一个显式的 reason,由调用方决定记日志还是中断。
 */

export type Domain = readonly string[] | string | null;

export type DomainVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/** 区间型 domain 的形状:`0.0-5.0` / `1-100` / `-1.5-2.5`(前导负号也支持) */
const RANGE_RE = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/;

/**
 * 校验一个值是否落在它的 domain 内。
 *
 * @param value  要写回的值(已经是最终形态,不再转换)
 * @param domain config 里声明的 domain
 * @param maxLength 可选,config 里的 max_length —— 超长会被 GHL 截断,那是静默数据丢失
 */
export function checkDomain(
  value: unknown,
  domain: Domain,
  maxLength?: number,
): DomainVerdict {
  // null domain：自由文本，只查长度
  if (domain === null || domain === undefined) {
    if (maxLength !== undefined && typeof value === 'string' && value.length > maxLength) {
      // 不自己截断 —— 截断是静默丢数据。让调用方知道并决定
      return { ok: false, reason: `length ${value.length} exceeds max_length ${maxLength}` };
    }
    return { ok: true };
  }

  // 枚举数组
  if (Array.isArray(domain)) {
    if (typeof value !== 'string') {
      return { ok: false, reason: `expected one of [${domain.join(',')}], got ${typeof value}` };
    }
    if (!domain.includes(value)) {
      return { ok: false, reason: `"${value}" is not in [${domain.join(',')}]` };
    }
    return { ok: true };
  }

  // 区间字符串
  if (typeof domain === 'string') {
    const m = RANGE_RE.exec(domain);
    if (!m) {
      // domain 本身写坏了 —— 这是 config 错误,不是数据错误。必须显式报,
      // 否则一个打错的 domain 会让这个字段的校验静默失效
      return { ok: false, reason: `malformed range domain "${domain}"` };
    }
    const [min, max] = [Number(m[1]), Number(m[2])];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, reason: `expected a finite number in ${domain}, got ${JSON.stringify(value)}` };
    }
    if (value < min || value > max) {
      return { ok: false, reason: `${value} is outside ${domain}` };
    }
    return { ok: true };
  }

  return { ok: false, reason: `unsupported domain shape: ${JSON.stringify(domain)}` };
}

export interface FieldSpec {
  key: string;
  domain?: Domain;
  max_length?: number;
}

export interface FieldCheckFailure {
  key: string;
  reason: string;
}

/**
 * 批量校验一组待写回的字段。
 *
 * 【只校验实际要写的字段】payload 里没有的 key 不算失败 —— 有些字段(如 report_url)
 * 要等 PDF 好了才有值,分阶段写回是正常的。缺字段的行为由 D9 决定,不在这里判。
 */
export function checkFields(
  payload: Record<string, unknown>,
  specs: readonly FieldSpec[],
): FieldCheckFailure[] {
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const failures: FieldCheckFailure[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const spec = byKey.get(key);
    if (!spec) {
      // 不在 config 里声明的字段一律拒绝 —— 打错的 key 写进 GHL 会创建一个
      // 无人知晓的自定义字段,而原本该填的那个字段永远是空的
      failures.push({ key, reason: 'not declared in ghl_writeback.custom_fields' });
      continue;
    }
    const verdict = checkDomain(value, spec.domain ?? null, spec.max_length);
    if (!verdict.ok) failures.push({ key, reason: verdict.reason });
  }
  return failures;
}
