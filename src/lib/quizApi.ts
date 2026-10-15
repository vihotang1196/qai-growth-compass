/**
 * 答题接口 —— 走 `/api/assessment-quiz`,身份靠 httpOnly cookie(浏览器自动带)。
 *
 * 【为什么每个响应都是完整快照】客户端据它重算「下一题是哪一题」。
 * 只回增量的话,一次响应丢失(移动网络下很常见)就会让客户端的已答集合与库里不一致,
 * 表现是「答过的题又出现一次」或者「跳过了一题」—— 后者正是我们花力气防的静默错误。
 */
import { guardErrorOf, SessionGuardError } from '@/lib/sessionFlow';

export interface QuizSnapshot {
  locale: 'zh' | 'en';
  /** 背景题:id → 选项下标 */
  profile: Record<string, number>;
  /** 测评题:id → 选项下标 */
  answers: Record<string, number>;
  status: 'in_progress' | 'survey' | 'completed';
  complete: boolean;
  /** cookie 当前所属的 session。之后每次写入都带上它 —— 见 api/_lib/sessionGuard.ts */
  sessionId: string;
  /** 这是第几份(bootstrap / start_retake 才有;重填第 2 步起) */
  attemptNo?: number;
  /** 第 2 份及以后、没做完时:上一次的背景题与问卷 —— 页面的初始值,不是已答(_shared/retake.ts 的 retakePrefill) */
  prefill?: RetakePrefill | null;
}

export interface RetakePrefill {
  fromAttempt: number;
  profile: Record<string, number>;
  survey: Record<string, unknown>;
}

export class QuizAuthError extends Error {
  constructor(readonly kind: 'unauthorized' | 'revoked') {
    super(kind);
  }
}

/** start_retake / abandon_retake 被服务端拒绝(409):原因 + `too_soon` 时下一次可以重填的时间 */
export class RetakeRefusedError extends Error {
  constructor(
    readonly reason: string,
    readonly nextAllowedAt: string | null = null,
  ) {
    super(reason);
  }
}

/**
 * `retake`:start_retake / abandon_retake 的 409 是「被拒 + 原因」(too_soon 还带下一次的时间),
 * 不是写入守卫、也不是普通失败 —— 抛 `RetakeRefusedError`,原因与时间都留着,页面据此说明为什么不能重填。
 * 别的 action 的 409 照旧(守卫两种 → SessionGuardError,其余 → 以错误码为 message 的 Error)。
 */
async function post<T>(action: string, args: Record<string, unknown> = {}, opts: { retake?: boolean } = {}): Promise<T> {
  const res = await fetch('/api/assessment-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // cookie 是 httpOnly + SameSite,同源请求浏览器自动带;credentials 显式写出来
    // 是为了让「这个请求依赖 cookie」这件事在代码里看得见
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
    throw new Error(`non-JSON response from quiz (${res.status})`);
  }
  if (!res.ok) {
    if (opts.retake && res.status === 409) {
      const body = parsed as { error?: string; nextAllowedAt?: string } | null;
      throw new RetakeRefusedError(body?.error ?? 'refused', body?.nextAllowedAt ?? null);
    }
    const guard = guardErrorOf(res.status, parsed);
    if (guard) throw new SessionGuardError(guard);
    throw new Error((parsed as { error?: string } | null)?.error ?? `quiz failed (${res.status})`);
  }
  return parsed as T;
}

export const quizApi = {
  bootstrap: () => post<QuizSnapshot>('bootstrap'),
  /** 开始一次重填(只认 cookie,不带 session id)→ 新那一份的快照(含 attemptNo 与 prefill) */
  startRetake: () => post<QuizSnapshot>('start_retake', {}, { retake: true }),
  /** 放弃没做完的那份重填(服务端删掉它) */
  abandonRetake: () => post<{ ok: true; abandonedAttemptNo: number }>('abandon_retake', {}, { retake: true }),
  saveProfile: (id: string, optionIndex: number, sessionId: string) =>
    post<QuizSnapshot>('profile', { answers: { [id]: optionIndex }, session_id: sessionId }),
  /** 一次存几道背景题(服务端合并,不覆盖)—— 重填时学员沿用的预填值,在「提交」那一下存进这一份 */
  saveProfiles: (answers: Record<string, number>, sessionId: string) =>
    post<QuizSnapshot>('profile', { answers, session_id: sessionId }),
  saveAnswer: (questionId: string, optionIndex: number, sessionId: string) =>
    post<QuizSnapshot>('answer', { question_id: questionId, option_index: optionIndex, session_id: sessionId }),
};
