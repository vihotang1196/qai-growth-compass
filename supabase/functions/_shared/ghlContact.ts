/**
 * **所有 contact 级 GHL 调用的唯一出口。**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要有这个模块:这个项目第一次遇到「绕过它的方式是什么都不做」】
 *
 * 前面所有收口都是**翻转默认**:`PublicShell` 让新路由默认不带全局 chrome、
 * 批次范围做成必填参数让「混了测试数据的数字」不可表示。
 * 那些的共同点是:**新代码要主动做点什么才会出错。**
 *
 * 而测试批次那道收口原本装在 `syncToGhl` 里,并且注释里写着
 * 「将来 Stage 11 的 tags 一写出来就自动被覆盖」—— 那句话从来不成立:
 * `syncToGhl` 是字段写回专用,标签必然是另一条出站路径。
 * **新写一条出站路径,什么都不做就绕过了收口。默认值站错了边,而且站错的方式是缺席。**
 *
 * 所以收口从「函数级」挪到「传输级」:测试批次判断在这里,
 * 而 `check:ghl-transport` 那道门禁止别处出现 GHL 的域名 ——
 * **函数只是给人一条正确的路,门才是让错的路走不通。**
 *
 * 【PUT 带 tags 数组是不可逆的错误,所以在这里硬拦】
 * GHL 的 contact PUT 接受 `tags` 数组,而那是**整体替换**:
 * 一次请求就能抹掉客户在 GHL 里其它所有标签,而那些标签是他们业务流程在用的。
 * 症状要等某条 workflow 不再触发才会被发现,而那时已经没有东西可以还原。
 * 标签只能走 `POST` / `DELETE /contacts/{id}/tags`(增量),
 * 所以这里对「PUT 的 body 里带 tags」直接抛 —— 它不该到得了网络。
 * (方法联合里没有 PATCH;原本这句写着 PUT/PATCH,而代码只处理 PUT —— 又一次注释比代码多说了一点。)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isTestSessionCohort } from './testCohort.ts';

/** GHL 的 API 主机。**这个字面量只允许出现在本文件**(check:ghl-transport 守它) */
export const GHL_API_HOST = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export type ContactRequestSkip =
  | { skipped: 'test_cohort' }
  | { skipped: 'missing_credentials'; missing: string[] };

export interface ContactRequestSent {
  sent: true;
  status: number;
  ok: boolean;
  text: string;
}

export type ContactRequestResult = ContactRequestSent | (ContactRequestSkip & { sent: false });

/**
 * 对某个 contact 发一次 GHL 请求。
 *
 * @param sessionId 用来判「这是不是测试批次」——**必填,没有默认值**。
 *   一个可选的 sessionId 会让「忘了传」变成「跳过检查」,而那正是这道收口要防的形状。
 * @param path      contact 之后的路径,如 `''`(contact 本身)或 `'/tags'`
 */
export async function ghlContactRequest(
  supa: SupabaseClient,
  sessionId: string,
  contactId: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: Record<string, unknown> },
): Promise<ContactRequestResult> {
  /**
   * ── 不可逆错误:PUT 带 tags ──
   * 抛而不是返回错误 —— 这是**代码写错了**,不是运行时状况。
   * 运行时状况要分类、要重试;代码写错了要在第一次跑到时就炸掉。
   */
  if (init.method === 'PUT' && init.body && 'tags' in init.body) {
    /**
     * 【只拦 PUT,不拦 DELETE】`DELETE /contacts/{id}/tags` 带 `{ tags: [...] }`
     * 正是**合法的增量移除**。第一版我把 DELETE 也括进了外层条件、再在里面筛一次 PUT ——
     * 那留下一段什么都不做的结构,读的人会以为 DELETE 也被限制着。
     */
    throw new Error(
      'refusing to PUT a contact with a `tags` array: GHL replaces ALL tags on the contact, ' +
        'wiping tags this system never created. Use POST/DELETE /contacts/{id}/tags instead.',
    );
  }

  // ── 测试 / 演示批次一律不外发 ──
  // 收在这里而不是各功能里:新增一条出站路径时,绕过它需要**自己写一个 fetch**,
  // 而那是个显式动作,不是一次遗忘
  if (await isTestSessionCohort(supa, sessionId)) {
    return { sent: false, skipped: 'test_cohort' };
  }

  const token = Deno.env.get('GHL_PRIVATE_TOKEN');
  const locationId = Deno.env.get('GHL_LOCATION_ID');
  const missing: string[] = [];
  if (!token) missing.push('GHL_PRIVATE_TOKEN');
  if (!locationId) missing.push('GHL_LOCATION_ID');
  if (missing.length) return { sent: false, skipped: 'missing_credentials', missing };

  const res = await fetch(`${GHL_API_HOST}/contacts/${contactId}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Version: GHL_API_VERSION,
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text().catch(() => '');
  return { sent: true, status: res.status, ok: res.ok, text };
}
