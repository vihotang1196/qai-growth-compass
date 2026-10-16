/**
 * 名单的行形状与名单 CSV —— 纯函数,从 assessment-admin/index.ts 挪出来(重填第 4 步),为了能测。
 *
 * 【一人一行】`session` = 报告看的那一份(`pickReportAttempt`:最新完成的;一份都没完成时是当前那份),
 * 总分 / 档位 / 最弱 / 报告文件都从它来;`attempts` = 这个人的每一份(`attemptsNewestFirst`),给页面的「历次」和 CSV 的重填两列。
 */
import { toCsv } from './csv.ts';
import { LANGS } from './lang.ts';

/** 一份答题记录(名单里) */
export interface RosterAttempt {
  id: string;
  status: string;
  attempt_no?: number | null;
  /** 这一份完成的时间(没完成是 null)。entitlement 上的 `completed_at` 是**第一次**完成的时间,重填之后不动 */
  completed_at?: string | null;
  created_at?: string | null;
  result: {
    total: number;
    tier: string;
    weakest: string[];
  } | null;
  /**
   * 每种语言一行报告文件。**PDF 的状态从这里来,不再从 result 上来** ——
   * 一个 session 有两份,而 result 只有一行,放不下两个状态。
   * 一行都没有是正常的(finalize 之后那次异步渲染还没落库,或者根本还没答完)。
   */
  files: {
    lang: string;
    pdf_status: string;
    pdf_path: string | null;
    pdf_attempts: number | null;
    pdf_last_error: string | null;
    /** 分享卡失败原因。【非空不代表 PDF 失败】—— 两者分开,CSV 里也是两列 */
    share_card_error: string | null;
  }[];
}

export interface RosterRow {
  id: string;
  name: string | null;
  /** 这个人的语言(zh / en)—— 语言跟着人走,见 _shared/lang.ts */
  lang?: string | null;
  /** webhook 最近一次写入时的告警,jsonb 数组。名单页负责让它可见 */
  warnings?: unknown;
  phone_e164: string | null;
  phone_raw: string | null;
  email_lower: string | null;
  status: string;
  first_login_at: string | null;
  completed_at: string | null;
  link_sent_at: string | null;
  access_revoked_at: string | null;
  cohort: { id: string; name: string; is_test: boolean } | null;
  /** 报告看的那一份 */
  session: RosterAttempt | null;
  /** 这个人的每一份,编号从大到小(重填第 4 步) */
  attempts: RosterAttempt[];
}

/**
 * 报告文件那几列 —— **按语言展开,列名由 `LANGS` 推导**。
 *
 * 【为什么不合成一列】一个 session 现在有两份 PDF,而这份 CSV 是拿去做分群和人工排查的。
 * 合成 `zh=ready; en=absent` 这种字符串之后,「筛出英文版没好的人」就得靠人眼解析 ——
 * 而那正是导出要替人做的事。
 *
 * 【为什么列名从 LANGS 推导】以后加一种语言,列会自动出现;
 * 手写列名的话新语言的数据会**静默不出现在导出里**(判断标准 12)。
 */
function fileColumns(): string[] {
  return [...LANGS.flatMap((l) => [`PDF 状态(${l})`, `PDF 错误(${l})`]), '分享卡错误'];
}

function fileCells(r: RosterRow): (string | null)[] {
  const byLang = new Map((r.session?.files ?? []).map((f) => [f.lang, f]));
  const cells: (string | null)[] = [];
  for (const l of LANGS) {
    const f = byLang.get(l);
    // 【没有那一行就写 absent,不写空】空单元格分不清「没有」与「导出漏了」
    cells.push(f?.pdf_status ?? 'absent', f?.pdf_last_error ?? null);
  }
  // 分享卡的错误哪种语言的都算 —— 它是附属品,分两列反而让人以为要分别处理
  const cardErrors = (r.session?.files ?? [])
    .filter((f) => f.share_card_error)
    .map((f) => `${f.lang}: ${f.share_card_error}`);
  cells.push(cardErrors.length ? cardErrors.join(' | ') : null);
  return cells;
}

/**
 * 重填的两列(重填第 4 步)。**加在最后**:原来的 17 列一格不动,按位置读这份 CSV 的人不会错位。
 *   - 重填次数 = 完成的份数 − 1(只开始了、没做完的那份不算);一份都没完成 → 空(他还谈不上重填,不是 0)
 *   - 最新一次完成时间 = 总分 / 档位那一份的完成时间。原来那列「完成时间」是 entitlement 上的,**第一次**完成的时间,重填之后不动 ——
 *     不加这一列的话,重填过的人那一行是「新的分数 + 旧的时间」
 */
function retakeCells(r: RosterRow): (string | null)[] {
  const completed = r.attempts.filter((a) => a.status === 'completed').length;
  if (completed === 0) return [null, null];
  return [String(completed - 1), r.session?.status === 'completed' ? (r.session.completed_at ?? null) : null];
}

export function rosterCsv(rows: RosterRow[]): string {
  return toCsv(
    [
      '姓名', '手机', '手机原值', '邮箱', '批次', '状态', '登录时间', '完成时间', '总分', '档位', '最弱维度', '已停用', ...fileColumns(),
      '重填次数', '最新一次完成时间',
    ],
    rows.map((r) => [
      r.name,
      r.phone_e164,
      // 解析失败时原值才是唯一线索,导出必须带上
      r.phone_e164 ? null : r.phone_raw,
      r.email_lower,
      r.cohort?.name ?? null,
      r.status,
      r.first_login_at,
      r.completed_at,
      r.session?.result?.total ?? null,
      r.session?.result?.tier ?? null,
      r.session?.result?.weakest?.join(' / ') ?? null,
      r.access_revoked_at ? 'yes' : null,
      // 分享卡失败不影响 PDF,所以它仍然单独一列 —— 混进 PDF 那列会让人以为 PDF 也坏了
      ...fileCells(r),
      ...retakeCells(r),
    ]),
  );
}
