-- 删掉已经搬走的那两组列。**不可逆**,所以先断言「没有信息会因此丢失」。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【搬到哪儿了】
--   `assessment_results.pdf_* / share_card_*` → `assessment_report_files(session_id, lang)`
--   `assessment_sessions.locale`              → `assessment_entitlements.lang`
--
-- 【为什么现在才删,以及删之前做了什么】
-- 关键那句是:**一列没人读就不构成第二个真相源;危险的是读它的人,不是列本身。**
-- 所以顺序是「门先立起来,列之后再删」——
--   ① `check:legacy-columns` 已在构建链上,且**无豁免**;
--   ② 按[判断标准 0]刻意把起因造回去验过一遍:顶层 select / 嵌套 select / locale
--      **三种形状都让那道门变红**(起因已被修好,所以必须刻意改回去 —— 那一步最容易被省掉);
--   ③ 生产上新表在用(报告页的下载按钮、名单页那一格、sweep 都走新表)。
--
-- 【为什么不需要保留历史 PDF 信息】PDF 与分享卡是**派生物**:
-- 源数据(答案、结果)一个字不动,重渲一次就有。
-- 而 `pdf_attempts` 这类只对「当下要不要重试」有意义,不是历史资产。
--
-- 【顺带:全新重放这套迁移仍然成立】`20260812300000` 那条会读
-- `assessment_results.pdf_*` 把存量迁进新表,而它在这条**之前**执行。
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 断言:不能有「即将丢掉非空 pdf_path / 非 pending 状态,而新表里没有对应行」的记录 ──
--
-- 【为什么不断言「两表行数相等」】那是错的:seed 那批从没渲过 PDF
-- (`pdf_status = 'pending'`、`pdf_path is null`),所以 20260812300000 当初就没迁它们 ——
-- 它们身上本来就没有信息。断言行数相等会红在一个正确的状态上,
-- 而那种断言最后一定会被人注释掉。
--
-- 真正要问的是:**有没有哪一行带着信息、却没有对应的新行。**
do $$
declare
  orphan_count integer;
  orphan_list  text;
  dropped_info integer;
begin
  select count(*), coalesce(string_agg(r.session_id::text, ', '), '')
    into orphan_count, orphan_list
  from public.assessment_results r
  where (r.pdf_path is not null or r.pdf_status <> 'pending')
    and not exists (
      select 1 from public.assessment_report_files f where f.session_id = r.session_id
    );

  if orphan_count > 0 then
    raise exception
      '拒绝删列:有 % 行带着 PDF 信息但新表里没有对应行(session_id: %)。'
      '先把它们迁进 assessment_report_files,或者确认那些信息可以丢 —— 整条迁移已回滚。',
      orphan_count, orphan_list;
  end if;

  -- 把「这次丢掉了多少条非空的历史值」记进迁移日志。
  -- 【为什么要记】删列之后这个数字永远问不出来了,而它是唯一能说明
  -- 「当时丢的是什么规模」的东西(判断标准 2:打印一个值就要对它做判断 ——
  -- 这里的判断是上面那条 exception,数字本身是给以后的人看的)。
  select count(*) into dropped_info
  from public.assessment_results
  where pdf_path is not null or share_card_path is not null;
  raise notice '即将删列。其中带非空 pdf_path / share_card_path 的行:% 行(它们在新表里都有对应行)', dropped_info;
end $$;

-- ── 索引先显式删掉 ──
-- Postgres 会随列一起删掉依赖它的索引,但显式写出来是为了让「这个索引也没了」
-- 出现在迁移文件里 —— 否则下一个人只会看到「少了个索引」,而不知道是哪一步拿走的。
drop index if exists public.assessment_results_pdf_status_idx;

alter table public.assessment_results
  drop column if exists pdf_path,
  drop column if exists pdf_status,
  drop column if exists pdf_status_at,
  drop column if exists pdf_attempts,
  drop column if exists pdf_last_error,
  drop column if exists share_card_path,
  drop column if exists share_card_tall_path,
  drop column if exists share_card_error;

-- `locale` 上那条 check 约束是列级的,随列一起删。
-- 【它与 entitlement.lang 的区别】`locale` 是「这次会话从哪种语言的页面进来的」——
-- 跟着链接走的旧模型;而语言是**这个人的属性**(PDF 异步渲染时没有链接可读)。
alter table public.assessment_sessions
  drop column if exists locale;

comment on table public.assessment_results is
  '一次诊断的计分结果。PDF / 分享卡的状态与路径【不在这里】—— 它们按语言分行,见 assessment_report_files。';
