/**
 * 对真实学员开放重填的开关(重填第 5 步的准备,Viho 2026-10-16:用数据库开关,不改常量)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【存在哪】表 `assessment_retake_switch`(迁移 20261016100000),只追加;**当前值 = id 最大的那一行的 open**。
 * 那张表同时就是切换记录:谁、什么时间、开还是关。
 *
 * 【默认关闭,读不到也关闭】一行都没有、读取出错、抛异常、值不是布尔 true → 一律 `open: false`。
 * 关错了的代价是「学员暂时不能开始重填」;开错了的代价是「没准备好就对真实学员开放」—— 所以只往关的那边错。
 *
 * 【关上时只拦「开始新的重填」】读这个开关的只有两处:`startRetake`(开始)与报告页的 `retake` 信息(给不给按钮)。
 * 继续答题、交卷出分、放弃都不读它 —— 做到一半的人能做完或放弃,不会卡在半路。
 *
 * 【测试批次不受它影响】`retakeEligibility` 先看是不是测试批次。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbFail, dbLogLine, describeError } from './dbError.ts';

export const RETAKE_SWITCH_TABLE = 'assessment_retake_switch';

export interface SwitchChange {
  open: boolean;
  by: string;
  at: string;
}

export interface RetakeSwitch {
  /** 只有读到了、而且最新一行的 open 是布尔 true,才是 true */
  open: boolean;
  /** 读取成功(一行都没有也算成功)。false = 出错 —— 照样按关闭处理,后台据此说「读不到」 */
  readable: boolean;
  /** 最近几次切换,新的在前(只有后台要看;学员那两处只取一行) */
  recent: SwitchChange[];
}

/** 一行 → 开着吗:只认布尔 true(字符串 'true'、1、null 都是关) */
export function isOpenRow(row: unknown): boolean {
  return row !== null && typeof row === 'object' && (row as { open?: unknown }).open === true;
}

const CLOSED_UNREADABLE: RetakeSwitch = { open: false, readable: false, recent: [] };

/**
 * 读开关。`limit` = 要几条切换记录(学员那两处用 1)。**从不抛** —— 学员的请求不能因为这张表出事而 500;
 * 出错一律「关闭 + readable: false」,并打一行 error(Supabase 日志里搜 `retake switch unreadable`)。
 */
export async function readRetakeSwitch(supa: SupabaseClient, fn: string, limit = 1): Promise<RetakeSwitch> {
  const ctx = { fn, op: `${RETAKE_SWITCH_TABLE}.select (retake switch)` };
  try {
    const { data, error } = await supa
      .from(RETAKE_SWITCH_TABLE)
      .select('open, changed_by, changed_at')
      .order('id', { ascending: false })
      .limit(limit);
    if (error) {
      console.error(`retake switch unreadable, treated as closed: ${dbLogLine(ctx, error)}`);
      return CLOSED_UNREADABLE;
    }
    if (!Array.isArray(data)) {
      console.error(`retake switch unreadable, treated as closed: ${fn} got a non-array answer`);
      return CLOSED_UNREADABLE;
    }
    const recent = data.map((r) => {
      const row = r as { changed_by?: unknown; changed_at?: unknown };
      return { open: isOpenRow(r), by: String(row.changed_by ?? ''), at: String(row.changed_at ?? '') };
    });
    return { open: isOpenRow(data[0]), readable: true, recent };
  } catch (err) {
    console.error(`retake switch unreadable, treated as closed: ${fn}: ${describeError(err).log}`);
    return CLOSED_UNREADABLE;
  }
}

/** 后台 retake_switch_set 的参数:`open` 必须是布尔,没有默认值,也没有「切换」 */
export function parseSwitchSet(body: Record<string, unknown>): { ok: true; open: boolean } | { ok: false } {
  return typeof body.open === 'boolean' ? { ok: true, open: body.open } : { ok: false };
}

/**
 * 记一次切换(= 设开关)。只有 assessment-admin 调;`by` = 管理员邮箱(adminVerdict 给的)。
 * 时间由数据库的 `now()` 给。写不进去就抛(dbFail)—— 后台看到失败,开关保持原样。
 */
export async function setRetakeSwitch(supa: SupabaseClient, open: boolean, by: string, fn: string): Promise<void> {
  if (by.trim() === '') throw new Error(`${fn}: refusing to record a retake switch change without an admin email`);
  const { error } = await supa.from(RETAKE_SWITCH_TABLE).insert({ open, changed_by: by });
  if (error) dbFail({ fn, op: `${RETAKE_SWITCH_TABLE}.insert (retake switch)` }, error);
}

/** 后台面板列多少条切换记录 */
export const SWITCH_HISTORY = 20;

/**
 * assessment-admin 的两个 action(index.ts 只管把 `verdict.email` 交进来,判定都在这里,所以测得到)。
 *   - `retake_switch`:当前状态 + 最近 20 次切换
 *   - `retake_switch_set`:`open` 必须是明确的布尔(不是「切换」—— 两个管理员前后脚点「关闭」,结果都是关)。
 *     「谁」= `adminEmail`,**只来自名单判定**;请求体里自称的任何人都不认。时间 = 数据库 now()。
 *     写完重读一次回给页面 —— 页面显示的是库里的样子,不是它以为的样子。写不进去 → 抛给 index 的 catch(500 + 分类)。
 */
export async function retakeSwitchAction(
  supa: SupabaseClient,
  action: 'retake_switch' | 'retake_switch_set',
  body: Record<string, unknown>,
  adminEmail: string,
  fn: string,
): Promise<{ status: 200 | 400; body: unknown }> {
  if (action === 'retake_switch') return { status: 200, body: await readRetakeSwitch(supa, fn, SWITCH_HISTORY) };
  const parsed = parseSwitchSet(body);
  if (!parsed.ok) return { status: 400, body: { error: 'open must be true or false' } };
  await setRetakeSwitch(supa, parsed.open, adminEmail, fn);
  console.log(`admin ${adminEmail} turned retakes for real cohorts ${parsed.open ? 'ON' : 'OFF'}`);
  return { status: 200, body: await readRetakeSwitch(supa, fn, SWITCH_HISTORY) };
}
