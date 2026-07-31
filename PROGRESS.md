# AI 盈利增长罗盘™ 学员诊断系统 — PROGRESS

> 唯一进度真相源。每阶段开工前读,收工后写。
> 仓库:`vihotang1196/qai-growth-compass`(main 已有一个只含 README 的初始 commit;Stage 1 在此基础上 scaffold,不 `git init`,README 直接覆盖)
> 本地路径:`~/qai-growth-compass`(已 clone,HEAD = `94e6ea2 chore: initial commit`,remote 正确)

---

## 状态总览

| Stage | 内容 | 状态 |
|---|---|---|
| 0 | 方案确认 | **rev4 — 已定稿**(config 文件仍未收到,不阻塞 Stage 1–5) |
| 1 | 脚手架 + Brutalist 设计系统 + 组件层 + Vercel 上线 + 字体探针 | **代码完成,部署与字体探针待你的资产** |
| 2 | 数据表 + RLS + phone.ts + 单元测试 | **代码完成;Deno 侧待装 deno,migration 待批准执行** |
| 3 | assessment-ghl-webhook | 未开始 |
| 4 | 登录流程(魔法链接 + 重发 + 限流 + session) | 未开始 |
| 5 | Admin 认证 + 名单管理页 | 未开始 |
| 6 | 答题流程(背景题 + 24 题 + 断点续答) | 未开始 |
| 7 | 计分 Edge Function + 问卷页 | 未开始 |
| 8 | 报告页 9 板块 + 批次基准线 + 代价换算 + 打印样式表 | 未开始 |
| 9 | PDF 异步渲染 + Storage + 分享卡 | 未开始 |
| 10 | Admin Portal 其余四模块 + 现场模式 | 未开始 |
| 11 | GHL 写回 + 重试 | 未开始 |
| 12 | 英文版全量 + 语言切换 | 未开始 |

---

## 修订摘要

**rev1 → rev2**:PDF 异步化 + Storage;字体运行时 CDN 加载;GHL Inbound Webhook 替代 workflow ID;`GHL_API_KEY` → `GHL_PRIVATE_TOKEN`;新增 `GHL_RESEND_WEBHOOK_URL`;D1–D5 批准;新增 D6/D7。

**rev2 → rev3**(本轮)

| # | 变更 | 来源 |
|---|---|---|
| 1 | D6 批准:`pdf_attempts` + `pdf_last_error`,上限 3 次 → `failed_permanent`,Admin 可重置 | 你的第 1 条 |
| 2 | GHL scope 加 `locations/customFields.readonly`;映射需缓存 + 手动刷新 + 缺字段显式报错 | 你的第 2 条 |
| 3 | 字体第一批砍到 3 个文件,fontconfig 兜底层只放 Regular | 你的第 3 条 |
| 4 | Inbound Webhook URL 运维规则写入 0.17 | 你的第 4 条 |
| 5 | 本地路径确认 `~/qai-growth-compass` | 已 clone |
| 6 | 新增 D8(GHL 字段映射的持久化位置)、D9(缺字段时的写回行为) | rev3 派生 |

**rev3 → rev4(本轮,Stage 0 定稿)**

| # | 变更 | 来源 |
|---|---|---|
| 1 | **「8 张表」约束解除** → D8 采用第 9 张表 `app_settings` | 你主动撤销该约束 |
| 2 | D9 定稿:部分写入 + 标签照打 + 临时/永久错误分类 + 错误信息具体到字段名 | 你的三条补充 |
| 3 | 字体定稿:本地源文件放 `~/qai-growth-compass/assets/fonts/`,该目录进 `.gitignore` | 你的回复 |
| 4 | 家族名遮蔽规则、禁 ttc/otc 与可变版 → 写进 Stage 1 硬验收 | 你确认照做 |
| 5 | `assessment-config.json` 第三次未送达;发现字段前缀实为 `qai_assessment_*`,0.12 提案表作废 | 见 0.10 / 0.12 |

---

# Stage 0 方案(rev3)

## 0.1 需要你提供的东西

### A. 一次性信息

| # | 项 | 状态 |
|---|---|---|
| 1 | GitHub 仓库 | ✅ `vihotang1196/qai-growth-compass` |
| 2 | Supabase project ref + 3 个 key | ⏳ Singapore region,Stage 1 开工前给 |
| 3 | 域名 `compass.qiai.tech` | ⏳ 需在 DNS 加 CNAME 到 Vercel |
| 4 | GHL Private Integration Token + location ID | ⏳ scope 见 0.11 |
| 5 | `GHL_RESEND_WEBHOOK_URL` | ⏳ Inbound Webhook trigger URL |
| 6 | `assessment-config.json` | ❌ **仍未收到**,详见 0.10 —— 唯一剩余阻塞项 |
| 7 | 字体文件 | ⏳ 见 0.14:CDN 传 3 个,另需 1 个源文件(不上 CDN) |
| 8 | 本地路径 | ✅ `~/qai-growth-compass` |

### B. 环境变量清单

**B1 — Supabase Edge Function secrets**

| 变量 | 说明 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 自动注入,无需手动设 |
| `QAI_WEBHOOK_SECRET` | `openssl rand -hex 32`,同一份填到 GHL webhook 的 `X-QAI-Secret` |
| `GHL_PRIVATE_TOKEN` | v2 Private Integration Token |
| `GHL_LOCATION_ID` | |
| `GHL_RESEND_WEBHOOK_URL` | Inbound Webhook trigger URL。⚠️ **只存在于 Supabase secrets,不进 Vercel、不进代码、不进 bundle** |
| `APP_BASE_URL` | `https://compass.qiai.tech` |
| `SESSION_SECRET` | `openssl rand -hex 32`。签客户 session cookie 与 PDF 渲染令牌 |
| `LOGIN_HASH_PEPPER` | `openssl rand -hex 16`。`identifier_hash` 加盐 |
| `INTERNAL_FN_SECRET` | `openssl rand -hex 32`。函数间互调鉴权 |

**B2 — Vercel 环境变量**

| 变量 | 说明 |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 前端仅用于 Admin 的 Supabase Auth magic link |
| `VITE_APP_BASE_URL` | 前端拼分享链接 |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | `/api/*` 代理用(非 `VITE_`,不进 bundle) |
| `SUPABASE_SERVICE_ROLE_KEY` | PDF 渲染函数写 Storage / 更新 `pdf_status` |
| `SESSION_SECRET` / `INTERNAL_FN_SECRET` | 须与 B1 同值 |
| `CDN_FONT_BASE` | 如 `https://cdn.qiai.tech/fonts/`,代码拼具体文件名 |

> ⚠️ 只有 `VITE_` 前缀的变量会被 Vite 打进客户端 bundle。上表里带 `VITE_` 的三个是有意公开的(anon key 本就是公开凭证)。**其余任何变量都不许加 `VITE_` 前缀** —— 尤其 `GHL_RESEND_WEBHOOK_URL`、`SERVICE_ROLE_KEY`、各类 secret。Stage 1 会在 CI 加一条检查:构建产物里 grep 到 `INTERNAL_FN_SECRET` / `SERVICE_ROLE` / `leadconnector` 字样即构建失败。

**B3 — 本地 `.env.local`**:B2 全量 + `SUPABASE_PROJECT_REF`。`.env*` 进 `.gitignore`。

---

## 0.2 架构决策

### 已批准

| # | 决策 | 状态 |
|---|---|---|
| D1 | 客户端请求全走 `/api/*` Vercel 代理,cookie 保持第一方 | ✅ |
| D2 | GHL 写回重试不建第 9 张表,加 3 列 + Vercel Cron 指数退避 | ✅ |
| D3 | `assessment_cohorts` 加 `is_default` 列 | ✅ |
| D4 | 60s 重发节流复用 `link_sent_at`,不加列 | ✅ |
| D5 | UI chrome 文案单独字典 + ESLint 禁 tsx 内 CJK 字符 | ✅ |
| — | `assessment_entitlements` 加 `updated_at` + trigger | ✅ |
| D6 | `pdf_attempts` + `pdf_last_error` 两列 | ✅ 见下方细则 |
| D7 | `pdf_url` 存 Storage 私有路径,下载时现签 1 小时 signed URL | ✅ |

### D6 细则(按你的三条补充定稿)

- **上限 3 次**。`pdf_attempts >= 3` 时置 `pdf_status = 'failed_permanent'`,Cron 不再捡。退避 2 / 10 / 50 分钟。
- **`pdf_last_error` 截断到 200 字符**,只存首行错误信息,不存 stack。入库时 `left(msg, 200)`,不靠调用方自觉。
- **Admin 可重置**:名单页与 `/admin/sync` 对 `failed` 与 `failed_permanent` 的行提供「重新生成」按钮 → `pdf_status='pending'`、`pdf_attempts=0`、`pdf_last_error=null`,立即触发一次渲染。CDN 抽风、Storage 超时这类临时故障不需要碰数据库就能救回来。
- `pdf_status` 状态机:`pending → rendering → ready`,失败 `rendering → failed`,三次后 `failed → failed_permanent`,Admin 重置 `failed|failed_permanent → pending`。

### D8 — GHL 字段映射存 `app_settings` 表 ✅ 已定

「8 张表」约束由你主动撤销。加第 9 张表:

```
app_settings (key text primary key, value jsonb not null, updated_at timestamptz)
```

理由(你的):能在 Supabase 面板直接查改,不必写脚本读 blob;`updated_at` 一眼看出映射多久没刷新;以后的全局配置有地方放,不用再加一次表。

读取链路:

```
内存缓存(10 分钟 TTL)
  → 未命中 → select from app_settings where key = 'ghl_field_map'
      → 无记录 → GET /locations/{id}/customFields 回源 → upsert 进表 → 填缓存

Admin「刷新字段映射」→ 强制回源 GHL → upsert 表 → 所有实例下次 TTL 过期即拿到新值
```

这样「刷新对所有实例生效」才真的成立 —— 纯内存缓存做不到这点,那是 rev3 里 Storage 方案想解决但解决得更别扭的问题。

### D9 — 缺字段时部分写入 ✅ 已定

**基本行为**:存在的字段照写(跟进 workflow 至少拿得到分数和档位),缺失的记下来并显式暴露。

**你补充的三条,全部采纳:**

1. **标签必须照打,不受自定义字段失败影响。** workflow 的分支逻辑靠标签,字段只是给人看的。实现上打标签与写字段是两个独立的 API 调用、两段独立的 try —— 字段那段炸了不影响标签那段。这一点会写进 `assessment-ghl-sync` 的单测:构造一个「字段全缺 + 标签正常」的场景,断言标签仍然写入成功。

2. **临时失败与永久失败必须分类。** 两类的处理完全不同:

   | 类别 | 触发条件 | `ghl_next_retry_at` | Admin 显示 |
   |---|---|---|---|
   | `TRANSIENT` | 网络超时、5xx、429 限流 | 设值,进指数退避重试 | 「暂时失败,自动重试中(第 n/5 次)」 |
   | `CONFIG` | 字段在 GHL 不存在、字段类型不匹配 | `null`,**不自动重试** | 「字段 X 未在 GHL 建立」+ 手动重试按钮 |
   | `AUTH` | 401 / 403 / token 失效 | `null`,不自动重试 | 「GHL 凭证失效,请更新 `GHL_PRIVATE_TOKEN`」 |

   `ghl_last_error` 以 `TRANSIENT: ` / `CONFIG: ` / `AUTH: ` 前缀开头,Admin 据此分组过滤。

3. **错误信息具体到字段名。** 存 `CONFIG: 字段未在 GHL 建立 — qai_assessment_tier, qai_assessment_cohort`,Admin 原样展示字段 key 列表,不显示「部分字段写入失败」这种没法照着行动的话。缺多个就全部列出,不是只报第一个。

---

## 0.3 PDF 异步渲染流程

### 时序

```
客户提交问卷
  └→ assessment-submit
       ├─ 计分 → 写 assessment_results (pdf_status = 'pending')
       ├─ status → completed
       ├─ fire-and-forget → POST /api/render-pdf   (INTERNAL_FN_SECRET)
       └─ fire-and-forget → POST assessment-ghl-sync
  └→ 立刻返回,客户跳 /report        ← 客户在这里永不等待

/api/render-pdf  (Vercel Node function,puppeteer-core + @sparticuz/chromium)
  ├─ pdf_status → 'rendering'
  ├─ chromium.font(CDN_FONT_BASE + 'NotoSansSC-Regular.ttf')   ← 系统级中文兜底
  ├─ 签一个 5 分钟有效的 render token(HMAC / SESSION_SECRET)
  ├─ 打开 {APP_BASE_URL}/report/print?s={session_id}&rt={token}&lang={locale}
  ├─ 等 window.__REPORT_READY__ === true(雷达图渲完才截,不用 sleep)
  ├─ page.pdf({ format: 'A4', printBackground: true })
  ├─ 上传 Storage(private bucket `reports`)
  └─ 成功 → pdf_url = 路径, pdf_status = 'ready'
     失败 → pdf_attempts += 1, pdf_last_error = left(msg,200)
            pdf_attempts >= 3 ? 'failed_permanent' : 'failed'

/report 页面
  ├─ pending | rendering → 「PDF 生成中」,每 3 秒轮询,最多 40 次(2 分钟)
  ├─ ready               → 下载按钮,点击时现签 signed URL
  └─ failed | failed_permanent → 「用浏览器打印」,走 Stage 8 的 print.css 保底

Admin 批量下载 → 直接读 Storage 签 URL,不重新渲染
Vercel Cron /api/cron/retry(每 10 分钟)→ 扫 GHL 写回失败 + pdf_status='failed'
                                          (failed_permanent 不捡)
```

### 必须现在定下的实现细节

1. **`window.__REPORT_READY__`**:Recharts 雷达图异步渲染,`networkidle0` 不保证图画完。报告页在所有图表 mount 后置这个标志位,渲染器 `waitForFunction` 它。**Stage 8 做报告页时就要埋,不能等 Stage 9 补。**
2. **render token ≠ access_token**:5 分钟有效、只读、绑单个 session_id。不把客户的长期凭证送进无头浏览器。
3. **`/report/print` 独立路由**:无导航、无按钮、A4 宽、`printBackground`。与 `/report` 共用板块组件,只换 layout。
4. **语言**:按 `sessions.locale` 渲一份,路径含 `-zh` / `-en`,两份可共存。客户切英文后要 PDF 时按需触发第二次渲染。
5. **并发**:同一 session 已在 `rendering` 时,重复请求直接返回当前状态,不起第二个 Chromium。

---

## 0.4 文件结构

```
qai-growth-compass/
├── PROGRESS.md
├── README.md                        # 覆盖初始 commit 里的
├── vercel.json                      # rewrites + crons + SPA fallback + 函数时长/内存
├── vite.config.ts / tsconfig.*.json / tailwind.config.ts / vitest.config.ts
├── scripts/
│   ├── subset-fonts.mjs             # Stage 1,fonttools 生成 subset woff2
│   └── check-bundle-secrets.mjs     # Stage 1,构建产物泄密检查
├── api/                             # Vercel serverless (Node runtime)
│   ├── [...path].ts                 # → Supabase Functions 代理 (D1)
│   ├── render-pdf.ts                # Stage 9
│   ├── font-probe.ts                # Stage 1,中文字体探针(保留当健康检查)
│   └── cron/retry.ts                # Stage 11,GHL 写回 + PDF 双重试
├── src/
│   ├── config/
│   │   ├── assessment-config.json   # ★ 唯一真相源,只读不改
│   │   ├── assessment-config.ts     # zod schema + 类型 + 启动校验
│   │   └── ui-strings.ts            # 壳文案 zh/en
│   ├── styles/
│   │   ├── brutalist.css            # ★ 全部 CSS 变量 token
│   │   ├── fonts.css                # @font-face,指向 CDN_FONT_BASE
│   │   └── print.css                # Stage 8,打印保底
│   ├── components/brutalist/        # Stage 1 一次做完,后面不补
│   │   ├── Button.tsx  Card.tsx  Input.tsx  Select.tsx  Radio.tsx
│   │   ├── Progress.tsx  Dialog.tsx  Tabs.tsx  Table.tsx  Badge.tsx
│   │   └── index.ts
│   ├── components/
│   │   ├── RadarChart.tsx  TierBar.tsx  ScoreDial.tsx  ShareCard.tsx
│   │   └── report/                  # 9 板块,/report 与 /report/print 共用
│   ├── lib/
│   │   ├── phone.ts  phone.test.ts          # ★ 前后端共用
│   │   ├── scoring.ts  scoring.test.ts
│   │   ├── cost.ts  cost.test.ts
│   │   ├── api.ts  i18n.tsx  supabase.ts
│   ├── pages/
│   │   ├── Landing.tsx  Quiz.tsx  Survey.tsx
│   │   ├── Report.tsx  ReportPrint.tsx  Expired.tsx
│   │   └── admin/
│   │       ├── AdminLogin.tsx  AdminLayout.tsx
│   │       ├── Roster.tsx  Funnel.tsx  CohortDashboard.tsx
│   │       ├── SurveyInsights.tsx  HighIntent.tsx  SyncStatus.tsx  Live.tsx
│   ├── App.tsx  main.tsx
├── supabase/
│   ├── config.toml                  # 各函数 verify_jwt = false
│   ├── migrations/
│   │   ├── 20260731000000_assessment_init.sql
│   │   └── 20260731000100_reports_storage_bucket.sql
│   └── functions/
│       ├── _shared/  cors.ts supa.ts session.ts ghl.ts phone.ts config.ts
│       ├── assessment-ghl-webhook/     assessment-auth/
│       ├── assessment-login-request/   assessment-quiz/
│       ├── assessment-submit/          assessment-report/
│       ├── assessment-admin/           assessment-ghl-sync/
└── docs/  ghl-setup.md  decisions.md  fonts.md
```

**`phone.ts` 单份实现**:`supabase/functions/_shared/phone.ts` 一行 re-export `../../../src/lib/phone.ts`,配 `deno.json` 引 npm 的 `libphonenumber-js`。Stage 2 第一件事验证这条 import;不通则退到 CI 哈希比对(`check:phone-sync`,不一致构建失败),不接受两份实现各自演化。

---

## 0.5 路由表

### 前端

| 路由 | 内容 | 鉴权 |
|---|---|---|
| `/?t={token}` | 验 token → 建 session → 跳 `/quiz` 或 `/report` | access_token |
| `/` | 无 token:输手机或邮箱 → 重发链接 | 无 |
| `/quiz` | 3 背景题 + 24 测评题,单题单屏,进度条,每题即存 | cookie |
| `/survey` | 7 题问卷 | cookie |
| `/report` | 9 板块 + PDF 状态区 | cookie |
| `/report/print` | A4 无壳版,供 Chromium 抓取 | render token |
| `/expired` | token 无效 / session 失效 | 无 |
| `/admin/login` | Supabase Auth magic link | 无 |
| `/admin` | 名单管理(默认页) | JWT + 名单 |
| `/admin/funnel` | 漏斗监控 | 同上 |
| `/admin/cohorts/:id` | 批次聚合看板 | 同上 |
| `/admin/survey` | 问卷洞察(S5/S6 原文) | 同上 |
| `/admin/high-intent` | S7 高意向名单 | 同上 |
| `/admin/sync` | GHL 写回 + PDF 渲染失败列表、字段映射刷新、手动重试 | 同上 |
| `/admin/live` | 现场模式,全屏投影,30s 刷新 | 同上 |

所有内部跳转保留 `?lang=`。

### API

| 端点 | 方法 | 鉴权 | 职责 |
|---|---|---|---|
| `/api/assessment-ghl-webhook` | POST | `X-QAI-Secret` | 建/更新准入记录 |
| `/api/assessment-auth` | POST | access_token | 验 token,建 session,发 cookie |
| `/api/assessment-login-request` | POST | IP 限流 | 匹配 → POST 到 `GHL_RESEND_WEBHOOK_URL` |
| `/api/assessment-quiz` | GET/POST | cookie | GET 续答状态;POST upsert 单题 |
| `/api/assessment-submit` | POST | cookie | 存问卷 → 计分 → 写 results → 异步触发渲染与写回 |
| `/api/assessment-report` | GET | cookie / render token / admin JWT | 报告数据 + 基准线 + `pdf_status` + signed URL |
| `/api/assessment-admin` | POST | JWT + 名单 | action:roster / funnel / cohort / survey / high-intent / live / resend / retry-ghl / retry-pdf / refresh-field-map / export |
| `/api/assessment-ghl-sync` | POST | `INTERNAL_FN_SECRET` | 写回 GHL |
| `/api/render-pdf` | POST | `INTERNAL_FN_SECRET` | 异步渲染 + 上传 Storage |
| `/api/font-probe` | GET | `INTERNAL_FN_SECRET` | Stage 1 中文字体探针 |
| `/api/cron/retry` | GET | Vercel Cron header | GHL 写回 + PDF 双重试 |

`vercel.json` 里 `/api/render-pdf` 与 `/api/font-probe` 设 `maxDuration: 60`(Pro)、`memory: 1769`(Chromium 需要)。

---

## 0.6 Edge Function 职责划分

| 函数 | 入口鉴权 | 做什么 | 明确不做什么 |
|---|---|---|---|
| `assessment-ghl-webhook` | `X-QAI-Secret` 定长比较,失败 401 且**不写库** | 归一化邮箱/号码 → 解析 cohort → 以 `ghl_contact_id` upsert → 首次生成 `access_token` | 不发链接、不发消息 |
| `assessment-auth` | access_token 查 entitlement | 建/取 session、写 `first_login_at`、`status → started`、下 30 天 httpOnly cookie | 不轮换 token |
| `assessment-login-request` | IP 限流 + 恒定耗时 | 三级回退匹配 → 60s 节流 → POST `GHL_RESEND_WEBHOOK_URL` | 不直接登录、不发 OTP、不透露是否命中 |
| `assessment-quiz` | session cookie | GET 返回 profile + 已答题 + 下一题;POST 按 `(session_id, question_id)` upsert | 不计分 |
| `assessment-submit` | session cookie | 校验 24 题 + 7 问卷齐全 → `scoring.ts` → 写 results → 触发渲染与写回 | 不等 PDF、不等 GHL |
| `assessment-report` | cookie / render token / admin JWT | 9 板块数据 + 代价换算 + 基准线 + `pdf_status`(ready 时现签 signed URL) | 不重算分数、不触发渲染 |
| `assessment-admin` | 每次验 Supabase JWT **且**查 `admin_users`,不在名单 403 | 全部后台读写,action 分发 | 不信任前端路由守卫 |
| `assessment-ghl-sync` | `INTERNAL_FN_SECRET` | 解析字段映射 → 写 9 个字段 + 打 tag → `ghl_synced=true`;失败记 `ghl_last_error` 排重试 | 不阻塞客户看报告 |

计分只在 `assessment-submit` 内发生;`scoring.ts` 纯函数、有独立单测、前端拿不到。

---

## 0.7 完整 SQL(rev3 定稿,待批准后执行)

```sql
-- supabase/migrations/20260731000000_assessment_init.sql
-- AI 盈利增长罗盘 学员诊断系统 初始化
-- RLS 策略:9 张表全部 enable RLS 且【不建任何 policy】。
--   anon / authenticated 一律拒绝;所有读写走 Edge Function 的 service_role
--   (service_role 绕过 RLS)。比逐字段写 policy 更简单、更不容易漏。

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
  access_token    text not null unique,        -- 32 字节随机;重发不轮换;不过期
  status          text not null default 'pending'
                  check (status in ('pending','link_sent','started','completed')),
  link_sent_at    timestamptz,                 -- D4:每次发送都更新,兼作 60s 节流依据
  first_login_at  timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
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
  dim_scores        jsonb not null,            -- { dimensionId: 0..100 }
  total             int  not null,
  tier              text not null,
  weakest           text[] not null,           -- 最低 2 维
  strongest         text[] not null,
  -- GHL 写回 (D2)
  ghl_synced        boolean not null default false,
  ghl_sync_attempts int not null default 0,
  ghl_last_error    text,
  ghl_next_retry_at timestamptz,
  -- PDF 异步渲染 (D6 / D7)
  pdf_url           text,                      -- ⚠️ Storage 对象路径,不是公开 URL
  pdf_status        text not null default 'pending'
                    check (pdf_status in ('pending','rendering','ready','failed','failed_permanent')),
  pdf_attempts      int not null default 0,
  pdf_last_error    text,
  computed_at       timestamptz not null default now()
);
comment on column public.assessment_results.pdf_url is
  'Supabase Storage 私有 bucket 内的对象路径(如 reports/{cohort}/{session}-zh.pdf)。'
  '不是可直接访问的 URL;下载时由 Edge Function 现签 1 小时 signed URL。';
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
```

```sql
-- supabase/migrations/20260731000100_reports_storage_bucket.sql
-- PDF 报告私有 bucket。public = false,只有 service_role 能读写;
-- 客户与 Admin 一律通过 Edge Function 现签 signed URL 下载。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- 不为 anon / authenticated 建任何 storage policy —— 与 9 张表同一个思路。
-- (rev3 里为 D8 预留的 `internal` bucket 已删除:字段映射改存 app_settings 表)
```

**分开手工执行的第二段(值等你给,不进 migration):**

```sql
insert into public.admin_users (email, name) values ('<你的邮箱>', '<名字>');
insert into public.assessment_cohorts (name, event_date, source_tag, is_default)
values ('默认批次', null, 'default', true);
```

---

## 0.8 `src/lib/phone.ts`

```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

const DEFAULT_COUNTRY = 'MY';

/** 全角数字/加号/空格 → 半角。中文输入法真的会产出 ０１２ */
function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, '+')
    .replace(/　/g, ' ');
}

/** 只留数字与开头的一个 +;中间的 + 一律丢掉 */
function clean(input: string): string {
  const half = toHalfWidth(input);
  const plus = half.trimStart().startsWith('+');
  const digits = half.replace(/\D/g, '');
  return plus ? `+${digits}` : digits;
}

/**
 * 归一化为 E.164。无法确定为有效号码时返回 null——绝不猜。
 *   1. 有 + → 按国际号解析
 *   2. 无 + → 按默认国家 MY 解析
 *   3. 仍无效 → 补 + 再试(处理 '60124361382' / '6591234567' 带国码但没 +)
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = clean(raw);
  if (c.replace(/\D/g, '').length < 7) return null;

  if (c.startsWith('+')) {
    const p = parsePhoneNumberFromString(c);
    return p?.isValid() ? p.number : null;
  }
  const national = parsePhoneNumberFromString(c, DEFAULT_COUNTRY);
  if (national?.isValid()) return national.number;

  const intl = parsePhoneNumberFromString(`+${c}`);
  return intl?.isValid() ? intl.number : null;
}

/** E.164 去 + 后最后 8 位。容错匹配键,只在 e164 匹配失败时用 */
export function phoneTail(e164: string | null): string | null {
  if (!e164) return null;
  const d = e164.replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

/**
 * 用户任意输入 → 用于 tail 回退查询的 8 位。
 * 少于 8 位数字直接判无效,不进 tail 匹配——防碰撞。
 * 宁可让他改用邮箱,也不能把别人的诊断报告给他看。
 */
export function tailFromInput(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = clean(raw).replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-8) : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}
```

### 登录三级回退

```
输入 → normalizePhone()
  ├─ 得到 e164 → 查 phone_e164;命中 1 条 → 返回
  ├─ 未命中 或 normalizePhone 返回 null
  │    → tailFromInput();null 则判无效
  │    → 查 phone_tail;命中恰好 1 条 → 返回;命中 ≥2 条 → 视为未命中
  └─ 看起来像邮箱 → normalizeEmail() 查 email_lower;命中 ≥2 条 → 视为未命中
```

### 单元测试用例(Stage 2 全绿才能进 Stage 3)

| 输入 | 期望 | 说明 |
|---|---|---|
| `'012-436 1382'` | `+60124361382` | 你给的用例 |
| `'+60124361382'` | `+60124361382` | |
| `'0124361382'` | `+60124361382` | |
| `'60124361382'` | `+60124361382` | 带国码无 + → 第 3 级 |
| `'012 436 1382'` | `+60124361382` | |
| `'(012) 4361382'` | `+60124361382` | |
| `'０１２４３６１３８２'` | `+60124361382` | 全角 |
| `'+6591234567'` | `+6591234567` | 新加坡不被误判为马来西亚 |
| `'12345'` | `null` | 太短 |
| `'6591234567'` | `+6591234567` | SG 带国码无 + |
| `'+6281234567890'` | `+6281234567890` | 印尼 |
| `'+886912345678'` | `+886912345678` | 台湾 |
| `'+8613800138000'` | `+8613800138000` | 中国 |
| `'  012 436 1382  '` | `+60124361382` | 首尾空白 |
| `'012-436-1382 ext 5'` | `+60124361382` | 尾巴垃圾字符 |
| `''` / `null` / `undefined` | `null` | |
| `'abcdefgh'` | `null` | 无数字 |
| `'+60999999999'` | `null` | 号段不存在(用 isValid 而非 isPossible) |
| `phoneTail('+60124361382')` | `'24361382'` | |
| `tailFromInput('4361382')` | `null` | 7 位,不进 tail 匹配 |
| `tailFromInput('12345678')` | `'12345678'` | 8 位可以 |

> `'+60999999999'` 我拿不准 libphonenumber 的判定,Stage 2 先跑一遍再定期望值;若它判 valid 就改成记录实际行为,不硬掰。

### Webhook 降级

`normalizePhone` 返回 null 时:`phone_e164 = null`、`phone_tail = null`、`phone_raw = 原值`,记录照样写入。Admin 名单页该行标红「号码格式异常」,提供内联修正入口。不因为一个烂号码丢掉整条准入记录。

---

## 0.9 计分规则(`src/lib/scoring.ts`,纯函数)

```
单维得分 = round(该维 4 题原始分之和 / 12 * 100)      // 4 题 × 满分 3 = 12
总分     = round(0.7 * 六维平均 + 0.3 * 六维最低)
短板     = 最低 2 维,平分按 config.dimensions[].order 靠前优先
长板     = 最高 2 维,同上
档位     = 匹配 config.tiers 区间
```

基准线:同 cohort `completed` 且有 results 的人数 ≥ 10 → 本期六维均值;不足 → 全库历史均值,图例标注「历史基准」。返回体带 `baselineSource: 'cohort' | 'global'` 与 `baselineN`,前端据此渲染,不在前端猜。

代价换算走 `config.cost_model`;金额旁必须同时显示 `disclaimer_zh` 和每条假设的 `zh_note`。系数一律读 config,代码里不放任何数字。

---

## 0.10 `assessment-config.json` — ✅ 已入库,schema 对表结果

文件已原样写入 `src/config/assessment-config.json`,一个字符没改。

### 结构自检(脚本跑的,不是肉眼看的)

```
dimensions      goal traffic capture convert value measure     6 ✓
questions       24 ✓   每维 4 题 ✓   全部 4 选项 ✓
                submodule_index 每维 [0,1,2,null] ✓
profile 3 ✓     survey_questions 7 ✓     tiers 5     report_sections 9 ✓
tiers 区间      0-40 41-55 56-70 71-85 86-100  无断层、无重叠、上界 100 ✓
cost_model      六维全覆盖 ✓        offer_routing 六维全覆盖 ✓
custom_fields   9 ✓                 tags 4
value_map       与选项数全部对齐 ✓
```

### A. 与我 rev1 契约的结构性差异 —— 以文件为准,改代码

| # | 我的假设 | 文件实际 | 影响 |
|---|---|---|---|
| A1 | 每个可翻译节点是 `{ zh, en }` | **按 locale 分块**:`zh:{q,options}` / `en:{q,options}`,以及 `name_zh`/`name_en`、`zh_desc`/`en_desc`、`zh_label`/`en_label`、`zh_note`、`zh_cta` | **`t(node)` 完全取不到值,i18n.tsx 要重写**。改成两个取值器:`tBlock(item)` 取 `item[locale]`,`tSuffix(obj,'desc')` 取 `obj[locale+'_desc']` |
| A2 | `dimensions[].id` | `dimensions[].key`,另有 `color`、`submodules_zh/en` | 字段改名;`color` 引出配色冲突,见 C1 |
| A3 | `options[].score` 显式给分 | 无 score 字段,**分数 = 选项索引**(`scoring.option_values:[0,1,2,3]`) | 满分 3 成立 → `/12` 公式不变 ✓。但读分逻辑改成取 index |
| A4 | 4 个档位、有 `actions` 数组 | **5 个档位**,字段是 `key/zh/en/zh_desc/en_desc`,无 actions | 档位解读只有一段描述,行动清单另有来源问题,见 C3 |
| A5 | 节点名 `survey` | `survey_questions` | 改名 |
| A6 | `custom_fields` 是 `{key, source}` 对象数组 | **纯 key 字符串数组**,没有数据来源映射 | key→来源的映射得我在代码里定义,见 C5 |
| A7 | 公式可能是表达式字符串 | 确认是字符串:`"L * 0.30 * baseline_close_rate * V"` | 按原计划用白名单求值器,**不用 `eval`**。变量只允许 `L`、`V`、`baseline_close_rate` |
| A8 | `report_sections` 有 `{zh,en}` | 只有 `key` + `zh` | Stage 12 英文缺口,见 C7 |

### B. 文件里有、我方案里没有的新增需求

| # | 项 | 说明 |
|---|---|---|
| B1 | `report_sections.cohort_rank` | ✅ **改成分位区间,不给精确名次**(见下方 B1 细则) |
| B2 | `submodule_table` 18 项 | 映射是清楚的:每维 3 个 submodule 各对应 1 题(`submodule_index` 0/1/2),第 4 题 `type:"maturity"`、`submodule_index:null`,不进表。badge 直接取该题原始分 |
| B3 | `offer_routing` | 六维各一个 `product` + `zh_cta`,喂 `next_step` 板块 |
| B4 | `profile_questions[].value_map` | P2 → `L`(询盘量)、P3 → `V`(客单价),驱动整个 cost_model。**文件没明写 L/V 来自 P2/P3**,是我按字段名推的,见 C6 |
| B5 | `access` 块 | 限流参数、三级回退、`resend_link_only` 全部与我 Stage 4 设计一致 ✓,无冲突 |
| B6 | `scoring.weakest_selection` | 与我的规则逐字一致 ✓;`total_formula`、`dimension_score_formula` 也一致 ✓ |

**B1 细则 — `cohort_rank` 显示分位区间,不显示精确名次**

不显示「第 18 名 / 共 20 人」。这份报告的目的是让人想动手,精确的倒数名次只会让人关掉页面。

| 层面 | 显示什么 |
|---|---|
| 总分 | 分位区间(前 25% / 25–50% / 50–75% / 后 25%)+ 同档人数,如「本期有 6 人和你在同一档」 |
| 各维度 | 本人得分 vs 本期均值的**差值**,正负都显示,精确到分 |

维度层面的精确对比指向具体动作,总分层面的排名只指向羞耻 —— 前者留,后者去掉。

样本不足 `min_n_for_baseline`(10 人)时,整个 `cohort_rank` 板块隐藏,不用历史基准硬凑分位 —— 跨期分位没有意义。

### C. 冲突与缺口 —— 处理结果

**C1 — 配色 ✅ 已定:保留六色,用途严格限定**

六色是罗盘轮盘图原色,保留以与现有视觉资产对齐。三条硬约束:

| | |
|---|---|
| ✅ 只用于分类数据标记 | 子模块表维度分组、档位分布柱状图、最弱维度分布图、现场模式维度色块 |
| ❌ **雷达图不用六色** | 雷达图只有两条线(本人 vs 基准),用黄与墨。六色画轴上只会糊 |
| ❌ 页面 chrome 一律不碰 | 按钮、边框、背景、状态色全走 Brutalist 原 token |
| ✅ 必须进 `brutalist.css` 成 `--dim-*` 变量 | 组件里不许出现字面色值 —— 这条规矩不因为色值来自 config 而破例 |

**为什么只需过白底与灰底,不必对黄底扛 3:1**

WCAG 1.4.11 要求的是图形对象与**相邻颜色**可辨识。Brutalist 规格里每个元素都有 2px 墨色实边框,色块与背景之间永远隔着这条边框 —— 边框本身就是分界。所以黄底不构成约束,取宽松那套即可,色值与 config 原色保持在同一色系,和罗盘轮盘图 / 销售简报 / 工作手册对得上。

**最终 token(白 / 灰门槛 3.0):**

| 维度 | config 原色 | token 值 | 白底 | 灰底 | 处理 |
|---|---|---|---|---|---|
| goal | `#1e5fa8` | `#1e5fa8` | 6.45 | 5.91 | = 原色 |
| traffic | `#12897e` | `#12897e` | 4.28 | 3.93 | = 原色 |
| capture | `#4a9e3f` | `#499c3e` | 3.44 | 3.15 | 降 2%,基本无感 |
| convert | `#6b46a8` | `#6b46a8` | 6.85 | 6.28 | = 原色 |
| value | `#e8a020` | `#ba801a` | 3.39 | 3.11 | 降 32% —— 原色白底 2.22 不合格 |
| measure | `#c94f4f` | `#c94f4f` | 4.45 | 4.09 | = 原色 |

**六个色里只有 `value` 真正偏离原色**,`capture` 降 2%,其余四个原封不动。

**规则 2 —— 维度色填充上不放任何正文**

标签一律置于色块外部,白底墨字。唯一例外:现场模式 `/admin/live` 的维度色块,字号 ≥40px 远超大字门槛 3.0,且是投影距离观看。

为什么直接禁而不是「用大字号」:维度色的职责只是分类标记(图表填充、图例色块、分布条),这些场景本来就不该往色块里塞正文。一旦开例外,就得记住「traffic 和 measure 这两个色墨字 4.14 / 白字 4.45,两个都不到 4.5」这种规则 —— 需要靠人记的规则迟早会破。直接禁掉,这个问题就不存在。

> 这条规则落地当天就判了 Showcase 自己违规 —— 那六个色块原本把维度名写在填充里、用 `text-paper`。已改成色块与标签并排,标签在外部。

### 两条规则的强制方式

| 规则 | 强制方式 |
|---|---|
| 1. 只做填充 | ✅ `npm run check:dim` 构建门禁。拦 `text-dim-*`、`border-dim-*`、`stroke-dim-*`、`ring/outline/decoration/divide/caret/accent/shadow/placeholder-dim-*`、CSS 的 `color:` / `border-color:` / `stroke:` / `outline-color: var(--dim-`,以及六个色值写成字面量。**已反向验证:五种违规全部拦下,移除后恢复通过。** `brutalist.css` 自身豁免 |
| 2. 填充内不放正文 | ❌ **不做 lint**,只写注释 + review 把关 |

规则 2 不做 lint 是刻意的:JSX 的 `className` 常常是模板字符串或 `cn()` 调用,静态检查只能覆盖一部分写法。**一个有盲区的守卫比没有守卫更糟 —— 它让人以为这条已经被守住了。** 守卫要么证明得了它会拦,要么不装。

**C2 — badge ✅ 已定:纯 CSS 方块,完全不用字符**

`✅⚠️❌` → `■◧□` → **CSS 方块**,两轮都推翻了。最终方案不依赖任何字体收录。

理由:只要用字符,就永远在赌字体收录。`◧` U+25E7 这次探针即使过了,以后换字体、换字重、重新生成 subset,随时可能再掉。这是一整类风险,不该靠单点验证解决。

```
12×12,2px 墨边框
  已具备    实心墨色填充          .qai-mark--full
  部分具备  左半墨色(linear-gradient 90deg 到 50%)  .qai-mark--half
  缺失      透明填充              .qai-mark--empty
```

组件 `src/components/brutalist/SubmoduleMark.tsx`,含 `markStateFromScore()`(3→full / 2→half / 1、0→empty)与 `SubmoduleMarkLegend`。用 gradient 而非伪元素,打印时更稳。不依赖颜色区分,色盲可读;硬边方块本来就是 Brutalist 的基本形,比字符更贴。

config 里 `submodule_badge` 的字符**保留但降级为纯数据用途**(CSV 导出、GHL 字段、纯文本邮件),`submodule_badge_note` 已写明渲染层不使用。

`/api/font-probe` 里的几何符那一块已撤掉,探针只验中文常用字、中文生僻字、拉丁数字三块。

**C3 / C4 — `action_library` ✅ 契约已定,内容你写**

你在开 Stage 8 前把内容填满,我现在按此 schema 编码,不等:

```jsonc
{
  "action_library": {
    "<dimension_key>": {
      "root_cause": {
        "low":  "0-40 分区间的根因文案",
        "mid":  "41-70 分区间的根因文案",
        "high": "71+ 分区间的根因文案"
      },
      "actions": [
        {
          "id": "capture_01",
          "zh": "动作描述", "en": "...",
          "difficulty": "low | medium | high",
          "impact": "low | medium | high",
          "roi_rank": 1,
          "applies_below": 60
        }
      ]
    }
  }
}
```

**选取逻辑**:从最弱 2 维各取 `applies_below > 该维得分` 的动作 → 按 `roi_rank` 排 → 合并后取前 3 条 → 不满 3 条从次弱维补。
「现状」按原计划从所选选项文本推导,不进 library。
`root_cause` 的区间边界(low ≤40 / mid 41–70 / high ≥71)与 `tiers` 不完全重合,这是刻意的三段划分,不是笔误。

**C5 — 字段取值域 ✅ 已定:写机器可读 key,且取值域进 config**

理由(你的):GHL workflow 条件判断是精确字符串匹配,中文名一改文案 workflow 就断;可读性靠报告解决,不靠 contact 字段。取值域是机器要读的东西(写回要校验、workflow 要匹配),放 PROGRESS.md 里迟早跟代码走散,所以**批准结构变更**:`custom_fields` 由字符串数组改为对象数组。

```jsonc
{ "key": "qai_assessment_tier", "type": "text",
  "domain": ["manual","spot","semi_auto","systemic","flywheel"],
  "source": "result.tier" }
```

- `domain` 是枚举时给数组;自由文本给 `null` 并用 `max_length`;数字给 `"0-100"` 这类字符串
- `source` 写明取值来源,不靠猜
- **写回前按 domain 校验**。不在域内的报 `CONFIG` 类错误并中止该字段写入,**绝不静默写进去** —— GHL 收到域外值时 workflow 会静默不匹配,那种 bug 最难查

完整九项见 0.12。

**C6 — L / V 来源 ✅ 确认**:`L` = P2 `leads_per_month.value_map[选项索引]`,`V` = P3 `deal_value.value_map[选项索引]`。

**C7 — config 自相矛盾 ✅ 已改**

`trigger_rules` 拆成机器可执行的结构,`tags` 拆成无条件与有条件两组:

```jsonc
"tags_always": [
  "assessment_completed",
  "assessment_tier_{tier_key}",      // {tier_key} → tiers[].key
  "assessment_weak_{weakest_1}"      // {weakest_1} → 维度 key
],
"tags_conditional": [
  { "tag": "assessment_hot_lead",       "when": "consult_interest in ['asap','later']" },
  { "tag": "assessment_priority_high",  "when": "total < 55 and monthly_marketing_budget >= 3000" },
  { "tag": "assessment_mismatch",       "when": "priority_dimension != weakest_1" }
]
```

`monthly_marketing_budget` 取 S2 的 `value_map` 值(0 / 1500 / 4000 / 12000 / 30000),所以「≥ 3000」实际命中的是第 3 档及以上。

**C8 — 英文缺口(Stage 12 清单,未变)**
`report_sections` 无 `en`;`offer_routing` 无 `en_cta`;`cost_model.rules[]` 有 `en_label` 但无 `en_note`;新增的 `action_library` 需要 `en`。其余英文都齐 ✓

**C9 — `strongest` 平分规则**:沿用 `weakest` 同一条(按 `dimension.order` 靠前优先)。未收到反对意见,按此实现。

### D. 不是问题但要记一笔

题目 id 前缀与维度 key 不对应:`convert` → `V*`、`value` → `M*`、`measure` → `D*`。不是错误,但排查时极易看错。代码里**只按 `dimension` 字段分组,不解析 id 前缀**。

---

## 0.11 GHL 对接

### 鉴权与 scope

Private Integration Token,`services.leadconnectorhq.com`,header `Version: 2021-04-15`。

| scope | 用途 | 状态 |
|---|---|---|
| `contacts.readonly` | 读 contact 校验 | ✅ |
| `contacts.write` | 写 9 个自定义字段 + 打 tag | ✅ |
| `locations/customFields.readonly` | 拉字段清单建 key→id 映射 | ✅ 批准 |

### 字段映射的缓存与刷新(你的三条要求)

```
需要 key→id 映射时:
  1. 内存缓存(10 分钟 TTL)命中 → 直接用
  2. 未命中 → select value from app_settings where key = 'ghl_field_map'   (D8)
  3. 无记录 → GET /locations/{id}/customFields 回源
              → upsert 进 app_settings → 填内存缓存

Admin「刷新字段映射」按钮 → 强制回源 GHL → upsert app_settings
  (你在 GHL 加完新字段后点一下,所有实例下次 TTL 过期即生效,不必等冷启动)

映射建好后立即校验 config 里 9 个 key 是否都存在:
  缺失 → 按 D9 处理:标签照打、存在的字段照写、
         ghl_last_error = 'CONFIG: 字段未在 GHL 建立 — <逐个列出 key>'、
         ghl_next_retry_at = null(不自动重试)
  绝不静默跳过
```

### 重发链接 — Inbound Webhook Trigger

```
客户在 / 输入手机或邮箱
  → assessment-login-request 三级回退匹配 + IP 限流 + 60s 节流
  → POST {GHL_RESEND_WEBHOOK_URL}
       { contact_id, magic_link, name, phone, email, lang }
  → GHL workflow(Inbound Webhook trigger)取 {{inboundWebhookRequest.magic_link}}
       发 WhatsApp + Email 双通道
  → 更新 link_sent_at,页面统一返回:
     「如果这个号码或邮箱在我们的名单里,链接已经发出,请查收 WhatsApp 与邮箱」
```

### 你要在 GHL 后台做的四件事

1. Settings → Custom Fields 建 0.12 那 9 个字段
2. Settings → Tags 建对应 tag(或允许 API 自动创建)
3. 发链接 workflow 加 **Inbound Webhook trigger**,URL 给我 → `GHL_RESEND_WEBHOOK_URL`
4. 付款 workflow 加 Webhook action:`POST https://compass.qiai.tech/api/assessment-ghl-webhook`,custom header `X-QAI-Secret: <QAI_WEBHOOK_SECRET>`,body 至少含 `{ ghl_contact_id, phone, email, name, cohort_tag }`

---

## 0.12 GHL 自定义字段清单 — ⛔ 提案作废,不要照此建字段

**真相源是 config 的 `ghl_writeback.custom_fields`(已改成带 `domain` / `source` 的对象数组)。下表是它的可读版,若两者不一致以 config 为准。**

GHL 里九个字段全部建成单行文本(Single Line Text)。

| # | Unique Key | `domain` | `source` |
|---|---|---|---|
| 1 | `qai_assessment_status` | `["completed"]` | `system` |
| 2 | `qai_assessment_total` | `"0-100"` | `result.total` |
| 3 | `qai_assessment_tier` | `manual` \| `spot` \| `semi_auto` \| `systemic` \| `flywheel` | `result.tier` |
| 4 | `qai_assessment_weakest_1` | `goal` \| `traffic` \| `capture` \| `convert` \| `value` \| `measure` | `result.weakest[0]` |
| 5 | `qai_assessment_weakest_2` | 同上 | `result.weakest[1]` |
| 6 | `qai_assessment_priority` | 同上(**刻意与 weakest 同域**,`assessment_mismatch` 要直接比对) | `survey.priority_dimension` |
| 7 | `qai_assessment_goal_90d` | `null`,`max_length: 200` | `survey.goal_90d` |
| 8 | `qai_assessment_consult_interest` | `asap` \| `later` \| `self` \| `no` | `survey.consult_interest` |
| 9 | `qai_assessment_report_url` | `null`,`max_length: 300` | `APP_BASE_URL + '/?t=' + access_token` |

第 6 项:S1 选项顺序「定目标 造流量 接客户 促成交 增价值 测数据」与 `dimensions[].order` 一致,索引 → key 直接按序映射,不需要单独映射表。

**写回前必须按 `domain` 校验。** 域外值报 `CONFIG` 类错误、中止该字段写入、进 `/admin/sync` 显示,不静默写进 GHL。

**Tags** —— 分无条件与有条件两组(config `tags_always` / `tags_conditional`):

| 标签 | 何时打 |
|---|---|
| `assessment_completed` | 每次完成,无条件 |
| `assessment_tier_{tier_key}` | 无条件;`{tier_key}` → `semi_auto` 等,如 `assessment_tier_semi_auto` |
| `assessment_weak_{weakest_1}` | 无条件;`{weakest_1}` → 维度 key,如 `assessment_weak_capture` |
| `assessment_hot_lead` | `consult_interest in ['asap','later']` |
| `assessment_priority_high` | `total < 55 and monthly_marketing_budget >= 3000` |
| `assessment_mismatch` | `priority_dimension != weakest_1` |

`monthly_marketing_budget` 取 S2 `value_map`(0 / 1500 / 4000 / 12000 / 30000),「≥ 3000」实际命中第 3 档及以上。

**在 GHL 后台要建的 tag**:上表六个,其中三个带变量的要按实际取值展开 ——
`assessment_tier_*` 五个、`assessment_weak_*` 六个,加上四个固定标签,共 **15 个**。
或者允许 API 自动创建标签,就只建固定的那几个。

---

## 0.13 i18n

- 默认 `zh`。优先级:`?lang=` → `localStorage.compass_lang` → `zh`
- 两个文案来源,**只有这两个**:`assessment-config.json`、`src/config/ui-strings.ts`
- ⚠️ **取值器要按 config 的实际形状重写(A1)**。config 不是 `{zh,en}` 节点,而是两种形状并存:
  - 分块型 —— `item.zh = {q, options}` / `item.en = {...}` → `tBlock(item)` 返回 `item[locale] ?? item.zh`
  - 后缀型 —— `zh_desc`/`en_desc`、`zh_label`/`en_label`、`zh_note`、`zh_cta`、`name_zh`/`name_en` → `tSuffix(obj, 'desc')` 返回 `obj[locale+'_desc'] ?? obj['zh_desc']`
  - `ui-strings.ts` 仍是 `{zh,en}` 形状 → `tk('quiz.next')` 不变
  - **两个取值器必须放在同一个模块(`src/lib/i18n.tsx`)**,文件头用注释写清哪种形状用哪个、config 里哪些节点属于哪一类。两种形状并存是 config 的既有事实(`q`+`options` 适合分块、短字符串适合后缀),不为统一去重写 config;但这个规矩必须写在代码里,不能只存在于某个人脑子里
- en 缺失回落 zh 并在 dev 控制台警告,不显示空白
- 组件内禁止 CJK 字符,ESLint 拦,违反即构建失败
- 语言写进 `assessment_sessions.locale`;PDF 与 GHL 写回按 session 语言
- 切换语言保留当前题号,不重置进度
- Stage 1–11 只填 zh,en 允许空;Stage 12 全量填充 + 全站回归

---

## 0.14 字体方案(rev3 按你的意见砍到 3 个文件)

### 分层结构

| 层 | 文件 | 职责 |
|---|---|---|
| 排版层 | subset woff2(Regular + Bold) | 网页与 PDF 的实际排版,正文标题都走这层 |
| 兜底层 | `NotoSansSC-Regular` 单个 ttf/otf,`chromium.font()` 注册 | 只负责「subset 之外的生僻字不出方块」 |

**同意你的判断**:兜底层只放 Regular。生僻字大多出现在学员姓名,而姓名在报告里是大字号,Chromium 合成假粗在大字号下可以接受;真正的排版粗体由 subset Bold 承担,不受影响。省下 10MB 冷启动下载值这个代价。

### 但有三个坑要一起处理

**坑 1 —— 家族名必须错开,否则兜底根本不会触发(这个最容易踩)**

如果 `@font-face` 声明的 `font-family` 也叫 `"Noto Sans SC"`,它会**完全遮蔽**同名的系统字体:浏览器认为这个家族名已由 `@font-face` 定义,缺字时不会去找同名系统字体,而是直接跳到 font stack 里的**下一个**家族。结果就是你以为装了兜底,实际生僻字还是方块。

所以 `fonts.css` 里必须这样写:

```css
@font-face { font-family: 'Noto Sans SC Subset'; font-weight: 400;
             src: url('…/NotoSansSC-Regular.subset.woff2') format('woff2'); font-display: swap; }
@font-face { font-family: 'Noto Sans SC Subset'; font-weight: 700;
             src: url('…/NotoSansSC-Bold.subset.woff2')    format('woff2'); font-display: swap; }

:root {
  --font-body: 'Plus Jakarta Sans', 'Noto Sans SC Subset', 'Noto Sans SC', sans-serif;
  --font-head: 'Sora',               'Noto Sans SC Subset', 'Noto Sans SC', sans-serif;
}
```

`'Noto Sans SC'`(无 Subset 后缀)= `chromium.font()` 装进 fontconfig 的那个,排在 Subset 之后接住漏网字符。Stage 1 的字体探针要**同时验两件事**:常用字走 subset 正常显示,以及一个故意选的生僻字(如 `䶮`、`龘`)不是方块。

**坑 2 —— 别拿错文件**

- ✅ 要:静态单字重的 `NotoSansSC-Regular.ttf` 或 `.otf`(fontconfig 两种都认,你说得对)
- ❌ 不要 `.ttc` / `.otc` 字体集合包:一个文件装多个字族,`chromium.font()` 注册后家族名解析不确定
- ❌ 不要可变版 `NotoSansSC[wght].ttf`:约 20MB,而且 Chromium 对**系统级**可变字体的字重解析在不同版本行为不一致 —— 兜底层要的是确定性,不是灵活性

拿到实际文件后告诉我是 ttf 还是 otf,我照着写 `chromium.font()` 的路径。

**坑 3 —— 我仍然需要 Bold 的源文件,但它不用上 CDN**

subset Bold woff2 得从 Bold 源文件生成。你只传 Regular 上 CDN 的话,我没有 Bold 的字形数据,做不出第 6 号文件 —— 后果是**报告里所有中文粗体都变成假粗**(不只是生僻字),标题层级会明显发虚。

所以:**Bold 源文件请给我一份本地路径就行**(放 `~/Downloads` 或仓库外任意位置),我用它生成 subset 后,只把 subset woff2 交给你上 CDN。原始 Bold ttf 不需要上 CDN,不占那 10MB。

### 第一批 —— 你现在传 CDN(3 个)

| # | 文件 | 用途 | 预估体积 |
|---|---|---|---|
| 1 | `NotoSansSC-Regular.ttf`(或 `.otf`,静态单字重) | fontconfig 兜底层 | ~10 MB |
| 2 | `Sora[wght].woff2`(可变) | 标题的拉丁字母与数字 | ~50 KB |
| 3 | `PlusJakartaSans[wght].woff2`(可变) | 正文的拉丁字母与数字 | ~50 KB |

### 另需 —— 本地源文件(不上 CDN)✅ 位置已定

放 `~/qai-growth-compass/assets/fonts/`,你会把 Regular 和 Bold 都放进去。**该目录进 `.gitignore`,原始字体不进仓库**(单个 10MB,git 里放二进制字体没意义)。

| # | 文件 | 用途 |
|---|---|---|
| 4 | `NotoSansSC-Bold.ttf`(或 `.otf`) | 生成 subset Bold 的唯一来源,见坑 3 |
| (1) | `NotoSansSC-Regular.ttf`(或 `.otf`) | 同时也放这里,用来生成 subset Regular;另需一份上 CDN 作兜底层 |

### 第二批 —— Stage 1 我生成后给你传(2 个)

| # | 文件 | 说明 |
|---|---|---|
| 5 | `NotoSansSC-Regular.subset.woff2` | 常用 3500 字 + 拉丁 + 标点,预估 1.2–1.8 MB |
| 6 | `NotoSansSC-Bold.subset.woff2` | 同上,来源是 #4 |

**CDN 要求**:`https://cdn.qiai.tech/fonts/` 下平铺,文件名与上表一致,`CDN_FONT_BASE` 指到这一层。CORS 需允许 `compass.qiai.tech`(`@font-face` 跨域受 CORS 约束;BunnyCDN 默认放开,确认即可)。

---

## 0.15 分阶段验收标准

| Stage | 「做完了」= |
|---|---|
| 1 | `compass.qiai.tech` 打开 Brutalist 组件展示页,10 个组件全在;`npm run build` 零错;bundle 泄密检查通过;**`/api/font-probe` 渲出的常用字与生僻字都不是方块 —— 这条不过不进 Stage 2** |
| 2 | migration 已 apply;`npm test` 全绿(含全部 phone 用例);Deno 能 import 同一份 phone.ts |
| 3 | curl 打 webhook:错密钥 401 且不写库;同一 contact_id 打 3 次只有 1 行;烂号码降级写入且 raw 保留 |
| 4 | 魔法链接可登录;Inbound Webhook 触发后 WhatsApp + Email 双通道到达;第 6 次登录尝试被锁;命中与未命中文案与耗时无差异 |
| 5 | 名单页可筛可导出;非名单邮箱登录后台得 403;异常号码行标红 |
| 6 | 答到第 12 题关浏览器,重开链接从第 12 题继续 |
| 7 | 手算一份分数与系统输出一致;24 题不齐 submit 被拒 |
| 8 | 9 板块齐;基准线两种来源都能触发并正确标注;代价换算旁 disclaimer 与假设可见;`window.__REPORT_READY__` 已埋;print.css 保底可用 |
| 9 | 提交后客户**不等待**即见报告;PDF 2 分钟内变 ready;中文无方块;Admin 批量下载不触发重渲;失败 3 次转 `failed_permanent`;Admin 重置后能救回 |
| 10 | 四模块 + 现场模式可投屏;30s 自刷新 |
| 11 | 断网模拟写回失败 → 进重试 → 恢复后自动成功;缺字段场景显示「字段未建立」而非静默成功;Admin 可刷新映射并手动重试 |
| 12 | `?lang=en` 全站无中文残留、无空白 |

---

## 0.16 待你最后确认

Stage 0 已定稿。剩余待办均为**你侧的交付物**,不是待裁决的设计问题:

| # | 项 | 卡住谁 |
|---|---|---|
| 1 | `assessment-config.json` | Stage 6/7/8。三次未送达,见 0.10 |
| 2 | 字体:CDN 3 个文件的 URL + `assets/fonts/` 里的 2 个源文件 | Stage 1 的字体探针(Stage 1 其余部分不受影响) |
| 3 | Supabase project ref + 3 个 key | Stage 2 |
| 4 | 域名 CNAME + Vercel 项目关联 | Stage 1 的部署验收 |
| 5 | GHL PIT + location ID + `GHL_RESEND_WEBHOOK_URL` | Stage 3/4 |

**SQL 在你说批准之前一行都不会执行。**

---

## 0.17 运维备注

| 项 | 规则 |
|---|---|
| `GHL_RESEND_WEBHOOK_URL` | 当 secret 处理。只进 Supabase Edge Function secrets,**不进 Vercel、不进代码、不进前端 bundle**。**泄露时的处置:在 GHL 里重新生成该 workflow 的 Inbound Webhook trigger URL → `supabase secrets set GHL_RESEND_WEBHOOK_URL=<新值>` → 重新部署 `assessment-login-request`。旧 URL 立即失效,无需改代码、无需改数据库。** |
| 重发端点的防护 | IP 限流(15 分钟 5 次,超限锁 1 小时)与同一 entitlement 60 秒间隔**始终保留**。不因为「Inbound Webhook 风险有限」而放松任何一层 |
| 分支策略 | **Stage 0–1 直接提交 main**(新仓库、无协作者、未部署,开分支只是仪式)。**Stage 2 起一个 Stage 一条分支**,首条 `stage-2-schema-phone` —— 那时 Vercel 已接上,分支能出 preview 部署,这才是分支值钱的地方 |
| Push | **每次 push 都要明说**。一次「push」授权只覆盖当次那批 commit,不是长期通行证 |
| 守卫标准 | 任何守卫类的东西(lint、门禁、校验)必须**反向验证**:证明它会拦,而不是证明它不报错。做不到全覆盖就别装 —— 有盲区的守卫比没有守卫更糟,它制造假安全感 |
| PAT 轮换 | 每次 `git push` 后提醒轮换 GitHub PAT |
| 密钥轮换清单 | `QAI_WEBHOOK_SECRET`(改后要同步改 GHL webhook header)、`SESSION_SECRET`(改后所有客户 session 失效,需重新点魔法链接)、`INTERNAL_FN_SECRET`(改后 Supabase 与 Vercel 两边必须同时改,否则渲染与写回全断) |
| bundle 泄密检查 | CI 在 `dist/` 里 grep `SERVICE_ROLE` / `INTERNAL_FN_SECRET` / `leadconnector` / `hooks.` 字样,命中即构建失败 |

---

---

# Stage 1 — 脚手架 + 设计系统 + 组件层

## 已完成

| 项 | 说明 |
|---|---|
| 脚手架 | Vite 5 + React 18 + TS 5.7 + Tailwind 3.4 + Radix primitives,`@/*` 路径别名 |
| 设计 token | `src/styles/brutalist.css` —— 5 个色值 + 语义别名 + 边框/阴影/字体全部 CSS 变量;`tailwind.config.ts` 只做变量映射,不出现任何字面色值 |
| 组件层 | 10 个:Button / Card / Input / Select / Radio / Progress / Dialog / Tabs / Table / Badge。一次做完,后续页面不再补 |
| 子模块标记 | `SubmoduleMark` + `SubmoduleMarkLegend`(纯 CSS 方块,C2) |
| 维度色门禁 | `scripts/check-dim-color-usage.mjs` 挂进 `npm run build`,维度色用在填充之外即失败 |
| i18n 骨架 | `LocaleProvider` + `t()` + `tk()`;`?lang=` → localStorage → zh |
| 壳文案字典 | `src/config/ui-strings.ts`,当前 30 条,en 待 Stage 12 补 |
| CJK 门禁 | `eslint.cjk.config.js` 挂进 `npm run build`,组件里出现中日韩字符即构建失败 |
| 产物泄密门禁 | `scripts/check-bundle-secrets.mjs`,扫 `dist/` 里的 secret 字样 |
| 字体注入 | `src/styles/fonts.ts`,家族名按 0.14 坑 1 的规则错开;CDN base 走 `VITE_CDN_FONT_BASE` |
| 字体 subset 脚本 | `scripts/subset-fonts.mjs`(pyftsubset,GB2312 一二级 + 拉丁 + 标点) |
| 字体探针 | `api/font-probe.ts`,同时验常用字与生僻字 |
| 部署配置 | `vercel.json`:SPA fallback、安全头、渲染函数 60s / 1769MB |
| 组件展示页 | `/_showcase`,含字体自检区块 |

## 验证结果

```
npm run build
  ✓ lint:cjk        无硬编码中文
  ✓ check:dim       维度色仅用于填充
  ✓ tsc -b          类型检查通过
  ✓ vite build      1674 modules,CSS 15.72 kB / JS 310.42 kB(gzip 102.22 kB)
  ✓ check:bundle    扫描 3 个文件,无 secret 泄漏
```

**两道守卫都做过反向验证** —— 守卫类的东西必须证明它会拦,不是证明它不报错:

| 守卫 | 反向用例 | 结果 |
|---|---|---|
| `lint:cjk` | 含中文字面量 + 中文 JSX 文本的临时文件 | 两处都拦下 |
| `check:dim` | `text-dim-goal`、`border-dim-capture`、`stroke="#ba801a"`、CSS `color: var(--dim-value)`、CSS `border-color: var(--dim-goal)` | 五种全拦下,移除后恢复通过 |

两次验完即删,不留在仓库里。

## 未完成 —— 全部卡在你侧资产

| 项 | 卡在 |
|---|---|
| **字体探针实测**(Stage 1 硬验收) | CDN 3 个文件的 URL 未到;`assets/fonts/` 里的源文件未到,subset 生成不了 |
| **Vercel 部署** | 需要你把仓库接到 Vercel、配域名 CNAME、填环境变量 |
| 浏览器实际观感 | 未跑起 dev server:`.claude/launch.json` 只从当前会话工作目录读,而那是另一个项目。你本地 `npm run dev` 看 `/_showcase` 即可 |

## 改动文件

新增 27 个,全部在 `~/qai-growth-compass/`,**未 commit**:

```
package.json  package-lock.json  .gitignore  .env.example
vite.config.ts  tsconfig.json  tsconfig.app.json  tsconfig.node.json
tailwind.config.ts  postcss.config.js  index.html  vercel.json
eslint.config.js  eslint.cjk.config.js
.claude/launch.json
README.md(覆盖初始 commit 的版本)  PROGRESS.md(本文件)
api/font-probe.ts
scripts/check-bundle-secrets.mjs  scripts/subset-fonts.mjs
src/index.css  src/main.tsx  src/App.tsx  src/vite-env.d.ts
src/styles/brutalist.css  src/styles/fonts.ts
src/config/ui-strings.ts
src/lib/cn.ts  src/lib/i18n.tsx
src/pages/Showcase.tsx
src/components/brutalist/{Button,Card,Input,Select,Radio,Progress,Dialog,Tabs,Table,Badge}.tsx
src/components/brutalist/index.ts
```

---

# Stage 2 — 数据表 + phone.ts + 单元测试

分支 `stage-2-schema-phone`。

## 跨运行时共享的三层做法

你指出真正的要害不是「文件放哪」而是 specifier 与版本,这个判断对。落地如下:

**1. specifier —— 裸标识符 + import map**

`src/lib/phone.ts` 只写 `from 'libphonenumber-js/max'`。Vite 走 node_modules;Deno 走 `supabase/functions/deno.json` 的 import map 映射到 `npm:libphonenumber-js@1.13.10/max`。同一份文件不可能两种写法都写,裸标识符 + import map 是唯一能让两边都解析的方案。

`supabase/functions/_shared/phone.ts` 是**一行 re-export,不是拷贝**。用显式 `.ts` 扩展名 —— Deno 要求扩展名,Vite 侧由 `allowImportingTsExtensions` 允许同样写法,一行满足两个运行时。

**2. 版本 —— 两处写死到 patch 位 + 构建门禁**

`package.json` 与 import map 都是 `1.13.10`,无 `^` 无 `~`。`npm run check:dep-sync` 是第五道门。

**这道门的第一版有盲区,反向验证时抓到了。** 第一版手写 `SHARED = ['libphonenumber-js']`,于是 import map 少掉 `libphonenumber-js/max` 这个子路径条目时守卫照样说 OK —— 而 `phone.ts` 恰恰 import 的是 `/max`,Deno 根本解析不了,那个文件在 Edge Function 里会直接加载失败。手写清单必然跟不上代码。改成**扫共享源码里的裸 specifier 反推**,逐个要求 import map 有条目且版本一致。

反向验证 5 种违规,全部拦下,恢复后通过:

| 用例 | 结果 |
|---|---|
| import map 版本落后(1.10.55) | 拦下 |
| `package.json` 用 `^1.13.10` | 拦下 |
| **import map 缺 `/max` 条目** ← 第一版的盲区 | 拦下(第一版误判为通过) |
| 目标缺版本号 `npm:libphonenumber-js/max` | 拦下 |
| `package.json` 缺依赖 | 拦下 |

新增共享文件时要加进 `SHARED_SOURCES`,漏加会让该文件的依赖失去保护 —— 这是本守卫已知的边界,写在脚本注释里。

**3. 行为 —— 同一组用例两个运行时各跑一遍**

`src/lib/phone.cases.ts` 是**纯数据,不 import 任何测试框架**,两边各自的 runner 消费它:

| 运行时 | 文件 | 跑法 |
|---|---|---|
| Node | `src/lib/phone.test.ts`(Vitest) | `npm test` |
| Deno | `supabase/functions/_shared/phone_test.ts` | `npm run test:deno` |

「同一份源码」只保证源码一致,不保证行为一致。只有两边跑同一组用例并断言输出逐字相同,才算真的验过。

## 用例与实测结果

`npm test` → **38 passed**。除需求点名的 9 条,补了区域覆盖(SG / ID / TW / CN)、脏输入、`phoneTail`、`tailFromInput`、`normalizeEmail`,以及两条跨函数不变量:

- `tailFromInput(归一化结果) === phoneTail(归一化结果)` —— 入库算的 tail 与查询算的 tail 必须一致,这是三级回退的前提
- `normalizePhone` 幂等 —— 归一化结果再归一化仍是自己

**两条原本拿不准的,实测有了答案:**

| 用例 | 我原来的标注 | 实测 |
|---|---|---|
| `'+60999999999'` | 「拿不准 libphonenumber 怎么判」 | → `null` ✓ 期望成立,`isValid` 确实拒绝未分配号段 |
| `'012-436-1382 ext 5'` | 期望 `+60124361382` | → `null` ✗ **我的期望是错的,已改期望值** |

`ext 5` 那条值得记一笔:config 的 `phone_normalization` 规定的顺序是**先去掉所有非数字非加号字符、再 parse**,所以 `ext` 的那个 `5` 会被并进号码本体,变成 11 位的 `01243613825` —— 对 MY 手机号无效,返回 `null`。

这不是缺陷,是设计要的降级:拿不准就返回 `null`,记录仍然入库、`phone_raw` 保留原值、Admin 名单页标红「号码格式异常」,由人来修。若改成先用 libphonenumber 原生解析(它认得 ext),就违背了 config 定的顺序,而 config 是真相源。**所以改期望值,不改函数。**

## 迁移文件 —— 已写,未执行

| 文件 | 内容 |
|---|---|
| `supabase/migrations/20260731000000_assessment_init.sql` | 9 张表 + 索引 + trigger + RLS 全开零 policy |
| `supabase/migrations/20260731000100_reports_storage_bucket.sql` | `reports` 私有 bucket |

与 PROGRESS.md 0.7 的 SQL 逐行一致。**一行都没执行** —— 等你批准,而且 Supabase 的 project ref 与 keys 也还没给。

## 未完成

| 项 | 卡在 |
|---|---|
| **Deno 侧跑用例** | 这台机器**没装 deno**(Supabase CLI 2.90.0 有,但它不提供通用 `deno` 命令)。需要 `brew install deno` —— 装工具链会改你的机器,等你点头 |
| **migration 执行** | 等你批准 SQL + 给 Supabase keys |
| 字体探针 | 等 CDN URL |

## 构建链(五道门)

```
npm run build
  ✓ lint:cjk        无硬编码中文
  ✓ check:dim       维度色仅用于填充
  ✓ check:dep-sync  1 个共享 specifier 两侧版本一致
  ✓ tsc -b          类型检查通过
  ✓ vite build      1674 modules
  ✓ check:bundle    无 secret 泄漏
npm test            38 passed
```

三道自建守卫全部反向验证过(`lint:cjk` 2 种、`check:dim` 5 种、`check:dep-sync` 5 种)。

---

## 变更日志

- 2026-07-31 — rev1 初稿
- 2026-07-31 — rev2:PDF 异步化 + Storage;字体 CDN 化;GHL Inbound Webhook 替代 workflow ID;环境变量改名与新增;D1–D5 批准;新增 D6/D7
- 2026-07-31 — rev4 **Stage 0 定稿**:「8 张表」约束解除,D8 采用第 9 张 `app_settings` 表;D9 定稿(标签独立于字段写入、TRANSIENT/CONFIG/AUTH 三类错误分流、错误具体到字段 key);字体源文件位置与 `.gitignore` 规则确定;0.12 字段清单标记作废(实际前缀为 `qai_assessment_*`);`assessment-config.json` 第三次未送达
- 2026-07-31 — rev3:D6 细则定稿(3 次上限 / `failed_permanent` / 200 字截断 / Admin 重置);GHL scope 批准 + 映射缓存与刷新机制;字体砍到 3 个文件并补三个坑;运维备注 0.17;新增 D8/D9;本地路径确认;`assessment-config.json` 仍未收到
