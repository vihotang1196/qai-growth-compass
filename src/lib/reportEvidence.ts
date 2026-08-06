/**
 * 「你选的是什么 / 顶格是什么」—— 报告里那条前后对比的取数逻辑。纯函数,单独测。
 *
 * 【为什么这是报告里最有说服力的一块】分数是我们判的,选项是客户自己填的。
 * 「造流量 2.8」不解释就没人认同;「你选的是『集中在单一渠道』,顶格是『三条腿都在跑』」
 * 不需要解释 —— 差距是他自己看出来的。所以这里不造任何文案,只从 config 取他选的那句
 * 和顶格那句。
 */

export interface QuestionLike {
  id: string;
  option_count: number;
  zh: { q: string; options: string[] };
  en: { q: string; options: string[] };
}

export interface EvidencePair {
  questionId: string;
  /** 客户选的那句 */
  current: string;
  /** 顶格那句(option_count - 1) */
  target: string;
  /** 已经顶格 —— 此时不该渲染成「现在 → 目标」,那会像在说他还没做到 */
  atTarget: boolean;
}

/**
 * 取某题的「现在 → 目标」。
 * @param optionIndex 客户选的下标;越界或缺失返回 null(调用方据此不渲染这一行,不编内容)
 */
export function evidencePair(
  question: QuestionLike | undefined,
  optionIndex: number | undefined,
  locale: 'zh' | 'en',
): EvidencePair | null {
  if (!question || optionIndex === undefined) return null;
  const opts = locale === 'en' ? question.en.options : question.zh.options;
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= opts.length) return null;
  const topIndex = opts.length - 1;
  return {
    questionId: question.id,
    current: opts[optionIndex],
    target: opts[topIndex],
    atTarget: optionIndex === topIndex,
  };
}

/**
 * 行动清单那条对比:按 action.related_question 找题。
 * related_question 为 null(没有合适对应)时返回 null —— 不为了统一而编一个对比。
 */
export function actionEvidence(
  relatedQuestion: string | null | undefined,
  questions: readonly QuestionLike[],
  answersByQuestion: Record<string, number>,
  locale: 'zh' | 'en',
): EvidencePair | null {
  if (!relatedQuestion) return null;
  const q = questions.find((x) => x.id === relatedQuestion);
  return evidencePair(q, answersByQuestion[relatedQuestion], locale);
}
