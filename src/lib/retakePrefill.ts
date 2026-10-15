import type { QuizSnapshot, RetakePrefill } from '@/lib/quizApi';

/**
 * 重填时答题页 / 问卷页的初始值(Viho 的第 3 个决定,docs/retake-design.md):
 * 背景题与问卷**预填上一次的回答**,可以直接沿用或修改;15 道正式题从空白开始。
 *
 * 【预填只是初始值】服务端不把它写进新的一份(_shared/retake.ts 的 retakePrefill)。学员要像第一次一样提交才算答了:
 *   - 答题页:沿用的那几道背景题,在点「提交」的那一下存进这一份(`prefillToSave`)—— 不提交就没有;
 *   - 问卷页:本来就是攒完一次提交,预填只是表单的起点。
 * 不在打开页面时替学员存:那是「沿用上次」的隐式复制,正是那个决定要排除的。
 */

export type SurveyAnswer = number | number[] | string;

export interface SurveyQuestionShape {
  id: string;
  type: string;
  zh: { options?: string[] };
}

/**
 * 答题页的初始答案:这一份已经存的(背景题 + 正式题)盖在预填的背景题上面。
 * `prefilled` = 只来自预填、这一份还没存的那几道背景题 —— 页面据此标「上次的选择」,提交时替学员存。
 * 预填里只认背景题的题号(正式题一道都不从预填来,哪怕它混进来了)。
 */
export function quizInitial(
  snapshot: Pick<QuizSnapshot, 'profile' | 'answers' | 'prefill'>,
  profileIds: readonly string[],
): { answers: Record<string, number>; prefilled: string[] } {
  const saved = { ...snapshot.profile, ...snapshot.answers };
  const fromPrefill: Record<string, number> = {};
  for (const id of profileIds) {
    const v = snapshot.prefill?.profile?.[id];
    if (typeof v === 'number' && !(id in saved)) fromPrefill[id] = v;
  }
  return { answers: { ...fromPrefill, ...saved }, prefilled: Object.keys(fromPrefill) };
}

/**
 * 「提交」时要替学员存的背景题:还标着「上次的选择」(没重新点过)、而且还没有任何保存在路上或存好的。
 * 重新点过的那一题走的是平常的逐题保存,页面会把它从 `prefilled` 里拿掉。
 */
export function prefillToSave(
  prefilled: ReadonlySet<string>,
  answers: Readonly<Record<string, number>>,
  saveState: Readonly<Record<string, string | undefined>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of prefilled) {
    if (saveState[id] !== undefined) continue;
    if (typeof answers[id] === 'number') out[id] = answers[id];
  }
  return out;
}

const isIndex = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;

/**
 * 问卷页的初始答案。服务端已经按现在的题目换成了下标(对不上的整题不给);这里再按题型与选项数过一遍 ——
 * 形状不对的那一题留空让学员重选,不猜。
 */
export function surveyInitial(
  prefill: RetakePrefill | null | undefined,
  questions: readonly SurveyQuestionShape[],
): Record<string, SurveyAnswer> {
  const out: Record<string, SurveyAnswer> = {};
  if (!prefill) return out;
  for (const q of questions) {
    const v = prefill.survey?.[q.id];
    const n = q.zh.options?.length ?? 0;
    if (q.type === 'single_select' && isIndex(v, n)) out[q.id] = v as number;
    else if (q.type === 'multi_select' && Array.isArray(v) && v.every((i) => isIndex(i, n))) out[q.id] = [...(v as number[])];
    else if (q.type === 'open_text' && typeof v === 'string') out[q.id] = v;
  }
  return out;
}
