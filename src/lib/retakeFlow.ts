import type { ConfirmOptions } from '@/components/ConfirmProvider';
import { QuizAuthError, RetakeRefusedError, type QuizSnapshot } from '@/lib/quizApi';
import { routeForStatus } from '@/lib/sessionFlow';
import type { RetakeAction } from '@/lib/retakeView';
import type { UiKey } from '@/config/ui-strings';

/**
 * 报告页上三个重填动作背后的顺序与结果(重填第 3 步)。确认框(`useConfirm()` 的 ask)与请求都由页面注入 ——
 * 这样「先问、后发」「取消就什么都不发」能在 node 里直接测,不用浏览器。
 *
 * 【先问、后发】「重填」与「放弃」都改变东西(新开一份 / 删掉没做完的那份),所以先弹网站自己的确认框
 * (不用浏览器原生弹窗 —— check:native-dialogs 守着);取消 = 一个请求都不发。
 * 「继续」不改变任何东西,不问。
 *
 * 【「正在准备…」只在请求路上】确认框开着的时候,背后那个按钮不该转圈 —— 那会像是已经开始了。
 * 所以忙的状态由 `onRequest` 报给页面,只包住请求那一段。
 * (连点两下弹出两个确认框的事,由页面在整个流程外面套一道 singleFlight 挡住。)
 */

type Ask = (opts: ConfirmOptions) => Promise<boolean>;
type Tk = (key: UiKey) => string;

/** 动作失败时,401 / 403 / 别的,三种去向 */
function failureOf(err: unknown): { kind: 'revoked' } | { kind: 'authLost' } | { kind: 'failed' } {
  if (err instanceof QuizAuthError) return err.kind === 'revoked' ? { kind: 'revoked' } : { kind: 'authLost' };
  return { kind: 'failed' };
}

async function during<T>(onRequest: ((on: boolean) => void) | undefined, request: () => Promise<T>): Promise<T> {
  onRequest?.(true);
  try {
    return await request();
  } finally {
    onRequest?.(false);
  }
}

export type StartOutcome =
  | { kind: 'cancelled' }
  | { kind: 'started'; route: string }
  | { kind: 'refused'; reason: string; nextAllowedAt: string | null }
  | { kind: 'revoked' }
  | { kind: 'authLost' }
  | { kind: 'failed' };

/** 「重填测评」:问 → start_retake → 新那一份该去的页面(按新那一份的状态与语言) */
export async function startRetakeFlow(deps: {
  ask: Ask;
  confirm: ConfirmOptions;
  request: () => Promise<QuizSnapshot>;
  onRequest?: (on: boolean) => void;
  fallbackLocale: 'zh' | 'en';
}): Promise<StartOutcome> {
  if (!(await deps.ask(deps.confirm))) return { kind: 'cancelled' };
  try {
    const snap = await during(deps.onRequest, deps.request);
    return { kind: 'started', route: routeForStatus(snap.status, snap.locale ?? deps.fallbackLocale) };
  } catch (err) {
    // 被拒(太快 / 满了 / 已经有一份没做完的…):服务端什么都没写;页面重取一次报告,按钮的位置就会说原因
    if (err instanceof RetakeRefusedError) return { kind: 'refused', reason: err.reason, nextAllowedAt: err.nextAllowedAt };
    return failureOf(err);
  }
}

export type AbandonOutcome =
  | { kind: 'cancelled' }
  | { kind: 'abandoned' }
  | { kind: 'gone' }
  | { kind: 'revoked' }
  | { kind: 'authLost' }
  | { kind: 'failed' };

/** 「放弃」:问 → abandon_retake。已经没有没做完的(另一个标签页里交了卷 / 放弃了)→ gone,页面重取一次就对了 */
export async function abandonRetakeFlow(deps: {
  ask: Ask;
  confirm: ConfirmOptions;
  request: () => Promise<unknown>;
  onRequest?: (on: boolean) => void;
}): Promise<AbandonOutcome> {
  if (!(await deps.ask(deps.confirm))) return { kind: 'cancelled' };
  try {
    await during(deps.onRequest, deps.request);
    return { kind: 'abandoned' };
  } catch (err) {
    if (err instanceof RetakeRefusedError) return { kind: 'gone' };
    return failureOf(err);
  }
}

export type ContinueOutcome = { kind: 'go'; route: string } | { kind: 'revoked' } | { kind: 'authLost' } | { kind: 'failed' };

/**
 * 「继续」:不问,先问服务端那一份现在在哪一步(答题 / 问卷 / 刚好在别处交了卷),再去那一页。
 * 报告接口只给了编号、没给状态;bootstrap 回的正是 cookie 当前那一份(没做完的优先)。
 */
export async function continueRetakeFlow(deps: {
  bootstrap: () => Promise<QuizSnapshot>;
  fallbackLocale: 'zh' | 'en';
}): Promise<ContinueOutcome> {
  try {
    const snap = await deps.bootstrap();
    return { kind: 'go', route: routeForStatus(snap.status, snap.locale ?? deps.fallbackLocale) };
  } catch (err) {
    return failureOf(err);
  }
}

/**
 * 「重填」的确认框:说清四件事(方案第 2 节)—— 旧报告保留;新的一份成为默认;顾问看到的会更新;
 * 下一次能重填的时间(完成之后隔多少小时)。数字全部来自服务端(`retake.minHoursBetween` / `maxAttempts`)。
 */
export function retakeConfirmOptions(tk: Tk, action: Extract<RetakeAction, { kind: 'start' }>): ConfirmOptions {
  return {
    title: tk('report.retake.confirmTitle'),
    description: tk('report.retake.confirmBody')
      .replace('{hours}', String(action.minHours))
      .replace('{max}', String(action.max))
      .replace('{next}', String(action.used + 1)),
    confirmLabel: tk('report.retake.confirmAction'),
  };
}

export function abandonConfirmOptions(tk: Tk): ConfirmOptions {
  return {
    title: tk('report.retake.abandonTitle'),
    description: tk('report.retake.abandonBody'),
    confirmLabel: tk('report.retake.abandonAction'),
  };
}
