/**
 * 语言的**唯一真相源判定** —— 纯函数,没有 IO。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【语言跟着人走,不跟着链接走】存在 `assessment_entitlements.lang` 上。
 *
 * 跟着链接走的失败形态是具体的:**报告页英文、PDF 中文**。
 * 因为 PDF 是**异步渲染**的 —— 渲染那一刻没有「他当时点的是哪条链接」这个信息,
 * 只能猜一个默认值。分享卡同理(它也是离线截图),GHL 消息更是。
 * 存在人身上之后,magic link / 报告页 / PDF / 分享卡 / GHL 消息全部读同一处,
 * **不可能分叉**。
 *
 * 【`?lang=` 的语义是「设置」,不是「覆盖」】读到就写库,然后按库里的值渲染。
 * 这样 GHL 那边发链接时可以带 `?lang=en` 来初始化,而不用先调一次 API。
 * 而「覆盖」的语义会把语言变回跟着链接走 —— 同一个人在不同时刻走出不同语言,
 * 于是异步渲染那一刻又没有依据了。
 *
 * 【所以「切换语言」是一个持久动作】学员在任何一处切换,都写回那一列;
 * 他下次点链接、下次收到消息、PDF 重渲,都跟着变。
 * 这不是显示偏好,是这个人的属性。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 顺序即优先级无关;第一个是默认值 */
export const LANGS = ['zh', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** 默认语言。**只在这里写一次** —— 散在各处的 `'zh'` 字面量迟早有一处漏改 */
export const DEFAULT_LANG: Lang = LANGS[0];

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/**
 * 解析一个外部来的语言值。
 *
 * 三态,**刻意不合并**:
 *   - `{ kind: 'absent' }`  没给 —— 用库里的值(或默认)
 *   - `{ kind: 'set', lang }` 给了合法值 —— 写库
 *   - `{ kind: 'invalid', received }` 给了但不合法 —— **由调用方决定怎么办**
 *
 * 【为什么不在这里就回落成默认】「没给」与「给了个拼错的」是两件不同的事:
 * 前者是正常路径,后者说明**上游配错了**。
 * 合并成一个「回落到 zh」会让后者变成静默 —— 而它的症状是
 * 「英文客户收到中文链接」,那要等客户投诉才知道。
 * 所以这里只做判定,处置留给各个入口(它们的代价不一样:
 * webhook 是付款入口,阻塞它的代价比一次语言错大得多)。
 */
export type LangParse =
  | { kind: 'absent' }
  | { kind: 'set'; lang: Lang }
  | { kind: 'invalid'; received: string };

export function parseLang(raw: unknown): LangParse {
  if (raw === undefined || raw === null) return { kind: 'absent' };
  if (typeof raw === 'string' && raw.trim() === '') return { kind: 'absent' };
  if (isLang(raw)) return { kind: 'set', lang: raw };
  return { kind: 'invalid', received: typeof raw === 'string' ? raw : JSON.stringify(raw) };
}

/**
 * 定下这一次渲染 / 发送用哪个语言。
 *
 * @param stored   `entitlement.lang`(库里的那一列)
 * @param incoming 这次请求带来的 `?lang=` 解析结果
 *
 * 【`invalid` 一律按 `absent` 处理 —— 不是无视它,是不让它改库】
 * 一个拼错的 `?lang=xx` 不该把这个人的语言改成别的东西,也不该让页面打不开。
 * **但调用方必须把 invalid 记出来**(日志 / warning),否则它就是静默的。
 */
export function effectiveLang(stored: unknown, incoming: LangParse = { kind: 'absent' }): Lang {
  if (incoming.kind === 'set') return incoming.lang;
  return isLang(stored) ? stored : DEFAULT_LANG;
}

/**
 * 这次请求要不要把语言写回库里。
 *
 * 【只有「合法且与库里不同」才写】
 * 每次都写会让每一次页面打开都产生一次写库 —— 而那一列的更新时间以后可能被当成
 * 「这个人最近有动作」来读(`updated_at` 那个 trigger 就装在这张表上)。
 */
export function shouldPersistLang(stored: unknown, incoming: LangParse): Lang | null {
  if (incoming.kind !== 'set') return null;
  return isLang(stored) && stored === incoming.lang ? null : incoming.lang;
}
