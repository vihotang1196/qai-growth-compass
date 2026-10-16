-- 重填第 5 步(准备):对真实学员开放重填的开关 —— docs/retake-design.md 第 6 节第 5 步。
-- Viho 2026-10-16 定:用数据库开关,不改常量;后台有一个只有管理员能用的开关;每次切换都记下谁、什么时间、开还是关。
--
-- 【一张只追加的表,最新一行就是开关】没有另外一个「当前值」:当前值 = id 最大的那一行的 open。
--   于是「切换记录」与开关本身是同一份数据 —— 不会出现「值改了、记录没写上」或者反过来(没有第二个真相源)。
-- 【默认关闭 = 一行都没有】这条迁移不插任何一行。代码读不到行、读取出错、值不是 true → 一律按关闭
--   (supabase/functions/_shared/retakeSwitch.ts)。
-- 【关闭只拦「开始新的重填」】已经开始的那一份照样能做完、能放弃 —— 那两条路径不读这个开关。
-- 【只追加】service_role 只有 select / insert;update / delete / truncate 收回 —— 函数改不了记录。
--   (Dashboard 的 SQL 编辑器用 postgres 角色,仍然能改 —— 那是人在改,不是代码。)
-- 【谁能写】只有 assessment-admin 的 retake_switch_set(管理员名单之内);changed_by = 那个管理员的邮箱。

create table public.assessment_retake_switch (
  id          bigint generated always as identity primary key,
  open        boolean not null,
  changed_by  text not null check (length(btrim(changed_by)) > 0),
  changed_at  timestamptz not null default now()
);

comment on table public.assessment_retake_switch is
  '对真实学员开放重填的开关(只追加)。当前值 = id 最大的那一行的 open;一行都没有 = 关闭。'
  '测试批次不受它影响。每一行 = 一次切换:谁(changed_by)、什么时间(changed_at)、开还是关(open)。';

alter table public.assessment_retake_switch enable row level security;

revoke all on public.assessment_retake_switch from anon, authenticated, service_role;
grant select, insert on public.assessment_retake_switch to service_role;
