-- config v3.0.0：计分改为每题按 option_count 归一化，per-question 分是小数
-- （3 选项得 0 / 2.5 / 5，4 选项得 0 / 1.667 / 3.333 / 5）。
--
-- assessment_answers.score 原本是 `int not null`，v2 时代存的是 option_values 查表得到的
-- 整数分。v3 有两个问题叠加：
--   1. per-question 分是小数，int 存不下（会静默四舍五入，跟 total 那次同一类）；
--   2. 更根本地，score 只是缓存 —— finalize 以 option_index 为准重算（option_index 是
--      不受标度影响的事实）。既然每次都重算，就不该再存一个会过时的派生值。
--
-- 所以：drop not null，assessment-quiz 不再写它。留列不删是为了避免部署顺序风险
-- （迁移可能先于函数重部署上线；老函数仍会带 score 插入，列还在就不会失败）。
-- 列变成「总是 null 的历史遗留」，等 v3 稳定后可另起一个迁移删除。

alter table public.assessment_answers alter column score drop not null;

comment on column public.assessment_answers.score is
  'v2 遗留缓存列，v3 起不再写入（恒为 null）。分数在 finalize 按 option_index + config 重算，见 assessment-score。稳定后可删';
