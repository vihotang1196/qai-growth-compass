-- 默认批次 seed。
--
-- 【为什么这条进 migration,而 admin_users 不进】
-- 判断标准是「换一个环境重建,代码还能不能正常跑」:
--   没有 is_default = true 的 cohort → webhook 的兜底逻辑无处可落,payload 不带
--   cohort 时 cohort_id 会静默落 null。不报错,但基准线、cohort_rank、批次聚合
--   看板整块失效,而且要等 Stage 8 才会发现。这是【代码的功能依赖】。
--   admin_users 为空只是没人能登录后台,代码本身照常运行,而且内容含个人邮箱 ——
--   那是【环境配置】,手动 insert。
--
-- 放 migration 的好处是可复现:以后重建环境、开 staging,不会漏这一步。

insert into public.assessment_cohorts (name, event_date, source_tag, is_active, is_default)
values ('默认批次', null, null, true, true)
on conflict do nothing;

-- on conflict do nothing 会吞掉【任何】唯一冲突,不只是「默认批次已存在」这一种。
-- 所以插完必须断言目标状态真的达成了,否则这个 seed 可能静默失败,
-- 而失败的后果(cohort_id 落 null)恰恰是不报错的那类问题。
do $$
begin
  if not exists (select 1 from public.assessment_cohorts where is_default) then
    raise exception
      'seed 失败:没有 is_default = true 的批次。'
      'webhook 的 cohort 兜底会静默落 null,基准线与批次看板将整块失效。';
  end if;
end $$;

-- source_tag 留 null 是有意的:默认批次靠 is_default 选出,不靠 tag 匹配。
-- 给它一个 'default' 之类的魔法字符串,只会诱使代码去按 tag 找它。
comment on index public.assessment_cohorts_single_default is
  '保证全库最多一行 is_default = true。默认批次由 20260731000200 seed 建立。';
