-- 语言跟着人走 —— `assessment_entitlements.lang`。
--
-- 【为什么存在人身上,而不是跟着链接走】
-- 跟着链接走的失败形态很具体:**报告页英文、PDF 中文**。因为 PDF 是**异步渲染**的 ——
-- 渲染那一刻没有「他当时点的是哪条链接」这个信息,只能猜一个默认值。
-- 分享卡同理(也是离线截图),GHL 消息更是。
-- 存在人身上之后,magic link / 报告页 / PDF / 分享卡 / GHL 消息全部读同一处,不可能分叉。
--
-- 【为什么带 check 约束,而不只是默认值】这一列会被三个入口写:
-- webhook(建记录时)、报告页的语言切换、`?lang=` 初始化。
-- 值域只有 zh / en,而一个拼错的语言码写进去之后,**读的那一侧只能回落默认** ——
-- 那就又变成静默了。约束让写入那一刻就失败,而失败点离原因最近。
--
-- 【默认 'zh' 而不是 not null 无默认】历史行有 3 条(1 真实 + 15 seed 里的存量),
-- 加列必须能就地补齐;而「没说的时候是中文」是这个产品当下的事实(马来西亚华语市场)。
alter table public.assessment_entitlements
  add column if not exists lang text not null default 'zh';

alter table public.assessment_entitlements
  drop constraint if exists assessment_entitlements_lang_check;
alter table public.assessment_entitlements
  add constraint assessment_entitlements_lang_check check (lang in ('zh', 'en'));

comment on column public.assessment_entitlements.lang is
  '这个人的语言(zh / en)。magic link、报告页、PDF、分享卡、GHL 消息全部读这一列 —— 语言跟着人走,不跟着链接走(PDF 异步渲染时没有链接可读)。?lang= 的语义是「设置」:读到就写这一列,然后按这一列渲染。';
