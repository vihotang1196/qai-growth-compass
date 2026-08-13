-- 每种语言一份报告文件 —— `assessment_report_files`。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【为什么按语言分行,而不是加一列 pdf_lang 然后重渲覆盖】
--
-- 覆盖式(A)之下,一个人切五次语言就渲五次,而且**永远如此** —— 于是要给一个正当的
-- 用户动作加限流,而限流是在管理一个不该存在的问题。
-- 按语言分行(B)之下,切回去直接给已有的那一份:**每种语言一生只渲一次**,那是终态。
--
-- 一张小表 + 几处取数改动是**一次性**成本;A 的成本是每次切换都付。
--
-- 而 A 还会让我们主动造一个已经拆过很多次的形状:终身计数(`pdf_attempts`)用在
-- 一个正当动作上,表现是「那个按钮某天起就不动了」,而且没有任何提示。
--
-- 【主键是 (session_id, lang)】「同一个 session 同一种语言只能有一份」由数据库保证,
-- 不靠代码记得。sweep 的候选也因此天然按 (session_id, lang) 挑 ——
-- 按 session 挑的话,一个 session 有两行时会重复渲同一份。
--
-- 【分享卡也在这张表里】它渲的是报告页的内容(含档位名),所以它同样跟语言有关。
-- 放在 results 上、只有一份的话,「中文卡 + 英文报告」这种组合会静默出现。
--
-- 【为什么不双写、不保留双真相源】PDF 与分享卡是**派生物**:
-- 迁错了就重渲一次,源数据(答案、结果)一个字都不会丢。
-- 需要双写的场景是「数据重建不出来」,而这里重建的成本正好是一次 Lambda 调用。
-- 所以直接切,不搞双写期 —— 那个期间本身才是最容易分叉的时候。
--
-- 旧的 `assessment_results.pdf_*` 列**这一轮不删**:删列不可逆,而且没有理由和建表同时做。
-- 一列没人读就不构成第二个真相源 —— **危险的是读它的人,不是列本身**。
-- 所以配套加了一道门(`check:pdf-columns`)禁止再读那几列;
-- 等生产上跑通一段时间,再单独一条迁移删列。
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.assessment_report_files (
  session_id uuid not null references public.assessment_sessions (id) on delete cascade,
  lang       text not null check (lang in ('zh', 'en')),

  pdf_path      text,
  pdf_status    text not null default 'pending'
                check (pdf_status in ('pending', 'rendering', 'ready', 'failed', 'failed_permanent')),
  pdf_status_at timestamptz,
  -- 【只数失败】这一列是失败重试预算(上限 MAX_PDF_ATTEMPTS)。
  -- 用户主动请求另一种语言不该消耗它 —— 那不是重试,而 B 方案下他每种语言只会请求一次
  pdf_attempts  integer not null default 0,
  pdf_last_error text,

  share_card_path      text,
  share_card_tall_path text,
  share_card_error     text,

  created_at timestamptz not null default now(),

  primary key (session_id, lang)
);

alter table public.assessment_report_files enable row level security;

-- sweep 的候选查询:按状态挑,而 `ready` 的行永远不该进候选,所以做成部分索引
create index if not exists assessment_report_files_status_idx
  on public.assessment_report_files (pdf_status)
  where pdf_status <> 'ready';

comment on table public.assessment_report_files is
  '每个 (session, 语言) 一行报告文件。语言跟着人走(entitlement.lang),而 PDF 是异步渲染的 —— 渲染那一刻没有链接可读,所以必须知道这一份是哪种语言。切回已有语言时直接给已有文件,不重渲。';
comment on column public.assessment_report_files.pdf_attempts is
  '失败重试次数,上限见 MAX_PDF_ATTEMPTS。【只数失败】—— 用户主动请求另一种语言不消耗它。';

-- ── 把现有的一行真实数据迁过来 ──────────────────────────────
-- 【为什么带断言】迁移写完就跑一次,而「迁了几行」这个数字如果没人核对,
-- 迁漏了的表现是报告页上那个下载按钮消失,而不是任何一处报错。
do $$
declare
  moved integer;
  expected integer;
begin
  select count(*) into expected
  from public.assessment_results
  where pdf_path is not null or pdf_status <> 'pending';

  insert into public.assessment_report_files (
    session_id, lang, pdf_path, pdf_status, pdf_status_at, pdf_attempts, pdf_last_error,
    share_card_path, share_card_tall_path, share_card_error
  )
  select
    r.session_id,
    -- 迁移之前 render-pdf 里两处都硬编码 lang=zh,所以存量文件**全部是中文的**。
    -- 这不是猜:那两行代码就在 api/render-pdf.ts 里(报告页 goto 与分享卡 goto)
    'zh',
    r.pdf_path, r.pdf_status, r.pdf_status_at, r.pdf_attempts, r.pdf_last_error,
    r.share_card_path, r.share_card_tall_path, r.share_card_error
  from public.assessment_results r
  where r.pdf_path is not null or r.pdf_status <> 'pending'
  on conflict (session_id, lang) do nothing;

  select count(*) into moved from public.assessment_report_files where lang = 'zh';
  if moved <> expected then
    raise exception '迁移行数不符:预期 %,实际 % —— 整条迁移回滚', expected, moved;
  end if;
  raise notice '已迁移 % 行(全部按 zh —— 旧 render-pdf 硬编码 lang=zh)', moved;
end $$;
