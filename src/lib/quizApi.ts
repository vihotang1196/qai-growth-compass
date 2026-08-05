/**
 * 答题接口 —— 走 `/api/assessment-quiz`,身份靠 httpOnly cookie(浏览器自动带)。
 *
 * 【为什么每个响应都是完整快照】客户端据它重算「下一题是哪一题」。
 * 只回增量的话,一次响应丢失(移动网络下很常见)就会让客户端的已答集合与库里不一致,
 * 表现是「答过的题又出现一次」或者「跳过了一题」—— 后者正是我们花力气防的静默错误。
 */
export interface QuizSnapshot {
  locale: 'zh' | 'en';
  /** 背景题:id → 选项下标 */
  profile: Record<string, number>;
  /** 测评题:id → 选项下标 */
  answers: Record<string, number>;
  status: 'in_progress' | 'survey' | 'completed';
  complete: boolean;
}

export class QuizAuthError extends Error {
  constructor(readonly kind: 'unauthorized' | 'revoked') {
    super(kind);
  }
}

async function post<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
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
    throw new Error((parsed as { error?: string } | null)?.error ?? `quiz failed (${res.status})`);
  }
  return parsed as T;
}

export const quizApi = {
  bootstrap: () => post<QuizSnapshot>('bootstrap'),
  saveProfile: (id: string, optionIndex: number) =>
    post<QuizSnapshot>('profile', { answers: { [id]: optionIndex } }),
  saveAnswer: (questionId: string, optionIndex: number) =>
    post<QuizSnapshot>('answer', { question_id: questionId, option_index: optionIndex }),
};
