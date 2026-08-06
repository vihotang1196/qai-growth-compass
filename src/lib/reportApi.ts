import { QuizAuthError } from '@/lib/quizApi';

/**
 * 报告取数 —— GET /api/assessment-report,cookie 鉴权。
 * 401/403 复用 QuizAuthError(与答题/问卷一致,都跳 /expired)。
 */
export interface ReportPayload {
  locale: 'zh' | 'en';
  result: {
    dimensions: Record<string, number>;
    total: number;
    tier: string;
    weakest: [string, string];
    strongest: [string, string];
  };
  /** 维度 key → 3 个子模块的归一化分(submodule_index 0/1/2),缺答为 null */
  submodules: Record<string, (number | null)[]>;
  /** 与 submodules 同位:那一格对应的题号 + 客户选的下标(用来展示「你选的是…」) */
  evidence: Record<string, ({ questionId: string; optionIndex: number } | null)[]>;
  /** 题号 → 客户选的下标。行动清单按 related_question 查这张表做「现在 → 目标」 */
  answersByQuestion: Record<string, number>;
  /** 询盘量 / 客单价,由 profile 经 value_map 解析;缺失为 null(代价换算据此隐藏) */
  leadsPerMonth: number | null;
  dealValue: number | null;
  survey: Record<string, unknown>;
  baseline: { source: 'cohort' | 'global'; n: number; means: Record<string, number> };
  cohort: {
    standing: { band: 'top25' | 'q25_50' | 'q50_75' | 'bottom25'; percentile: number; sameTierOthers: number };
    diffs: Record<string, number>;
  } | null;
  /** 诊断:本人是否在基准样本池里 + 本人 session 的实际状态 */
  diagnostics?: { baselineIncludesSelf: boolean; sessionStatus: string };
  pdfStatus: string;
}

/** 报告还没算出来(还没走完 finalize)—— 与鉴权失败区分开 */
export class ReportNotReadyError extends Error {
  constructor() {
    super('not_ready');
  }
}

export async function fetchReport(): Promise<ReportPayload> {
  /**
   * PDF 渲染器打开报告页时带 ?rt=<渲染令牌>(它没有 cookie)。原样透传给 API ——
   * 令牌用另一个密钥、只活几分钟,不能当登录态用,见 lib/renderToken.ts。
   */
  const rt = new URLSearchParams(window.location.search).get('rt');
  const url = rt ? `/api/assessment-report?rt=${encodeURIComponent(rt)}` : '/api/assessment-report';
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (res.status === 401) throw new QuizAuthError('unauthorized');
  if (res.status === 403) throw new QuizAuthError('revoked');
  if (res.status === 404) throw new ReportNotReadyError();

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`non-JSON response from report (${res.status})`);
  }
  if (!res.ok) {
    throw new Error((parsed as { error?: string } | null)?.error ?? `report failed (${res.status})`);
  }
  return parsed as ReportPayload;
}
