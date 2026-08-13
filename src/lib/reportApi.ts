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
  /**
   * 每种语言一份文件。**总是包含全部语言**,没有的那种 availability 是 `absent` ——
   * 「生成英文版」这个按钮该不该出现,取决于**另一种语言**的状态,
   * 所以前端必须看得到全部,而不是只看当前那份。
   */
  files: {
    lang: 'zh' | 'en';
    availability: 'ready' | 'working' | 'failed' | 'exhausted' | 'absent';
    url: string | null;
    cardUrl: string | null;
    cardTallUrl: string | null;
  }[];
  /** ⚠️ 兼容投影,从 `files` 派生 —— 不是第二个来源。等一个版本之后删 */
  pdfStatus: string;
  /** ready 时服务端现签的 signed URL(1 小时);其余为 null */
  pdfUrl: string | null;
  /**
   * 分享卡的 signed URL,两个尺寸各一条,没出来就是 null。
   *
   * 【刻意不跟 pdfStatus 挂钩】分享卡是附属品的附属品:PDF 失败不该把已经存在的
   * 分享卡一起藏掉。整块渲不渲只看这两条是不是 null。
   */
  cardUrl: string | null;
  cardTallUrl: string | null;
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

/**
 * 只取 PDF 状态与新签的 URL —— 轮询用,不重复搬整份报告数据。
 * 走同一个端点(它每次都现签),所以「URL 过期」这件事不存在:点击那一刻才取。
 */
export async function fetchPdfState(): Promise<{ pdfStatus: string; pdfUrl: string | null }> {
  const d = await fetchReport();
  return { pdfStatus: d.pdfStatus, pdfUrl: d.pdfUrl };
}

/**
 * 请求生成某种语言的报告文件 —— POST /api/assessment-report-file,cookie 鉴权。
 *
 * 【幂等在服务端】已经 ready 就直接回 ready(不重渲),正在渲就回 working。
 * 所以前端不需要自己记「我点过了吗」—— 那种本地状态一刷新就丢,
 * 而丢了之后人会再点一次,于是又是一次 Lambda。
 */
export async function requestReportFile(lang: 'zh' | 'en'): Promise<{ status: string }> {
  const res = await fetch('/api/assessment-report-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  });
  // 403 = 已停用(revoked),401 = 没登录 —— 与答题 / 报告取数同一套跳转
  if (res.status === 401) throw new QuizAuthError('unauthorized');
  if (res.status === 403) throw new QuizAuthError('revoked');
  const body = (await res.json().catch(() => null)) as { status?: string } | null;
  return { status: body?.status ?? 'failed' };
}
