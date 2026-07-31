-- AI 盈利增长罗盘 学员诊断系统 初始化
--
-- RLS 策略:9 张表全部 enable RLS 且【不建任何 policy】。
--   anon / authenticated 一律拒绝;所有读写走 Edge Function 的 service_role
--   (service_role 绕过 RLS)。比逐字段写 policy 更简单、更不容易漏。
--
-- 与 PROGRESS.md 0.7 的 SQL 逐行一致。改这里就要同步改那里。

create extension if not exists "pgcrypto";

-- ── 0. 全局配置 (D8) ──────────────────────────────────────────
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.app_settings is
  '全局运行时配置。当前用途:key = ''ghl_field_map'',value = { "<field_key>": "<ghl_field_id>" }。'
  'Edge Function 读取顺序:内存缓存(10 分钟 TTL)→ 本表 → 回源 GHL 并 upsert。'
  'Admin 的「刷新字段映射」直接写本表,所有实例下次 TTL 过期即生效。';

-- ── 1. 后台允许名单 ─────────────────────────────────────────────
create table public.admin_users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  created_at timestamptz not null default now()
);
comment on table public.admin_users is '后台允许名单;初始管理员用 SQL 手动 insert,无注册页';

-- ── 2. 批次 ────────────────────────────────────────────────────
create table public.assessment_cohorts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  event_date date,
  source_tag text unique,                      -- GHL tag / payload 里的批次标识
  is_active  boolean not null default true,
  is_default boolean not null default false,   -- D3:payload 没带 cohort 时兜底
  created_at timestamptz not null default now()
);
create unique index assessment_cohorts_single_default
  on public.assessment_cohorts ((is_default)) where is_default;

-- ── 3. 准入记录 ────────────────────────────────────────────────
create table public.assessment_entitlements (
  id              uuid primary key default gen_random_uuid(),
  ghl_contact_id  text not null unique,        -- 幂等冲突键(邮箱会变,不能用)
  cohort_id       uuid references public.assessment_cohorts(id) on delete set null,
  phone_e164      text,                        -- 主匹配键;解析失败为 null
  phone_tail      text,                        -- E.164 去 + 后最后 8 位,容错匹配键
  phone_raw       text,                        -- 原始输入,解析失败时 Admin 标红用
  email_lower     text,                        -- 一律 trim().toLowerCase()
  name            text,
  access_token      text not null unique,      -- 32 字节随机;重发不轮换;不自动过期
  access_revoked_at timestamptz,                -- 作废时间;非 null 即拒绝该 token
  status          text not null default 'pending'
                  check (status in ('pending','link_sent','started','completed')),
  link_sent_at    timestamptz,                 -- D4:每次发送都更新,兼作 60s 节流依据
  first_login_at  timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.assessment_entitlements.email_lower is
  '【不唯一,故意不加 unique 约束】GHL 里同一个邮箱挂在两个 contact 上是可能的'
  '(同一人重复报名、公司共用邮箱)。加 unique 会让 webhook 在重复邮箱时直接失败,'
  '丢掉整条准入记录,那更糟。'
  '代价是查询侧必须处理多命中:命中 >1 条一律【视为未命中】,不发链接,页面文案不变,'
  '同时记 warn 日志带上 email_lower 供 Admin 排查「疑似重复 contact」。'
  '与 phone_tail 同一条原则 —— 宁可让客户联系我们,也不能把 A 的报告链接发给 B。';

comment on column public.assessment_entitlements.phone_tail is
  'E.164 去 + 后最后 8 位,容错匹配键。同样不唯一,命中 >1 条视为未命中(防碰撞)。'
  '少于 8 位数字的输入不进 tail 匹配。';

comment on column public.assessment_entitlements.access_revoked_at is
  '链接作废时间。access_token 不自动过期(学员可能几周后回来看报告,'
  '自动过期只会制造大量「链接失效」客服),但必须有撤销路径 ——'
  '报告含对方营收、询盘量、经营弱点,链接经 WhatsApp 与邮箱流转,'
  '转发 / 截图 / 共用设备 / 换号都可能让它落到别人手里。'
  'Admin 的「作废并重发新链接」置本列 = now() 并生成新 access_token;'
  '校验 token 时 access_revoked_at is not null 一律拒绝。';
create index assessment_entitlements_phone_e164_idx    on public.assessment_entitlements (phone_e164);
create index assessment_entitlements_phone_tail_idx    on public.assessment_entitlements (phone_tail);
create index assessment_entitlements_email_lower_idx   on public.assessment_entitlements (email_lower);
create index assessment_entitlements_cohort_status_idx on public.assessment_entitlements (cohort_id, status);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger assessment_entitlements_touch
  before update on public.assessment_entitlements
  for each row execute function public.touch_updated_at();

-- ── 4. 登录尝试(限流) ────────────────────────────────────────
create table public.assessment_login_attempts (
  id              uuid primary key default gen_random_uuid(),
  ip              text,
  identifier_hash text,                        -- sha256(LOGIN_HASH_PEPPER || 归一化标识)
  succeeded       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index assessment_login_attempts_ip_idx         on public.assessment_login_attempts (ip, created_at desc);
create index assessment_login_attempts_identifier_idx on public.assessment_login_attempts (identifier_hash, created_at desc);

-- ── 5. 答题 session ───────────────────────────────────────────
create table public.assessment_sessions (
  id             uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.assessment_entitlements(id) on delete cascade,
  locale         text not null default 'zh' check (locale in ('zh','en')),
  profile        jsonb,                        -- 3 道背景题答案
  status         text not null default 'in_progress'
                 check (status in ('in_progress','survey','completed')),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- ── 6. 逐题答案(断点续答) ──────────────────────────────────
create table public.assessment_answers (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.assessment_sessions(id) on delete cascade,
  question_id  text not null,
  option_index int  not null,
  score        int  not null,
  answered_at  timestamptz not null default now(),
  unique (session_id, question_id)             -- 支撑改答案的 upsert
);
create index assessment_answers_session_idx on public.assessment_answers (session_id);

-- ── 7. 问卷 ────────────────────────────────────────────────────
create table public.assessment_survey (
  session_id   uuid primary key references public.assessment_sessions(id) on delete cascade,
  responses    jsonb not null,
  submitted_at timestamptz not null default now()
);

-- ── 8. 结果 ────────────────────────────────────────────────────
create table public.assessment_results (
  session_id        uuid primary key references public.assessment_sessions(id) on delete cascade,
  dim_scores        jsonb not null,            -- { dimensionKey: 0..100 }
  total             int  not null,
  -- tier 会写回 GHL 供 workflow 精确匹配,域外值会让 workflow 静默不匹配。
  -- 取值域与 config 的 ghl_writeback.custom_fields[].domain 一致,数据库这一层就挡住。
  tier              text not null
                    check (tier in ('manual','spot','semi_auto','systemic','flywheel')),
  weakest           text[] not null,           -- 最低 2 维
  strongest         text[] not null,
  -- GHL 写回 (D2)
  ghl_synced        boolean not null default false,
  ghl_sync_attempts int not null default 0,
  ghl_last_error    text,
  ghl_next_retry_at timestamptz,
  -- PDF 异步渲染 (D6 / D7)
  pdf_path          text,                      -- Storage 对象路径。命名刻意不叫 pdf_url
  pdf_status        text not null default 'pending'
                    check (pdf_status in ('pending','rendering','ready','failed','failed_permanent')),
  pdf_attempts      int not null default 0,
  pdf_last_error    text,
  computed_at       timestamptz not null default now()
);
comment on column public.assessment_results.pdf_path is
  'Supabase Storage 私有 bucket 内的对象路径(如 reports/{cohort}/{session}-zh.pdf)。'
  '不是可直接访问的 URL;下载时由 Edge Function 现签 1 小时 signed URL。'
  '字段名从 pdf_url 改成 pdf_path —— 原名需要靠注释纠正,说明名字本身是错的。';
comment on column public.assessment_results.pdf_status is
  'pending→rendering→ready;失败 rendering→failed;attempts>=3 时 failed→failed_permanent。'
  'Cron 只捡 failed,不捡 failed_permanent;Admin 可把两者重置回 pending。';
comment on column public.assessment_results.pdf_last_error is
  '错误首行,入库时 left(msg,200) 截断,不存 stack。';

create index assessment_results_tier_idx on public.assessment_results (tier);
create index assessment_results_ghl_retry_idx on public.assessment_results (ghl_next_retry_at)
  where ghl_synced = false;
create index assessment_results_pdf_status_idx on public.assessment_results (pdf_status)
  where pdf_status <> 'ready';

-- ── RLS:全开,零 policy ───────────────────────────────────────
alter table public.app_settings              enable row level security;
alter table public.admin_users               enable row level security;
alter table public.assessment_cohorts        enable row level security;
alter table public.assessment_entitlements   enable row level security;
alter table public.assessment_login_attempts enable row level security;
alter table public.assessment_sessions       enable row level security;
alter table public.assessment_answers        enable row level security;
alter table public.assessment_survey         enable row level security;
alter table public.assessment_results        enable row level security;
