/**
 * GHL 写回的判据 —— 纯逻辑。三块:解析字段映射、验证写入是否被接受、HTTP 错误分类。
 *
 * 【为什么需要判据】GHL 的 contact 更新返回 200 不代表字段写进去了 —— 上一轮字段还不存在时
 * 也返回 200,我们却标了 synced=true。实证发现:响应体会回显整个 contact 的 customFields
 * 数组,写进去的字段【会出现】、被静默丢弃的【不出现】。所以「200 之外的成功信号」是有的,
 * 不需要额外回读一次 contact —— 但响应回显的是 UUID 不是我们的 key,得先有 key→id 映射(D8)。
 */

/** 字段映射:我们的 key(qai_assessment_*)→ GHL 的字段 UUID */
export type FieldMap = Record<string, string>;

/**
 * 解析 GET /locations/{id}/customFields 的响应为 key→id。
 *
 * ⚠️ 这个端点的响应形状我没有实测过,按 GHL v2 文档写:`{ customFields: [{ id, fieldKey }] }`,
 * fieldKey 形如 `contact.qai_assessment_tier`(带 model 前缀)。所以取前缀之后那段做 key。
 * 调用方会把【原始响应完整记日志】,第一次回源就能确认这个假设对不对(响应是字段定义,不含
 * 客户 PII,可以安全全量记)。防御:拿不到 id 或推不出 key 的条目跳过,不塞进映射。
 */
export function parseFieldMap(raw: unknown): FieldMap {
  const map: FieldMap = {};
  const list = (raw as { customFields?: unknown })?.customFields;
  if (!Array.isArray(list)) return map;
  for (const f of list) {
    const id = (f as { id?: unknown }).id;
    // fieldKey 优先(带 contact. 前缀);个别响应可能只给 key,一并兼容
    const rawKey = (f as { fieldKey?: unknown }).fieldKey ?? (f as { key?: unknown }).key;
    if (typeof id !== 'string' || typeof rawKey !== 'string') continue;
    // 去掉 model 前缀:contact.qai_assessment_tier → qai_assessment_tier
    const key = rawKey.includes('.') ? rawKey.slice(rawKey.indexOf('.') + 1) : rawKey;
    if (key) map[key] = id;
  }
  return map;
}

export interface WrittenFieldMiss {
  key: string;
  reason: string;
}

/**
 * 验证 payload 里每个字段都真的被 GHL 接受了。
 *
 * @param payload            我们发出去的 { key: value }
 * @param fieldMap           key → GHL 字段 id
 * @param responseFields     contact 更新响应回显的 customFields,形如 [{ id, value }]
 *
 * 逐个 key 查:映射里有没有它的 id、响应里有没有那个 id、值对不对。任一不满足即算「没写进去」,
 * 并给出具体原因和 key —— D9 要求错误具体到字段名,不报「部分字段失败」这种没法照着行动的话。
 */
export function verifyWrittenFields(
  payload: Record<string, unknown>,
  fieldMap: FieldMap,
  responseFields: unknown,
): { ok: boolean; missing: WrittenFieldMiss[] } {
  const byId = new Map<string, unknown>();
  if (Array.isArray(responseFields)) {
    for (const f of responseFields) {
      const id = (f as { id?: unknown }).id;
      // 响应里字段值的键名可能是 value,也可能是 field_value,两个都认
      const value = (f as { value?: unknown }).value ?? (f as { field_value?: unknown }).field_value;
      if (typeof id === 'string') byId.set(id, value);
    }
  }

  const missing: WrittenFieldMiss[] = [];
  for (const [key, want] of Object.entries(payload)) {
    const id = fieldMap[key];
    if (!id) {
      // 映射里没有 —— 要么字段确实没在 GHL 建,要么映射缓存旧了(刚加的字段)
      missing.push({ key, reason: 'no id in field map (field missing in GHL, or the cached map is stale — refresh it)' });
      continue;
    }
    if (!byId.has(id)) {
      missing.push({ key, reason: 'not echoed in response — GHL silently dropped it' });
      continue;
    }
    if (!valuesMatch(byId.get(id), want)) {
      missing.push({ key, reason: `value mismatch: sent ${JSON.stringify(want)}, got ${JSON.stringify(byId.get(id))}` });
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * 值比对 —— 数字可能以 number(0.6)或 string("0.6")回来,统一成字符串比。
 * 这正是 total 那条:发出去 0.6(number),GHL 收下、回显也是 number,但别的字段是字符串,
 * 所以不能假设类型一致,按字符串比最稳。
 */
function valuesMatch(got: unknown, want: unknown): boolean {
  if (got === want) return true;
  return String(got).trim() === String(want).trim();
}

export type GhlErrorClass = 'TRANSIENT' | 'CONFIG' | 'AUTH';

/**
 * HTTP 状态 → 错误类别(D9)。
 *   AUTH      401 / 403 —— token 失效,不自动重试
 *   TRANSIENT 429 / 5xx —— 限流或服务端抖动,进指数退避重试
 *   CONFIG    其余 4xx —— 请求本身有问题,重试同样的请求无意义
 */
export function classifyGhlError(status: number): GhlErrorClass {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429 || status >= 500) return 'TRANSIENT';
  return 'CONFIG';
}
