/**
 * 判读 GHL Inbound Webhook trigger 的响应。
 *
 * 【为什么需要判读响应体,而不是只看状态码】实测:
 *
 *   假 trigger(UUID 不存在)
 *     200 {"status":"Success: test request received"}
 *
 *   真 trigger
 *     200 {"status":"Success: request sent to trigger execution server",
 *          "id":"jgQ3xUHIHauEHadGtRmM"}
 *
 * 状态码都是 200。差别在响应体:真 trigger 带一个 `id`。
 * 所以「GHL_RESEND_WEBHOOK_URL 过期了」这个失败形态**是可检测的**——
 * 而它很容易发生:在 GHL 里删掉重建 trigger 就会换 UUID。
 *
 * 【为什么判据用 id 有无,而不是匹配 status 文案】
 * 文案是 GHL 的实现细节,随时可能改;`id` 有无是行为差异(进没进执行队列),
 * 更稳。匹配文案的检测会在 GHL 改一个字之后静默失效,而那种失效没人会发现。
 *
 * 【这个信号能证明什么、不能证明什么 —— 比第一版以为的弱一点】
 *
 * 有 id  → trigger 存在 **且** workflow 已 Publish。两者合一,分不开。
 * 无 id  → 两种可能:trigger 不存在 / UUID 变了,**或者 workflow 还是 Draft**。
 *          Draft 状态下 GHL 回的响应体与假 trigger 完全相同,
 *          所以这个检测无法单独证明「trigger 有效」。
 *
 * 排查顺序:**先确认 workflow 状态,再怀疑 URL。** Draft 是开发期的常态,
 * UUID 变了是罕见事件 —— 先查常见的那个。
 *
 * ❌ 仍然不能证明:消息真的送达。即使进了执行队列,中途某个 action 可能报错、
 *    contact 可能没有可用的手机号。要闭环到「送达」只有让 workflow 发完之后
 *    回调我们一个端点,那是新功能,目前没建。
 *
 * 对生产用途够用:线上 workflow 必然是 Publish 的,无 id 就是真出事了。
 * 但别让人以为它能单独证明 trigger 有效 —— 那是它做不到的。
 */

/** 响应体是否表明请求进了 trigger 的执行队列 */
export function triggerAccepted(bodyText: string): boolean {
  if (!bodyText) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const id = (parsed as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0;
}
