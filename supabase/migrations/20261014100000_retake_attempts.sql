-- 重填第 1 步:数据层 +「每人最新的一份」的唯一定义 —— 对现有数据零变化(docs/retake-design.md 第 1、6 节)。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【这一步做什么】
--   1. `assessment_sessions.attempt_no`(默认 1):现有每一行都是第 1 份。
--   2. `(entitlement_id, attempt_no)` 唯一:以后「连点两次只建一份」的保护靠它(auth 的 get-or-create)。
--   3. 同一个人同一时间最多一份没做完的 —— 部分唯一索引,由数据库保证,不靠代码记得。
--   4. 视图 `assessment_latest_results`:每人最新完成的一份。基准线、看板从这里取;
--      与 `_shared/attempts.ts` 的 `pickReportAttempt` / `latestPerEntitlement` 是同一个定义。
--
-- 【刻意不做的:`entitlement_id` 上原来那个 unique 这一步不去掉】
-- 方案里写的是「换约束」,实施时改成「这一步只加、不去」,理由两条:
--   - 部署顺序:迁移先上、函数后上。中间那段时间旧函数照常工作 —— 它们读写的形状一点没变。
--   - 第 1 步不开放重填:那个 unique 还在,数据库层面仍然保证「一人一份」,第 1 步的「零变化」由数据库兜底。
-- 去掉它放在第 2 步(开放 `start_retake` 的那一步),那之前要先把 `scripts/seed-test-data.ts` 的 upsert 改成按新键。
--
-- 【不改任何一行已有数据】加列用的是常量默认值(Postgres 11 起只改目录,不重写行);
-- 断言不成立就整条回滚(与 20260812300000 同一个做法)。
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.assessment_sessions
  add column if not exists attempt_no int not null default 1;

-- 先断言:每个 entitlement 恰好 0 或 1 份、全部 attempt_no = 1。不成立 → 整条迁移回滚,什么都不留
do $$
declare
  multi int;
  not_one int;
begin
  select count(*) into multi
    from (select entitlement_id from public.assessment_sessions group by entitlement_id having count(*) > 1) x;
  select count(*) into not_one from public.assessment_sessions where attempt_no <> 1;
  if multi > 0 or not_one > 0 then
    raise exception 'retake step 1 precondition failed: % entitlement(s) with more than one session, % session(s) with attempt_no <> 1',
      multi, not_one;
  end if;
end $$;

alter table public.assessment_sessions
  add constraint assessment_sessions_attempt_no_positive check (attempt_no >= 1);

alter table public.assessment_sessions
  add constraint assessment_sessions_entitlement_attempt_key unique (entitlement_id, attempt_no);

-- 同一个人同一时间最多一份没做完的(连点、开两个标签页都建不出第二份)
create unique index if not exists assessment_sessions_one_open_attempt
  on public.assessment_sessions (entitlement_id)
  where status <> 'completed';

comment on column public.assessment_sessions.attempt_no is
  '第几份答题记录(重填)。现有的全是 1;第 2 步起由 start_retake 按最大值 + 1 插入。「当前那份」与「报告看的那份」的定义在 supabase/functions/_shared/attempts.ts。';

-- ─────────────────────────────────────────────────────────────────────────────
-- 每人最新完成的一份 —— 统计(基准线、看板)唯一的来源
--
-- 【security_invoker】视图默认以创建者的权限执行,会绕过底表的 RLS:不加的话,
-- 任何拿着 publishable key 的人都能经 PostgREST 读到全部分数。加了之后按调用者的权限查底表(底表都开着 RLS);
-- 再把 anon / authenticated 的权限收回 —— 两道。只给 service_role(Edge Function 用的那个)。
-- ─────────────────────────────────────────────────────────────────────────────
create view public.assessment_latest_results
  with (security_invoker = true) as
  select distinct on (s.entitlement_id)
    r.session_id,
    r.dim_scores,
    r.total,
    r.tier,
    r.weakest,
    r.strongest,
    r.computed_at,
    r.config_version,
    r.config_sha256,
    s.entitlement_id,
    s.attempt_no,
    s.completed_at,
    e.cohort_id,
    coalesce(c.is_test, false) as cohort_is_test
  from public.assessment_results r
  join public.assessment_sessions s on s.id = r.session_id
  join public.assessment_entitlements e on e.id = s.entitlement_id
  left join public.assessment_cohorts c on c.id = e.cohort_id
  where s.status = 'completed'
  order by s.entitlement_id, s.attempt_no desc;

revoke all on public.assessment_latest_results from anon, authenticated;
grant select on public.assessment_latest_results to service_role;

comment on view public.assessment_latest_results is
  '每人最新完成的一份结果(重填第 1 步)。基准线与看板从这里取;与 supabase/functions/_shared/attempts.ts 同一个定义。cohort_is_test = coalesce(is_test, false)。';
