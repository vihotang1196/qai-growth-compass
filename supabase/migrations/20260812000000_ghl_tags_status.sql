-- 标签写回的状态列 —— **与字段写回的状态分开**。
--
-- 【为什么不复用 ghl_synced / ghl_last_error】D9 定的是「标签独立于字段写入」:
-- 字段炸了标签照打,标签炸了不影响字段的 synced 判定。共用一列的话
-- 「字段成了、标签没成」这个状态**没有表达方式** —— 而那是最常见的一种:
-- 字段是 PUT 一次,标签是 POST + 可能一次 DELETE,三次调用里任意一次可能失败。
--
-- 【四列各自的作用】
--   ghl_tags_synced        标签是否已全部落地(与 ghl_synced 平行)
--   ghl_tags_last_error    带 D9 前缀(TRANSIENT: / CONFIG: / AUTH:),sweep 据此跳过不可重试的
--   ghl_tags_next_retry_at TRANSIENT 的指数退避时间;CONFIG/AUTH 置 null
--   ghl_tags_applied       **我们上次实际打上去的标签**(jsonb 数组)
--
-- 【ghl_tags_applied 为什么必须存下来】重答或重算之后档位可能从 spot 变成 semi_auto,
-- 旧的 assessment_tier_spot 必须移除 —— 否则一个人身上挂两个互斥的档位标签,
-- GHL 里两条 workflow 都会触发。
--
-- 而「该移除哪些」有两种算法:
--   (a) 先 GET contact 现有标签再算差集 —— 多一次读,而且拿回的是客户**全部**标签
--   (b) 存我们上次打了什么,只对自己命名空间做差集 —— 0 次额外读
-- 选 (b)。它同时是一条**安全**规则的前提:只移除 `assessment_` 前缀
-- 且在这一列里的标签。客户在 GHL 里有大量与本系统无关的标签,误删不可逆。
alter table public.assessment_results
  add column if not exists ghl_tags_synced        boolean not null default false,
  add column if not exists ghl_tags_last_error    text,
  add column if not exists ghl_tags_next_retry_at timestamptz,
  add column if not exists ghl_tags_applied       jsonb;

-- 与字段那条 (ghl_next_retry_at) where ghl_synced = false 同一个形状:
-- sweep 的候选查询按这两列挑行,所以部分索引只覆盖「还没同步」的那部分。
create index if not exists assessment_results_ghl_tags_retry_idx
  on public.assessment_results (ghl_tags_next_retry_at)
  where ghl_tags_synced = false;

comment on column public.assessment_results.ghl_tags_applied is
  '我们上次实际打上去的 assessment_* 标签(jsonb 数组)。移除旧标签时只对这一列做差集,且只碰 assessment_ 前缀 —— 客户的其它标签不可误删。';
