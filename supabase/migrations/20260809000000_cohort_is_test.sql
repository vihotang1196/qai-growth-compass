-- 测试 / 演示批次标记。
--
-- 【为什么必须有代码层的排除,单独一个 cohort 不够】
-- assessment-report 算基准线时取两个池:
--   cohortRows —— 按 entitlement.cohort_id 过滤
--   globalRows —— **全库所有 completed 结果,不按 cohort 过滤**
-- 而 selectBaseline 在 cohortRows 不足 min_n_for_baseline 时回落 globalRows。
-- 所以把测试数据放进单独 cohort 只能让它不污染那个 cohort 的基准,**全局兜底照样被污染** ——
-- 而真实学员在自己批次样本不足时走的正是全局兜底。
-- 失败形态是最不该出错的那一处:**新批次第一个学员的报告,基准是一堆假数据**,
-- 而报告本身看起来完全正常。
--
-- 【为什么标在 cohort 上而不是 entitlement 上】测试数据是整批造的、整批看的、整批删的。
-- 标在 entitlement 上要么每条都记得设,要么写个 trigger 去同步 —— 两者都是新的出错面。
-- 一个批次一个开关,Admin 那边也只需要一个复选框。
--
-- 【为什么不用 is_active】那一列管的是「这批还在进行中吗」,与「这批是假的吗」正交:
-- 一个已结束的真实批次是 is_active=false / is_test=false,一个正在演示的假批次是
-- is_active=true / is_test=true。复用一列会让两个问题互相绑住。

alter table public.assessment_cohorts
  add column if not exists is_test boolean not null default false;

comment on column public.assessment_cohorts.is_test is
  '测试 / 演示批次。true 时这批的结果【一律不进基准线的全局池】(见 _shared/baselinePools.ts),'
  'Admin 名单页默认隐藏,CSV 导出一律不含 —— 导出会被拿去做 GHL 分群,'
  '测试行混进去就是给假联系人发消息。'
  '默认 false —— 新建批次默认是真实批次,造测试数据的人必须显式声明 is_test=true。'
  '这个方向是有代价的(漏标一个测试批次会污染真实学员的基准),选它是因为:'
  '造数据是一个有意识的动作,把标记当成那个动作的一部分是可控的;'
  '而反过来默认 true 会让每一个真实批次都依赖有人记得去关掉它,'
  '那是把风险挪到了一个没人会想起来的地方。';

-- 现有批次都是真实的(库里只有一个默认批次),不需要回填
