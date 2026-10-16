/**
 * 重填(第 2 步:服务端)—— docs/retake-design.md 第 2、4、5 节。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【每次重填 = 新开一份答题记录】旧的那份原样保留、永远不再被写(两道守卫:`guardSessionWrite` 与
 * 迁移 20261014300000 的触发器)。这里**没有任何一条路径**把已完成的一份改回未完成。
 *
 * 【限制(Viho 2026-10-14 定)】全部在服务端:
 *   - 同一时间最多一份没做完的 —— 数据库的部分唯一索引保证,这里先查一遍只为回一个清楚的原因
 *   - 两次完成之间至少 24 小时(从最近一次**完成**算)
 *   - 每人最多 6 份(第一次 + 5 次重填),先于时间检查 —— 满了等多久都没用
 *   - 链接被作废的人不能重填;测试批次同样受限
 *
 * 【对真实学员开不开放:数据库开关】测试批次一直能重填;真实批次看 `assessment_retake_switch`
 * (retakeSwitch.ts,Viho 2026-10-16 定:用数据库开关,不改常量;默认关闭,读不到也按关闭)。
 * 开关只进「能不能**开始**」这一处(`checkRetake`:start_retake 与报告页的按钮共用)——
 * 继续答题、交卷、放弃都不看它,关上时做到一半的人照样能做完或放弃。
 * (第 2 步到这里之前,这是常量 `RETAKE_OPEN_TO_REAL_COHORTS = false`。)
 *
 * 【预填(Viho 的第 3 个决定)】背景题与问卷**只是初始值**,来源 = 最新完成的那一份;不写进新的一份 ——
 * 学员要像第一次一样提交,才算答了(不提交问卷就出不了分:finalize 读的是这一份自己的问卷)。
 * 15 道正式题不预填。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickReportAttempt, type AttemptLike } from './attempts.ts';
import { attemptsOf } from './currentSession.ts';
import type { SessionStatus } from './postAuthTarget.ts';
import { isTestCohort } from './testCohort.ts';
import { dbFail } from './dbError.ts';
import { readRetakeSwitch } from './retakeSwitch.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

export const RETAKE_MIN_HOURS = 24;
export const RETAKE_MAX_ATTEMPTS = 6;

export interface AttemptRow {
  id: string;
  status: string;
  attempt_no: number;
  completed_at: string | null;
}

export type RetakeRefusal = 'revoked' | 'not_open' | 'no_completed_attempt' | 'open_attempt' | 'limit_reached' | 'too_soon';
export type RetakeEligibility = { ok: true; nextAttemptNo: number } | { ok: false; reason: RetakeRefusal; nextAllowedAt?: string };

/**
 * 能不能开始一次重填 —— 纯函数,start_retake 与报告页的「下一次可以重填的时间」用同一个。
 * 检查顺序就是回给学员的原因的优先级:作废 → 没开放 → 不是重填 → 有没做完的 → 满了 → 太快。
 * `openToReal` = 数据库开关读出来的值;不读库的调用方用 `checkRetake`。
 */
export function retakeEligibility(
  rows: readonly AttemptRow[],
  ctx: { revoked: boolean; isTest: boolean; openToReal: boolean; nowMs: number },
): RetakeEligibility {
  if (ctx.revoked) return { ok: false, reason: 'revoked' };
  if (!ctx.isTest && !ctx.openToReal) return { ok: false, reason: 'not_open' };
  const completed = rows.filter((r) => r.status === 'completed');
  if (completed.length === 0) return { ok: false, reason: 'no_completed_attempt' };
  if (rows.some((r) => r.status !== 'completed')) return { ok: false, reason: 'open_attempt' };
  if (rows.length >= RETAKE_MAX_ATTEMPTS) return { ok: false, reason: 'limit_reached' };
  /**
   * 【从最近一次完成算】`completed_at` 缺失时(2026-10-14 生产上 114 份完成的里 0 份缺)这一条无从判断 ——
   * 不因此把人永远卡住;6 份的上限仍然兜着。
   */
  const lastMs = Math.max(...completed.map((r) => (r.completed_at ? Date.parse(r.completed_at) : Number.NaN)).filter((n) => !Number.isNaN(n)));
  if (Number.isFinite(lastMs)) {
    const allowedMs = lastMs + RETAKE_MIN_HOURS * 3_600_000;
    if (ctx.nowMs < allowedMs) return { ok: false, reason: 'too_soon', nextAllowedAt: new Date(allowedMs).toISOString() };
  }
  return { ok: true, nextAttemptNo: Math.max(...rows.map((r) => r.attempt_no)) + 1 };
}

/**
 * 「现在能不能开始一次重填」—— start_retake 与报告页的按钮**都走这一个**,所以两边对开关的理解不会分家。
 * 只有真实批次、链接没作废时才去读开关(测试批次与作废的人用不着它:开关表出事也影响不到测试批次)。
 * 读开关从不抛,读不到 = 关(retakeSwitch.ts)。
 */
export async function checkRetake(
  supa: SupabaseClient,
  rows: readonly AttemptRow[],
  ctx: { revoked: boolean; isTest: boolean; nowMs: number },
  fn: string,
): Promise<RetakeEligibility> {
  const openToReal = !ctx.isTest && !ctx.revoked ? (await readRetakeSwitch(supa, fn)).open : false;
  return retakeEligibility(rows, { ...ctx, openToReal });
}

const ROW_COLS = 'completed_at';

/** 读准入:作废了没有、是不是测试批次。读不到就按「作废」处理 —— 这里宁可拒绝 */
async function admission(supa: SupabaseClient, entitlementId: string, fn: string) {
  const { data, error } = await supa
    .from('assessment_entitlements')
    .select('access_revoked_at, cohort:assessment_cohorts(is_test)')
    .eq('id', entitlementId)
    .maybeSingle();
  if (error) dbFail({ fn, op: 'assessment_entitlements.select (retake admission)', entitlement: entitlementId }, error);
  const row = data as { access_revoked_at: string | null; cohort: { is_test?: boolean | null } | null } | null;
  return { revoked: !row || row.access_revoked_at !== null, isTest: isTestCohort(row?.cohort) };
}

async function rowsOf(supa: SupabaseClient, entitlementId: string, fn: string): Promise<AttemptRow[]> {
  const { data, error } = await attemptsOf<{ completed_at: string | null }>(supa, entitlementId, ROW_COLS);
  if (error) dbFail({ fn, op: 'assessment_sessions.select (attempts)', entitlement: entitlementId }, error);
  return (data ?? []) as AttemptRow[];
}

export type StartRetakeResult = { ok: true; sessionId: string; attemptNo: number } | { ok: false; reason: RetakeRefusal; nextAllowedAt?: string };

/**
 * 开始一次重填:检查全部限制 → 插入一行新的(编号 = 最大 + 1)。被拒时**什么都不写**。
 * 只认 cookie 里的人(调用方传进来的 entitlementId 来自 cookie),不接受任何 session id。
 */
export async function startRetake(supa: SupabaseClient, entitlementId: string, nowMs: number): Promise<StartRetakeResult> {
  const fn = 'startRetake';
  const { revoked, isTest } = await admission(supa, entitlementId, fn);
  const rows = await rowsOf(supa, entitlementId, fn);
  const elig = await checkRetake(supa, rows, { revoked, isTest, nowMs }, fn);
  if (!elig.ok) return elig;

  /**
   * 【只插 entitlement 与编号】背景题不复制、答案不复制 —— 预填只是页面上的初始值(`retakePrefill`)。
   * 复制进来的话,「没提交问卷也能出分」就成立了,那正是 Viho 的决定要排除的。
   */
  const { data, error } = await supa
    .from('assessment_sessions')
    .insert({ entitlement_id: entitlementId, attempt_no: elig.nextAttemptNo })
    .select('id, status, attempt_no')
    .single();
  if (error) {
    /**
     * 【并发】两个 start_retake 同时过了上面的检查:编号相同 → `(entitlement_id, attempt_no)` 唯一;
     * 编号不同也逃不过「同一时间最多一份没做完的」那个部分唯一索引。输的那一个重查一次:
     * 确实有一份没做完的 → 回 open_attempt(不是 500);没有 → 是别的错误,照常报。
     */
    if ((error as { code?: string }).code === '23505') {
      const again = await rowsOf(supa, entitlementId, fn);
      if (again.some((r) => r.status !== 'completed')) return { ok: false, reason: 'open_attempt' };
    }
    dbFail({ fn, op: 'assessment_sessions.insert (start_retake)', entitlement: entitlementId }, error);
  }
  const created = data as { id: string; attempt_no: number };
  console.log(`retake started: entitlement ${entitlementId} attempt ${created.attempt_no}`);
  return { ok: true, sessionId: created.id, attemptNo: created.attempt_no };
}

/**
 * 放弃没做完的那一份重填 = 删掉它(它还没有分数、没有文件、没对外发过任何东西;答案与问卷随外键级联)。
 * 第一份不能放弃 —— 那不是重填。删除本身带着「不是 completed」的条件:查完之后它刚好完成了的话,一行都删不到。
 */
export async function abandonRetake(
  supa: SupabaseClient,
  entitlementId: string,
): Promise<{ ok: true; attemptNo: number } | { ok: false; reason: 'no_open_attempt' | 'first_attempt' }> {
  const fn = 'abandonRetake';
  const rows = await rowsOf(supa, entitlementId, fn);
  const open = rows.find((r) => r.status !== 'completed');
  if (!open) return { ok: false, reason: 'no_open_attempt' };
  if (open.attempt_no <= 1) return { ok: false, reason: 'first_attempt' };
  const { data, error } = await supa
    .from('assessment_sessions')
    .delete()
    .eq('id', open.id)
    .neq('status', 'completed')
    .select('id');
  if (error) dbFail({ fn, op: 'assessment_sessions.delete (abandon retake)', entitlement: entitlementId, session: open.id }, error);
  if (!data || (data as unknown[]).length === 0) return { ok: false, reason: 'no_open_attempt' };
  console.log(`retake abandoned: entitlement ${entitlementId} attempt ${open.attempt_no}`);
  return { ok: true, attemptNo: open.attempt_no };
}

/** 登录去向用的状态:看「报告看的那份」—— 有完成的就去报告,即使有一份重填没做完(第 2 节) */
export function loginStatus(rows: readonly AttemptLike[]): SessionStatus | null {
  return (pickReportAttempt(rows)?.status as SessionStatus | undefined) ?? null;
}

// ── 预填 ─────────────────────────────────────────────────────────

interface SurveyQ {
  id: string;
  type: string;
  field: string;
  zh: { options?: string[] };
  option_to_dimension?: string[];
  option_to_value?: string[];
  value_map?: number[];
}
const SURVEY = config.survey_questions as unknown as SurveyQ[];
const PROFILE_OPTIONS = new Map(config.profile_questions.map((p) => [p.id, p.zh.options.length]));

/** 唯一的下标;对不上或不唯一 → null(不猜) */
function uniqueIndex<T>(table: readonly T[], value: unknown): number | null {
  const i = table.indexOf(value as T);
  return i >= 0 && table.lastIndexOf(value as T) === i ? i : null;
}

/**
 * 库里存的问卷(语义值,见 assessment-score 的 saveSurvey)→ 页面提交时的形状(按题号,下标)。
 * 对不上现在选项的那一题**整题不预填** —— 改过题之后硬凑一个下标,比让学员重选一次更糟。
 */
export function surveyPrefill(stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of SURVEY) {
    const v = stored?.[q.field];
    if (v === undefined || v === null) continue;
    if (q.type === 'single_select') {
      const table = q.option_to_dimension ?? q.option_to_value ?? q.value_map;
      const n = q.zh.options?.length ?? 0;
      const idx = table ? uniqueIndex<unknown>(table, v) : (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : null);
      if (idx !== null) out[q.id] = idx;
    } else if (q.type === 'multi_select') {
      if (!Array.isArray(v)) continue;
      const idxs = v.map((item) => uniqueIndex(q.zh.options ?? [], item));
      if (idxs.every((i) => i !== null)) out[q.id] = idxs;
    } else if (q.type === 'open_text') {
      if (typeof v === 'string') out[q.id] = v;
    }
  }
  return out;
}

/** 背景题本来就存下标;只留现在的题、范围内的 */
export function profilePrefill(profile: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (profile === null || typeof profile !== 'object') return out;
  for (const [id, v] of Object.entries(profile as Record<string, unknown>)) {
    const n = PROFILE_OPTIONS.get(id);
    if (n !== undefined && Number.isInteger(v) && (v as number) >= 0 && (v as number) < n) out[id] = v as number;
  }
  return out;
}

export interface RetakePrefill {
  fromAttempt: number;
  profile: Record<string, number>;
  survey: Record<string, unknown>;
}

/**
 * 当前这一份是第 2 份及以后、还没做完 → 上一次(最新完成的那一份)的背景题与问卷;否则 null。
 * 只读给 cookie 的本人(调用方的 rows 来自 cookie 的 entitlement)。正式题的答案**不读**。
 */
export async function retakePrefill(
  supa: SupabaseClient,
  rows: readonly AttemptRow[],
  current: AttemptRow,
): Promise<RetakePrefill | null> {
  if (current.attempt_no <= 1 || current.status === 'completed') return null;
  const source = pickReportAttempt(rows.filter((r) => r.status === 'completed'));
  if (!source) return null;
  const fn = 'retakePrefill';
  const [{ data: ses, error: sErr }, { data: sv, error: vErr }] = await Promise.all([
    supa.from('assessment_sessions').select('profile').eq('id', source.id).maybeSingle(),
    supa.from('assessment_survey').select('responses').eq('session_id', source.id).maybeSingle(),
  ]);
  if (sErr) dbFail({ fn, op: 'assessment_sessions.select profile (prefill)', session: source.id }, sErr);
  if (vErr) dbFail({ fn, op: 'assessment_survey.select (prefill)', session: source.id }, vErr);
  return {
    fromAttempt: source.attempt_no,
    profile: profilePrefill((ses as { profile?: unknown } | null)?.profile),
    survey: surveyPrefill(((sv as { responses?: Record<string, unknown> } | null)?.responses ?? {}) as Record<string, unknown>),
  };
}

// ── 报告文件:「生成另一种语言」只对最新那一份(Viho 的第 2 个决定)──

export type FileDecision = 'ready' | 'working' | 'exhausted' | 'render' | 'refuse_history';

/**
 * 学员请求某种语言的文件时怎么办。最新那一份与今天完全一样;历史那几份只给已经有的,不触发渲染 ——
 * 成本有上限(每份最多两种语言),入口也只有一个要守。
 */
export function fileRequestDecision(isLatest: boolean, availability: string): FileDecision {
  if (availability === 'ready' || availability === 'working' || availability === 'exhausted') return availability;
  return isLatest ? 'render' : 'refuse_history';
}

// ── GHL 重试只认最新一份(第 3 节)──

/**
 * 哪些候选的重试已经作废:同一个人有**编号更大的完成份**(视图 `assessment_latest_results` 里那一行)。
 * 视图里没有这个人、或视图里最新的编号不比它大(第 2 份有结果但答题记录没标上 completed)→ 不作废 ——
 * 宁可多重试一次,也不把唯一有分数的那一份的同步扔掉。
 */
export function supersededSessionIds(
  candidates: readonly { session_id: string; entitlement_id: string; attempt_no: number }[],
  latest: readonly { entitlement_id: string; attempt_no: number }[],
): Set<string> {
  const newest = new Map<string, number>();
  for (const l of latest) newest.set(l.entitlement_id, Math.max(newest.get(l.entitlement_id) ?? 0, l.attempt_no));
  const out = new Set<string>();
  for (const c of candidates) {
    const n = newest.get(c.entitlement_id);
    if (n !== undefined && n > c.attempt_no) out.add(c.session_id);
  }
  return out;
}
