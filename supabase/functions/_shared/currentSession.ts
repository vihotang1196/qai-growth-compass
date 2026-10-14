/**
 * 按 entitlement 取答题记录 —— **全仓库唯一一处**(`check:session-reads` 守)。
 *
 * 【为什么只能在这里】原来 5 个函数各自 `.from('assessment_sessions').eq('entitlement_id', …).maybeSingle()`。
 * 一个人有两份时,`.maybeSingle()` 会报错 → 500 —— 而那正是重填要带来的状态。
 * 现在都调这里:取这个人的全部答题记录,交给 `attempts.ts` 的同一个定义挑一份。
 * 今天每个人最多一份,挑出来的就是那一份(重填第 1 步对现有数据零变化)。
 *
 * 【回的形状与 supabase-js 一样是 `{ data, error }`】调用方照旧 `if (error) dbFail(...)`,改动只有一行。
 * `id, status, attempt_no` 一定会取;调用方再要别的列,写在 `extra` 里。
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { pickCurrent, pickReportAttempt } from './attempts.ts';

export interface SessionBase {
  id: string;
  status: string;
  attempt_no: number;
}

/** 有上限:设计里每人最多 6 份(第 2 步才会执行);取多一点,多出来说明限额没守住,但这里照样能挑 */
const MAX_ROWS = 50;

async function sessionsOf<T>(
  supa: SupabaseClient,
  entitlementId: string,
  extra: string,
): Promise<{ data: (SessionBase & T)[] | null; error: PostgrestError | null }> {
  const { data, error } = await supa
    .from('assessment_sessions')
    .select(extra ? `id, status, attempt_no, ${extra}` : 'id, status, attempt_no')
    .eq('entitlement_id', entitlementId)
    .order('attempt_no', { ascending: false })
    .limit(MAX_ROWS);
  return { data: (data ?? null) as unknown as (SessionBase & T)[] | null, error };
}

/** 当前答题记录(答题、出分、登录去向用)。没有任何一份 → data: null */
export async function currentSession<T = Record<never, never>>(
  supa: SupabaseClient,
  entitlementId: string,
  extra = '',
): Promise<{ data: (SessionBase & T) | null; error: PostgrestError | null }> {
  const { data, error } = await sessionsOf<T>(supa, entitlementId, extra);
  return { data: error ? null : pickCurrent(data ?? []), error };
}

/** 报告看的那份(报告、报告文件用):最新完成的;一份都没完成 → 当前那份 */
export async function reportSession<T = Record<never, never>>(
  supa: SupabaseClient,
  entitlementId: string,
  extra = '',
): Promise<{ data: (SessionBase & T) | null; error: PostgrestError | null }> {
  const { data, error } = await sessionsOf<T>(supa, entitlementId, extra);
  return { data: error ? null : pickReportAttempt(data ?? []), error };
}
