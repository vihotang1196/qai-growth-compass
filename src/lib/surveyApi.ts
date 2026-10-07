import { QuizAuthError } from '@/lib/quizApi';
import { guardErrorOf, SessionGuardError } from '@/lib/sessionFlow';

/**
 * 问卷提交与计分 —— 走 `/api/assessment-score`,身份靠 httpOnly cookie。
 *
 * 【复用 QuizAuthError】401 / 403 的处理与答题页完全一样(都跳 /expired),
 * 定义两个错误类型只会让两个页面的处理逻辑分叉。
 */
export interface ScoreResultPayload {
  dimensions: Record<string, number>;
  total: number;
  tier: string;
  weakest: [string, string];
  strongest: [string, string];
}

export interface FinalizeResponse {
  ok: boolean;
  result: ScoreResultPayload;
  writeback: { attempted: boolean; ok: boolean; detail?: string };
}

/** 服务端按题校验后回的具体原因 —— 前端据此指到具体那一题 */
export class SurveyValidationError extends Error {
  constructor(
    readonly questionId: string | null,
    readonly code: string,
    readonly max?: number,
  ) {
    super(code);
  }
}

async function post<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/assessment-score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action, ...args }),
  });

  if (res.status === 401) throw new QuizAuthError('unauthorized');
  if (res.status === 403) throw new QuizAuthError('revoked');

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`non-JSON response from score (${res.status})`);
  }

  if (!res.ok) {
    // 写入守卫的两种 409 先认出来 —— 它们不是「问卷没填好」,不能落进下面的校验分支
    const guard = guardErrorOf(res.status, parsed);
    if (guard) throw new SessionGuardError(guard);
    const body = parsed as { error?: string; id?: string; max?: number } | null;
    // 400 是逐题校验失败,带 id;409 是流程状态不对(没答满 / 没交问卷)
    if (res.status === 400 || res.status === 409) {
      throw new SurveyValidationError(body?.id ?? null, body?.error ?? 'invalid', body?.max);
    }
    throw new Error(body?.error ?? `score failed (${res.status})`);
  }
  return parsed as T;
}

export const surveyApi = {
  /** 存问卷。responses 的键是题 id,值是下标 / 下标数组 / 文本 */
  save: (responses: Record<string, number | number[] | string>, sessionId: string) =>
    post<{ ok: boolean }>('survey', { responses, session_id: sessionId }),
  /** 算分并写结果。必须在 save 之后调 */
  finalize: (sessionId: string) => post<FinalizeResponse>('finalize', { session_id: sessionId }),
};
