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
| 2 | 数据表 + RLS + phone.ts + 单元测试 | **代码与验证完成;migration 待批准执行** |
| 3 | assessment-ghl-webhook | **代码完成,待部署实测** |
| 4 | 登录流程(魔法链接 + 重发 + 限流 + session) | 未开始 |
| 5 | Admin 认证 + 名单管理页 | 未开始 |
| 6 | 答题流程(背景题 + 24 题 + 断点续答) | 未开始 |
| 7 | 计分 Edge Function + 问卷页 | **收尾:判据实现完成,待部署实测(字段映射 N/key 由你回报)** |
| 8 | 报告页 9 板块 + 批次基准线 + 代价换算 + 打印样式表 | **完成**(板块合并后仍 9 个) |
| 9 | PDF 异步渲染 + Storage + 分享卡 | 未开始 |
| 10 | Admin Portal 其余四模块 + 现场模式 | 未开始 |
| 11 | GHL 写回 + 重试(**含从 Stage 7 挂回的:tags、Vercel Cron 定时、Admin 刷新字段映射按钮**) | 部分先行(字段映射 / 判据 / sweep 已在 Stage 7 做掉) |
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

**rev5 — 设计补漏:魔法链接的来源(Stage 3 实施时发现)**

原方案写「到指定时间由 GHL 批量发链接」,但**从头到尾没说 GHL 手上的链接从哪来**。`access_token` 是 32 字节随机值,GHL 猜不出来;`qai_assessment_report_url` 要等 Stage 11 答完题才写回,时间点完全错位 —— 那时候链接早该发出去了。

**这个洞的失败形态是最难查的一种**:数据库记录齐全、`created: true`、日志无异常,但没人收到链接。要等 Stage 4 测登录时才撞上,而那时会先去查登录逻辑,根因却在三个 Stage 之前的 GHL 配置里。

**定稿的契约:**

```
GHL 付款 workflow → Webhook action → POST /assessment-ghl-webhook
  ← 响应体 { "magic_link": "https://compass.qiai.tech/?t=<43 字符 token>", ... }
  → GHL 把响应字段 magic_link 映射进自定义字段 qai_assessment_magic_link
  → 到指定时间,发链接的 workflow 从该字段取值发出
```

- 初始链接**只能**走这条响应映射。Stage 3 因此不需要引入 GHL API 依赖
- `qai_assessment_report_url`(Stage 11 写回)与它是两个不同时间点的东西,**不能互相替代**
- 重复触发返回同一个 `magic_link`(token 不轮换),GHL 重复映射同一个值,幂等
- 需要在 GHL 建的字段:`qai_assessment_magic_link`(单行文本)—— 这是 Stage 3 唯一需要提前建的自定义字段

配置步骤见 [`docs/ghl-setup.md`](docs/ghl-setup.md) 的「Response —— 这一步必须配」。

**rev3 → rev4(Stage 0 定稿)**

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
| D7 | `pdf_path` 存 Storage 私有路径,下载时现签 1 小时 signed URL(原名 `pdf_url`,已改) | ✅ |

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
  └─ 成功 → pdf_path = 路径, pdf_status = 'ready'
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
| `<ref>.supabase.co/functions/v1/assessment-ghl-webhook` | POST | `X-QAI-Secret` | 建/更新准入记录。⚠️ **不走 `/api/*` 代理** —— 代理是为浏览器请求的第一方 cookie 存在的,GHL 是服务器到服务器,没有 cookie 参与 |
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

## 0.7 数据库 schema

**SQL 的唯一真相源是 migration 文件本身,本节不再内联复制:**

| 文件 | 内容 |
|---|---|
| [`20260731000000_assessment_init.sql`](supabase/migrations/20260731000000_assessment_init.sql) | 9 张表 + 索引 + trigger + 列注释 + RLS 全开零 policy |
| [`20260731000100_reports_storage_bucket.sql`](supabase/migrations/20260731000100_reports_storage_bucket.sql) | `reports` 私有 bucket |
| [`20260731000200_seed_default_cohort.sql`](supabase/migrations/20260731000200_seed_default_cohort.sql) | 默认批次 seed + 自断言 |

> **为什么删掉内联的那 164 行**:Stage 0 时还没有 migration 文件,SQL 只能写在这里;
> 文件建好之后两份就要靠人同步 —— 而这次审查一比对,立刻发现已经漂了一处
> (本节写 `dimensionId`,migration 写 `dimensionKey`,后者才对,config 用的是 `key`)。
> 与其加一道「文档与 migration 一致」的守卫来维护复制品,不如取消复制。
> 设计理由与决策依据已经全部写在 SQL 的注释里,那里才是它们该待的地方。

### 关键设计点(细节见 SQL 注释)

| 点 | 决定 |
|---|---|
| RLS | 9 张表全 `enable row level security`,**零 `create policy`**;客户与 Admin 一律走 Edge Function 的 service_role |
| `reports` bucket | `public = false`,20MB 上限,mime 白名单只有 `application/pdf`,不建任何 storage policy |
| `tier` | 有 CHECK,取值域与 config 的 `custom_fields[].domain` 一致 —— 域外值会让 GHL workflow 静默不匹配,数据库这层就挡 |
| `email_lower` / `phone_tail` | **故意不加 unique**。加了会让 webhook 在重复时直接失败、丢掉整条准入记录。代价是查询侧必须处理多命中(见 S4-A) |
| `access_revoked_at` | 不自动过期,但有撤销路径(见 S4-C) |
| `pdf_path` | 存 Storage 对象路径,不是公开 URL。原名 `pdf_url` 需要靠注释纠正字段名,说明名字本身是错的 |
| `touch_updated_at` trigger | 保留。纯赋值 per-row,开销可忽略;真要批量导入时临时 `disable trigger` 即可 |

### 功能依赖进 migration,环境配置手动

判断标准:**换一个环境重建,代码还能不能正常跑。**

| | 归类 | 处理 |
|---|---|---|
| 默认批次(`is_default = true`) | **功能依赖** —— 没有它 webhook 的 cohort 兜底无处可落,`cohort_id` 静默落 null,基准线 / `cohort_rank` / 批次聚合看板整块失效,而且要等 Stage 8 才会发现 | 进 migration `20260731000200`,可复现,重建环境不会漏 |
| `admin_users` 首行 | **环境配置** —— 为空只是没人能登录后台,代码本身照常运行;而且内容含个人邮箱 | 手动 SQL Editor insert |

**手动执行的部分(不进 migration):**

```sql
insert into public.admin_users (email, name) values ('<你的邮箱>', '<名字>');
```

> seed migration 里那句 `on conflict do nothing` 会吞掉**任何**唯一冲突,不只是「默认批次已存在」这一种。所以插完跟了一个 `do $$ ... raise exception ... $$` 断言目标状态真的达成 —— 这个 seed 若静默失败,后果(`cohort_id` 落 null)恰恰属于不报错的那一类。

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
4. 付款 workflow 加 Webhook action:`POST https://<ref>.supabase.co/functions/v1/assessment-ghl-webhook`(**直连 Supabase,不走 `/api/*` 代理**),custom header `X-QAI-Secret: <QAI_WEBHOOK_SECRET>`,body 至少含 `{ ghl_contact_id, phone, email, name, cohort_tag }`,并把响应的 `magic_link` 映射进 `qai_assessment_magic_link`(见 rev5)

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

### 第一批 —— ✅ 已上 CDN(3 个,均验证 200,CORS `*`)

| # | 文件 | 用途 | 实际体积 |
|---|---|---|---|
| 1 | `NotoSansSC-Regular.otf` | fontconfig 兜底层 | 8,331,336 B |
| 2 | `Sora-VF.woff2`(可变,wght 轴) | 标题的拉丁字母与数字 | 49,436 B |
| 3 | `PlusJakartaSans-VF.woff2`(可变,wght 轴) | 正文的拉丁字母与数字 | 60,548 B |

**格式是 otf 不是 ttf** —— 来源 `googlefonts/noto-cjk` 的 `Sans/SubsetOTF/SC/`,SC 子集静态版、非可变字体。fontconfig 认 otf,符合「静态单字重、不要可变版」的要求。family name 精确等于 `Noto Sans SC`,与 webfont 的 `Noto Sans SC Subset` 错开,坑 1 的设计成立。

代码里的文件名已按实际资产改正:`Sora[wght].woff2` → `Sora-VF.woff2`,`PlusJakartaSans[wght].woff2` → `PlusJakartaSans-VF.woff2`,`chromium.font()` 的 `.ttf` → `.otf`。

### 另需 —— 本地源文件(不上 CDN)✅ 位置已定

放 `~/qai-growth-compass/assets/fonts/`,你会把 Regular 和 Bold 都放进去。**该目录进 `.gitignore`,原始字体不进仓库**(单个 10MB,git 里放二进制字体没意义)。

| # | 文件 | 用途 |
|---|---|---|
| 4 | `NotoSansSC-Bold.ttf`(或 `.otf`) | 生成 subset Bold 的唯一来源,见坑 3 |
| (1) | `NotoSansSC-Regular.ttf`(或 `.otf`) | 同时也放这里,用来生成 subset Regular;另需一份上 CDN 作兜底层 |

### 第二批 —— ✅ 已生成,待上 CDN(2 个)

| # | 文件 | 实际体积 |
|---|---|---|
| 5 | `NotoSansSC-Regular.subset.woff2` | 1,165,800 B(1.11 MB) |
| 6 | `NotoSansSC-Bold.subset.woff2` | 1,191,732 B(1.14 MB) |

产物在 `build/fonts/`(已 gitignore)。**不写进 `public/`** —— Vite 会把 `public/` 整个复制进 `dist/`,而字体是从 CDN 取的,放那里会让 2.3MB 跟着每次部署走一遍。

生成用项目内的 Python venv,不动系统 Python:`python3 -m venv .venv && ./.venv/bin/pip install "fonttools[woff]" brotli`(`.venv` 已 gitignore)。

### subset 的码位选择

第一版直接收整个 CJK 基本区(20,992 码位),出来 **3.25 / 3.37 MB** —— 是我原先估算的两倍。手机首屏拉这个太重,而其中绝大多数字这辈子不会出现在报告里。

改成两部分的并集:

| 来源 | 数量 | 理由 |
|---|---|---|
| GB2312 可编码的汉字 | 6,763 | 有明确标准依据,不靠某份来路不明的「常用 3500 字」频率表。用 Python `codecs` 枚举,离线可复现 |
| config + ui-strings 里实际出现的汉字 | 680,全部落在 GB2312 内 | 报告正文词汇是固定的,必须 100% 覆盖 |

结果 6,763 个汉字 + 9 段非汉字区间 → **1.11 / 1.14 MB**,回到原估算。

### ⚠️ 生成时发现:测试字符串污染了它要测的东西

`ui-strings.ts` 里有一条 `showcase.fontRare: '生僻字:䶮 龘 靐 齉 麤'`,而 `ui-strings.ts` 正是 subset 的扫描源。于是 **龘 靐 齉 麤 四个字被收进了 subset**(䶮 属 CJK 扩展 A 区,不在扫描范围内所以逃过)。

后果:字体探针第 2 块与 Showcase 自检块**会被 subset 满足** —— 显示正常,但根本没验到 fontconfig 兜底层。探针会给出一个假的通过。

修法:`FALLBACK_PROBE_CHARS = '䶮龘靐齉麤'` 显式排除,并在生成后**双向断言**:

- config 里每个汉字必须在 subset 内(一个都不能漏)→ 漏了构建失败
- 探针字必须**不在** subset 内 → 漏进去构建失败

```
[subset] NotoSansSC-Regular 校验通过:7650 个码位,config 无漏字,探针字未被收进。
[subset] NotoSansSC-Bold    校验通过:7650 个码位,config 无漏字,探针字未被收进。
```

这两条断言是 `npm run fonts:subset` 的一部分,以后改 config 或改探针字符都会被挡住。

**CDN 要求**:`https://cdn.qiai.tech/fonts/` 下平铺,文件名与上表一致,`CDN_FONT_BASE` 指到这一层。CORS 已开(`access-control-allow-origin: *`)。

---

## 0.15 分阶段验收标准

| Stage | 「做完了」= |
|---|---|
| 1 | `compass.qiai.tech` 打开 Brutalist 组件展示页,10 个组件全在;`npm run build` 零错;bundle 泄密检查通过;**`/api/font-probe` 渲出的常用字与生僻字都不是方块 —— 这条不过不进 Stage 2** |
| 2 | migration 已 apply;`npm test` 全绿(含全部 phone 用例);Deno 能 import 同一份 phone.ts |
| 3 | curl 打 webhook:错密钥 401 且不写库;同一 contact_id 打 3 次只有 1 行;烂号码降级写入且 raw 保留 |
| 4 | 魔法链接可登录;Inbound Webhook 触发后 WhatsApp + Email 双通道到达;第 6 次登录尝试被锁;命中与未命中文案与耗时无差异;**跳转目标由 session 状态推导且类型层受限(四态各验一遍,`survey` 态不得被推回 `/quiz`)**;**英文入口(`?lang=en`)登录后仍是英文**;**同一邮箱两条 entitlement 时不发链接且记 warn(S4-A)**;**`login_attempts` 30 天清理生效(S4-B)**;**作废后旧链接被拒、新链接可用(S4-C)** |
| 5 | **前置检查:`admin_users` 至少一行,否则后台不可达**(环境配置,手动 insert,见 0.7);名单页可筛可导出;非名单邮箱登录后台得 403;异常号码行标红;**可筛 `phone_e164 is null` 并显示占比**(阈值 2%,见 Stage 2 的 ext 用例记录) |
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
| **「能不能区分 A 和 B」必须两边都有样本** | 判断 GHL 无效 trigger 能否检测时,只测了假 trigger、拿到 200 就下了「不能检测」的结论。实际上真 trigger 也回 200,但响应体带一个 `id` —— 差异一直在,只是**手上没有对照样本**。一个样本只能证明「A 长这样」,证明不了「A 和 B 一样」。凡是结论形如「两者无法区分」「没有信号」的,先问:另一边的样本在哪 |
| **守卫的覆盖边界会被代码越过** | 已经栽了**七次**(第七次是另一类,见下一行):`api/` 目录建了但没进 `tsc -b`;`check:dep-sync` 只扫 `_shared/` 而函数本体在外面;Deno 侧代码一直没 `deno check`;`deploy` 两条守卫都不经过;**环境变量的需求在代码里,而配置在人的记忆里**(Stage 4 端到端时 `LOGIN_HASH_PEPPER` 与 `SESSION_SECRET` 两次 500,都是 Stage 1 清单里标着「以后才用」的变量,而没有任何东西提醒去补)。**每加一个新运行时、新目录、新配置维度,就多一个没人检查的角落。** 加之前先问:现有守卫的边界是手写的吗?会不会把它落在外面 |
| 验证分三层 | ① `npm run build` —— **纯 Node** 五道门,Vercel 也跑得动。② `npm run verify` —— 加上需要 deno 的三项(`check:deno` / `test:deno` / `check:cross`)。③ **`npm run smoke -- --base <url>`** —— 部署后跑,验证 `/api` 代理链真的通 |
| ⚠️ **有些执行路径本地根本没有能覆盖它的地方** | 这是「执行路径长到守卫外面」的第七次,但**性质不同**:前六次是边界画小了、补一下就能覆盖;`api/[...path].ts` 这条链是**本地无处可测** —— `vite dev` 走 `VITE_API_PROXY` 时它根本不参与,五道门是静态检查不发请求,`deploy` 只保证部署成功。「本地全绿 + 部署成功」与「代理能用」之间原本是零检查,第一版的路径解析错误就是这么漏到生产的。**答案不是再加一道构建门,是把检查移到部署之后** —— `npm run smoke`。判断标准:这条路径在本地会不会被执行?不会,就必须有一个部署后的检查 |
| ⚠️ **已知开着的洞:`verify` 靠人记得跑** | Vercel 只跑 `npm run build`,所以需要 deno 的三项**在 CI 上永远不会执行**。这跟我们拆掉的那些手写清单是同一类问题 —— 一个依赖人自觉的检查。当前单人开发、本地跑 verify 够用,**所以现在不做**。触发条件:①加人 ②开始出现漏跑。到那时上 GitHub Actions 跑 `npm run verify`(runner 装 deno 即可)。记在这里是为了知道它开着,而不是假装它不存在 |
| **三条执行路径,守卫覆盖各不相同** | ① Vercel 部署 → 只跑 `npm run build`(五道门)。② 本地开发 → `npm run verify`(五道门 + deno 三项)。③ **`supabase functions deploy` / `db push` → 本地 CLI 直连 Supabase,两边都不经过**。第三条是 Stage 3 才暴露的:deploy 失败而 `check:dep-sync` 是绿的。已把 deploy 收进 `npm run deploy:functions`(= `verify && supabase functions deploy`),让它**必须**经过守卫,而不是靠人记得先跑 |
| **配置跟着实现走** | 不给尚未存在的文件写配置。提前的配置只有两种下场:**直接炸**(Vercel 对 `functions` 里不存在的函数硬失败)或**静默腐烂**(import map 里没人用的条目不受任何校验,可以漂到别的版本而无人发现)。也不要为了让部署过去建空占位文件 —— 占位函数一部署就是一个真实可访问的端点,而且下个 Stage 会接手一个来路不明的文件 |
| 依赖审计 | 每个 Stage 收尾跑 `npm audit --omit=dev`,只看生产依赖。devDependencies 的漏洞不进产物,不管。**不跑 `npm audit fix --force`** —— 会拉高大版本把验过的构建链弄坏 |
| seed 数据的归属 | **功能依赖进 migration,环境配置手动。** 判断标准是「换一个环境重建,代码还能不能正常跑」。没有默认 cohort 代码就跑不对 → migration;没有 admin 只是没人能登录 → 手动 |
| **不要同一份东西存两处** | 靠人同步的复制品本身就是 bug 源,加「一致性守卫」只是给它上保险。发现复制品先想能不能取消复制:SQL 的真相源是 migration 文件,题库的真相源是 `assessment-config.json`,设计理由写在它们各自的注释里 |
| ~~PAT 轮换~~ | ❌ **已作废**。本机已从 PAT 切到 SSH key,remote 改为 `git@github.com`。**不要再提醒轮换 PAT** |
| 密钥轮换清单 | `QAI_WEBHOOK_SECRET`(改后要同步改 GHL webhook header)、`INTERNAL_FN_SECRET`(改后 Supabase 与 Vercel 两边必须同时改,否则渲染与写回全断) |
| **换 `SESSION_SECRET` 只清 session,它不是吊销开关** | 无状态签名 cookie 的副产品:换一次 `SESSION_SECRET`,所有已发出的 session 立刻失效,不需要遍历任何表。<br>⚠️ **但最容易想到的那个用途恰恰是它做不到的**:「怀疑链接大面积泄露 → 换 secret 全清」是错的 —— 泄露的是 `access_token`,而魔法链接不过期,对方点一次链接就又进来了。换 secret 在这种情况下一点用没有。<br>两者粒度不同,混用会有一方失效:<br>• `access_revoked_at` —— **单个人**,清 session **和** `access_token`<br>• 换 `SESSION_SECRET` —— **所有人**,只清 session,链接仍可重新登录<br>所以:怀疑某个人的链接落到别人手里 → 作废那一条。怀疑 session cookie 本身被截(共用设备、某个渠道被抓包)且链接没泄露 → 换 secret。**链接泄露只能靠作废 token,没有批量版本** —— 真要批量作废,得写一个按 cohort 批量置 `access_revoked_at` 并重发的 Admin 操作,那是新功能不是配置开关 |
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

`package.json` 与 import map 都是 `1.13.9`,无 `^` 无 `~`。`npm run check:dep-sync` 是第五道门(纯 Node,不依赖 deno,所以 Vercel 也跑得动)。

**版本从 1.13.10 降到 1.13.9,是 Deno 拦下来的。** Deno 2.9 有最小依赖年龄策略(默认 24 小时),`1.13.10` 发布仅 22.5 小时,直接拒绝安装。我原本 pin 的就是 `npm install` 当天抓到的最新版 —— 一个没有任何 soak time 的版本。**没有关掉这个策略,而是降到 14 天前的 `1.13.9`。** 策略拦对了,pin 一个刚发布几小时的包本身就是风险。

**这道门迭代了三版,每一版都是在删手写清单:**

| 版本 | 做法 | 盲区 |
|---|---|---|
| v1 | 手写包名清单 `SHARED = ['libphonenumber-js']` | import map 少掉 `/max` 子路径条目照样判通过,而那正是 `phone.ts` 实际 import 的 specifier |
| v2 | 扫源码反推 specifier,但文件清单 `SHARED_SOURCES` 手写 | 同一类问题上移一层 —— 新增共享文件忘了加进清单,那个文件就没保护 |
| **v3(当前)** | **文件清单也不手写**:`_shared/` 下所有 `.ts` 无条件纳入,再沿 import 图递归捞进被引用的项目内文件;清单为空则判失败 | 见下 |

结论:凡是「需要人记得去更新」的清单,迟早会漏。能从代码推出来的就别写。

反向验证 7 种违规,**全部拦下**,恢复后通过:

| 用例 | 结果 |
|---|---|
| **新增 `_shared` 文件带未映射的裸 import** ← v2 的盲区 | 拦下(v2 会误判通过) |
| import map 版本落后(1.10.55) | 拦下 |
| `package.json` 用 `^1.13.9` | 拦下 |
| **import map 缺 `/max` 条目** ← v1 的盲区 | 拦下 |
| jsr 目标含范围符 `jsr:@std/assert@^1.0.10` | 拦下 |
| npm 目标但 `package.json` 缺该依赖 | 拦下 |
| `_shared` 目录消失(空清单不得判通过) | 拦下 |

自动发现结果:4 个共享源码文件、2 个外部 specifier(`libphonenumber-js/max` → npm、`@std/assert` → jsr)。jsr 的包不在 `package.json` 里,校验到「精确版本」为止。

**3. 行为 —— 同一组用例两个运行时各跑一遍**

`src/lib/phone.cases.ts` 是**纯数据,不 import 任何测试框架**,两边各自的 runner 消费它:

| 运行时 | 文件 | 跑法 | 结果 |
|---|---|---|---|
| Node | `src/lib/phone.test.ts`(Vitest) | `npm test` | 38 passed |
| Deno | `supabase/functions/_shared/phone_test.ts` | `npm run test:deno` | 5 passed |

「同一份源码」只保证源码一致,不保证行为一致。

**但「两个套件都绿」也只是推出来的一致,不是量出来的。** 两边都等于 `cases` 里的 `expected`,逻辑上能推出两边相等 —— 可一旦哪天不等,只会得到一句 assertion failed,看不出差在哪。所以再加一层:

```
npm run check:cross
  → node scripts/dump-phone.ts
  → deno run --allow-read --config supabase/functions/deno.json scripts/dump-phone.ts
  → 逐行 diff
[check-cross] OK —— Node 与 Deno 的 36 行输出逐字相同。
```

**同一个 `dump-phone.ts` 在两个运行时各跑一次**(Node 靠原生类型剥离直接跑 `.ts`),把真实输出摆出来对比。这也是唯一能抓住「除了两边同时错成一样以外的所有情况」的检查 —— 号码元数据、Intl 行为、正则引擎差异都会在这里现形。

反向验证 3 种,全部拦下:输出分叉(22/36 行不一致)、某一侧无输出、行数不等。

> `check:cross` **不进 `npm run build`** —— 它需要 deno,而 Vercel 的构建环境没有。它属于本地与 CI(装了 deno 的那种)的检查。`check:dep-sync` 是纯 Node,所以留在构建链里。

> 第一次写这个反向验证时,三个用例全部「通过」—— 其实是我的注入锚点没匹配上,文件根本没被改动,harness 静默 no-op 了。一个不会失败的反向验证比没有更糟。现在 harness 会先断言文件真的变了,匹配不到锚点就报「跳过」而不是「通过」。

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

这不是缺陷,是设计要的降级:拿不准就返回 `null`,记录仍然入库、`phone_raw` 保留原值、Admin 名单页标红「号码格式异常」,由人来修。失败方向是对的 —— 拿不准就交给人,不猜一个可能错的号码存进去。若改成先用 libphonenumber 原生解析(它认得 ext),就违背了 config 定的顺序,而 config 是真相源。**所以改期望值,不改函数。反过来改函数去迁就一个手写的期望值,等于让测试倒过来定义行为。**

**配套的监控要求(Stage 5 名单页必做):**

- 名单页要能筛出 `phone_e164 is null` 的记录,并显示**占全部准入记录的百分比**
- **阈值 2%**:上线后这个比例超过 2%,说明 GHL 里的号码质量比预期差,那时再回来讨论要不要加 ext 预处理
- **现在不加 ext 预处理** —— 没有数据支撑的优化就是猜

这条写进 Stage 5 的验收标准,不是「记得做」。

## 迁移文件 —— 已写,未执行

| 文件 | 内容 |
|---|---|
| `supabase/migrations/20260731000000_assessment_init.sql` | 9 张表 + 索引 + trigger + RLS 全开零 policy |
| `supabase/migrations/20260731000100_reports_storage_bucket.sql` | `reports` 私有 bucket |

与 PROGRESS.md 0.7 的 SQL 逐行一致。**一行都没执行** —— 等你批准,而且 Supabase 的 project ref 与 keys 也还没给。

## Vercel preview 首次部署失败 —— 提前的配置

```
Error: The pattern "api/render-pdf.ts" defined in `functions` doesn't match any
Serverless Functions inside the `api` directory.
```

`vercel.json` 给 `api/render-pdf.ts` 配了 `maxDuration` / `memory`,但函数本体是 Stage 9 才写,文件不存在 → Vercel 硬失败。与代码无关,本地 `rm -rf node_modules && npm ci && npm run build` 全绿。

**修法:整段删掉那条规则,Stage 9 写函数本体时再一起加回来。** 不建空占位文件 —— 占位函数一部署就是真实可访问的端点,而且 Stage 9 会接手一个来路不明的文件。

**顺带排查出同一类的第二处**:`deno.json` 的 import map 里映射了裸 `libphonenumber-js`,但**没有任何文件 import 它**。而 `check:dep-sync` 只校验被实际用到的 specifier,所以这条未使用的映射不受任何校验 —— 它可以漂到另一个版本而不被发现,等哪天有人 import 裸形式,就拿到一个与 `/max` 不同的版本。同样是配置提前于实现,只是它不会炸,会静默腐烂。

已删掉,并**加了守卫**:import map 里出现没人用的条目即构建失败。反向验证 2 种(加回裸条目、加一个无关的 `zod` 条目),都拦下。

全仓其余配置引用的文件已逐一确认存在:`package.json` 的 scripts、`deno.json` 的 tasks、`.claude/launch.json`、`vercel.json` 剩下的 `api/font-probe.ts`(这个文件是存在的)。

**Stage 9 要加回的配置**:`vercel.json` → `functions["api/render-pdf.ts"] = { maxDuration: 60, memory: 1769 }`。

## 依赖审计(Stage 2 收尾)

```
全部依赖    moderate=4  high=16  critical=1  total=21
仅生产依赖  moderate=2  high=0   critical=0  total=2
```

**那个 critical 和全部 16 个 high 都在 devDependencies 里** —— 不进产物,不管。

生产依赖的 2 个 moderate 都在 `react-router`(`react-router-dom` 依赖它):

| 漏洞 | 对本项目的实际暴露 |
|---|---|
| `deserializeErrors()` 构造器注入(SSR Hydration) | **不适用** —— 本项目是纯 SPA,没有 SSR hydration |
| `<Link>` / `useNavigate` 反斜杠开放重定向 | **当前不适用**,但 Stage 4 要当心:登录后的跳转目标必须是代码里的字面路径,**绝不能来自 query param**。已写进下面的约束 |

**6.x 分支有没有补丁 —— 已查清,没有:**

| 事实 | 值 |
|---|---|
| 当前安装 | `react-router` / `react-router-dom` **6.30.4** |
| 6.x 最后一个版本 | 6.30.4 —— **我们已经在 6.x 最新版上了** |
| 漏洞区间 | `6.0.0 - 7.17.0` → 6.30.4 落在区间内 |
| 首个修复版本 | **7.18.0**,即 major |

所以没有零成本选项。6.x 不会再有补丁(7.x 已是当前主线),**约束方案就是最终方案,不是权宜之计**。这条不用留到 Stage 4 复查了。

### Stage 4 登录跳转规范(源自上述开放重定向)

**约束 1 —— 白名单落到类型层,不是文档里的规矩**

```ts
type PostAuthTarget = '/quiz' | '/survey' | '/report' | '/expired';
```

跳转函数只接受这个类型。传字符串进不去,编译期就挡住。不接受任何形式的 `?next=` / `?redirect=` 参数。

**约束 2 —— 目标由 session 状态推导,不由调用方传入**

白名单只是必要条件不是充分条件:已完成的 session 跳 `/quiz` 会让人重答一遍,未完成的跳 `/report` 会看到空报告。白名单防外部注入,状态推导防内部逻辑错,两个都要。

| 条件 | 目标 |
|---|---|
| token 无效 / entitlement 不存在 | `/expired` |
| `sessions.status = 'in_progress'` | `/quiz` |
| `sessions.status = 'survey'` | `/survey` |
| `sessions.status = 'completed'` | `/report` |

> ⚠️ **四值的由来:最初两次描述白名单时都写成三值(`/quiz` `/report` `/expired`),漏掉了 `/survey`。**
> 这是一次单向的疏漏,不是「定了三值又改成四值」—— 记清楚是因为以后回看时,「改过主意」和「一开始就漏了」指向完全不同的复查方向。
>
> **四值是被 schema 逼出来的,不是设计偏好**:`assessment_sessions.status` 的 CHECK 约束就是三态(`in_progress` / `survey` / `completed`),加上 revoked 这一路,正好四个跳转目标。少任何一个都会有一类人无处可去 —— 三值时 `status = 'survey'` 的人要么被推回 `/quiz` 重答 24 题,要么落进 `/report` 看空报告,两个都是产品事故。
>
> 所以这条不靠记:**跳转目标的数量由 status 的 CHECK 约束决定**。以后给 status 加态,就必须同步加一个 `PostAuthTarget` —— `postAuthTarget()` 里的 `switch` 是穷尽匹配,漏了会在编译期报错。

**约束 3 —— `lang` 必须显式带上**

语言存 URL query(`?lang=en`)+ localStorage。白名单约束的是**路径**,不是 query。跳转时如果整个 query 被丢掉,英文用户登录后会掉回中文。

`lang` 不是重定向目标,不受白名单约束,跳转时显式拼上,别让白名单顺手清掉。

**这个 bug 只有英文用户会遇到,我们自己测大概率测不到**,所以写进 Stage 4 验收标准,不靠记。

### Stage 4 其余三项(SQL 审查带出的)

**S4-A —— email 多命中必须视为未命中**

`phone_tail` 的歧义规则早就写清了(命中 >1 条视为未命中),但 `email_lower` **没有 unique 约束也没有对应规则**。GHL 里同一个邮箱挂在两个 contact 上是完全可能的:同一人重复报名、公司共用邮箱。那时备用路径输入邮箱会命中两条 entitlement,各有各的 `access_token` —— 发哪一个?

按 `phone_tail` 同一条原则:

| | |
|---|---|
| 命中 = 1 条 | 正常重发 |
| 命中 > 1 条 | **视为未命中**,不发链接,页面文案不变(与命中/未命中完全一致) |
| 同时 | 记一条 warn 日志带 `email_lower`,Admin 要能看到「疑似重复 contact」 |

宁可让他联系我们,也不能把 A 的报告链接发给 B。

**SQL 侧不加 unique** —— 加了会让 webhook 在重复邮箱时直接失败、丢掉整条准入记录,那更糟。改为在 `email_lower` 上写死注释:不唯一,查询侧必须处理多命中。`phone_tail` 也补了同样的注释。

**S4-B —— `assessment_login_attempts` 的保留策略**

限流只查最近 15 分钟,但这张表没有任何清理机制。跑一年之后它是纯负担:索引变大、vacuum 变慢,而 99.99% 的行永远不会再被读。

Vercel Cron 每天删 `created_at < now() - interval '30 days'` 的行。30 天是排查窗口,限流本身只要 15 分钟。跟限流一起做,不单独排期。

**S4-C —— `access_token` 的撤销路径**

「重发不轮换」不变(客户可能同时收到新旧两条消息)。但「不过期」和「无法撤销」是两件事。

这个 token 是永久的完整访问权,报告里有对方的营收、询盘量、经营弱点。链接经 WhatsApp 与邮箱流转,转发、截图、共用设备、换手机号都可能让它落到别人手里,而目前**没有任何补救手段**。

⚠️ **原文自相矛盾,Stage 5 实现时才发现。** 原文写的是「置 `access_revoked_at = now()`、生成新 `access_token`、触发重发」,同时又写「校验 token 时 `access_revoked_at is not null` 一律拒绝」—— **这两条一起成立的话,新发的那条链接也会被拒**。

达成意图(旧链接失效、新链接可用)其实**只需要轮换 token**:旧 token 不再匹配任何行,自然就死了,不需要那个标记。所以拆成两个独立动作:

| 动作 | 做什么 | 什么时候用 |
|---|---|---|
| `rotate`(换新链接) | 生成新 `access_token` + **清空** `access_revoked_at` + 发送 | 怀疑某个人的链接落到别人手里 —— 换一条 |
| `revoke`(停用) | 置 `access_revoked_at = now()`,**不发新链接** | 彻底停掉这个人(退款、误发给非学员) |

`resend`(单纯重发同一条)对已停用的记录返回 409,提示改用 `rotate` —— 否则它会把一条本该死的链接又送出去。

**不做自动过期** —— 学员可能几周后才回来看报告,自动过期会制造大量「链接失效」的客服工作。要的是出事时能补救,不是预防性地制造麻烦。

列现在就加,比以后迁移便宜。

## ✅ migration 已应用(Supabase,Singapore region)

三个 migration 全部成功,验证结果与设计一致:

| 检查 | 结果 |
|---|---|
| 表数量 | 9 |
| `is_default = true` 的批次 | 1 |
| `reports` bucket `public` | false |
| RLS 未开启的表 | 0 |

> Region 说明:原建在孟买,趁库空时删掉重建到新加坡。旧 project ref 作废 —— 我这边全程没拿到过任何 keys,PROGRESS.md 里也只有占位符。

## ✅ 字体资产齐全(CDN 5 个文件,全部 200)

```
NotoSansSC-Regular.otf              8,331,336 B   fontconfig 兜底层
NotoSansSC-Regular.subset.woff2     1,165,800 B   排版层
NotoSansSC-Bold.subset.woff2        1,191,732 B   排版层
Sora-VF.woff2                          49,436 B   标题拉丁 + 数字
PlusJakartaSans-VF.woff2               60,548 B   正文拉丁 + 数字
```

Vercel 已配 3 个变量:`VITE_CDN_FONT_BASE`、`CDN_FONT_BASE`(同值 `https://cdn.qiai.tech/fonts`)、`INTERNAL_FN_SECRET`。

## ✅ 字体探针通过(结论由你实测,我未见截图)

Production 上跑通,四块全过,`X-Cdn-Base-Check: match`。

> **来源说明**:截图没到我这边(消息里没有附件)。这条结论是**你实测报告的**,不是我验证的 —— 记在这里以免以后回看时误以为我看过图。

## 字体探针的三处加固

**1. secret 走 header,不走 query string**

原来是 `?secret=...` —— 会落进 Vercel 访问日志、浏览器历史和任何中间代理的日志。跟 `GHL_RESEND_WEBHOOK_URL` 同一条标准:是 secret 就别放 URL。改成 `X-Internal-Secret` header,并用 `timingSafeEqual` 定长比较(先 sha256 消除长度差异,避免长度本身泄露信息)。

```bash
curl -sS -H "X-Internal-Secret: $INTERNAL_FN_SECRET" \
  "https://compass.qiai.tech/api/font-probe" -o probe.png
```

**2. 两个 CDN base 的一致性做成了真守卫,不是眼睛对照**

`VITE_CDN_FONT_BASE` 进 bundle、`CDN_FONT_BASE` 在运行时,构建期确实比对不了 —— 但**它们属于同一个部署**,所以探针可以 fetch 自己站点的 HTML 与 JS,把 Vite 烘进去的字面量抠出来程序化比对。

- 比的是**生效值**而不是「环境变量有没有设」:任一侧没设都会回落到代码默认值,而真正要防的是「网页从一个 CDN 取字体、PDF 从另一个取」。只要两边生效值相同就没问题,与各自怎么拿到的无关。
- 结论进 PNG 第 4 块,同时进响应头 `X-Cdn-Base-Check: match | mismatch | unverified`,不看图也能用脚本消费。
- **抓不到 bundle 就报 `unverified`,绝不当作通过** —— 拿不出证据就说拿不出,不让抓取失败伪装成一致。

**3. 探针第 2 块现在真的在考兜底层**

`RARE` 的那五个字已由 `scripts/subset-fonts.mjs` 显式排除在 subset 之外,并由该脚本断言「必须不在 subset 内」。所以它们出现在探针里就是真的在考 fontconfig,不会被 subset 顺手满足。这一层保证写进了探针的注释,免得以后有人把它们加回 subset。

## 顺带补上一个盲区:`api/` 一直没有类型检查

`tsconfig.app.json` 只 `include: ["src"]`,所以 `api/` 下的代码**从来没被 `tsc -b` 检查过** —— 错误只会在 Vercel 构建时才暴露。改完探针才发现自己刚写了 200 行没类型检查的生产代码。

新增 `tsconfig.api.json` 并挂进根 `references`。反向验证:往 `api/` 放一个 `const x: number = "..."`,`tsc -b` 报 `error TS2322`,删掉后恢复。

Stage 4 的 `/api/[...path].ts` 代理和 Stage 9 的 `render-pdf` 本来都会落进这个盲区。

## 验证总览

```
npm run build          (五道门,纯 Node,Vercel 也跑得动)
  ✓ lint:cjk           无硬编码中文
  ✓ check:dim          维度色仅用于填充
  ✓ check:dep-sync     4 个共享文件、2 个 specifier 两侧一致
  ✓ tsc -b             类型检查通过(src + api + 构建脚本三个 project)
  ✓ vite build         1674 modules
  ✓ check:bundle       无 secret 泄漏

npm test               38 passed   (Node / Vitest)
npm run test:deno      5 passed    (Deno)
npm run check:cross    36 行逐字相同  (需要 deno,不进构建链)
```

四道自建守卫全部反向验证过 —— 证明它会拦,不是证明它不报错:

| 守卫 | 反向用例数 | 抓到过的真问题 |
|---|---|---|
| `lint:cjk` | 2 | — |
| `check:dim` | 5 | — |
| `check:dep-sync` | 7 | 自身 v1 / v2 两代盲区 |
| `check:cross` | 3 | 自身 harness 静默 no-op |

后两行值得记:**两个守卫的反向验证抓到的第一个问题都是守卫自己的**。这正是为什么反向验证不能省。

---

# Stage 3 — assessment-ghl-webhook

分支 `stage-3-webhook`。

## ⚠️ Stage 0 漏了一件事:GHL 从哪拿到魔法链接

原方案写「到指定时间由 GHL 批量发链接」,但**没说 GHL 手上的链接从哪来**。`access_token` 是随机的,GHL 猜不出来;而 `qai_assessment_report_url` 是答完题之后由 Stage 11 的写回填的,时间点完全不同 —— 拿它当发链接的来源是错的,那时候链接早该发出去了。

解法:**webhook 的响应体返回 `magic_link`,GHL 的 Webhook action 把它映射进一个自定义字段**(`qai_assessment_magic_link`)。这样 Stage 3 不需要引入 GHL API 依赖,发链接那一步也有值可用。

这条已写进 [`docs/ghl-setup.md`](docs/ghl-setup.md) 并标了「必须配,否则链接发不出去」。**GHL 那边只映射 request、不映射 response 的话,整条流程会静默断在发链接那一步** —— 数据库里记录齐全、看不出任何异常,但没人收到链接。

## 实现要点

| 约束 | 落地 |
|---|---|
| 密钥校验 | `X-QAI-Secret` 与 `QAI_WEBHOOK_SECRET` 定长比较(先 sha256 压等长再无分支异或),失败 401 **且在任何 DB 操作之前返回** |
| 幂等 | 冲突键 `ghl_contact_id`。**不用邮箱** —— 邮箱会变,改一次就变成两条记录两个 token 两份报告 |
| 批次映射 | 有 `cohort_tag` → 匹配 `source_tag` 且 `is_active`;没匹配上 → **回落默认批次 + warning**,不拒绝;没有 `cohort_tag` → 默认批次 |
| 号码降级 | 解析失败仍写记录,`phone_e164`/`phone_tail` 置 null,`phone_raw` 保留原值,响应带 `phone_unparseable` |
| 邮箱 | `trim().toLowerCase()` → `email_lower` |
| token | 32 字节 CSPRNG → base64url 无填充(43 字符)。**只在首次创建时生成一次** |

### 写入走 DB function,原子无竞态

supabase-js 的 `.upsert()` 会把提供的所有列一起覆盖,而这几列**不能**被覆盖:`access_token`(重发不轮换)、`status`(不能把已完成的人打回 `pending`)、`first_login_at` / `completed_at` / `link_sent_at`、`access_revoked_at`(作废是 Admin 的决定)。

第一版因此走了「查 → 有则只更新可变列,无则插入」+ 唯一键冲突码 `23505` 兜底。那是**正确的补救,但不是「不会发生」** —— GHL 重复触发是常态(网络重试、workflow 配错、手动重跑),那条补救路径会被反复走,而且冲突后还要再查一次才能拿到 token 返回,分支变多。

改成一条 DB function:[`20260731000300_upsert_entitlement_fn.sql`](supabase/migrations/20260731000300_upsert_entitlement_fn.sql)

| | 列 |
|---|---|
| `do update set` **会**覆盖 | `cohort_id`、`phone_e164`、`phone_tail`、`phone_raw`、`email_lower`、`name` |
| 刻意**不**覆盖 | `access_token`、`status`、`first_login_at`、`completed_at`、`link_sent_at`、`access_revoked_at`、`created_at`、`updated_at`(由 trigger 维护) |

三个实现细节:

- `was_created` 由 `xmax::text::bigint = 0` 判定 —— 比比较 `created_at`/`updated_at` 可靠。`xid` 不能直接和整数比,所以经 text 转
- **`security invoker`(默认),不用 definer** —— 调用方是 service_role,本就绕过 RLS,不需要提权。`search_path` 仍然钉住
- **收回了 PUBLIC 的 execute 权限**。函数默认对 PUBLIC 授予 execute,而 anon / authenticated 继承 PUBLIC —— 不收回的话它们能通过 REST 的 `/rpc` 端点调到这个函数。虽然 invoker 模式下 RLS 仍会拦住写入(9 张表零 policy),但多一个可达的写入入口本身就不该存在

**副产品:删掉了一份复制品。** 可变列白名单原来同时存在于 `webhookPayload.ts` 的 `MUTABLE_ON_CONFLICT` 常量和 SQL 里,靠人同步。现在只存在于 `do update set` —— 那也是它唯一该待的地方,改错一列会立刻在数据上体现,而不是等某个分支被走到。

> ⚠️ **部署顺序有依赖**:必须先 `supabase db push` 应用这个 migration,**再** `supabase functions deploy`。反过来的话函数会调用一个还不存在的 RPC,每次请求都 500。

### 为什么不接受 `contact_id` / `contactId` 别名

宽容地接受别名会让「GHL 侧字段映射配错」变成静默行为 —— 我们收到一个能用的 id,但它可能根本不是 contact id。只认一个名字,400 时把**收到的 key 列表**(只有 key,没有值)回给对方,配错第一次测试就能定位。这是 setup 期该有的响亮失败,不是运行期的容错。

### 为什么只有 `ghl_contact_id` 必填

客户已经付过钱。因为一个烂号码、或者 GHL 侧漏映射一个字段,就丢掉整条准入记录,代价比存一条需要人工修的记录大得多。手机与邮箱**都**缺失时也不拒绝,只发 `no_contact_channel` warning —— 那种情况备用路径找不回链接,但魔法链接照样能用。

## 首次 deploy 失败:守卫验了配置内容,没验配置会不会到达运行时

```
unexpected deploy status 400: Failed to bundle the function
  Relative import path "@supabase/supabase-js" not prefixed with / or ./ or ../
    at .../supabase/functions/_shared/supa.ts:1:51
```

上传的资产列表里只有 `.ts` 文件,**没有 `deno.json`**。

### 诊断(先查清再改)

| 问题 | 结论 |
|---|---|
| 是 CLI 没带,还是带了但服务端没用? | **CLI 没带**。资产列表里没有 `deno.json`,失败发生在服务端打包阶段 —— 服务端只能用上传上来的东西 |
| 根因 | 我们的 map 在 `supabase/functions/deno.json`,即**函数目录的上一层**。CLI 为某个函数查找 import map 时不会往上找 |
| `config.toml` 原来有 `import_map` 声明吗? | **没有**,只有 `verify_jwt = false` |
| `--use-api` 与 Docker 打包有差异吗? | 有,而且这个差异是关键:Docker 路径在**本地**解析 import map 再上传打好的包;`--use-api` 上传源码由**服务端**打包,所以 import map 必须作为资产被上传。服务端打包对 map 的可达性更敏感 |
| CLI 2.90 支持 `import_map` 这个 config key 吗? | **我没能在本地证明**。`--import-map` flag 在 `--help` 里明确存在;但 `supabase config push` 对未知 key 和合法 key 报同一个错(都先挂在「未 link」上),所以那条路径证明不了 config key 的支持情况。CLI 默认模板里也根本没有 `[functions]` 段 |

### 修法(按 A,不动代码)

`config.toml` 显式声明:

```toml
[functions.assessment-ghl-webhook]
verify_jwt = false
import_map = "./functions/deno.json"     # 路径相对 supabase/
```

**没有走 B(在 `supa.ts` 里写全 `npm:@supabase/supabase-js@2.110.8`)。** B 会把版本号散到源码里,而 `check:dep-sync` 的全部价值就是「版本只有一处」—— 走 B 就得同时改守卫去扫源码里的 `npm:` 版本号,否则守卫会退化成一道验着一份没人用的配置的空门。A 走不通再走 B,退路写在 docs 里。

### 守卫跟着补:可达性

原来那道门验的是「import map 里有对应条目」—— 条目确实有,所以它是**绿的**。它没验的是「这份 map 会不会被 deploy 带上去」。**检查的边界与实际执行的边界不重合**,这已经是同一模式的第四次。

`check:dep-sync` 新增第 4 节,反向验证 5 种全部拦下:

| 用例 | 结果 |
|---|---|
| `config.toml` 缺 `import_map`(**线上失败的确切形态**) | 拦下 |
| `import_map` 指向另一份没人校验的 map | 拦下 |
| 函数目录存在但 `config.toml` 里没有对应段 | 拦下 |
| `verify_jwt` 未显式声明(默认 true 会拦掉 GHL) | 拦下 |
| 新增函数目录但忘了配 config | 拦下 |

最后一条尤其重要:Stage 4 会加 4 个函数,Stage 9 再加。**新增函数忘了配 config** 是这个洞最可能的复发形态。

## 又补了两个盲区

**1. `check:dep-sync` 只扫 `_shared/`,Edge Function 本体不在其中**

v3 的自动发现是从 `supabase/functions/_shared/` 起步的,而 `assessment-ghl-webhook/index.ts` 不在那里 —— **Stage 3 加的第一个非 `_shared` 函数就活了这个洞**,它 import 什么都不受检查。

v4 改成扫整个 `supabase/functions/**`,并把两条规则分开(它们的适用范围本来就不同):

| 规则 | 适用范围 |
|---|---|
| A. 必须在 import map 里有**精确版本**的条目 | **所有**被 Edge Function 引用的裸 specifier。这是 Deno 能不能解析的问题 |
| B. 与 `package.json` 交叉校验版本 | **只对同时被 `src/` 引用的** specifier。Node 侧根本不 import 的包(`@supabase/supabase-js`、`@std/assert`)不该被强塞进 `package.json` —— 那会让依赖清单谎报 Node 侧的真实需要 |

反向验证:函数目录下放一个未映射的 `import { z } from "zod"` → 拦下(v3 会漏);放一个已映射的 import → 正确通过,不误报。

**2. Edge Function 也没有类型检查**

`tsc -b` 只管 `src/` 与 `api/`,Deno 那边的代码一直没 `deno check`。新增 `npm run check:deno`(`deno task check _shared/ assessment-ghl-webhook/`)。这跟上一轮 `api/` 那个洞是同一类问题 —— **每加一个新运行时,就多一个没人检查的角落**。

## 验证

```
npm run build        五道门全绿
npm test             38 passed  (Node)
npm run test:deno    16 passed  (Deno,新增 11 条 webhook payload 用例)
npm run check:deno   Edge Function 类型检查通过
npm run check:cross  36 行逐字相同
npm audit --omit=dev 2 moderate(react-router,已评估,当前不可达)
```

11 条 webhook 用例覆盖:缺 `ghl_contact_id` 的 8 种形态(含两种别名)、非对象 body、400 只回 key 不回值、正常归一化、号码降级且保留原值、全角数字、无联系方式、双 warning、空串与非字符串变 null、多余字段被忽略、新加坡号不被当马来西亚。

**没验的部分要说清楚**:幂等的实际行为(重复触发只有一行、token 不变、`status` 不被打回)**需要真库**,纯函数测不了。我这边没有 Supabase keys,也没部署过任何 Edge Function。验收命令见下。

## 部署与验收命令

```bash
# 1. 配 secrets(先 supabase link --project-ref <ref>)
supabase secrets set QAI_WEBHOOK_SECRET="$(openssl rand -hex 32)"
supabase secrets set APP_BASE_URL="https://compass.qiai.tech"
supabase secrets list

# 2. 部署
supabase functions deploy assessment-ghl-webhook

# 3. 验收 —— 五条
URL="https://<ref>.supabase.co/functions/v1/assessment-ghl-webhook"
S="<QAI_WEBHOOK_SECRET>"

# (1) 错密钥 → 401,且事后查库确认没有新行
curl -si -X POST "$URL" -H "X-QAI-Secret: wrong" -H "Content-Type: application/json" \
  -d '{"ghl_contact_id":"t_401"}' | head -1

# (2) 幂等 —— 同一个 contact 打三次
for i in 1 2 3; do
  curl -s -X POST "$URL" -H "X-QAI-Secret: $S" -H "Content-Type: application/json" \
    -d '{"ghl_contact_id":"t_idem","phone":"012-436 1382","email":"A@B.com","name":"Tan"}' \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["created"], d["magic_link"])'
done
# 期望:第一次 True,后两次 False,三次的 magic_link 完全相同

# (3) 烂号码降级
curl -s -X POST "$URL" -H "X-QAI-Secret: $S" -H "Content-Type: application/json" \
  -d '{"ghl_contact_id":"t_badphone","phone":"0l2-436 l382","email":"c@d.com"}'
# 期望:phone_parsed=false,warnings 含 phone_unparseable,库里 phone_raw 保留原值

# (4) 未知 cohort_tag → 回落默认批次 + warning
curl -s -X POST "$URL" -H "X-QAI-Secret: $S" -H "Content-Type: application/json" \
  -d '{"ghl_contact_id":"t_badtag","email":"e@f.com","cohort_tag":"nope"}'
# 期望:cohort_source=default,warnings 含 fell back

# (5) 字段名配错 → 400 且回显 key 列表
curl -s -X POST "$URL" -H "X-QAI-Secret: $S" -H "Content-Type: application/json" \
  -d '{"contact_id":"wrong_name","email":"g@h.com"}'
# 期望:400,detail 提示要 ghl_contact_id,received_keys=["contact_id","email"]
```

验完记得清掉这五条测试记录(`t_401` 应该本来就不存在):

```sql
delete from public.assessment_entitlements
where ghl_contact_id in ('t_401','t_idem','t_badphone','t_badtag');
```

---

# Stage 5 — Admin 认证 + 名单管理页

分支 `stage-5-admin`。

## 授权:两步都在后端,前端那层刻意写薄

```
浏览器 → Supabase Auth magic link → 拿到 access token
      → POST /api/assessment-admin,带 X-Admin-Token: <token>
      → 函数内:验 JWT → 查 admin_users 允许名单 → 判定
```

**`X-Admin-Token` 而不是 `Authorization`**:代理会把 `Authorization` 换成 anon key(Edge Functions 网关要求),后台的 JWT 必须走另一个头,否则会被覆盖。

**401 与 403 分开**,这不是洁癖:不在名单的账号再登一百次也是 403,把它当 401 会造成「登录成功 → 被弹回登录页 → 再登录成功」的死循环,而那种循环极难自查。前端因此有两个分支:401 → 登录页;403 → 显示「这个账号不在允许名单里」。

**前端守卫是 UX,不是安全边界。** `AdminLayout` 只做一件事:没有 session 就显示登录页而不是空表格。它不保护任何数据。**刻意写得薄** —— 一个看起来很严密的前端守卫会让后来的人以为那一层有保护,从而在后端放松检查。

## CSV 导出:两个只在「用 Excel 打开」时才暴露的问题

| | |
|---|---|
| **公式注入** | 以 `= + - @` 或制表符开头的单元格会被 Excel 当公式执行。**学员姓名来自 GHL,是外部输入** —— 一个叫 `=cmd\|'/c calc'!A1` 的「姓名」在文件被打开时就会执行。前面加单引号中和。代价:真负数也会变文本,但我们导出的数值列(总分)不会是负数,而姓名列可能以 `-` 开头 —— 宁可让一个不存在的负数变文本 |
| **BOM + CRLF** | 不加 BOM,Excel 在中文 Windows 上会按本地代码页解码 UTF-8,姓名和维度名全是乱码 |

8 条测试,含真实注入载荷。

## 已知限制,写在代码里不是随口一提

**筛选在前端做,后端一次返回全量。** 分数区间要跨到 `assessment_results`,而 PostgREST 对嵌套表的过滤很别扭;当前批次几十到一两百人够用,而且省一张视图(视图要走 migration)。**批次上到几千人时要把筛选推回 SQL。**

**「查看报告」按钮禁用而不是隐藏** —— 让人知道它会有,Stage 8 接上。

## magic link 回调的 URL 残留

登录后地址栏留下 `compass.qiai.tech/admin#`。查了装在本地的 auth-js 源码,它**确实清了 token,但用的机制不好**:

```js
// PKCE(code 在 query)—— 干净
url.searchParams.delete('code');
window.history.replaceState(window.history.state, '', url.toString());

// Implicit(token 在 hash)—— 我们现在走的这条
window.location.hash = '';
```

给 `location.hash` 赋值是**一次 fragment 导航,会新增一条历史记录**,而带 `access_token` 的那条留在后面。所以地址栏看着干净(只剩裸 `#`),但按后退键能回到含 token 的 URL。管理员凭证泄露比学员链接更严重。

`AdminLayout` 里加了 `stripUrlFragment()`,用 `replaceState` 把当前这条换成干净 URL。判断条件用 `href.includes('#')` 而不是 `location.hash` —— 后者在 auth-js 清完之后返回 `''`,永远为假。

### 已换成 PKCE

`replaceState` 只能改当前那一条,**更早那条含 token 的历史记录删不掉** —— History API 没有删除条目的能力。所以那只是缓解。管理员凭证是整个系统权限最高的东西,让它一次都不出现在地址栏比事后清理可靠,已换:

```ts
createClient(url, anonKey, { auth: { flowType: 'pkce', ... } })
```

查了 auth-js 源码确认三件事:

| | |
|---|---|
| `signInWithOtp` 邮箱路径支持 PKCE | 支持 —— `if (this.flowType === 'pkce')` 就在邮箱分支里,生成 code challenge。默认值是 `implicit` |
| Supabase Auth 的 Redirect URLs 要不要改 | **不用**。`redirectTo` 取的还是 `options.emailRedirectTo`,路径不变,只是回调参数从 `#access_token=` 变成 `?code=` |
| 客户端 `?t=` 魔法链接受不受影响 | 不受。`@/lib/supabase` 只被三个文件 import,全是 admin —— 客户端路径上 Supabase 客户端**根本不会被实例化**。这比「两个参数名碰巧不撞」强:那段代码在客户端页面上压根不运行 |

**代价(已确认接受)**:code verifier 存在发起登录的那个浏览器里,magic link 必须在同一个浏览器打开。手机上点开电脑上申请的邮件会失败(`code verifier not found`)。

`stripUrlFragment()` 留着,但理由变了:**换 flow 之前已经发出去的 magic link 还躺在收件箱里**,那些仍是 hash 形式,点开仍走 implicit。它是旧链接的兜底,不是防线。旧链接过期(Supabase 默认 1 小时)之后可以删。

## 待办(Stage 5 验收时记下的)

| | |
|---|---|
| **上线前必做:换掉内置 SMTP** | Supabase 内置邮件服务**只能发给 project 成员**,而且有限流(验收时触发了 `EMAIL RATE LIMIT EXCEEDED`)。只影响后台登录邮件 —— 学员链接走 GHL,不受影响。上线前接自己的 SMTP(Resend 之类) |
| EXPORT CSV 未实测 | 验收时库里只有一行记录。等有真实数据了一起验。公式注入与 BOM 都有单元测试覆盖,没验的是「点下去真的下载了一个 Excel 能打开的文件」 |

## 待你操作

| | |
|---|---|
| `admin_users` insert | `insert into public.admin_users (email, name) values ('jianan1196@gmail.com', '<名字>');` —— **邮箱必须小写**,函数侧会 `trim().toLowerCase()` 再比,大小写不一致会永远 403 而看起来像「我明明插了记录」 |
| Supabase Auth 配置 | Site URL + Redirect URLs,见下 |
| Vercel 环境变量 | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`(**带** `VITE_` 前缀,前端登录要用) |

---

# Stage 6 — 答题引擎

分支 `stage-6-quiz`。

## 断点续答:取「第一个未答」,不是「最后已答之后」

没有空洞时两者相同,有空洞时不同。而空洞会出现:回头改答案时保存失败、后退键跳答、以后加「允许跳过」。

按「最后已答之后」续,空洞会被**永久跳过**。那道题的答案缺失一路走到算分,而 `(raw_sum / 12) * 100` 的**分母写死 12** → 那一维静默低估 → 最弱维度可能指错 → **offer_routing 分流到错误的产品**。

一个答题页的续答逻辑写错,最终表现是销售话术指向错误的产品,而中间每一步看起来都正常。所以逻辑在 `src/lib/quizFlow.ts`,纯函数,4 条空洞用例。

## 「我在哪」这个问题从不由客户端回答

每次作答**等服务端确认**,然后用返回的**完整快照**重算下一题。不用本地计数器 —— 本地计数器是漂移的来源。

代价是每题一次往返;换来刷新、断线、后退全都自动正确。保存失败时**停在原地并给出重试**,不前进 —— 前进会让这一题永久缺失而客户不知道。

响应回全量(27 个短字符串)而不是增量:一次响应丢失(移动网络常见)在增量模型下会让客户端与库不一致,而那种不一致的表现正是「跳过了一题」。

## 分数一律服务端算

客户端只传 `option_index`,分数由服务端按 `config.scoring.option_values` **查表**得出。那是唯一能改自己成绩的入口,而这份报告要拿去做 offer 分流 —— 有人把自己刷成高分档,我们就把他从名单里漏掉了。

**Edge Function 读同一份 `assessment-config.json`**(Deno 的 `with { type: 'json' }`)。前后端各一份的话,改题库时必然有一侧漏改,而漏改那侧不会报错 —— 它会照旧接受一个已不存在的 question_id,或者按旧标度算分。

**每次请求都重查 `access_revoked_at`。** cookie 有 30 天,而 Stage 4 的 token 校验只在换 cookie 那一刻发生。中途被 revoke 的人如果还能答题,那个「停用」就只停了入口没停人。

## 锁住的配置不变量

计分公式的分母 12 写死在配置里,前提是「每维 4 题 × 每题满分 3」—— 这是个**隐含契约**。改题库的人不会同时想到那个分母。现在这些改动会当场变红:

| 断言 | 拦住的 |
|---|---|
| 24 题 / 6 维 / 每维恰好 4 题 | 增删题 |
| `4 × max(option_values) === 12` | 改标度而忘了分母 |
| dimensions 的 key 集合 **等于** questions 里出现的 dimension 集合 | **一道题挂错维度** —— 正向断言全过,那道题只是消失在统计外 |
| 每维 3 个子模块下标 0/1/2 各一道 + 1 道 `type:'maturity'` | 下标重复(某子模块徽章取空) |
| 「有 type」与「submodule_index 为 null」是同一批题 | 两个字段分叉,两处代码判断依据不同 |
| `value_map` 长度 = 选项数 | P2 某选项映射到 undefined,流进成本估算 |

发现配置的真实结构比原先假设的更规整:**每维 = 3 道子模块题(下标 0/1/2)+ 1 道 `type: "maturity"` 题(下标 `null`)**,「有 type」与「下标 null」恰好是同一批 6 道(G4/T4/C4/V4/M4/D4)。

## 没做的两件,以及为什么

**不扩 `check:cross` 到 quizFlow。** phone 需要跨运行时逐字比对是因为 libphonenumber 可能行为不同;quizFlow 只有数组索引和整数比较,两个运行时不可能不一致。守卫要按「这里真的可能出分歧吗」来加,不是按「别的地方有所以这里也要有」。

**没有浏览器渲染验证。** 预览工具解析的是本会话的主工作目录,够不到这个项目的 `launch.json`,而不用 Bash 起 dev server。页面过了 tsc 与单元测试,但**没有看到它渲染出来** —— 部署后点真实链接是更强的信号(dev server 连 `/api` 都到不了)。

## 部署前要做

`supabase secrets` 里 `assessment-quiz` 用到的是已有的 `SESSION_SECRET`,**没有新变量**。要 `npm run deploy:functions`(新增了一个函数)。

---

# config v2.0.0 + Stage 7 计分核心

分支 `stage-7-scoring`。

## config v2.0.0

第三次下载没落地(下载这条路在客户那边一直不通),改为把 JSON 贴进来我落盘。落盘后**独立校验 29 条全过**——不看客户自检,自己跑一遍,含 4 条客户没单列的交叉引用:

| 交叉引用 | 为什么单独查 |
|---|---|
| `ghl_writeback` 的 tier / weakest domain == tiers / dimensions | 改一处忘另一处,写回 GHL 的值不在域内,而 GHL 那边只会静默拒绝 |
| `cost_model` / `offer_routing` 维度 key 都在 5 维内 | offer 指向一个不存在的维度 → 报告尾部 CTA 空白 |
| `offer_routing` 引用的 product 都已定义 | 同上 |
| measure 彻底清除(维度 / 题 / offer_routing 三处) | 静默残留:一道 dimension:"measure" 的题会被算进 raw_sum 却无对应维度 |

主要改动:6→5 维(移除 measure)、24→20 题、计分 0–100→0–5.0、总分木桶加权→**五维简单平均**、新增 `action_library`、`offer_routing` 重写为两产品、survey S1 加 `option_to_dimension`、tiers 改 0–5 刻度。

**总分改简单平均的理由(客户的设计决定):** 客户能自己验算——五个数加起来除以五就对上。算不出来的分数会让人怀疑整份报告。木桶效应移到叙事层:分数用平均,报告单独高亮最弱维度 + 代价换算。所以 `weakest_selection` 仍是主线。

## Stage 6 断言随 config 一起改

改 config 前先确认断言**正在红**(证明它们真在盯着 config):只有硬编码 `toHaveLength(24/6)` 那一条红,其余结构断言因为**动态遍历 dimensions**,自动适配了 5 维——这是当初写成动态 + 反向断言的回报。

改成 20/5,分母 12 断言保留(每维仍 4 题 × 满分 3)。并把 ad-hoc 校验里的交叉引用**固化进 CI**(S1 映射对齐 order、ghl domain 对齐、offer_routing 覆盖、tiers 无缝、action_library 齐全)——ad-hoc 跑一次不如锁在测试里,Stage 8 要依赖这些。

## Stage 7 计分核心(`src/lib/scoring.ts`)

三处最容易错、单独锁死:

1. **总分取整一次,显示与档位判定共用同一个值。** 否则显示 2.8、档位按未取整的 2.84999 判,两者对不上,学员直接不信报告。
2. **tiers 查找在十分位整数上做。** 绕开 2.1 存成 2.0999… 的浮点边界。区间有缝/重叠都由 config 测试锁死(0.0–5.0 无缝无重叠)。
3. **最弱/最强平分按 dimension.order 靠前优先**,不是数组顺序、不是字典序。

**缺一个维度直接抛,不拿 0 顶替**——拿 0 顶替会算出看起来正常的错分数,那正是断点续答那条链路要防的静默错误。

`round1` 加 `Number.EPSILON`:裸 `Math.round(2.85*10)/10` 会得 2.8(2.85*10 在 float 里是 28.4999…),加 EPSILON 顶回 2.9。

### 三组手算验收(实际输出,已核对)

| 输入 | 各维 | 总分 | 档位 | 最弱 | 最强 |
|---|---|---|---|---|---|
| 全 0 | 全 0.0 | 0.0 | manual | goal,traffic | goal,traffic |
| 全 3 | 全 5.0 | 5.0 | flywheel | goal,traffic | goal,traffic |
| goal 全 0 其余全 3 | goal 0.0 其余 5.0 | **4.0** | systemic | goal,traffic | traffic,capture |

第三组是唯一能区分简单平均(4.0)与木桶加权(2.8)的。有一条测试显式钉住 `total !== 2.8`——谁把公式改回木桶,它会红并指名 2.8。

## Stage 7 还没做的(下一轮)

- **问卷页**(7 题,混合题型:single_select / multi_select / open_text）
- **计分 Edge Function**:答满 → 触发 `computeResult` → 写 `assessment_results` → GHL 写回
- **GHL 写回**:按 `ghl_writeback.custom_fields` 的 domain 校验后写,不在域内报 CONFIG 错不静默写

## 数据清理(客户来跑,config 校验已通过)

```
delete from assessment_answers;
delete from assessment_survey;
delete from assessment_results;
delete from assessment_sessions;
```
四张表名已核对存在,顺序子表先、entitlements 保留。**config 已校验通过,可以清了。**

---

# Stage 7 下半 — 问卷页 + 计分函数 + GHL 写回

## 一处必须先说的 schema 阻塞(已修)

`assessment_results.total` 原本是 **`int`**,而 v2 的总分是 0.0–5.0 一位小数。往 int 列插 `2.8`,PostgreSQL 会**四舍五入成 3 且不报错**。后果:报告页显示 2.8(前端算的),库里存 3;档位若从库里的值重算,2.8 属于 `spot`、3.0 属于 `semi_auto` —— **直接换档**。学员同时看得见分数和档位,两者不一致他会直接不信报告。

迁移 `20260805000000_scoring_v2_decimal.sql`:`total` → `numeric(2,1)`,加 `check (total between 0.0 and 5.0)`。越界报错而不是截断 —— 上游算出 5.1 应该炸。顺带修了 `dim_scores` 的过时注释(`0..100` → `0.0–5.0`),以及 `quizFlow.ts` / 测试里两处 `(raw_sum/12)*100` 的过时注释。

## apply-config 脚本(下载失败三次之后的固定通路)

```
npm run config:apply <文件>      落盘 + 校验
pbpaste | npm run config:apply -  从剪贴板
npm run config:check              只校验当前 config
```

**校验不通过就不落盘。** 一份坏 config 落盘之后所有测试会一起红,而排查方向会被引到测试上而不是 config 上。规则从 `meta` 读(题数 / 维度数 / 每维题数 / 分母 / 刻度都不写死),所以下次再改维度数这个脚本不用动。落盘前自动备份旧版到 `.v1.0.0.bak`。

## 「下标 → 语义值」只有一份实现

这个形状在 config 里出现五次:题目分数、S1 维度、S7 意向值、P2/P3/S2 数值。`src/lib/optionMap.ts` 是唯一实现,`quizFlow.scoreForOption` 现在委托给它。

多选的语义是刻意的:**任一下标越界就整体拒绝,不跳过坏的那个** —— 跳过会让客户勾 5 项存 4 项而不知情,而后面按工具分流的销售判断就基于一份不完整的事实。

**问卷存语义值不存下标**:存下标的话,以后调整选项顺序,库里的历史数据会静默指向不同的语义。

## GHL domain 校验:三种形态

| 形态 | 例 | 处理 |
|---|---|---|
| 枚举数组 | `["manual","spot",…]` | 值必须在数组里 |
| **区间字符串** | `"0.0-5.0"` | 数值落在闭区间内 |
| null | goal_90d | 只查 `max_length` |

只做 `Array.isArray(domain) && includes(v)` 的话,区间型会走到 else 分支 —— **永远失败**(总分永远写不进 GHL)或**永远跳过**(等于没校验)。两种都静默。

另外三条刻意的选择:**domain 本身写坏了(比如用了全角破折号)要显式报**,否则那个字段的校验静默失效;**未声明的 key 一律拒绝**,打错的 key 会在 GHL 创建一个无人知晓的自定义字段而本该填的那个永远是空;**超长报错不截断**,S5 是销售最好用的一句话,截半句比拒绝更糟。

## ⚠️ GHL 写回有一处我没验证过

实际 API 调用写了(`PUT /contacts/{id}`,`Version: 2021-07-28`),但 **`customFields` 用 `key` 还是 `id`(UUID)我没有把握**。config 里存的是 key,而如果这个端点只认 UUID,调用会**返回 200 而字段没写进去** —— 静默失败。

这正是 Stage 3 学到的同一类:GHL 收下请求不代表它做了我们以为的事。所以:

- 日志里记下了响应体和写入的 key 列表,并显式写了 `VERIFY ON THE CONTACT — a 200 does not prove the custom fields were matched by key`
- 验收时**必须去 GHL contact 上肉眼确认字段有值**,不能只看函数返回 ok
- 不匹配的话两条退路:先查 custom field 列表拿 id 再写,或者改用 Inbound Webhook + workflow(那条路重发链接上已经验过)

## 问卷页与答题页的差别是刻意的

答题页每题即存(20 题掉线要重来代价太大);问卷 7 题约一分钟,而且是**报告前最后一步**,逐题往返会在客户最接近终点的地方加 7 次等待。所以本地攒完一次提交,失败时内容还在页面上。

提交分两步 `save` → `finalize`:`finalize` 会拒绝「测评题没答满」,而那时问卷内容应该已经存住 —— 不然客户填完 7 题被打回去补测评题,回来还要重填。服务端指名哪一题出错就把客户送回那一屏。

## finalize 里一处容易忽略的选择

**重算分数,不直接信库里的 `score` 列。** 库里的 score 是当初按 `option_values` 算的;标度改过之后,旧 score 就是按旧标度算的 —— 直接用会让同一批人里有的按新标度、有的按旧标度。以 `option_index` 为准重算,因为 option_index 是不受标度影响的事实。

## 待部署实测

新增两个函数(`assessment-score`)+ 一个迁移,所以要 `supabase db push` 和 `npm run deploy:functions`。环境变量无新增(`GHL_PRIVATE_TOKEN` / `GHL_LOCATION_ID` 已在清单里)。

---

# config v3.0.0 — 计分公式 + 选项数 + UI 全改

分支 `stage-7-scoring`(接着 v2 那批往下)。这次比 v2 更伤,因为**计分公式本身变了**。

## 计分:固定分母作废,改每题归一化

选项数不再统一(T2/C2/C3 是 4 个,其余 12 题 3 个),固定分母 12 不成立。改为:

```
每题归一化 = (option_index / (option_count - 1)) * 5     # 3 选项 → 0/2.5/5;4 选项 → 0/1.667/3.333/5
维度分     = round(mean(该维 3 题归一化分), 1)
总分       = round(mean(五维分), 1)                       # 简单平均不变
```

**为什么归一化**:每题代表一个子模块,权重必须相等。4 选项的题不能因为格子多就占更大权重。归一化让顶格永远是 5.0、零格永远是 0,与选项数无关。

三组手算(实际输出,已核对):全零→0.0/manual;全顶格→5.0/flywheel;一维全零其余顶格→**4.0**/systemic(木桶会给 2.8)。

## 徽章的连带修正(你点名的那处)

徽章从**按 option_index** 改成**按归一化分**。旧逻辑 `index===3→full` 在 v3 是错的:3 选项题的 index 2 已经是满分 5.0,却会被判成 partial。v3 真值是 `scoring.badgeForScore(归一化分, scale)`:`>=5.0` full、`==0` missing、其余 partial。

`SubmoduleMark.markStateFromScore`(v2 的 option_index 判据)**已标注废弃**,只剩 Showcase 在用。**Stage 8 报告页必须用 `badgeForScore`,不要用组件里那个旧函数**——两者词汇不同(partial↔half、missing↔empty),Stage 8 接线时对上。

## schema 连带:assessment_answers.score

per-question 分是小数(2.5 / 1.667),而 score 列是 int。但 score 只是缓存——finalize 以 option_index 为准重算。迁移 `20260805100000` 把 score 改成可空,assessment-quiz 不再写它。留列不删是为避免部署顺序风险(迁移可能先于函数上线,老函数仍带 score 插入,列还在就不失败)。

## apply-config 校验器同步改 v3

上一轮那个校验器是 v2 形状写死的,会拒绝合法的 v3(每维 4 题、固定分母、maturity 结构)——这正是「约束活在两处」:校验器把 v2 的形状复制进了自己。已改成 v3 规则:每维 3 题、`option_count == 实际选项数`、子模块 0/1/2 无 maturity、题数 == 子模块总数。`npm run config:check` 通过 31 条。

## 死代码清理

v3 没有 `option_values`,`scoreForOption` 成了死代码,连同它的 SCORE_CASES 测试一并删除(quizFlow / optionMap / 两侧测试)。`mapOption` 保留——问卷的 S1/S7 映射还用它。

## 答题页:滚动式 + 乐观保存

一题一屏 + 等确认 → 一页滚动(背景题一段 + 五维各一段,带维度标题)+ 点选即刻生效、后台异步保存。**断点续答仍成立**:进来 bootstrap 回填 + 滚动定位到第一个未答;提交时统一校验有没有没答的 / 还在存的 / 存失败的,有则定位过去。防跳题的旧约束去掉了——滚动式下跳题本来就允许,那约束失去意义。

## Stage 6 断言随 config 改到 v3

20→15、每维 4→3 题、去掉 maturity 结构与固定分母那条,新增「option_count == 实际选项数」「无 maturity 题」「题数 == 子模块总数」。反向和动态断言照旧自动适配。

## 数据清理(客户来跑,config 已校验通过)

G4/T4/C4/V4/M4 指向已删除的题,旧 score 是旧标度。四张表清空,entitlements 保留。

## 待部署

`supabase db push`(两个新迁移:total→numeric 那条是 v2 的、score→nullable 这条是 v3 的)+ `npm run deploy:functions`(assessment-score 新增、assessment-quiz 改了)。GHL 两个变量客户已配,这轮 finalize 第一次真撞 key vs UUID —— 验收去 contact 上肉眼看字段。

Node 127 / Deno 106 / 跨运行时逐字一致。

---

# GHL 写回:重试 sweep + 静默失败的实证

## 实证:200 ≠ 写进去了(我的 bug)

客户先建好 8 个自定义字段前,上一轮 finalize 的 `ghl_synced=true` / `ghl_last_error=null`,
而那时字段在 GHL 里【根本不存在】。GHL 收下 PUT、返回 200、我们标 synced=true —— 
字段却没有。**不是「写进去了看不到」,是「什么都没发生但报告成功」。**

更糟:`syncToGhl` 上面就贴着「200 不证明字段被接受」的注释,逻辑里却仍在 200 时标
synced=true。**注释承认了风险,代码没照做** —— 跟「打印一个值但不对它做判断」同一个病。

## 重试 sweep 之前根本不存在

只有 assessment-score 写那三列,没有任何东西读。D2 上一轮只建了列 + markSyncFailure
(设 next_retry_at),没建消费端。所以「把 ghl_synced 重置成 false」本身什么都不会发生。
新增 `assessment-ghl-resync`(内部接口,X-Internal-Secret,与 maintenance 同套鉴权)
补上消费端;挑 ghl_synced=false 且 next_retry_at 已过的行重跑,批上限 50 到顶会明说。
写回逻辑抽到 `_shared/ghlWriteback.ts`,finalize 与 sweep 共用一份,不造第二份副本。

## 判据待定,故意留在这一轮之外

响应体日志从截断 400 字改成完整记(最多 4000)—— 上一轮的截断可能正好切掉信号。这次
重跑采集「字段存在时」GHL 返回什么,和上一轮「字段不存在时」对比,才知道 200 之外有没有
可用信号(响应体里的 accepted/skipped),还是必须写回后回读 contact。**没在看到数据前
把判据定死** —— 与当初区分真假 Inbound Webhook trigger 同一个方法。看到响应体后要做的:
把成功判据从「200」改成「响应体确认字段被接受」或「回读 contact 核对」。

## 触发命令(手动重跑一次)

直接 curl Supabase 函数,带 apikey(anon)+ X-Internal-Secret。Vercel Cron 的定时 wiring
(api/cron/ghl-retry.ts + vercel.json)是 D2 剩下的一步,不阻塞这次手动重跑。

---

# GHL 写回判据:验响应体,不信 200(D8 + D9 落地)

## 实测确认:响应体可区分「写进去」与「被丢弃」

字段建好后重跑,contact 更新的响应回显整个 contact 的 customFields 数组,8 条新字段都在、值全对。上一轮字段不存在时那些条目【根本不出现】—— 所以「200 之外的成功信号」确实存在,不必额外回读 contact。跟当初真假 Inbound Webhook trigger 的 id 同一类方法:先看响应体差异,再下判据。

**坑**:响应回显的是 UUID 不是我们的 key。所以判据依赖 D8 的 key→id 映射。

## D8 — 字段映射(app_settings.ghl_field_map)

`_shared/ghlFieldMap.ts`:内存缓存(10 分钟 TTL)→ app_settings → 回源 `GET /locations/{id}/customFields` → upsert 回表。回源那次把**原始响应完整记日志**(字段定义,不含 PII)——`GET /locations/{id}/customFields` 的形状我没实测过,按 GHL v2 文档假设 `{customFields:[{id,fieldKey}]}`、fieldKey 带 `contact.` 前缀,第一次回源就能确认或暴露。

## D9 — 判据 + 三类错误

`syncToGhl` 改成:PUT 200 后用映射把 key 翻成 id,在响应 customFields 里逐个核对「id 在、值相符」,**全部命中才标 ghl_synced=true**;有缺失记 CONFIG 并**列出具体缺哪些 key**(D9:错误具体到字段名,不报「部分失败」)。

三类错误分流:CONFIG(值域不符 / 字段没建 / 值不符)与 AUTH(401/403)置 `ghl_next_retry_at=null` 不自动重试;TRANSIENT(网络 / 5xx / 429 / 拿不到映射)进指数退避。**拿不到映射一律 TRANSIENT,绝不因无法验证就标 synced** —— 那会退回原来的静默失败。

自愈:若某 key 不在映射里(可能是刚在 GHL 加的字段、缓存旧了),强制刷新映射一次再验,再缺才判 CONFIG。

sweep 跳过 CONFIG/AUTH 行:那两类把 next_retry_at 置 null,而「从没试过 / 手动重置」也是 null —— 用 ghl_last_error 的 `CONFIG:`/`AUTH:` 前缀区分,靠前缀排除,不靠那个歧义的 null。

## PII:日志收敛

判据定下来了,成功路径不再 dump 整个 contact(含姓名 / 手机 / 邮箱 / 全部 tags),只记我们写的 key 列表 + 缺失的 key。字段映射回源的日志保留全量(那是字段定义,无 PII)。上线前清单里那条「trim 全量响应日志」由此关闭。

## 纯逻辑单独测

parseFieldMap / verifyWrittenFields / classifyGhlError 抽到 `src/lib/ghlVerify.ts`,两侧共用用例。含关键一条:total=0.6 无论以 number 还是 string 回来都判匹配(发出去是 number)。

## 待部署

`npm run deploy:functions`(assessment-ghl-resync 改了、assessment-score 经共享模块改了、新增 _shared 若干)。无新迁移、无新环境变量。GHL token 需有 `locations/customFields.readonly` scope(客户已加)。

## 还没做(teed up)

- **tags**(tags_always + tags_conditional,含 assessment_mismatch)—— priority=convert 而 weakest=goal/value,mismatch 条件这次已成立。标签独立于字段写入(D9:字段炸了标签照打)。
- **Vercel Cron 定时** wiring(api/cron/ghl-retry.ts + vercel.json)—— sweep 目前靠手动 curl。
- **Admin「刷新字段映射」按钮** —— 目前靠自愈 force-refresh 覆盖常见场景。

Node 146 / Deno 117 / 跨运行时一致。

---

# Stage 7 收尾 + 归属澄清

判据验通即 Stage 7 收尾。以下三件**挂回 Stage 11**(它们本来就是 Stage 11「GHL 写回 + 重试」的活):

- **tags**(tags_always + tags_conditional,含 assessment_mismatch)—— 纯新功能,不影响任何验证
- **Vercel Cron 定时**(api/cron/ghl-retry.ts + vercel.json)—— sweep 现靠手动 curl
- **Admin「刷新字段映射」按钮** —— 现靠 syncToGhl 里的自愈 force-refresh 覆盖常见场景

**为什么它们一度在 Stage 7:** 判据不定,就验不了写回到底成没成,Stage 7 的验收(「手算分数与系统一致」延伸到「分数确实写进了 GHL」)就是假的。这个理由到判据定完用尽 —— 字段映射 / 判据 / sweep 是验证的必要前提,tags 不是。

已在 Stage 7 提前做掉的 Stage 11 部分:key→id 字段映射(D8)、写回判据(D9 三分类)、重试 sweep 消费端。Stage 11 剩上面三件。

---

# Stage 8 — 报告页(9 板块)

数据层上一轮已做(assessment-report 端点 + reportContent/reportStats 纯逻辑)。这轮是页面渲染。

## 九个板块

1. 总分 + 五边形雷达(手写 SVG,本人黄 / 基准墨虚线,维度色只在轴标签的小方块上)
2. 分档解读(config.tiers 的 zh + zh_desc)
3. 批次位置(cohort 非 null 才渲染;分位区间 + 同档人数 + 各维度差值,B1)
4. 强项 Top 2
5. 短板 Top 2:根因(action_library.root_cause 按 low/mid/high)/ 代价(computeCosts,带每条 zh_note + 总 disclaimer)
6. 15 项子模块明细(徽章走 badgeForScore)
7. 30 天行动清单(selectActions,难度 + 影响)
8. 下一步 offer(offer_routing 按最弱维度)+ mismatch 高亮(priority ≠ weakest[0])
9. PDF / 打印(Stage 9 接自动 PDF,先给浏览器打印保底)

## 兑现的三处(你点名的)

- **徽章走 `scoring.badgeForScore` 不走 `markStateFromScore`** —— v3 归一化后,3 选项题 index 2 是满分 5.0,旧逻辑会错标 partial。废弃标注这里兑现。
- **代价金额带 `disclaimer_zh` + 每条 `zh_note`** —— 系数是行业下沿估值不是精算,一个看起来确定的数字客户对不上真实账目就会毁掉整份报告的信任。
- **cohort < 10 整块隐藏,radar 基准回落 global** —— 现在只有 1 条记录,cohort_rank 板块不渲染,radar 两条线重合(正确退化)。

## `window.__REPORT_READY__`

数据到 + 渲染后置 true,卸载时置 false。Stage 9 的 PDF 渲染器 waitForFunction 它 —— SVG 同步渲染,mount 即画完,这个信号好埋(这也是不装 recharts 手写 SVG 的一个理由)。

## 打印保底(print.css)

index.css 末尾加 @media print:交互件(语言切换、打印按钮)不进纸、板块尽量不跨页断、
**保留背景色**(print-color-adjust: exact —— 布局主义靠墨边框和填充表意,变白纸黑字会丢信息)。

## ⚠️ 渲染没预览过

预览工具解析的是本会话主工作目录(qaiconversationai-main),起出来的是另一个 app —— 
导航 /report 得到 404(那是别的项目)。所以报告页只过了 tsc + build + 纯逻辑测试,
**渲染效果没亲眼看**,与 Stage 6 答题页同样的限制。你部署后看,尤其:算出的最弱维度是否
与你心里一致、30 天清单是否是你真会对客户说的话 —— 那两样只有你能判断,不一致就是题目
校准或 action_library 文案要调。

Node 169 / Deno 117 / 跨运行时一致。端点与页面一起部署一次验:deploy:functions(assessment-report 新增)+ 前端部署。

---

# Stage 8 报告页 —— 实测反馈七件

校准确认:客户按真实情况答完,最弱维度(造流量 2.8)与自身判断一致,action_library 方向也对 —— 题库与文案不用调。

## 0. 雷达基准线「挂错轴」—— 假设不成立,但现象是真的

客户假设:基准按 dim_scores 的 JSONB key 顺序取值,与 config 顺序错开。**查证后不成立** —— 渲染路径全是按 key 取值(`result.dimensions[d.key]` / `baseline.means[d.key]`),两个多边形来自同一个 axes 数组,顺序不可能错开。

**真因是数据**,而且找到一个真 bug:端点那条 PostgREST 查询

```js
.select('... session:assessment_sessions(status, ...)').eq('session.status','completed')
```

**对嵌套资源的过滤不会过滤父行** —— 不加 `!inner` 时父行照样全回来(只是 session 变 null)。于是基准把未完成的结果也算进均值,症状正是「库里只有我一条,基准却不重合」,且无任何报错。已加 `!inner`。

按客户要求留下**永久断言**(`radarInvariant.test.ts`,4 条):n=1 时两多边形逐点相等;**打乱 key 顺序结果不变**(直接钉住「按 key 不按位置」);以及反向锁 —— 两条不同样本时基准必须与本人不重合(防止哪天基准被误接成本人的复制,那时前三条仍会绿)。图例现在显示 `n`,让「基准由几份样本算出」变成看得见的事实。

## 1. 每维「为什么是这个分」(产品价值最大的一条)

新板块:每维展开三个子模块,显示**客户自己选的那句** + 顶格那句,做成「现在 → 目标」。不新写任何文案 —— 依据是他自己填的,比任何解释都有说服力。已顶格的不摆「目标」(那会像在说他还没做到)。

## 2. 30 天清单的前后对比 —— 复用同一机制,不加装饰性图表

config v3.1.0:每条 action 加 `related_question`,指向它要解决的那道题;渲染成「现在的选项 → 顶格选项」。`related_question` 为 null(goal_05 / convert_05)的不显示对比行 —— 不为了统一而编。apply-config 与 vitest 双锁:related_question 必须 null 或指向真实题目(指向不存在的题会让对比行静默取空)。

## 3. 难度 / 影响用两个不同视觉维度,红色不参与

红色已专属「缺失 / 优先」。难度再用红会撞义(同一份报告红色一会儿是「你缺这个」一会儿是「这件事难」)。所以:**难度 = 墨色深浅**(阻力:白 / 浅灰 / 墨底白字),**影响 = 黄色深浅**(收益:白 / 浅黄 / 满黄)。「高影响低难度」= 满黄 + 白底,一眼就是该先做的 —— 颜色本身在排序。

## 4. 缺失项红框 + 优先标记

alert token `--alert: #c94f4f` 进 brutalist.css,**不进维度色白名单**(check:dim 不受影响)。缺失项红边框;但只有**最弱两维**的缺失额外标「优先」—— 否则分数低的人看到一整片红,报告读起来像判决书。标了优先的格子正好对应第 7 板块的动作,两块因此连起来。

## 5. 雷达轴标签

五个顶点外侧:维度色小方块(填充 + 墨边框)+ 维度名 + 分数。维度色仍只做填充。

## 6. 提交按钮的保存中状态

未答完或还在保存 → 置灰禁用;全部落库才变黄可点。**按钮状态就是承诺,不能用文字去纠正** —— 亮着的按钮配一行「还有答案在保存」,是在用文字纠正视觉,而人先看颜色再读字。

## 7. 生成中动画

`PentagonLoader`:五边形五条边依次描出 + 顶点方块同节奏亮起,复用五维罗盘母题,不用渐变圆形 spinner。带 `prefers-reduced-motion` 降级。**纯装饰,绝不参与 `__REPORT_READY__`** —— 那个信号只由数据到达 + 渲染完成决定,否则 Stage 9 的 PDF 会截到动画中间的帧。这条写进了组件与 CSS 两处注释。

## 顺带

`quizFlow.test.ts` 里「版本 === '3.0.0'」改为钉**主版本** —— 结构由其余断言各自守着,精确版本会让每次内容改动(如这次加 related_question)都误报。

Node 182 / Deno 117 / 跨运行时一致。渲染仍未预览(预览工具指向另一个项目),你部署后看。

---

# 基准线:断言与渲染路径之间的断裂(以及代价呈现)

## 断裂找到了 —— 断言测的是自己写的副本

上一轮那 4 条不变量断言里,`buildAxisValues` 是**测试自己重写的一份轴构造**,没有调用
`Report.tsx` 的代码(那里是内联构造的)。两份今天恰好等价,所以断言绿着 —— 但它守的是
副本,不是渲染路径。**一条绿着的断言守着一个正在出错的行为,比没有断言更危险:它让下一个
人以为这块验过了。**

修法:轴构造抽成**唯一一份** `RadarPentagon.buildRadarAxes`,页面与测试都调它。改完断言
仍然全绿 —— 这次可以信了,渲染路径确实是按 key 取值。

## 所以问题在数据 —— 加了两个诊断字段直说

`n=1` 却与本人分数不符,唯一解释是**那 1 条不是本人**。而这只可能因为本人的 session 不是
`completed`(被 `!inner` 过滤掉)。而 finalize 里把 status 标 completed 那步**失败时只记
日志不失败**,所以它是会发生的。

端点新增 `diagnostics: { baselineIncludesSelf, sessionStatus }` —— 与其让人从「n=1 但不
重合」反推,不如让端点直说。

## 代价呈现:取整 + 约 + 假设同级,不做区间

`RM 33,750` 精确到个位,视觉上像确定的事实,而它建立在两层假设上。改为 `约 RM 34,000`
(`roundToSignificant` 两位有效数字),假设从浅灰小字提到与数字同级、加分隔线。

**没有改成区间**,理由:区间需要一个带宽,而 config 里只有单点系数、没有上界 ——
编一个 ±30% 正是这条要防的毛病(造一个看起来确定的数字)。要真区间需要每条规则的上界系数;
capture 的 note 里已经写了「30–50%」,那条有据可依,其余四条没有。

Node 184 / Deno 117。

---

# 雷达「基准不重合」结案:视觉 bug,不是数据也不是渲染

## 断言第三次推远,这次推到最终产物

前两次都绿着而线上错,原因都是**断言的边界比执行路径短**:
1. 测试重写了一份轴构造的副本 → 守的不是渲染路径;
2. 测试停在 `polygonPoints`(中间层)→ 没验组件到底把什么喂给 `<polygon>`。

这次用 `renderToStaticMarkup` **渲染真实组件、读 DOM 里 `<polygon>` 的 points 属性**
(react-dom 已在依赖里,不需要 jsdom)。之后就只剩浏览器。带反向锁:数据不同必须画出不同
形状,证明断言不是恒真。

结果:**`baseline === mine` 时两个数据多边形的 points 逐字相同**。渲染是对的。

## 真因:最外圈网格环被读成了基准线

原来最外圈是 `opacity 0.9 / 2px` 的**深墨满格五边形**,与基准虚线(同为深墨)难以区分。
而真正的基准恰好与本人重合、被压在黄边下看不见 —— 于是视觉上就是「一条深色线伸到满格,
黄色缩在里面」。

对分数完全吻合:满格环在 traffic(2.8)、capture(3.6)两轴明显在黄色之外,在
goal / convert / value(都 5.0)与黄色重合 —— 正是客户描述的「造流量、接客户方向伸得远,
别处相反」。

**两处修:**
- 网格一律淡(最外圈 0.3、其余 0.12,统一 1px)。网格是背景,不能与数据竞争。
- **n < 2 时不画基准线**:样本只有本人时基准均值定义上等于本人,画一条必然重合的线零信息,
  而且正是它与网格混淆才产生了这次误读。改为不画,图例说明「本期样本只有你自己,
  等同批次答满 10 份后这里会出现基准线」。

两条都有 DOM 级断言锁住(网格透明度上限、n=1 时不存在基准多边形)。

Node 188 / Deno 117。

---

# 代价区间:等实测,不编系数(以后可以做的事)

**现在保持:单点 + 「约」+ 两位有效数字 + 假设与数字同级。** 不做区间。

**为什么不给上界系数**(客户的判断,采纳):那五条系数本来就是取的行业下沿估值,再造一组
上界只是**把假精确变成假严谨** —— 编一个 0.5 跟编一个 ±30% 是同一件事。

**真正的出路 —— 等 cohort 数据够了,区间就不用编:**

同一批学员里「造流量 2.8 的人」与「造流量 4.5 的人」,实际询盘量差多少,**那是可测的**。
到那时把 `factor_low` / `factor_high` 从**实测**回填进 `cost_model.rules`,区间才有依据。

前置条件:同 cohort 完成人数够(至少到 `min_n_for_baseline` 的量级),且能把「维度分」与
「客户自报的询盘量 / 客单价」关联分析 —— 这两份数据现在就在存(`assessment_results.dim_scores`
与 `assessment_sessions.profile`),不需要额外埋点。

⚠️ **在实测回填之前,任何人不要往 config 里加上界系数。** 那会让报告显示一个看起来更严谨、
实际同样是编的区间 —— 比现在的单点更糟,因为区间会让人以为背后有分布。

---

# 设计系统:辅助元素不能与数据竞争(铁律 2)

雷达那次误读的产物,已写进 `brutalist.css` 顶部的铁律段(不是散在组件注释里)——
它不是那个组件的注意事项,是**重墨风格的系统性风险**:网格、坐标轴、参考环、分隔线一律
低对比(`stroke-opacity <= 0.3`、1px),深墨 + 粗描边只留给数据。

推论也写进去了:**零信息的元素不要画**(n=1 的基准线定义上与本人重合,画出来只是噪声,
而且正是它制造了那次误读)。

## 「先验证再动手」在这条链上救了三次

客户三次各给了一个具体假设(JSONB key 顺序 / baseline 计算 / 坐标转换),**三次都不对**。
每次都是先查证再动手:
1. 查渲染路径 → 全按 key 取值,JSONB 顺序影响不到 → 转而发现 `!inner` 那个真 bug;
2. 数据层实测确认 `means === mine` → 转而发现断言在测自己写的副本;
3. 断言推到 DOM 属性 → 证明渲染正确 → 定位到网格被读成基准。

如果第一轮就照假设去改 baseline 计算,这个视觉 bug 会一直在,**而且我们会以为修过了** ——
那比没修更糟。

---

# Stage 8 收尾 —— 子模块表并入「每维为什么是这个分」

**删掉原第 6 板块「15 项子模块明细表」,把它的红框 + 「优先」标记搬进第 2 板块。**

理由(客户的,采纳):后者本就逐项列出同样 15 个子模块,而且带「你选的是什么 / 目标是什么」,
**信息量严格更大**。同一组数据在一份报告里出现两次,读者会以为第二次有新信息,读完发现没有 ——
那是在消耗他的注意力预算,而后面的代价换算与 30 天清单才是要他认真读的部分。

但原第 6 板块有一样第 2 板块没有的东西:**红色缺失框 + 「优先」标记**,那个视觉排序有用,
所以是合并不是纯删。

## 密度确认

第 2 板块现在最密(维度分 + 徽章 + 现在/目标 + 红框 + 优先)。客户提的缓解办法
「已满分的项不显示目标」**上一轮已经做了**(`!pair.atTarget`,第 2 板块与行动清单两处都有),
已核实在位 —— 满分维度的子模块只显示一行。

## config 同步 + 锁住不分叉

`report_sections` 移除 `submodule_table`、新增 `dimension_evidence`(说明里写明它**同时承担
徽章明细与作答依据两个职责**,不是漏了一个板块)。仍是 9 条,与页面 9 个板块对上。

加了一条断言锁住这个对应:`report_sections` 不得含 `submodule_table`、必须含
`dimension_evidence`、key 不重复 —— 否则以后又会出现「config 说有、页面没有」的分叉。

Node 189 / Deno 117。**Stage 8 完成。**

---

# ERR_MODULE_NOT_FOUND:api/ 的导入在部署产物里解析不到

## 诊断先行:只有一处,不是潜伏在多处

grep 全部 `api/**/*.ts` 的导入,**跨目录导入只有 `api/render-pdf.ts` 一处**(两条)。
其余三个函数只导入 npm 包与 node 内置 —— 所以这是第一次出现,也解释了为什么以前没炸。

## 查证 Vercel 的实际规则(不按假设选方案)

| 已确认的规则 | 出处 |
|---|---|
| TS 编译作用域 = `/api` 之内 | 官方文档:"supports TypeScript files for server entrypoints and **files inside of the /api directory**" |
| 路径别名不支持 | "Most options are supported **aside from Path Mappings**" |
| ESM 要求显式扩展名 | `package.json` 是 `"type": "module"`,错误里 `finalizeResolution` 正是 ESM 解析器 |

**`includeFiles`(选项 C)在文档里根本没有**,而且它只原样拷贝文件 —— 拷进去的还是 `.ts`,
Node 在 ESM 下照样跑不了。**C 出局。** 复制一份(选项 A)是我们拆了八次的东西,不接受。

## 选 B,但方向反过来

规范实现移到 **`api/_lib/`**(Vercel 确实会编译的位置),`src/` 与 Deno 从那里导入,
而不是反过来。单一真相源保住,且落在编译作用域内。

- `api/_lib/glyphCheck.ts`、`api/_lib/renderToken.ts` —— 规范实现,文件头写明为什么在这里
- `api/render-pdf.ts` → `./_lib/xxx.js`(显式扩展名)
- `supabase/functions/_shared/renderToken.ts` → `../../../api/_lib/renderToken.ts`
- vitest 测试 → `../../api/_lib/xxx`

## 为什么四道门全绿 —— 根因

**`tsconfig.api.json` 用 `moduleResolution: "bundler"`**,它允许省略扩展名、允许跨目录 ——
tsc 按打包器语义解析,而运行时是纯 ESM 语义。两套语义不一致,没有任何一处在验后者。

`vite build` 过是因为那个文件确实进了前端 bundle;`check:dep-sync` 管的是 npm 依赖版本;
Vercel 部署不做静态导入分析。

## 新门:`check:api-imports`(已进 build 链)

对 `api/**` 的每条相对导入断言三件事,全部来自上面**已确认**的规则,不是猜测:
1. 目标在 `api/` 内(否则不会被编译成 `.js`)
2. 带显式扩展名(ESM 要求;`.js` 映射到同名 `.ts`)
3. 目标文件真的存在;顺带拦 `@/` 别名(Vercel 不支持)

**这道门验证过会红**:把原 bug 改回去,它精确报出两条原因(无扩展名 + 指向 api 外);
只去掉扩展名,它报一条。**一道没见过它变红的门不值钱** —— 这条是这个项目反复吃的亏。

## 顺带:坏 JSON 回 400 不是 500

`JSON.parse` 抛出来会变成 `FUNCTION_INVOCATION_FAILED`(500),客户端看到的是「服务器挂了」
而不是「你发的东西不对」,排查方向直接被带偏。Vercel 的 `req.body` 是 getter,内容畸形时
**访问它就抛**,所以连读取一并包进 try。

Node 203 / Deno 117,六道门全绿。

---

# 平台地基漂移:钉住运行时版本(本项目第一次纯外部环境失败)

## 事实

`font-probe` **2026-07-31 实测通过**;**2026-08-06 同一份代码、同一个包版本失败**,
中间我们什么都没改。两个函数都是 `libnss3.so: cannot open shared object file`。

诊断给出了变量:**`node v24.18.0`**。`engines` 是空的 ⇒ 吃 Vercel 默认版本,而默认值在这
六天里从 22.x 升到了 24.x。`@sparticuz/chromium@131`(2024 末)打包的那批 `.so` 与
Node 24 基础镜像的 glibc/nss 层对不上。

**前面所有 bug 都是我们自己引入的;这个是平台在我们不知情的情况下换了地基。**
而这次升级没有任何一处会通知我们。

## 版本矩阵(查实,不猜)

| 版本 | 发布 | `engines.node` |
|---|---|---|
| 131.0.1(我们的) | 2024 末 | 旧 |
| 147.0.1 – 148.0.0 | 2026-04 | `>=22.17.0` |
| **149.0.0(latest)** | 2026-05-27 | `^22.17.0 \|\| >=24.0.0` ← 明确支持 Node 24 |

Vercel 文档:24.x(默认)/ 22.x / 20.x 都可用;`engines.node` **覆盖**项目设置。

## 选 A(钉 22.x),B(升 149)单独一轮

A 不是拖延 —— 149 确实支持 Node 24,B 有出路。但先 A,三条理由:

1. **A 能立刻验证**;B 要连带升 `puppeteer-core` 到 `^25`(149 的开发依赖),而 131→149 是
   18 个 Chromium 大版本。两件事一起动,失败了分不清是哪件。
2. **B 会重开字体那条链** —— fontconfig 兜底与 `.notdef` 判定都得重验,值得单独一轮。
3. **A 有独立价值**,不只是修 bug(见下)。

`engines.node` 写进 `package.json` 而不是项目设置:它进版本控制、能被评审、能被守卫检查;
控制台里的开关是一个没人记得的状态。

## 规则:依赖运行时二进制的东西,不让平台默认值决定

钉住之后,升级变成**我们主动做的动作**,而不是某天早上突然发现的事故。
以后引入任何依赖运行时二进制的包(Chromium、原生插件、sharp 之类),**先钉版本**。

新门 `check:runtime-pin`(已进 build 链):
1. `package.json` 必须有 `engines.node`(不留空 → 不吃平台默认)
2. 钉的主版本必须落在 `@sparticuz/chromium` 自己声明的 `engines.node` 之内
   —— 升 chromium 时忘了同步 Node,这里会红

### 这道门第一版是错的,被「验它会不会红」抓出来

原来的 `majorsOf` 抓 range 里所有数字:`"^22.17.0 || >=24.0.0"` → `[22,17,0,24,0,0]` →
`Math.min` 得 **0**,于是任何版本都判相容,**门永远绿**。
改成按 `||` 分段、每段只取第一个数字(那才是主版本)。

**一道绿着的门守着坏行为,比没有门更危险 —— 这次坏的是门自己。**
两种失败形态现在都验证过会红:删掉 `engines`、钉一个低于 chromium 要求的版本。

Node 203 / Deno 117,七道门全绿。

---

# libnss3 真因:环境探测失败,不是版本不兼容

## 把包拆开查实(不停在「版本不兼容」这个最省事的解释)

`node_modules/@sparticuz/chromium@131/bin/` 里有 5 个文件,**`libnss3.so` 确实在包里**:

| 压缩包 | 内容 | 解压条件 |
|---|---|---|
| `swiftshader.tar.br` | libEGL / libGLESv2 / libvulkan… | **无条件** |
| `al2.tar.br` | **libnss3** / libnssutil3 / libsoftokn3… | 有条件 |
| `al2023.tar.br` | 上面那些 + libnspr4 / libplc4 / libplds4 / libfreeblpriv3 | 有条件 |

`build/index.js` **模块顶层**就做探测:
```
if (isRunningInAwsLambda())            setupLambdaEnvironment('/tmp/al2/lib');
else if (isRunningInAwsLambdaNode20()) setupLambdaEnvironment('/tmp/al2023/lib');
```
两个函数只读 `AWS_EXECUTION_ENV` / `AWS_LAMBDA_JS_RUNTIME`,匹配 `AWS_Lambda_nodejs` 与
`20.x` / `22.x`。**Vercel 不按 AWS 格式声明这些** ⇒ 两个 if 都不进 ⇒ NSS 不解压、
`LD_LIBRARY_PATH` 不加 `/tmp`。

用实测 facts 反推完全吻合:图形库(无条件)在、NSS(有条件)不在、`LD_LIBRARY_PATH`
是 Lambda 原始默认值一个 `/tmp` 都没有。**库压根不在,不是符号对不上。**

推论:**A(钉 Node 22)的成败不由我们决定** —— 取决于 Vercel 在 Node 22 下给的
`AWS_EXECUTION_ENV` 长什么样,而那是个我们看不见的值。注入才是能自己确定结果的做法。

## 注入(`api/_lib/lambdaEnv.ts`)

在 `import chromium` 之前,若 `AWS_EXECUTION_ENV` 缺失则补 `AWS_Lambda_nodejs22.x`。
选这个值有依据:含 `22.x` ⇒ 走 `isRunningInAwsLambdaNode20` ⇒ 解压 **al2023**
(Node 24 的 Lambda 基础镜像就是 AL2023,且这个包的库更全);同时它让
`isRunningInAwsLambda` 的两个 `!includes` 为 false,两支互斥不打架。

**这不是绕过 bug,是补上平台没提供的事实** —— 我们确实在 Lambda 上。

文件头写清三件(客户要求):对应包里哪个函数、为什么 Vercel 不提供、**升级 chromium 时
必须重新确认**(149 声明支持 Node 24 很可能正是改了探测逻辑,那时这段注入可能变成没必要
或**有害**)。

## font-probe 也要注入 —— 门抓出来的

新加的顺序规则第一次跑就报了 `font-probe.ts`:它同样起 Chromium、同样缺 NSS。
**只修 render-pdf 的话它会继续 500,而它恰好是我们判断环境好坏的那把尺。**

## 三道门,每道都验证过会红

1. **顺序规则**(`check:api-imports` 新增):导入 chromium 的文件必须更早导入 lambdaEnv。
   验了两形态:顺序反了、完全没导入。
   第一版用 `src.includes(包名)` 误报了 lambdaEnv.ts 自己 —— **守卫误报会让人开始忽略它,
   和漏报一样坏**,改成只认真实 import 语句。
2. **运行时事后校验** `assertChromiumEnvReady()`:导入后检查 `LD_LIBRARY_PATH` 含 `/tmp`,
   不含就抛,并指明是「注入没赶上」还是「探测逻辑变了」。
3. **`check:env` 的平台注入豁免**(见下)。

## check:env 的一个真实盲区(顺带修好)

`AWS_EXECUTION_ENV` 是平台注入的,**不该由人配置**,写进 `.env.example` 反而误导下一个人
手动去设。但守卫只区分「读了 / 在不在模板里」,不区分「人配的」和「平台给的」。

脚本里本来就有「平台注入」这个概念,但写死了 `target.id === 'supabase'` ——
**盲区在「按平台判」这个前提上**。

改成按变量判 + **豁免必须带理由**(Map 的值是理由字符串,不是 `true`)——
一个只有名字的白名单,半年后没人知道某项当初为什么在里面,于是要么不敢删、要么随手删。

**但第一版我改松了**:只按变量名豁免,把 **Vercel 侧**那三个 Supabase 变量也标成「平台注入」
—— 而它们在 Vercel 上是要人手动配的。同名变量在不同平台性质可能相反。
改成 `{ on: ['vercel'|'supabase'], why }` 限定平台。
**这是在「验证它对该报的东西仍然会报」时发现的** —— 删掉 Vercel 侧 `SUPABASE_URL` 必须红。

Node 203 / Deno 117,七道门全绿。

---

# font-probe 200 之后暴露的两件(以及一个差点永远绿的自检)

注入生效,Chromium 起来了、NSS 解压了。但探针第 2 块空白、render-pdf 在
`__REPORT_READY__` 超时。

## 先推翻一个假设:两个问题不是同一原因

客户猜「CDN 字体在 Lambda 加载失败,既解释空白也解释页面不 ready」。**后半不成立** ——
`__REPORT_READY__` 只在 `state === 'ready'`(数据到)时置位,**不等字体**。所以报告页超时
更可能是取数失败,与字体无关。两件事分开查。

## 第 2 块空白:subset 陷阱被排除,兜底层才是问题

先查了最像的成因:subset 的 cmap 仍覆盖那五个码位、只是字形为空 —— 那样浏览器永远不会
回落。**本地跑 `subset-fonts.mjs` 实测:「探针字未被收进」**,cmap 里确实没有。假设排除。

所以空白只剩一个解释:**fontconfig 那层没生效**,容器里没有任何字体覆盖那些码位,
浏览器连 `.notdef` 都画不出来。

`chromium.font()` 把文件下到 `$HOME/.fonts/`(HOME 默认 `/tmp`),而它 **resolve 只代表
下载流程走完,不校验文件大小** —— `existsSync` 为真就直接 resolve。CDN 出网失败、写盘
截断、或早先留下的 0 字节残留,都会让兜底层静默失效。

现在渲染前显式校验:文件存在且 > 1MB(那个 otf 是 8.3MB),否则**直接失败并报出
`FONTCONFIG_PATH` / `HOME` / CDN base**。宁可在这里失败,也不要出一份姓名看不见的报告。

## ⚠️ 差点永远绿的自检 —— 这是这轮最重要的一条

原来的 `.notdef` 检测只比对「与 U+FFFF 的位图一致」。而**空白的位图与 U+FFFF 不同**,
于是空白被判成 **ok**。也就是说:客户提的那个担心是真的 ——
**在当前这个坏掉的环境里,自检会说「一切正常」。**

改成量墨迹,判三种而不是两种:

| 结果 | 判据 | 含义 | 分级 |
|---|---|---|---|
| ok | 有墨迹且不等于 .notdef | 正常 | — |
| tofu | 与 U+FFFF 位图一致 | 字体匹配上了但缺这个字(逐字问题) | `partial` |
| **blank** | **一点墨迹都没有** | 没有字体覆盖它,**兜底层整体失效** | `critical` |

**空白比方块严重**,所以按系统性失败处理:方块是逐字缺字,空白影响所有客户的所有生僻字。
优先级:常用字缺失 > 空白 > 方块。三条都有测试锁住(11 条)。

## `__REPORT_READY__` 超时:带回页面侧信息,不调大超时

30 秒等不到,调到 50 秒大概率还是等不到,只是把一个确定的失败变成一个更慢的失败。

超时那一刻改为收集:`document.readyState`、`__REPORT_READY__` 的实际值、`location.href`、
`body.innerText` 前 300 字(报告页三种状态各有可辨识文字,据此判断停在哪一屏)、
`document.fonts.status`、以及**全程的 console 消息与失败请求**(≥400 的响应也记 ——
报告页取数失败会让信号永不置位)。

Node 206 / Deno 117,七道门全绿。

---

# 不是超时,是渲染令牌被拒(页面侧诊断一次定位)

`pageState` 直接给出答案:`url` 是 `/expired`、`reportReady: false`、`readyState: complete`、
`fontsStatus: loaded`。报告页只在鉴权失败(401/403)时跳 `/expired`,所以
`__REPORT_READY__` 永不置位**是正确行为** —— 等 30 秒是在等一个不可能发生的事。

## 先用算术排除一条:有效期不是原因

那次总耗时 37.9 秒,令牌 TTL 180 秒 ⇒ 页面发起请求时令牌约 35 秒龄。**排除**,不用再查
冷启动时序。(渲染器现在会把「请求时的令牌年龄」一并报出来,以后这条不用手算。)

## 三处改动

**1. 失败要响得早** —— `waitForFunction` 与「URL 离开 `/report`」两个条件竞速。令牌被拒时
页面几秒内就跳走,原来却要等满 30 秒才报「30000ms exceeded」——那句话零信息量,而且把一个
明确的鉴权失败伪装成超时。现在立刻失败并报出实际落点。

**2. 开浏览器之前先服务端直连一次 API(决定性诊断)** —— 用【同一个令牌】、同一条 URL,
没有浏览器参与。这把两件事彻底分开:
- 直连也被拒 ⇒ **端点层**问题(两侧 secret 不同值 / 过期 / entitlement 停用 / session 不存在)
- 直连通了但页面仍跳走 ⇒ **页面层**问题(rt 没透传、走进了 cookie 分支)

失败时报出状态码 + 响应体 + 令牌年龄,并列出 401/403/409 各自该查什么。

**3. 端点的 401 带上不含敏感信息的 reason** —— 「有令牌但验不过」与「压根没凭证」排查方向
完全不同:前者查两侧 `INTERNAL_FN_SECRET` 是否同值、是否过期;后者查 `rt` 有没有真的传到
这一层(代理丢 query?页面没透传?)。只回类别,不回令牌内容、不回期望值。

## ⚠️ `fontsStatus: "loaded"` 不是兜底层已修好的证据

客户点出这一条,采纳并记下:`document.fonts` 是 **CSS webfont**(页面 HTTP 加载 subset
woff2)那条路;fontconfig 兜底层是 `chromium.font()` → `$HOME/.fonts/` → 系统字体那条路。
**两条完全不同。** 探针第 2 块空白是后者的问题,与前者的 `loaded` 无关。
上一轮加的「字体文件 > 1MB 才继续」校验守的是后者,那条仍然待实测。

Node 206 / Deno 117,七道门全绿。

---

# 探针空白的根因:fontconfig 不扫 chromium.font() 的落点

## 运维备注(客户实测,三轮的代价)

**`supabase secrets set` 成功 ≠ 函数拿到新值。** Edge Function 不会自动重载 secret,
必须 `supabase functions deploy` 之后才生效。

症状是**「两边明明一样却验不过」** —— 而那正是最容易陷进去反复核对值的场景。
**以后任何 secret 轮换之后,都要重新部署受影响的函数。**

## 根因:两个目录

`chromium.font()` 写到 **`$HOME/.fonts/`**(HOME 默认 `/tmp` ⇒ `/tmp/.fonts`)。
而这个包自带的 `fonts.conf`(`bin/fonts.tar.br` → `/tmp/fonts/fonts.conf`)只列四个目录:

```
/var/task/.fonts   /var/task/fonts   /opt/fonts   /tmp/fonts
```

**没有 `/tmp/.fonts`。** 所以字体**下载成功、落地了、体积校验通过**,而 fontconfig
**从来没扫过它所在的目录**。

这解释了实测的全部现象:
- 探针第 2 块(生僻字,走 fontconfig 兜底)**纯空白** —— 容器里没有任何字体覆盖那些码位
- 探针第 1 块(常用字)正常 —— 那是页面 HTTP 加载的 subset woff2,**不走 fontconfig**
- 报告页 `fontsStatus: "loaded"` —— 同上,那是 CSS webfont,与兜底层无关
- `/tmp` 下同时有 `.fonts` 与 `fonts` 两个目录 —— 正是这两条路各自的落点

`> 1MB` 那个校验**跑到了并且通过了**(它在 preflight 之前,而 preflight 通了)——
所以它证明的是「文件在」,不是「fontconfig 用得上」。**校验的位置对,但校验的对象不够。**

## 修法

把字体**复制**进 `/tmp/fonts`(fonts.conf 里唯一可写的 `/tmp` 目录),并清掉
`/tmp/fonts-cache`(目录内容变了,旧索引要作废)。复制而不是符号链接:fontconfig 扫目录时
对 symlink 的处理依实现而异,复制没有歧义。

抽成 `installFallbackFont()`,**render-pdf 与 font-probe 共用一份** —— 两者走同一条路径,
而 font-probe 正是我们判断兜底层好坏的那把尺,两份实现迟早只改一处。

## glyph: ok 这次有分量

`scanned: 393`,全部有墨迹。但**这次没验到兜底层** —— 报告页那 393 个字符全在 subset
覆盖范围内,走不到 fontconfig。真实学员姓名出现 subset 外的字时才会走那条路。
所以兜底层要靠 font-probe 第 2 块来验,而不是靠报告页的 `glyph: ok`。

Node 206 / Deno 117,七道门全绿。

---

## 变更日志

- 2026-07-31 — rev1 初稿
- 2026-07-31 — rev2:PDF 异步化 + Storage;字体 CDN 化;GHL Inbound Webhook 替代 workflow ID;环境变量改名与新增;D1–D5 批准;新增 D6/D7
- 2026-07-31 — rev4 **Stage 0 定稿**:「8 张表」约束解除,D8 采用第 9 张 `app_settings` 表;D9 定稿(标签独立于字段写入、TRANSIENT/CONFIG/AUTH 三类错误分流、错误具体到字段 key);字体源文件位置与 `.gitignore` 规则确定;0.12 字段清单标记作废(实际前缀为 `qai_assessment_*`);`assessment-config.json` 第三次未送达
- 2026-07-31 — rev3:D6 细则定稿(3 次上限 / `failed_permanent` / 200 字截断 / Admin 重置);GHL scope 批准 + 映射缓存与刷新机制;字体砍到 3 个文件并补三个坑;运维备注 0.17;新增 D8/D9;本地路径确认;`assessment-config.json` 仍未收到
