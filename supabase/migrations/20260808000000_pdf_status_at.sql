-- PDF 状态最后一次变化的时刻。给定时兜底 sweep 用。
--
-- 【为什么需要它】sweep 要能分辨「正在渲染」和「渲染中途死了」。
-- 这张表上原本没有任何一列记录 pdf_status 是【什么时候】变成现在这个值的:
--   computed_at 是 finalize 那一刻,一条三天前算完、此刻正常在渲的行,拿它算年龄会算成三天;
--   entitlements 上那个 touch_updated_at trigger 只装在那张表上,这张没有。
-- 没有年龄就只有两个选择:要么不扫 rendering(卡死的行永远只能靠人从名单页发现,
-- 而那正是 sweep 想取消的东西),要么见到 rendering 就重跑(会撞上正在跑的那一次,
-- 平白多烧一次 Chromium 并把 attempts 提前耗掉)。两个都不好,所以加这一列。
--
-- 【为什么可空、且不回填】判断年龄时用 coalesce(pdf_status_at, computed_at):
--   * 迁移与代码的上线顺序不保证 —— 迁移先到时没人写这一列,回落 computed_at 仍然能判;
--   * 修复前就存在的老行同理。
-- 回落最坏是把年龄算大了(把一条其实很新的行当成陈旧的去重跑),而那是安全的方向:
-- attempts 有上限兜着,而漏扫是没有上限的。
--
-- 【为什么不加 trigger 自动维护】trigger 会在【任何】update 时刷新它,
-- 包括与 pdf 无关的写(比如 GHL 重试写 ghl_last_error)。那样一条卡在 rendering 的行
-- 会被一次无关的写「续命」,永远够不到陈旧阈值 —— 一个看起来在工作、实际永不触发的兜底,
-- 比没有兜底更糟。所以由改状态的那几处显式写,写的地方就是它的定义。

alter table public.assessment_results
  add column if not exists pdf_status_at timestamptz;

comment on column public.assessment_results.pdf_status_at is
  'pdf_status 最后一次变化的时刻,由改状态的代码显式写入(render-pdf 的 rendering/ready/failed 三处、'
  'assessment-admin 的重置)。【不要】加 trigger 自动维护:无关的 update 会把它刷新,'
  '使卡在 rendering 的行永远够不到 sweep 的陈旧阈值。'
  '判断年龄时用 coalesce(pdf_status_at, computed_at) —— 这一列是后加的,老行为 null。';
