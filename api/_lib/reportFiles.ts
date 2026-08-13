/**
 * 报告文件的状态判定 —— **纯函数,没有 IO**。取数在各调用方。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【每个 (session, 语言) 一份】`assessment_report_files` 的主键就是这两列。
 *
 * 为什么不是「一份 PDF + 一个 pdf_lang 列 + 重渲覆盖」:那样一个人切五次语言就渲五次,
 * 而且永远如此 —— 于是要给一个正当动作加限流,而**限流是在管理一个不该存在的问题**。
 * 按语言分行之后,切回去直接给已有那一份,每种语言一生只渲一次。
 *
 * 【这个模块回答四个问题,每个都有一处 UI 或一条查询依赖它】
 *   1. 当前语言那份能不能直接下载        → 报告页的下载按钮
 *   2. 哪些语言还没有 / 失败了            → 「生成英文版」那个显式动作
 *   3. 每种语言各自什么状态               → Roster 那一格(zh ✓ / en —)
 *   4. sweep 该不该重渲某一份             → 复用 pdfState 的判定,按 (session, lang) 逐份判
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { LANGS, type Lang } from './lang.js';
import { MAX_PDF_ATTEMPTS } from './pdfState.js';

export type PdfStatus = 'pending' | 'rendering' | 'ready' | 'failed' | 'failed_permanent';

export interface ReportFileRow {
  lang: string;
  pdf_status: string;
  pdf_path?: string | null;
  pdf_attempts?: number | null;
  pdf_last_error?: string | null;
  pdf_status_at?: string | null;
  share_card_error?: string | null;
}

/** 一种语言的对外状态 —— UI 只认这四个,不认库里那五个 */
export type LangAvailability =
  /** 有文件,可以直接下载 */
  | 'ready'
  /** 正在渲(pending / rendering)—— 按钮该转圈而不是让人再点一次 */
  | 'working'
  /** 试过但失败了,还有重试预算 */
  | 'failed'
  /** 失败到上限,或被标死 —— 需要人干预 */
  | 'exhausted'
  /** 从来没请求过这种语言 */
  | 'absent';

/**
 * 把库里那五个状态压成 UI 要的四个 + 「没有这一行」。
 *
 * 【为什么要压】库里的 `pending` 与 `rendering` 对使用者是同一件事(等着),
 * 而 `failed` 与 `failed_permanent` 的差别只有一处 UI 需要知道(还能不能点重试)。
 * 让 UI 直接读库里的字符串,五个值 × 两种语言 × 三处界面 = 三十种组合要各自记得,
 * 而其中大部分组合根本没有区别。
 */
export function availabilityOf(row: ReportFileRow | undefined | null): LangAvailability {
  if (!row) return 'absent';
  const attempts = row.pdf_attempts ?? 0;
  switch (row.pdf_status) {
    case 'ready':
      // 【状态 ready 但没有路径 = 不能下载】这不是理论情况:上传成功之后写库
      // 那一步失败过一次,那时状态与文件会不一致。以「有没有文件」为准
      return row.pdf_path ? 'ready' : 'failed';
    case 'pending':
    case 'rendering':
      return 'working';
    case 'failed_permanent':
      return 'exhausted';
    case 'failed':
      return attempts >= MAX_PDF_ATTEMPTS ? 'exhausted' : 'failed';
    default:
      // 认不出的状态按「需要人看」处理,不按「可以下载」处理
      return 'exhausted';
  }
}

export interface LangState {
  lang: Lang;
  availability: LangAvailability;
  path: string | null;
  lastError: string | null;
}

/**
 * 每种语言各自的状态 —— **总是返回全部语言**,没有行的那种是 `absent`。
 *
 * 【为什么不只返回已有的行】Roster 要显示「zh ✓ / en —」,而「—」这一格
 * 恰恰来自没有行的那种语言。只返回已有行的话,调用方得自己去补全缺的那些,
 * 而那份补全逻辑会散在三处 UI 里(判断标准 3)。
 */
export function langStates(rows: readonly ReportFileRow[]): LangState[] {
  const byLang = new Map<string, ReportFileRow>();
  for (const r of rows) byLang.set(r.lang, r);
  return LANGS.map((lang) => {
    const row = byLang.get(lang);
    return {
      lang,
      availability: availabilityOf(row),
      path: row?.pdf_path ?? null,
      lastError: row?.pdf_last_error ?? null,
    };
  });
}

/**
 * 这个人现在能不能直接下载他当前语言那一份。
 *
 * 【为什么单独一个函数而不是让 UI 自己找】报告页要的判断是
 * 「**当前语言**那份能不能给」,而它错的方式是安静的:找错了语言就把另一种语言的 PDF
 * 递给他,而那个文件确实能打开 —— 只是语言不对。
 */
export function downloadableIn(rows: readonly ReportFileRow[], lang: Lang): LangState | null {
  const state = langStates(rows).find((s) => s.lang === lang);
  return state && state.availability === 'ready' ? state : null;
}

/**
 * 该给出「生成 X 版」动作的语言。
 *
 * 【`working` 不在里面】正在渲的时候再给一个按钮,等于邀请人再触发一次 ——
 * 而每一次触发都是一次 Lambda。
 * 【`exhausted` 也不在里面】那种情况人点了也不会好,按钮该让位给「去看错误」。
 */
export function offerableLangs(rows: readonly ReportFileRow[]): Lang[] {
  return langStates(rows)
    .filter((s) => s.availability === 'absent' || s.availability === 'failed')
    .map((s) => s.lang);
}

/**
 * Storage 里的对象路径。**语言进文件名** —— 两种语言各自一份,互不覆盖。
 *
 * 【为什么不是 `${sessionId}.pdf` 加一列语言】那样两种语言会写同一个对象,
 * 后渲的覆盖先渲的 —— 而「覆盖」正是 B 方案要避免的那件事。
 * 路径里带语言之后,「切回中文」这件事在存储层就已经是「另一个文件」。
 */
export function pdfObjectPath(sessionId: string, lang: Lang): string {
  return `${sessionId}-${lang}.pdf`;
}

export function shareCardObjectPath(sessionId: string, lang: Lang, suffix: string): string {
  return `${sessionId}-${lang}${suffix}`;
}
