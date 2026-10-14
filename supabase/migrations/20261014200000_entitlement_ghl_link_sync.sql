-- 换链接之后把新链接写进 GHL 的 `qai_assessment_magic_link` —— 记账的四列(2026-10-14,PROGRESS「换链接后写回魔法链接字段」)。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【与 assessment_results 上字段写回那四列同一套规矩】synced / attempts / last_error / next_retry_at;
-- 写的代码在 supabase/functions/_shared/ghlMagicLink.ts,补写由 assessment-ghl-resync 做。
--
-- 【ghl_link_synced 可空、默认 null —— 这是这条迁移里唯一要紧的决定】
--   null  = 从没换过链接:字段是 GHL 自己的工作流写的那条(表单 → Webhook → Update Contact Field),是对的
--   false = 换过链接、新链接还没确认写进 GHL(补写会挑它)
--   true  = GHL 回显了这条新链接
-- 默认值不能是 false:那样补写会把现有的每一个人都挑出来写一遍 —— 一次没人授权的、对全部真实联系人的写入。
-- 也不能是 true:从没写过,说「已同步」是在数据里说谎。只有后台「换链接」把它置成 false。
--
-- 【不改任何一行已有数据】可空列不带默认值、带常量默认值的列 —— Postgres 11 起都只改目录、不重写行;
-- 末尾断言「没有任何一行的 ghl_link_synced 不是 null」,不成立就整条回滚。
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.assessment_entitlements
  add column if not exists ghl_link_synced boolean,
  add column if not exists ghl_link_attempts int not null default 0,
  add column if not exists ghl_link_last_error text,
  add column if not exists ghl_link_next_retry_at timestamptz;

-- 补写的候选查询只看 false 的行(很少);部分索引让它不扫全表
create index if not exists assessment_entitlements_ghl_link_retry_idx
  on public.assessment_entitlements (ghl_link_next_retry_at)
  where ghl_link_synced = false;

comment on column public.assessment_entitlements.ghl_link_synced is
  '换链接后 GHL 的 qai_assessment_magic_link 是否已确认是新链接。null = 从没换过链接(字段由 GHL 自己写,对的);false = 待写;true = GHL 回显已核对。见 _shared/ghlMagicLink.ts';
comment on column public.assessment_entitlements.ghl_link_last_error is
  '最近一次写魔法链接字段失败的原因,以 TRANSIENT: / CONFIG: / AUTH: 开头(CONFIG / AUTH 不自动重试)。不含 token';

do $$
declare
  touched int;
begin
  select count(*) into touched from public.assessment_entitlements where ghl_link_synced is not null;
  if touched > 0 then
    raise exception 'entitlement ghl link sync: % row(s) already have ghl_link_synced set — expected none', touched;
  end if;
end $$;
