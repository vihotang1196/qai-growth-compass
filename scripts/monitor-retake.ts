#!/usr/bin/env node
/**
 * 重填的监控(重填第 5 步:对真实学员开放前后看的那些数)—— 只读,一次印完。2026-10-16 加。
 *
 *   npm run monitor:retake                 真实学员(默认)
 *   npm run monitor:retake -- --scope=test 只有测试批次(用来看这条命令真的数得到东西)
 *
 * 印什么:开关现在的状态与最近 10 次切换;第 2 份及以后的答题记录(还在库里的:完成 / 没做完;开放以来开始 / 完成了几份);
 * 卡住没做完的(开始超过 24 小时);这些结果里 GHL 字段 / 标签没同步的;这些文件里 PDF 失败的。
 * **放弃的次数数据库里没有**(放弃 = 删掉那一份)—— 输出里写了去哪看。
 *
 * 【只读、只有计数与时间】走 `scripts/calibration/lib.ts` 的同一条只读路径:每条查询包进 `select * from (…) as q`、
 * 写操作关键词与个人信息字段(电话、邮箱、姓名、token、GHL contact id…)在发出去之前就被拒。
 * 查询里不取任何 id、姓名、错误原文;开关只取「记了谁没有」(不取邮箱);GHL 错误只取写回代码自己加的类别前缀。
 *
 * 退出码:0 没有要看的;1 有要看的(最后一行列出是哪几项,判定在 scripts/monitor/retakeReport.ts);2 查询失败 / 用法错。
 */
import { queryOwnAttemptChoice } from './calibration/lib.ts';
import { parseCounts, renderMonitor, attentionItems, type SwitchChangeRow } from './monitor/retakeReport.ts';

const scopeArg = process.argv.slice(2).find((a) => a.startsWith('--scope='));
const scope = scopeArg ? scopeArg.slice('--scope='.length) : 'real';
if (scope !== 'real' && scope !== 'test') {
  console.error('用法:npm run monitor:retake [-- --scope=real|test]');
  process.exit(2);
}
const isTest = scope === 'test';

/** 这个范围的答题记录、其中第 2 份及以后、每人最新完成的编号、这些的结果与文件 */
const CTES = `
  with s_all as (
    select s.id, s.entitlement_id, s.attempt_no, s.status, s.created_at, s.completed_at, coalesce(c.is_test, false) as is_test
    from assessment_sessions s
    join assessment_entitlements e on e.id = s.entitlement_id
    left join assessment_cohorts c on c.id = e.cohort_id
  ),
  sc as (select * from s_all where is_test = ${isTest}),
  rt as (select * from sc where attempt_no > 1),
  newest_done as (select entitlement_id, max(attempt_no) as no from sc where status = 'completed' group by entitlement_id),
  rr as (
    select r.ghl_synced, r.ghl_next_retry_at, r.ghl_last_error, r.ghl_tags_synced, r.ghl_tags_next_retry_at, r.ghl_tags_last_error,
           r.computed_at, rt.attempt_no < coalesce(nd.no, rt.attempt_no) as superseded
    from assessment_results r
    join rt on rt.id = r.session_id
    left join newest_done nd on nd.entitlement_id = rt.entitlement_id
  ),
  rf as (
    select f.pdf_status, f.pdf_attempts, f.pdf_status_at, f.share_card_error is not null as card_err
    from assessment_report_files f
    join rt on rt.id = f.session_id
  ),
  opened as (select max(w.changed_at) as at from assessment_retake_switch w where w.open = true)`;

const COUNTS_SQL = `${CTES}
  select
    now() as at,
    (select count(*) from rt)::int as retakes_in_db,
    (select count(*) from rt where status = 'completed')::int as retakes_completed,
    (select count(*) from rt where status <> 'completed')::int as retakes_open,
    (select count(*) from rt where status <> 'completed' and created_at < now() - interval '24 hours')::int as stuck_24h,
    (select min(created_at) from rt where status <> 'completed') as oldest_open_started,
    (select count(distinct entitlement_id) from rt where status = 'completed')::int as people_retaken,
    (select max(created_at) from rt) as last_started,
    (select max(completed_at) from rt) as last_completed,
    (select at from opened) as opened_at,
    (select count(*) from rt, opened where opened.at is not null and rt.created_at >= opened.at)::int as started_since_open,
    (select count(*) from rt, opened where opened.at is not null and rt.completed_at >= opened.at)::int as completed_since_open,
    (select count(*) from rr)::int as results,
    (select count(*) from rr where not ghl_synced and not superseded)::int as fields_unsynced,
    (select count(*) from rr where not ghl_synced and not superseded and computed_at < now() - interval '30 minutes')::int as fields_unsynced_30m,
    (select count(*) from rr where not ghl_synced and not superseded and ghl_next_retry_at is null and ghl_last_error is not null)::int as fields_gave_up,
    (select count(*) from rr where not ghl_tags_synced and not superseded)::int as tags_unsynced,
    (select count(*) from rr where not ghl_tags_synced and not superseded and computed_at < now() - interval '30 minutes')::int as tags_unsynced_30m,
    (select count(*) from rr where not ghl_tags_synced and not superseded and ghl_tags_next_retry_at is null and ghl_tags_last_error is not null)::int as tags_gave_up,
    (select count(*) from rr where superseded and (not ghl_synced or not ghl_tags_synced))::int as unsynced_superseded,
    (select max(computed_at) from rr) as last_result,
    (select count(*) from rf)::int as files,
    (select count(*) from rf where pdf_status = 'ready')::int as pdf_ready,
    (select count(*) from rf where pdf_status in ('failed', 'failed_permanent'))::int as pdf_failed,
    (select count(*) from rf where pdf_status <> 'ready' and pdf_attempts >= 3)::int as pdf_exhausted,
    (select count(*) from rf where pdf_status in ('pending', 'rendering') and pdf_status_at < now() - interval '30 minutes')::int as pdf_stuck_30m,
    (select count(*) from rf where card_err)::int as card_errors,
    (select count(*) from sc where attempt_no = 1 and status = 'completed')::int as first_completed,
    (select count(*) from s_all where is_test = ${!isTest} and attempt_no > 1)::int as other_scope_retakes`;

/** 只取写回代码自己加的类别前缀(`${klass}: ${detail}`);不像类别的一律 OTHER —— 错误原文绝不取出来 */
const klass = (col: string) => `case when split_part(${col}, ':', 1) ~ '^[A-Z_]{2,30}$' then split_part(${col}, ':', 1) else 'OTHER' end`;
const CLASSES_SQL = `${CTES}
  select 'fields' as kind, ${klass('ghl_last_error')} as klass, count(*)::int as n
  from rr where not ghl_synced and not superseded and ghl_last_error is not null group by 1, 2
  union all
  select 'tags' as kind, ${klass('ghl_tags_last_error')} as klass, count(*)::int as n
  from rr where not ghl_tags_synced and not superseded and ghl_tags_last_error is not null group by 1, 2`;

const SWITCH_SQL = `
  select w.open, w.changed_at, length(btrim(w.changed_by)) > 0 as who_recorded
  from assessment_retake_switch w
  order by w.id desc
  limit 10`;

try {
  const switchRows = queryOwnAttemptChoice<SwitchChangeRow>(SWITCH_SQL);
  const [row] = queryOwnAttemptChoice<Record<string, unknown>>(COUNTS_SQL);
  if (!row) throw new Error('计数查询没有返回行');
  const counts = parseCounts(row);
  const ghlClasses = queryOwnAttemptChoice<{ kind: 'fields' | 'tags'; klass: string; n: number }>(CLASSES_SQL);
  console.log(renderMonitor({ scope, switchRows, counts, ghlClasses }));
  process.exit(attentionItems(counts).length ? 1 : 0);
} catch (err) {
  console.error(`monitor:retake 失败:${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
