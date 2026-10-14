-- 重填第 2 步:服务端的重填(docs/retake-design.md 第 1、3、5 节)。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【这一步做三件事】
--   1. 去掉 `assessment_sessions.entitlement_id` 上原来那个 unique(第 1 步刻意留到这一步)。
--      之后一个人可以有多份;「连点两次只建一份」由 `(entitlement_id, attempt_no)` 唯一与
--      「同一时间最多一份没做完的」部分唯一索引保证(第 1 步已加)。按 entitlement 查答题记录走
--      `(entitlement_id, attempt_no)` 那个唯一索引的前导列,不需要另建。
--   2. `assessment_entitlements.ghl_tags_applied`:GHL「上次打了哪些标签」记在人身上(联系人上只有一套标签)。
--      **不回填**:没有记录时代码回落到这个人编号最大、记过标签的那一份结果(_shared/ghlTagsWriteback.ts
--      的 previousAppliedTags)—— 今天每人一份,回落取到的就是原来读的那一列。
--   3. 两个触发器 —— 「已完成的不能再写入」的第二道,在数据库里(第一道是函数里的 guardSessionWrite):
--      - 答题记录的状态只往前走(in_progress → survey → completed);已完成的那份背景题、归属、编号都不能改
--      - 已完成的那份的答案与问卷不能再写(insert / update 都拒)
--      删除不拦:放弃重填删的是没做完的那份;seed 的 --clean 级联删的是测试数据。
--
-- 【部署顺序】迁移先上、函数后上。中间那段时间旧函数(第 1 步的)照常工作:它们已经按「可能多份」读,
-- 而第 2 份只有新函数的 start_retake 能建。触发器拦的写法,今天的任何一条代码路径都不会走到(守卫先拦)。
--
-- 【不改任何一行已有数据】去约束、加可空列、建函数与触发器。
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.assessment_sessions drop constraint assessment_sessions_entitlement_id_key;

alter table public.assessment_entitlements add column if not exists ghl_tags_applied jsonb;
comment on column public.assessment_entitlements.ghl_tags_applied is
  'GHL 上这个联系人现在应有的 assessment_* 标签(最近一次同步成功时写)。下一次算差集的依据;null = 还没有记录,回落到编号最大、记过标签的那一份结果(_shared/ghlTagsWriteback.ts)。';

-- ── 状态只往前走 ──────────────────────────────────────────────
-- 次序就写在触发器里(array_position),不另建一个函数:另建的话,触发器里那次调用要求**写入者**
-- 对它有 EXECUTE 权限 —— 那是一个与这条规则无关、却能让所有写入失败的依赖。
create or replace function public.assessment_sessions_forward_only()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if array_position(array['in_progress', 'survey', 'completed'], new.status)
     < array_position(array['in_progress', 'survey', 'completed'], old.status) then
    raise exception 'assessment_sessions %: status can only move forward (% -> %)', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  if old.status = 'completed'
     and (new.profile is distinct from old.profile
          or new.entitlement_id is distinct from old.entitlement_id
          or new.attempt_no is distinct from old.attempt_no) then
    raise exception 'assessment_sessions %: a completed attempt is immutable (profile / entitlement / attempt_no)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger assessment_sessions_forward_only
  before update on public.assessment_sessions
  for each row execute function public.assessment_sessions_forward_only();

-- ── 已完成的那份的答案与问卷不能再写 ──────────────────────────
create or replace function public.assessment_completed_attempt_frozen()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if exists (select 1 from public.assessment_sessions s where s.id = new.session_id and s.status = 'completed')
     or (tg_op = 'UPDATE'
         and exists (select 1 from public.assessment_sessions s where s.id = old.session_id and s.status = 'completed')) then
    raise exception '%: session % is completed — its answers and survey cannot be written', tg_table_name, new.session_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger assessment_answers_completed_frozen
  before insert or update on public.assessment_answers
  for each row execute function public.assessment_completed_attempt_frozen();

create trigger assessment_survey_completed_frozen
  before insert or update on public.assessment_survey
  for each row execute function public.assessment_completed_attempt_frozen();

-- 这两个函数只给触发器用(返回 trigger 的函数本来也不能直接调;收回只是不留口子)
revoke all on function public.assessment_sessions_forward_only() from public, anon, authenticated;
revoke all on function public.assessment_completed_attempt_frozen() from public, anon, authenticated;
