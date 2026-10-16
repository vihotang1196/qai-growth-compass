import { langStates, type LangState } from '../../api/_lib/reportFiles';

/**
 * 名单里「第几次」那一格与「历次」—— 判定全在这里(纯函数),RosterRow 只照着画。重填第 4 步,docs/retake-design.md 第 3 节「后台名单」。
 *
 * 【数据从哪来】assessment-admin 的 roster:`session` = 报告看的那一份(最新完成的;一份都没完成时是当前那份),
 * `attempts` = 这个人的每一份、编号从大到小(`_shared/rosterCsv.ts` 的 `RosterRow`)。
 * 旧版服务端(函数还没部署到这一版时)不回 `attempts` —— 那时按「只有 `session` 这一份」画,不报错。
 */
export interface RosterAttemptData {
  id: string;
  status: string;
  attempt_no?: number | null;
  completed_at?: string | null;
  created_at?: string | null;
  result: { total: number; tier: string; weakest: string[] } | null;
  files?: {
    lang: string;
    pdf_status: string;
    pdf_path: string | null;
    pdf_attempts: number | null;
    pdf_last_error: string | null;
    share_card_error: string | null;
  }[];
}

export interface AttemptCell {
  /** 名单这一行显示的那一份是第几次;还没完成过任何一份 → null(那一格是「—」) */
  shownNo: number | null;
  /** 一共几份(含没做完的那份);≥ 2 才有「历次」 */
  count: number;
  /** 有一份重填还没做完 → 它的编号 */
  openNo: number | null;
}

const noOf = (a: RosterAttemptData) => a.attempt_no ?? 1;

/** 旧版服务端没有 `attempts`:只有 `session` 那一份 */
const allOf = (session: RosterAttemptData | null, attempts: readonly RosterAttemptData[] | undefined) =>
  attempts ?? (session ? [session] : []);

export function attemptCell(session: RosterAttemptData | null, attempts: readonly RosterAttemptData[] | undefined): AttemptCell {
  const all = allOf(session, attempts);
  const anyDone = all.some((a) => a.status === 'completed');
  // 「重填中」= 已经完成过一份、又开了一份没做完的;第一份还在答的人不叫重填
  const open = anyDone ? all.find((a) => a.status !== 'completed') : undefined;
  return {
    shownNo: session && session.status === 'completed' ? noOf(session) : null,
    count: all.length,
    openNo: open ? noOf(open) : null,
  };
}

export interface HistoryLine {
  attempt: RosterAttemptData;
  no: number;
  /** 名单主行显示的就是这一份 */
  shown: boolean;
  /** 还没做完的那份重填 */
  open: boolean;
  /** 有分数才有报告可看 */
  canOpenReport: boolean;
  /** 每种语言的状态(画成 `zh ✓ / en —`);没做完的那份是空的 */
  states: LangState[];
  /** 给「重新生成 {lang}」按钮的语言 */
  regen: string[];
}

/** 历次的每一行,编号从大到小;不到两份 → null(没有「历次」可看) */
export function historyLines(session: RosterAttemptData | null, attempts: readonly RosterAttemptData[] | undefined): HistoryLine[] | null {
  const all = allOf(session, attempts);
  if (all.length < 2) return null;
  return [...all]
    .sort((x, y) => noOf(y) - noOf(x))
    .map((a) => {
      const open = a.status !== 'completed';
      const shown = !!session && a.id === session.id;
      const states = open ? [] : langStates(a.files ?? []);
      /**
       * 【重新生成给哪几种语言】名单主行显示的那一份(最新完成的)与主行一样:任何不是 ready 的,包括从没生成过的另一种语言;
       * 以前的那几份只给**已经有那一行**的(失败 / 卡住的可以重来),不给从没有过的语言 ——
       * Viho 的决定 2:另一种语言只给最新的一份(学员那边同样只对最新那份开放)。
       */
      const regen = states
        .filter((st) => st.availability !== 'ready' && (shown || st.availability !== 'absent'))
        .map((st) => st.lang);
      return { attempt: a, no: noOf(a), shown, open, canOpenReport: !open && a.result !== null, states, regen };
    });
}
