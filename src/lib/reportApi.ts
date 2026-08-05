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
  /** 询盘量 / 客单价,由 profile 经 value_map 解析;缺失为 null(代价换算据此隐藏) */
  leadsPerMonth: number | null;
  dealValue: number | null;
  survey: Record<string, unknown>;
  baseline: { source: 'cohort' | 'global'; n: number; means: Record<string, number> };
  cohort: {
    standing: { band: 'top25' | 'q25_50' | 'q50_75' | 'bottom25'; percentile: number; sameTierOthers: number };
    diffs: Record<string, number>;
  } | null;
  pdfStatus: string;
}

/** 报告还没算出来(还没走完 finalize)—— 与鉴权失败区分开 */
export class ReportNotReadyError extends Error {
  constructor() {
    super('not_ready');
  }
}

export async function fetchReport(): Promise<ReportPayload> {
  const res = await fetch('/api/assessment-report', {
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
