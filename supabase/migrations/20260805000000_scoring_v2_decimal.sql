-- config v2.0.0：计分标度从 0–100 整数改为 0.0–5.0 一位小数。
--
-- 【为什么必须改列类型】assessment_results.total 原本是 int。v2 的总分是一位小数，
-- 而往 int 列插 2.8 时 PostgreSQL 会四舍五入成 3 —— 不报错，静默丢掉小数位。
-- 后果：报告页显示 2.8（前端算的），库里存 3；档位若从库里的值重算就落到别的档
-- （2.8 属于 spot，3.0 属于 semi_auto）。学员同时看得见分数和档位名，两者不一致
-- 他会直接不信这份报告。
--
-- numeric(2,1) 恰好覆盖 0.0–5.0：2 位有效数字、1 位小数。越界会报错而不是截断，
-- 这正是我们想要的 —— 上游算出 5.1 应该炸，不该被悄悄存成 5.1 或 5。
--
-- 【dim_scores 不用改类型】它是 jsonb，数字精度由 JSON 本身承载。
-- 但原注释写的是 0..100，跟着改掉 —— 过时的注释比没注释更糟。

alter table public.assessment_results
  alter column total type numeric(2, 1) using total::numeric(2, 1);

-- 值域约束。config 的 tiers 覆盖 0.0–5.0，越界只可能是上游算错，
-- 数据库这一层挡住，别让错分数落库之后再去报告里追查
alter table public.assessment_results
  add constraint assessment_results_total_range check (total >= 0.0 and total <= 5.0);

comment on column public.assessment_results.dim_scores is
  '{ dimensionKey: 0.0–5.0 }，一位小数。v2.0.0 起为 5 个维度（移除 measure）';

comment on column public.assessment_results.total is
  '五维简单平均，0.0–5.0 一位小数。取整发生在档位判定之前，显示与判定共用同一个值';

-- tier 的 check 约束在 v2 里取值不变（manual/spot/semi_auto/systemic/flywheel），
-- 只是区间边界从 0–100 改成 0–5，那是 config 侧的事，数据库不需要动。
