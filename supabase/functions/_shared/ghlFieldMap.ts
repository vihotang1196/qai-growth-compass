/**
 * GHL 字段映射(D8):我们的 key(qai_assessment_*)→ GHL 字段 UUID。
 *
 * 判据需要它:contact 更新的响应回显的是 UUID 不是 key,要验证「我们写的字段被接受了」,
 * 必须先把 key 翻成 id 再在响应里找。
 *
 * 读取链路(与 PROGRESS D8 一致):
 *   内存缓存(10 分钟 TTL)→ app_settings.ghl_field_map → 回源 GET /locations/{id}/customFields
 * 回源后 upsert 进 app_settings —— 这样「刷新对所有实例生效」才成立(纯内存缓存做不到)。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseFieldMap, type FieldMap } from './ghlVerify.ts';

const SETTINGS_KEY = 'ghl_field_map';
const TTL_MS = 10 * 60 * 1000;

let cache: { map: FieldMap; atMs: number } | null = null;

/**
 * 拿 key→id 映射。force=true 跳过缓存与 app_settings,强制回源(Admin「刷新字段映射」用)。
 * 回源失败会抛 —— 调用方(syncToGhl)据此判为 TRANSIENT:拿不到映射就无法验证,
 * 不能因此就把 synced 标成 true。
 */
export async function getFieldMap(
  supa: SupabaseClient,
  /**
   * `nowMs` **只为可测**:TTL 是一个跟时间有关的分支,而不注入时钟就只能靠
   * 真的等 10 分钟(或者去 stub 全局 `Date.now`,那会影响同一进程里别的用例)。
   * 与 `lambdaEnv.fontDir` 那次同一个手法 —— 默认值保持生产行为不变。
   */
  opts: { force?: boolean; nowMs?: number } = {},
): Promise<FieldMap> {
  const now = opts.nowMs ?? Date.now();
  if (!opts.force && cache && now - cache.atMs < TTL_MS) return cache.map;

  if (!opts.force) {
    const { data, error } = await supa
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle();
    if (error) throw new Error(`app_settings read failed: ${error.message}`);
    if (data?.value && typeof data.value === 'object') {
      cache = { map: data.value as FieldMap, atMs: now };
      return cache.map;
    }
  }

  // 回源
  const map = await fetchFromGhl();
  const { error: upErr } = await supa
    .from('app_settings')
    .upsert({ key: SETTINGS_KEY, value: map, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (upErr) console.error(`app_settings upsert failed: ${upErr.message}`);
  cache = { map, atMs: now };
  return map;
}

async function fetchFromGhl(): Promise<FieldMap> {
  const token = Deno.env.get('GHL_PRIVATE_TOKEN');
  const locationId = Deno.env.get('GHL_LOCATION_ID');
  if (!token || !locationId) throw new Error('GHL credentials missing for field-map fetch');

  const url = `https://services.leadconnectorhq.com/locations/${locationId}/customFields`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`GHL customFields fetch ${res.status}: ${text.slice(0, 400)}`);

  /**
   * 【完整记原始响应 —— 这是我唯一没实测过形状的 GHL 调用】按文档假设
   * `{ customFields: [{ id, fieldKey }] }`。响应是字段【定义】(id / key / 类型),
   * 不含任何客户 PII,所以可以安全全量记。第一次回源就能确认解析对不对。
   */
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`GHL customFields response is not JSON: ${text.slice(0, 400)}`);
  }
  const map = parseFieldMap(raw);
  console.log(
    `GHL field-map fetched: parsed ${Object.keys(map).length} keys ${JSON.stringify(Object.keys(map))}.\n` +
      `RAW customFields response (no PII — field definitions):\n${text.slice(0, 4000)}`,
  );
  return map;
}

/**
 * 供测试重置内存缓存。
 *
 * 【这个函数曾经是一个「为不存在的测试准备的钩子」】入口审计那一轮发现:
 * 它的注释写着「供测试」,而 `ghlFieldMap` **根本没有测试文件** ——
 * 于是那句注释在替一份不存在的覆盖作证。补了 `ghlFieldMap_test.ts` 之后
 * 它才真的有服务对象(判断标准 18:名字听起来是入口但没人引用;
 * 这一处的处理是**补上被服务的对象**,不是删掉服务者)。
 */
export function _resetFieldMapCache(): void {
  cache = null;
}
