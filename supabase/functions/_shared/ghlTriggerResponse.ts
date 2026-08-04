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
 * 【这个信号能证明什么、不能证明什么】
 *   ✅ 能证明:对面有一个 workflow 接住了这次请求,进了执行队列
 *   ❌ 不能证明:消息真的送达。workflow 可能是 Draft、可能中途某个 action 报错、
 *      可能 contact 没有可用的手机号
 *
 * 要闭环到「送达」只有一条路:让 workflow 发完之后回调我们一个端点。
 * 那是新功能,目前没建。所以这里的定位很明确——
 * 检测的是「trigger 存在」,不是「消息送达」。
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
