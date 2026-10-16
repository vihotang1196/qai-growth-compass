import type { ConfirmOptions } from '@/components/ConfirmProvider';
import type { UiKey } from '@/config/ui-strings';
import { AdminAuthError } from '@/lib/adminApi';

/**
 * 后台的「重填开关」—— 对真实学员开不开放重填(重填第 5 步的准备,Viho 2026-10-16:用数据库开关,不改常量)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【开关在服务端】`assessment_retake_switch`(只追加,最新一行就是开关),读写都只经 assessment-admin 的
 * `retake_switch` / `retake_switch_set`;那个函数每次请求都验管理员名单。这里只是把它的答案画出来。
 *
 * 【读不懂 = 关】与服务端同一条规矩:只有 `readable: true` 且 `open` 是布尔 true 才算开着;
 * 别的形状(旧服务端、错误页、null)一律「读不到、关」。页面因此永远不会把一个不确定的状态说成「开放」。
 *
 * 【一个按钮,永远是另一个状态】开着 → 「关闭重填」;关着 → 「开放重填」;**读不到 → 「关闭重填」**:
 * 状态不明的时候只给安全的那一个(关上永远无害;学员那边本来就按关处理)。
 *
 * 【先问、后发,发的是明确的值】确认框(`useConfirm()`)点了确认才发;发 `{ open: true | false }`,不是「切换」——
 * 两个管理员前后脚点「关闭」,结果都是关。页面显示的是服务端写完之后重读的样子。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface SwitchChange {
  open: boolean;
  by: string;
  at: string;
}

export interface RetakeSwitchState {
  open: boolean;
  readable: boolean;
  /** 最近的切换,新的在前(服务端排好的) */
  recent: SwitchChange[];
}

export type SwitchStatus = 'open' | 'closed' | 'unreadable';

const UNREADABLE: RetakeSwitchState = { open: false, readable: false, recent: [] };

function isChange(x: unknown): x is SwitchChange {
  if (x === null || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return typeof c.open === 'boolean' && typeof c.by === 'string' && typeof c.at === 'string';
}

/** 服务端的答案 → 状态。读不懂的一律「读不到、关」 */
export function parseSwitchState(raw: unknown): RetakeSwitchState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return UNREADABLE;
  const r = raw as Record<string, unknown>;
  if (r.readable !== true || typeof r.open !== 'boolean' || !Array.isArray(r.recent)) return UNREADABLE;
  return { open: r.open === true, readable: true, recent: r.recent.filter(isChange).map((c) => ({ open: c.open, by: c.by, at: c.at })) };
}

/** `null` = 面板根本没读到(请求失败) */
export function switchStatus(s: RetakeSwitchState | null): SwitchStatus {
  if (!s || !s.readable) return 'unreadable';
  return s.open ? 'open' : 'closed';
}

/** 那一个按钮按下去要设成什么 */
export function nextSwitchValue(status: SwitchStatus): boolean {
  return status === 'closed';
}

export function switchConfirmKeys(next: boolean): { title: UiKey; description: UiKey; confirmLabel: UiKey } {
  return next
    ? { title: 'admin.retakeSwitch.confirmOn.title', description: 'admin.retakeSwitch.confirmOn.body', confirmLabel: 'admin.retakeSwitch.turnOn' }
    : { title: 'admin.retakeSwitch.confirmOff.title', description: 'admin.retakeSwitch.confirmOff.body', confirmLabel: 'admin.retakeSwitch.turnOff' };
}

export type SetSwitchOutcome =
  | { kind: 'cancelled' }
  | { kind: 'done'; state: RetakeSwitchState }
  | { kind: 'authLost'; forbidden: boolean }
  | { kind: 'failed'; message: string };

/** 问 → 发 `{ open: next }` → 服务端重读的状态。取消 = 一个请求都不发 */
export async function setSwitchFlow(deps: {
  ask: (opts: ConfirmOptions) => Promise<boolean>;
  confirm: ConfirmOptions;
  next: boolean;
  request: (open: boolean) => Promise<unknown>;
}): Promise<SetSwitchOutcome> {
  if (!(await deps.ask(deps.confirm))) return { kind: 'cancelled' };
  try {
    return { kind: 'done', state: parseSwitchState(await deps.request(deps.next)) };
  } catch (err) {
    if (err instanceof AdminAuthError) return { kind: 'authLost', forbidden: err.status === 403 };
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
}
