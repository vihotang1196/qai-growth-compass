# AI 盈利增长罗盘™ 学员诊断系统 — PROGRESS

> 唯一进度真相源。每阶段开工前读,收工后写。
> 仓库:`vihotang1196/qai-growth-compass`(main 已有一个只含 README 的初始 commit;Stage 1 在此基础上 scaffold,不 `git init`,README 直接覆盖)
> 本地路径:`~/qai-growth-compass`(已 clone,HEAD = `94e6ea2 chore: initial commit`,remote 正确)

---

## 从这里开始 —— 交接给一个没看过对话记录的人

这份文档是**唯一真相源**,对话记录不是。凡是只活在对话里的判断,都要写进来 ——
因为下一个接手的人(包括下一轮的我)只有这份文档。

**必读四节,按这个顺序:**

1. **[判断标准](#判断标准--这个项目反复用到的二十条)** —— 二十条。它们不是格言,是每一条都对应一次真实的返工。
   不读这节,后面很多设计会显得像洁癖。
2. **[十一道门](#十一道门--每一道都是撞出来的)** —— 构建链上的十一道守卫各自守什么、**因为踩了什么坑才加的**。
   没有那个背景,下一个人会以为它们可以绕过。
3. **[状态总览](#状态总览)** + **[当前未完成](#当前未完成)** —— 做到哪、下一步是什么。
4. 你要动的那个 Stage 自己那一节(文档按时间顺序排,越往后越新)。

**几条走位常识:**

- **共享代码跨三个运行时**,每个的扩展名规则不同,写错的下场是**部署成功、运行时才炸**:

  | 位置 | 运行时 | 相对导入怎么写 |
  |---|---|---|
  | `src/lib/*.ts` | Vite / vitest | 省略扩展名 |
  | `supabase/functions/_shared/*.ts` | Deno | **显式 `.ts`** |
  | `api/_lib/*.ts` | Vercel Node(纯 ESM) | **显式 `.js`**(映射到同名 `.ts`) |

  真相源的**方向是固定的**:被三边共用的规范实现放 **`api/_lib/`**,
  `src/` 与 Deno 从那里导入,**反过来不行** —— Vercel 只编译 `/api` 内的 TS
  ([原委](#选-b但方向反过来))。`check:api-imports` 守这条。
  只被 Vite / Deno 共用的仍按 [Stage 2 的两层做法](#跨运行时共享的三层做法)
  (`_shared/` 里一行 re-export,不是拷贝)。
- 改题库 / 改计分,真相源是 `src/config/assessment-config.json`,**改完跑 `npm run config:apply`**
  (它先校验后落地,32 项检查)。当前是 **v3.0.0**:5 维 × 3 题 = 15 题,每题按选项数归一化,
  维度分 = 三题均值,总分 = 五维均值,一位小数。
- 本地全绿的三层:`npm run build`(七道门,纯 Node,Vercel 也跑这条)→ `npm run verify`
  (加 deno 三项)→ `npm run smoke -- --base <url>`(**部署之后**才能跑的那条)。
- **部署 Edge Function 用 `npm run deploy:functions`**,不要直接 `supabase functions deploy` ——
  前者会强制先过 verify。
- **改过 secret 之后必须重新部署函数。** `supabase secrets set` 成功 ≠ 函数拿到新值,
  这条烧过三轮,详见 [那一节](#探针空白的根因fontconfig-不扫-chromiumfont-的落点)。
- **改过任何 `VITE_` 前缀的变量,必须重新构建 + 部署 —— 改环境变量不够。**
  Vite 在**构建时**把 `VITE_*` 替换成字面量编译进 `dist`,所以线上产物里那份值
  与 Vercel 环境变量里那份是**两个时刻的两个东西**。
  漏了重新构建的症状**不会说「值旧了」**:轮换 anon key 时它表现为 **Admin 登录坏掉**
  (前端拿一把已失效的 key 去 Supabase Auth,得到一个语义无关的鉴权错误)。
  这与上一条是同一族 —— **配置改了但产物没改**,只是介质从函数换成了构建产物。
  `npm run smoke` 里有一条专门守它([那一节](#轮换-anon-key-时最容易漏的一步))。

---

## 状态总览

| Stage | 内容 | 状态 |
|---|---|---|
| 0 | 方案确认 | **rev4 — 已定稿** |
| 1 | 脚手架 + Brutalist 设计系统 + 组件层 + Vercel 上线 + 字体探针 | **完成并上线** |
| 2 | 数据表 + RLS + phone.ts + 单元测试 | **完成**(migration 已应用于 Supabase Singapore) |
| 3 | assessment-ghl-webhook | **完成并实测** |
| 4 | 登录流程(魔法链接 + 重发 + 限流 + session) | **完成并实测** |
| 5 | Admin 认证 + 名单管理页 | **完成并实测**(PKCE;magic link 登录已验证) |
| 6 | 答题流程(背景题 + 15 题 + 断点续答) | **完成并实测**(config v3 之后是 15 题,不是 24) |
| 7 | 计分 Edge Function + 问卷页 + GHL 写回 | **完成并实测** |
| 8 | 报告页 9 板块 + 批次基准线 + 代价换算 + 打印样式表 | **完成并实测**(板块合并后仍 9 个) |
| 9 | PDF 异步渲染 + Storage + 分享卡 | **管线已在线上渲出真 PDF(中文兜底层已生效)**;触发 / 轮询 / Admin 三块代码完成待实测;**分享卡未做** |
| 10 | Admin Portal 其余四模块 + 现场模式 | **代码完成**(看板 / 漏斗 / 问卷洞察 / 现场模式),**未部署实测** |
| 11 | GHL 写回 + 重试(**含从 Stage 7 挂回的:tags、Vercel Cron 定时、Admin 刷新字段映射按钮**) | 部分先行(字段映射 / 判据 / sweep 已在 Stage 7 做掉) |
| 12 | 英文版全量 + 语言切换 | 未开始 |


当前分支基线:`main` = `fd05c59`。测试基线:**Node 334 / Deno 207,十一道门全绿**。


---

## 当前未完成

按「下一个人应该先拿哪一件」排序。

### 1. ⚠️ 已修好的 `entitlements.status` 需要**部署 + 一次真实跑通**,历史行还要回填

代码已修(见 [那一节](#entitlementsstatus-不跟着-finalize-走--已修)),**但两件事没做**:

- **未部署**。修在 `assessment-score` / `assessment-auth` 两个 Edge Function 里,
  要 `npm run deploy:functions`,然后走一遍「答完 → 看 Admin 名单」确认那一列变 `completed`。
  新的断言只落在纯函数(`_shared/entitlementStatus.ts`)上,**「写库那一句真的写对了表」本地无处可测**
  —— 按[判断标准 4](#4-断言的边界必须等于执行路径)的后半条,它属于必须放到部署之后的检查。
- **回填迁移已写但未应用、也未被执行验证**
  (`20260807000000_backfill_entitlement_completed.sql`)。本机没有 Postgres / Docker,
  只做了静态审查。**是一次生产数据写入,应用前先确认。**

### 2. 雷达图维度标签 —— 已改完,**PDF 里的样子还没看过**

代码已改(见[那一节](#雷达维度标签移到五个顶点旁--已改)),本地四种极端数据都用真实组件
渲出来肉眼看过(含全 5.0 时数据多边形顶到每个顶点、英文最长标签 "Drive Conversion")。

**没验的是 PDF。** 标签现在是 SVG 内的 `<text>`,`page.pdf()` 那条路上用的是 CDN 字体 /
兜底字体,字宽与本地不同 —— viewBox 已按最坏情况留了余量,但**「字有没有被 viewBox 切掉」
只能下次渲 PDF 时看图确认**。下次部署顺带看一眼报告 PDF 的第一页。

### 3. PDF 失败路径的实测(第 4 步,未做)

前三步(渲染成功、下载、Admin 看到 ready)会在下次部署时顺带验掉,**第 4 步要故意制造失败**。

**制造失败的方式:在 Bunny 上把 `NotoSansSC-Regular.otf` 改个名,不动环境变量。**
浏览器侧加载的是 `Sora-VF.woff2` / `PlusJakartaSans-VF.woff2` /
`NotoSansSC-Regular.subset.woff2` / `NotoSansSC-Bold.subset.woff2`(`src/styles/fonts.ts`),
那个 `.otf` **只有 PDF 兜底层用**。所以改名的影响面恰好等于被测对象,
而且**零次 Redeploy** —— 改 `CDN_FONT_BASE` 要来回两次构建。
两个前提:①改名和改回来都要 purge 边缘缓存(否则边缘还在回旧对象 / 404 被负缓存);
②挑没人答题的时段。

**触发用 curl 直连,不用 Admin 按钮**:

```bash
curl -sS -X POST "$APP_BASE_URL/api/render-pdf" -H "X-Internal-Secret: $INTERNAL_FN_SECRET" -H 'Content-Type: application/json' -d '{"session_id":"<uuid>"}'
```

失败时它当场回 `{"error":"render_failed","detail":...}`,不用去 Roster 里翻。
⚠️ **不要先跑 `update assessment_results set pdf_status='failed'`** ——
Admin 按钮自己会重置状态,而 curl 根本不受 Roster「按钮只在非 ready 时出现」那条 UI 约束影响。
那句 SQL 一旦漏了 `where`,会把**所有人**的 `pdf_status` 打成 failed,
症状是「别人的报告坏了」,不是「我的测试没跑通」。

期望:`pdf_status = failed`、`pdf_last_error` 里是**具体的**字体错误
(url + `HOME` / `FONTCONFIG_PATH` / dirBefore + 三个常见成因 —— 这一条
[在实测之前先修过一次](#字体下载失败时的错误归一化在跑-stage-9-失败路径之前先修),
否则 404 只会给出一句 `Unexpected status code: 404.`),而**报告页仍然能看**。

**这一步验的不是「成功路径能跑」,是「附属品失败时主交付不受拖累」** ——
整个异步化设计就是为了这一条,不验它等于没做。

### 4. Stage 9 —— 代码已全部完成,**三件未部署实测**

- ~~定时兜底 sweep~~ —— [已做](#pdf-定时兜底-sweep)。部署后看 Cron 历史那个 JSON 的
  `scanned` / `swept` / `deferred`
- ~~分享卡~~ —— [已做](#分享卡)。部署后看**真的截出图了**,以及**卡上没有维度分数**
- 两条迁移未应用:`20260808000000_pdf_status_at.sql`、`20260808000100_share_card.sql`
  (后者会放开 reports bucket 的 mime 白名单,**不应用的话分享卡会稳定上传失败**)

### 5. ⚠️ GHL 重试 sweep 对 `is_test` 零感知 —— 测试数据在往 GHL 发请求

`assessment-ghl-resync` 按 `ghl_synced = false` 挑候选行,**没有任何 `is_test` 过滤**
(`grep -c is_test` = 0)。所以 seed 那 15 条全进了重试队列 ——
第一次跑 resync 就**真的对 GHL 发了 15 次请求**,查的是不存在的 contact。

**这正是 CSV 导出那条规则的同一条:对外服务不该收到测试数据。**
CSV 那边守住了(服务端无条件剔除,不看任何开关),这条路漏了 ——
而漏的原因和判断标准 12 一样:那条规则当时只落在导出那一处,
没有做成「凡是对外的出口都过一遍」。

**它会反复发生**:`--clean` 之后重新 seed,`ghl_synced` 回到默认 `false`,
下一次 resync 又是 15 次。Stage 10 期间会反复造数据,所以这不是一次性浪费。

代价目前很小(GHL 返回 400 → 归为 CONFIG → 不进重试队列,不会每天重烧),
但它是**真的在对外发请求**:烧 GHL 的调用额度、在 GHL 侧留下查询日志。

**已改并实测。** pdf-sweep 用**新造的**样本验过(`seed:test:clean` 之后重造 15 条):

```json
{"ok":true,"scanned":15,"swept":0,"deferred":0,"skippedTest":15}
```

`scanned=15` 说明它确实看到了那 15 条,`skippedTest=15` 说明全被跳过,`swept=0`
说明**一次 Chromium 都没烧**。⚠️ **必须用新样本**:旧那 15 条已经被渲过、
被标成 CONFIG,拿它们验不出收口有没有生效([判断标准 7](#7-能不能区分-a-和-b必须两边都有样本))。

resync 那条待跑,判据是**一次 GHL 请求都不发**、`ghl_last_error` 里是
`CONFIG: test cohort — writeback intentionally skipped`。

修法(两条都要,不是二选一):
- `assessment-ghl-resync` 的候选查询加 `is_test` 过滤 —— 这是**原则性的那条**,
  它防的是**任何**测试数据,不只是这个脚本造的
- 把「cohort 是不是测试」的判断从 `_shared/baselinePools.ts` 里抽成一个与形状无关的
  共用谓词(现在那个 `isTestResultRow` 绑在基准线的行形状上),两处共用

顺带要想的:还有哪些**对外出口**没过这一遍?已知的三个是 CSV 导出(已守)、
GHL 写回(本条)、魔法链接重发(`resendLink` —— seed 行的 `email_lower` 是
`@seed.invalid`,发不出去,但值得确认它不会去尝试)。

### 6. ✅ 已结案:`/api/cron/retention` 没有问题 —— 起点是一次截断的观测

**结论:这个端点一切正常,从来没有过缺陷。** 保留这一节是因为**走错的过程是标本**。

## 最终事实(全部来自观测,不含推断)

| 观测 | 结果 |
|---|---|
| Supabase 侧 `assessment-maintenance` 的 Invocations | 连续五天每天准点一次(排期 `17 3 * * *` UTC,记录 11:17 UTC+8,时区对上)|
| Vercel Logs 筛 `/api/cron/retention` | `GET 401`、`Execution Duration: 87ms`、`User Agent: node` —— **函数确实执行到了** |
| 当初那个 `200 + text/html` | **不复现** |

401 正是 smoke 那条检查不带 Authorization 时的预期结果。所以:
公网这条路是通的、cron 在跑、**「同目录两个 cron 表现不同」那个差异也不存在**。

## 那条推理链错在哪

起点是一次 `head -3` 的输出。它显示了 `200` 与 `content-type: text/html`,
而后面是什么没人看过 —— **那不是观测,是片段**。

基于它走了五步:编译 rewrite 正则逐条试 → 比对两个文件的 git 跟踪 / 导出形状 /
tsconfig 覆盖 → 写一整节分析 → 加一道 smoke 检查 → 在门里把推断写成断言。
**五步全白做,而每一步都产出了「看起来是进展」的东西。**

已立成[判断标准 14](#14-有直接观测可用时先观测再推理),推论二特意补上了
「截断的输出不算观测」。

## 留下来的那道门:值不值

值,但**理由换了**。它原本的理由(捕捉「同目录两个 cron 表现不同」)已经不存在。
它现在的用处是:**「人手动 curl 触发某个 cron」这条路全靠它** ——
手动验收步骤要能跑,得先确认公网这条路通。覆盖范围仍然从 `readdirSync('api/cron')`
推导,新增 cron 自动被覆盖。

它的注释与失败信息被改过**三次**,每次都因为写的是叙事而不是机械事实。
第三版只剩两句:「401 = 请求到达了函数」、「这不能推出 cron 死活,那只看下游效果」。

## 可选的收尾观测(不必做)

Vercel Logs 里筛 `User Agent: vercel-cron/1.0`、时间 03:17 UTC —— 如果有,
就说明 **Vercel Cron 走的正是公网这条路**,那么从头到尾就没有过两条路。
纯为了闭环,不影响任何结论。

### 7. ✅ 测试数据的收口已做并实测(pdf-sweep 通过,resync 待跑)

三个已经实测到的实例,一个比一个便宜地暴露:

| 实例 | 后果 |
|---|---|
| `assessment-ghl-resync` | 对 GHL 发了 **15 次**请求,查不存在的 contact |
| `api/cron/pdf-sweep` | 把 15 条 seed 全渲了 —— **15 次 Chromium**,而 seed 脚本明说「刻意不渲」 |
| (基准线) | 已修,见 [`baselinePools`](#is_test测试--演示数据与真实数据共存) |

**seed 脚本那句「刻意不済」被 sweep 无视了** —— 这说明「意图写在注释里」对自动化流程无效。

## 判别标准不是「碰不碰测试数据」,是【无人请求 vs 有人请求】

39 个跨表取数点里绝大多数是**有人请求的单行操作**(auth / quiz / score / report /
login-request):它们处理的是请求者自己那一行。测试数据走这些路径是**正确的** ——
现场模式演示时那个人答题、看报告,本来就该正常工作。

危险的只有**无人请求**的那几个:cron 与 sweep 捡起了没人问过的行。

| 流程 | 类别 | 现状 | 该怎么修 |
|---|---|---|---|
| `assessment-ghl-resync` | 无人请求 | ⛔ 无过滤 | 收口(见下) |
| `api/cron/pdf-sweep` | 无人请求 | ⛔ 无过滤 | 在**选行**处过滤 |
| `assessment-report` 基准池 | 聚合 | ✅ 已修 | — |
| Admin roster / 统计 / CSV | 聚合 | ✅ 已修 | — |
| `assessment-maintenance`(retention) | 无人请求 | ✅ **不受影响** | — |
| finalize → `syncToGhl` | 有人请求 | ⛔ 会对假 contact 写回 | 收口(见下) |
| Admin「重新生成 PDF」 | 有人请求 | ✅ 应当照做 | **不要拦** |
| Admin 重发 / 换链接 | 有人请求 | ⚠️ 会尝试发给假联系人 | 收口(见下) |
| Stage 11 的 GHL tags | 未建 | — | **走收口就自动被覆盖** |

⚠️ **`retention` 查过了,它只 `delete` `assessment_login_attempts`**,一次都没碰
entitlements / sessions / results。所以它不在名单上 —— 这条是查出来的,不是假设的。

## 修法:收口,不是逐个查询加过滤

逐个加过滤就是**手写覆盖范围**([判断标准 12](#12-覆盖范围是手写的守卫会被代码悄悄长到边界外面--让覆盖由运行时事实驱动)):
下一个 sweep、下一个功能照样会漏,而漏的时候没有任何东西报错。

**对外副作用只有两个出口**(全仓查证,各只有 2 个调用点):

| 出口 | 调用点 |
|---|---|
| `_shared/ghlWriteback.ts` → `syncToGhl()` | resync(无人请求)+ finalize(有人请求) |
| `_shared/resendLink.ts` → `sendMagicLink()` | Admin 重发 / 换链接 + login-request |

**在这两处各加一道判断,就覆盖了所有现在和将来的 GHL 流量与外发消息** ——
包括 Stage 11 的 tags,因为它一定会走 `syncToGhl`。**这是在功能写出来之前就覆盖了它。**

**`syncToGhl` 里怎么表达「跳过」——复用 D9 的 CONFIG 类,不加新状态。**
置 `ghl_next_retry_at = null` + `ghl_last_error = 'CONFIG: test cohort — skipped'`。
CONFIG 的语义本来就是「重试一万次也没用」,而 resync 已经会跳过它 ——
**这一点刚刚在真实数据上被验过了**(第二次调用回 `nothing due for retry`)。
不要用 `ghl_synced = true` 表示跳过:那是在数据里说谎。

**PDF 那条不能收在 `render-pdf`**:那样会连 Admin 的「重新生成」一起拦掉,
而那个按钮是**有人请求**的 —— 演示时就是要看真 PDF。所以 PDF 的过滤放在
**pdf-sweep 的选行处**,判别的正是「无人请求」。

**还要抽一个与行形状无关的共用谓词**:现在那个 `isTestResultRow` 绑在基准线的行形状上,
而收口处拿到的是 entitlement id / session id,形状不同。

## 一个开着的问题(不硬做)

收口处要判「这一行的 cohort 是不是测试」,而那是一次**数据库查询**,不是纯函数。
所以收口的代价是每次外发前多一次 lookup。可以按调用缓存,但**不要为了省这一次查询
而把判断交给调用方传参** —— 那就又回到「调用方必须记得」,也就是这一整条的病因。

Node **287** / Deno 132,八道门全绿(本条只改文档)。

### 8. 一直挂着的

- **真正的冷启动耗时仍未测准** —— 两次都约 16 秒,但都是热的。要在**新部署之后的第一次调用**才拿得到
- **`@sparticuz/chromium` 149 升级** —— 单独一轮。**先读新版 `helper.js` 的探测函数**,
  再决定 `api/_lib/lambdaEnv.ts` 那段注入是保留 / 改值 / 删掉(它可能变成没必要,也可能变成有害)
- **上线前**:换掉 Supabase 内置 SMTP;用真实数据验一次 CSV 导出

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

# 判断标准 —— 这个项目反复用到的二十条

**每一条都对应一次真实的返工,不是格言。** 括号里是它第一次出现的地方。

### 1. 一道没见过它变红的门不值钱

加守卫时必须**反向验证**:证明它会拦,不是证明它不报错。

这条是撞出来的,而且撞点在意料之外 —— **反向验证抓到的第一个问题,好几次是守卫自己的**:

- `check:runtime-pin` 第一版**永远绿**:`majorsOf` 抓 range 里所有数字,
  `"^22.17.0 || >=24.0.0"` → `[22,17,0,24,0,0]` → `Math.min` 得 `0` → 任何版本都判相容
- `check:dep-sync` 与 `check:cross` 各自的第一个真实收获,也都是自身的盲区

推论:**一道绿着的门守着一个正在出错的行为,比没有门更危险** —— 它把注意力从那块地方引开了。

推论二:**守卫误报和漏报一样坏。** `check:api-imports` 第一版用 `src.includes(包名)`,
把注释里提到包名的文件也算成导入者,误报了 `lambdaEnv.ts` 自己。
误报会让人开始习惯性忽略那道门,而那正是它失效的方式。

推论三:**变异验证要能区分三种绿 —— 真的守住了、永远绿、无事可做。**

前两种已经在上面了。第三种是这个项目后来才撞出来的:**断言的前提在 fixture 里不成立**,
所以它无事可做,而名字和结构都在声称它守住了。

| 绿的种类 | 长什么样 | 怎么分辨 |
|---|---|---|
| 真的守住了 | 变异 → 红 | 跑变异 |
| **永远绿**(tautology) | 断言从被测对象自己推导出来 | 变异 → 仍绿 |
| **无事可做**(前提不成立) | fixture 里没有触发那个条件的数据 | 变异 → 仍绿;**再去看 fixture** |

两个标本,都是**跑变异**才发现的,读代码读不出来:

- 「顺序不能反」那条:把配置判断与上游判断对调后 168 条**全绿** ——
  今天没有任何一条真实消息同时命中两套模式,所以顺序怎么排都一样。
  注释和用例名都是我编的。
- 「0 行不画条形」那条:用的 fixture 是 15 人 seed,而**档位计数全是 3,一个 0 都没有** ——
  它在验一个不存在的行。

关键的一句:**一条永远绿的断言和一条无事可做的断言,在正常运行时长得一模一样** ——
两者都绿,都在报告里占一行,都让人以为那块地方被守着。
所以变异不只是「证明断言会红」,也是「证明断言**有事可做**」;
后者变异之后要**多走一步**:去 fixture 里找那个触发条件的数据在哪。

推论四:**工具用来检查 X 时,它自己也在 X 的作用域内。**

审计死代码的脚本可以有死代码;检查空断言的测试可以是空断言;
把不可见字符列成禁忌的那道门,第一个抓到的是它作者刚写下的零宽空格。

标本(比推论三那两个更刺眼,因为它出现在一个**专门用来找这类东西的工具**里):
入口审计那一轮,我给列抽取器写了一段自检 —— 埋一个绝不可能出现在代码里的假列名,
看它会不会被报出来。而假列被塞在检查循环**之后**,
于是它打印了「应当被报出来」而报告里仍然是「无」。
**一句没有被任何东西验证的声明,出现在一个专门用来找这类声明的脚本里。**

用法很朴素:**把工具自己扔进它的输入里跑一遍。**
死代码审计要能扫到审计脚本自己;新加的 lint 规则要扫全仓库(**包括这条规则刚改过的文件**);
自检的那个探针要真的走完被检查的那条路径,而不是在旁边打印一句话。

### 2. 打印一个值,但不对它做判断,等于没打印

日志、探针、诊断字段,只要没有一句断言去看它,它就只是噪音 —— 出问题时没人会回头翻。

第一次救回真错误:测试数从 **161 掉到 154**,而那一轮"看起来"是通过的。
只有把测试数当成一个**被断言的值**,才发现我在一个缺文件的分支上开工。

现在管线里所有诊断都带判断:字体文件**必须 >1MB**(否则抛,并报出 `FONTCONFIG_PATH` / `HOME` / CDN base);
preflight 的状态码**必须 2xx**(否则抛,并列出 401/403/409 各查什么);
`installFallbackFont` 进门**必须**看到 `fonts.conf`(否则抛)。

### 3. 同一份东西存两处 —— 先想能不能取消复制

靠人同步的复制品本身就是 bug 源;加一道「一致性守卫」只是给复制品上保险,
**能取消复制就不要上保险**。

项目里几处「本来会是两份」的:

| 本来会复制 | 实际做法 |
|---|---|
| 雷达轴的角度计算(页面一份、测试一份) | 抽出 `buildRadarAxes()`,**两边共用** —— 这是雷达那三轮的直接教训 |
| 字体安装(render-pdf 一份、font-probe 一份) | 抽出 `installFallbackFont()`,两个调用点共用 |
| probe 渲染 vs 正常渲染 | **同一个 `renderReport()`**,probe 只是一个参数 —— 检查走的就是真实路径 |
| 「下标 → 语义值」 | `src/lib/optionMap.ts` 一份实现 |
| 计分公式(finalize 一份、报告页一份) | 共用 `perQuestionScore`,报告页不重算总分 |
| 依赖版本(package.json / import map) | 取消不了(两个运行时),所以才有 `check:dep-sync` 这道保险 |

真相源的约定:SQL 是 migration 文件,题库与文案是 `assessment-config.json` /
`ui-strings.ts`,设计理由写在它们各自的注释里。

### 4. 断言的边界必须等于执行路径

**同一个模式在这个项目里连撞三轮**,全在雷达基准线那件事上:

1. 测试自己写了一份轴计算的副本 → 断言绿着,而页面在错
2. 改成用真实函数,但只断言到 `polygonPoints()`(**中间层**)→ 还是绿着,页面还是错
3. 把断言推到**最终产物**(`renderToStaticMarkup` 出来的 DOM)→ 这才咬住

一般化:**断言停在哪一层,哪一层以下就是没有覆盖的。**
凡是「断言绿而线上错」,先量断言的边界,不要先怀疑被测逻辑。

同一族的另一种失效(断言从被测对象自己推导,于是永远绿)是[第 8 条](#8-从被测对象推导出来的断言验的是代码和自己一致) ——
两者都表现为「绿着而线上错」,但一个是没验到,一个是验了自己。先分清是哪一种。

同类还有另一种形态:**有些执行路径本地根本没有能覆盖它的地方**
(`api/[...path].ts` 代理链)。那时答案不是再加一道构建门,而是把检查**移到部署之后**
(`npm run smoke`)。判断标准:这条路径在本地会不会被执行?不会,就必须有部署后检查。

### 5. 读了一半的源码比没读更危险

危险不在漏读,**在漏读之后的信心** —— 半懂会让人觉得已经理解,于是不再验证。

标本:`lambdafs.inflate()` 的第一行是
`if (existsSync(output)) return resolve(output)`(目录已存在就**整个跳过**解压)。
我读了它的解压逻辑,没读那行 early-return,于是在 `executablePath()` **之前**
`mkdirSync('/tmp/fonts')` —— `fonts.conf` 从此永不落地,fontconfig 一个字体目录都没有。
**四块全空,比修之前严重得多,而且是我引入的。**

现在的做法:凡是行为依赖第三方内部实现的地方,**把依据写进注释并加一条断言**
(`installFallbackFont` 进门检查 `fonts.conf`),而不是靠记住。

### 6. 能被证伪的错误假设,比模糊的正确直觉有用 —— 先验证再动手

「先验证再动手」在这条链上救了不止三次。**被验证掉的假设都留下了确定的信息:**

| 假设 | 验证结果 | 换来的东西 |
|---|---|---|
| 雷达基准线「挂错轴」 | 不成立 | 排除了渲染层,把范围收到数据 |
| 「字体加载失败既解释空白也解释页面超时」 | 后半不成立(`__REPORT_READY__` **不等字体**) | 两件事分开查,一次定位 |
| 「subset 的 cmap 覆盖了那五个码位所以不回落」 | 不成立(本地跑 subset 脚本,探针字确实没被收进) | 排除 subset,锁定 fontconfig |
| 「令牌过期」 | 算术直接排除(37.9 秒 vs TTL 180 秒) | 不用查冷启动时序 |
| 「回归是清缓存那步造成的」 | 不是,是 `mkdirSync` 抢跑 | 见第 5 条 |
| 「libnss3 是版本不兼容」 | 不是,是环境探测失败 | 没有走上猜版本试的路 |

反过来:「感觉是字体问题」这种直觉即使**方向对**,也无法排除任何东西,
所以推进不了一步。**宁可提一个能被打死的具体假设。**

### 7. 「能不能区分 A 和 B」必须两边都有样本

一个样本只能证明「A 长这样」,证明不了「A 和 B 一样」。
凡是结论形如「两者无法区分」「没有信号」的,先问:**另一边的样本在哪。**
完整案例(GHL trigger 的 200 响应)见 [0.17 运维备注](#017-运维备注)。

### 8. 从被测对象推导出来的断言,验的是「代码和自己一致」

**特征是:改了被测对象,断言跟着改,于是永远绿。** 这类断言不验意图,只验自洽 ——
它长得和真断言一模一样,但它没有独立的一方可以不同意。

与[第 4 条](#4-断言的边界必须等于执行路径)是**两个不同的失效方式**,不要混:

| | 失效方式 |
|---|---|
| 边界太短(第 4 条) | 验了,但**没验到该验的那一段** |
| tautology(本条) | 验了,但**验的是它自己** |

撞过两次,形态完全一样:

1. **雷达轴**:测试自己重写了一份轴构造,两份恰好等价所以绿着 —— 而生产路径它根本没测
2. **状态阶梯**:「阶梯上每一对的方向都对」拿 `ENTITLEMENT_STATUS_ORDER` 的下标去断言
   `canAdvance`,而后者也从同一个数组推导。把 `started` 和 `completed` 对调,它照样绿

**判定方法**:动一下被测对象里那个「意图」所在的地方(顺序、常量、公式),
断言不红,它就是 tautology。

**处理办法不是删掉它,是配一组写死值的用例。** 两者守的东西不同 ——
写死值钉住**意图**(顺序必须是这个顺序),推导式钉住**逻辑**
(`statusesBefore` 不能变成含自己)。状态阶梯那两次变异分别只被其中一组咬住,
少哪一组都会漏过一半。

### 9. 验一条失败路径,要验的不只是「它会失败」,还有「它说的话够不够用来定位」

前者容易验,**后者容易被前者的成功掩盖** —— 门确实响了,于是「这块验过了」被勾掉,
而它说的那句话根本没法照着行动。

与[第 1 条](#1-一道没见过它变红的门不值钱)是同一族的下一个形态:

| | 问题 |
|---|---|
| 第 1 条 | 门**没见过变红** —— 不知道它会不会响 |
| 本条 | 门**响了,但说的话没有信息量** —— 而响这件事本身让人以为已经验过了 |

标本(Stage 9 失败路径实测**开跑之前**就读出来的,不是踩出来的):
`@sparticuz/chromium` 的 `font()` 在非 200 时 reject 的是一个**裸字符串**
(`build/index.js:65`),不是 Error。调用侧统一按
`err instanceof Error ? err.message : String(err)` 降级,于是 `pdf_last_error` 会是整整一句:

```
Unexpected status code: 404.
```

没有 URL、没说这是字体、没有任何环境事实。而 **CDN 改错 / 文件被移走 / 403 恰恰是线上
最可能的那种字体失败** —— 最可能发生的失败模式,给出的是最没法照着行动的那条错误。
照原计划跑下去会拿到「`pdf_status` = failed ✅、`pdf_last_error` 非空 ✅」,然后把第 4 步勾掉。

**推论:失败路径的验收标准要写成「错误里必须出现哪几样东西」,不能写成「应该报错」。**
现在那条断言就是这么写的(必须出现 url / `HOME=` / `FONTCONFIG_PATH=` / 三个常见成因),
而不是 `expect(...).toThrow()`。


### 10. 用 CSS 表达的意图,没有渲染断言就要假设它没生效

**CSS 的失效从不抛异常。** 没有报错、没有警告,只有布局在告诉你 —— 而布局要有人去看。
所以任何以 `max-w` / `overflow` / `truncate` / `line-clamp` 表达的约束,
如果没有一条对应的渲染断言,就要假设**它可能一直没生效**。

与[第 2 条](#2-打印一个值但不对它做判断等于没打印)同形但介质不同:
那条是「打印一个值却不判断它」,这条是「写下一个 CSS 约束却没有任何东西验证它生效」。

标本:名单页的 `pdf_last_error` 写着 `max-w-[16rem] break-words`,**两个类都不生效** ——
`Td` 上的 `whitespace-nowrap` 会继承给里面的文本,`break-words` 因此没有任何换行机会,
1000 字符撑成一条不折行的横线,把操作区推出屏幕(表格 3953px,要横滚 2705px)。
那行代码看起来完全像是在限宽,读代码时不会有人怀疑它。

**判定方法**:把约束改坏(`max-w-[16rem]` → `max-w-[2rem]`),如果没有任何断言变红,
说明这个约束从来就没有被任何东西验证过 —— 它现在是否生效,只是运气。


### 11. 新标准 / 新守卫上线,先对现有代码全量跑一遍 —— 第一批命中的往往是自己刚写的

这个规律在本项目稳定到可以当预期用,而不是当巧合:

| 上线的东西 | 第一个命中 |
|---|---|
| `check:dim` | **落地当天就判了 Showcase 自己违规** —— 那六个色块把维度名写在填充里 |
| `check:api-imports` | 第一版误报了 `lambdaEnv.ts` **自己** |
| `check:dep-sync` / `check:cross` | 各自的第一个真实收获都是**自身的盲区** |
| `check:runtime-pin` | 第一版**永远绿** —— 命中的是这道门本身 |
| [判断标准 10](#10-用-css-表达的意图没有渲染断言就要假设它没生效) | 立完的第一件事就抓到**同一次改动里新写的** `max-w-3xl` 同样没有渲染断言 |

**为什么会这样**:定标准的人刚刚写过一批「符合直觉」的代码,而标准存在的理由正是
直觉在这里不够用。所以最新的代码是违规密度最高的地方,不是最低的。

推论一:**新守卫的第一次运行必须是全量,不能只跑 diff。** 只跑 diff 会让它从
「盘点现状」退化成「守住增量」,而现状里那批才是它当初被立出来的原因。

推论二:**第一批命中不要顺手改掉了事** —— 那是这条标准最好的一批标本,
写进文档比修掉更有价值。上面这张表就是这么攒出来的。

⚠️ 与[第 1 条](#1-一道没见过它变红的门不值钱)的关系:第 1 条是「门没见过变红」,
本条是「门第一次变红时,红的是谁」。两条都指向同一件事 —— **门的『存在』不等于『有效』**,
而验证有效性的最快办法是让它先咬自己一口。


### 12. 覆盖范围是手写的守卫,会被代码悄悄长到边界外面 —— 让覆盖由运行时事实驱动

**这条已经栽了八次**,而且第八次是在它已经被写下来之后栽的。

前七次记在 [Stage 4 那张表](#stage-4-登录跳转规范源自上述开放重定向)里:
`api/` 建了但没进 `tsc -b`;`check:dep-sync` 只扫 `_shared/` 而函数本体在外面;
Deno 侧一直没 `deno check`;`deploy` 两条守卫都不经过;环境变量的需求在代码里
而配置在人的记忆里……

**第八次:字形自检只跑在报告页上,而分享卡上线时管线多渲了一页。**
于是 `glyph: ok` 从那天起就是**不完整的结论**,而看到 ok 的人会以为整份产物都验过了。

⚠️ **第八次最值得记的地方不是它发生了,是它在「已经写下来」之后还是发生了。**
那条教训当时写进了一张 Stage 表格 —— 而[交接必读四节](#从这里开始--交接给一个没看过对话记录的人)
不包含那张表。**写在没人会先读的地方,等于没写。** 所以它现在在这里。

**修法不是「记得改清单」,是让覆盖由运行时事实驱动:**

| | 手写清单 | 运行时驱动 |
|---|---|---|
| `check:dep-sync` | 只扫 `_shared/` | **沿 import 图递归自动发现**(现在报「自动发现 60 个共享源码文件」)|
| 字形自检 | 只扫报告页 | **`framenavigated` 采集真的导航过的路径**,末尾比对「访问过」与「扫过」 |

两次的形状一样:**把「该检查什么」从一份要人维护的列表,换成一个从实际行为推导出来的集合。**
之后再加一个渲染产物(OG image、别的尺寸),漏扫会自己变成 `severity: incomplete`
写进 `pdf_last_error`,不需要任何人记得。

推论:**加守卫时先问一句「它的覆盖范围是我手写的吗」。** 是,就再问「代码往哪长会掉到外面」。

### 13. 过滤的判据是**请求的来源**,不是数据的属性

同一份数据在不同路径上应当得到**不同待遇** —— 判据不在数据身上,在「谁发起的」。

测试 / 演示数据这件事上,「碰不碰测试数据」这个判据是错的:它会把
Admin 的「重新生成 PDF」、演示时本人答题一起拦掉 —— **而那些恰恰是现场模式要的**。
换成「无人请求 vs 有人请求」之后,答案立刻清楚:

| 谁发起 | 例子 | 对测试数据 |
|---|---|---|
| **无人请求** | cron、sweep 捡起没人问过的行 | 跳过 |
| **有人请求** | Admin 点按钮、本人答题、本人看报告 | 照做 |

三次实测都落在「无人请求」那一栏:resync 对 GHL 发了 15 次请求、pdf-sweep 渲了
15 次 Chromium、基准线把假数据算进了真实学员的对照。而同一批数据被人主动点开时,
它就该正常工作。

推论一:**判据放错会同时产生两种错** —— 该拦的没拦(sweep),不该拦的拦了(演示)。
「碰不碰测试数据」这个判据两种错都会犯,而它听起来完全合理。

推论二:**收口的位置由判据决定。**
PDF 那条**不能**收在 `render-pdf`(那会连 Admin 的按钮一起拦掉),
要收在 **pdf-sweep 的选行处** —— 因为「无人请求」这件事只有 sweep 知道。
而 GHL 写回可以收在 `syncToGhl`(所有调用都不该对假 contact 发请求),
因为那个出口上**两种来源的答案相同**。
先问「这个出口上两种来源的答案一样吗」,再决定收在哪一层。


### 14. 有直接观测可用时,先观测再推理

查正则、比对文件差异、读源码 —— 全都是**推理**。调用记录、日志、Invocations 是**事实**。
两者都可用时,**先做那个不依赖任何推断的**。

标本(这一条是被自己坑出来的):
`/api/cron/retention` 从公网 curl 回 `200 + text/html`。据此推断「函数没执行 →
这条 cron 从 Stage 4 起从没跑过」,然后:编译 rewrite 正则逐条试、对比两个文件的
git 跟踪 / 导出形状 / tsconfig 覆盖、写了一整节分析、加了一道 smoke 检查
并在它的失败信息里把那个推断写成了断言。

**推翻它的是一张 Invocations 列表**:被调用方 `assessment-maintenance` 连续五天
每天准点执行(排期 `17 3 * * *` UTC,记录显示 11:17 UTC+8 —— 时区正好对上,
这本身是第二重确认)。一次点击,不依赖任何推断。

**而那个观测在第一轮就被提出来过**(「一个便宜的判据:去看
`assessment-maintenance` 的调用次数」),只是双方都先去查正则和文件差异了 ——
因为那些**看起来更像在调查**。

推论一:**推理链越长,它站在的那个前提越值钱。** 上面那条链有五步,而第一步是错的,
后面四步全是白做 —— 而且每一步都产出了「看起来是进展」的东西(一节分析、一道门)。

推论二:**排查开始前先列一遍「有哪些不需要推理的观测」。** 日志、调用记录、
数据库里的实际值都算。列不出来才开始推理。

**而观测本身也要确认是完整的 —— 截断的输出不算观测。**
这条标本的起点就是一次 `head -3`:它显示 `200` 与 `content-type: text/html`,
而完整响应里那两行之后是什么,没人看过。后来 Vercel Logs 显示同一个端点
**401 + 函数执行 87ms**,那个「200 + HTML」根本不复现 ——
**整条五步推理链的前提是一次被截断的读取。**
`head` / `tail` / `| grep` / 折叠的日志面板都属于这一类:它们给出的是**片段**,
而片段与观测的区别正是这一条标准的全部内容。

推论三:**守卫的文本只写它机械验证的事实 + 下一步去哪看,不写因果叙事。**
那道 smoke 检查的注释与失败信息被改过**三次**:
第一版断言「这条日程会每天成功而从不运行」(被 Invocations 推翻);
第二版拿「retention 从公网回 HTML」当反例(**后来不复现**);
第三版只剩「拿到 401 = 请求到达了函数」「这不能推出 cron 死活,那只看下游效果」。
**叙事会过期,而过期的叙事会以「工具说的」的身份传给下一个人** ——
这比没有那句话更糟。

推论四:**观测环境必须与被观测对象的运行环境一致 —— 用错误的方式做观测,
和不做观测一样危险。**

这条与推论二同族但换了介质:那次失真是**截断的输出**(`head -3`),
这次是**错误的渲染环境**。现场模式的四屏用 `vmin` 排版,而我把它们嵌进一个大页面里看,
`vmin` 于是按整页视口算 —— 字号全错、数字溢出边框,而我**差点把那个溢出当成新 bug**。
改成一屏一个整页 + 视口固定 960×540,才与「全屏投影」是同一个关系。

共同点是:**失真的观测看起来和真的一样**。它不像报错那样会自己喊出来 ——
它给你一张图、一段输出,而你据此开始推理。

同一条标准在这个项目里的另一头占掉了整个 Stage 9:
**serverless 的行为只能在部署环境里看** —— `chromium.font()` 的那个 404、
本机不存在的 Lambda 只读文件系统、本机看不到的 cron 排期与函数冻结时机,
没有一条能在本地观测到。那一整个阶段的返工都是同一句话的不同写法。

清单式的用法:动手观测之前先问一句「**这个观测环境与它真实运行的环境,差在哪儿**」。
差得出来就先把差异消掉,或者在结论里写明这是代理观测
(与[判断标准 10](#10-用-css-表达的意图没有渲染断言就要假设它没生效)
同一个交代)。



### 15. 一个结果的正确性取决于「它涵盖了哪些数据」时,那个范围必须是参数,不能是默认值

**因为默认值出错时,结果看起来仍然正确。**

聚合数字是这条的典型:「平均分 3.4」不会因为多算了 15 条假数据而看起来可疑 ——
它没有任何地方可以露出破绽。而一个漏掉了真实学员的漏斗图同样只是「数字小一点」。
**这类错误不会被当场发现,要等有人去核对 —— 而聚合数字恰恰是最没人核对的东西。**

与[判断标准 13](#13-过滤的判据是请求的来源不是数据的属性)的分工:
13 问**「谁发起的」**,这条问**「关于谁的」**。
聚合看板的两种用途(运营看真实批次 / 现场模式投影)**都是有人请求**,
所以 13 那个判据在这里区分不出来;真正区分它们的是那个数字关于哪一群人。

落法:
- `cohort_dashboard` 的 `cohort_id` **必填**,缺参数 400。没有「默认全部」这种隐式状态
- `'all'` 在**服务端**展开成「排除测试批次」,**不是「不加过滤」** —— 两者的差别就是这一整条
- 前端不做任何范围过滤:否则会出现两份「什么算全部」的定义

推论:**这与「开关控制」的差别不是严格程度,是错误状态能不能被表示。**
开关让「混合过的数字」成为一个可达状态(只要有人忘了拨回去);
显式范围让它**不可达** —— 而不可达不需要任何人记得。
这与 [PublicShell 那次](#分享卡截进了-en-按钮--全局-chrome-的默认方向反了)同族:
不是把默认值设对,是让错的那个状态没有表达方式。

⚠️ **`'all'` 的字面展开会掉一类真实数据。**
「所有 `is_test = false` 的批次」按字面去列 id,会漏掉 `cohort_id` 为 null 的行 ——
那是**批次被删了的真实学员**(`on delete set null`)。
所以判据要写成**「不是测试批次」**,而不是「在这批 id 里」。
少算一个真实学员和多算一个测试学员一样糟,只是更不容易被发现。


### 16. 说「照抄 X」时要说清照抄的是 X 的哪一部分

一句模糊的指令与一份手写的清单,**失效方式完全一样**:都要靠下一个人补上你没说的那部分,
而他补的那部分不一定是你想的。

标本:Stage 10 的「后面三个模块照抄看板」。说的人脑子里是「照抄**范围约束**」
(`cohort_id` 必填、`'all'` 展开成「不是测试批次」),而那句话**字面上包含了全部** ——
包括看板那条 `.eq('session.status', 'completed')`。
照抄那一条会得到一个**每段都 100% 的漏斗**:它只统计已完成的人,
而漏斗的全部意义在于看没完成的人掉在哪。

所以约束要写成两句,而不是一句:
> ✅ **该照抄的**:范围约束
> ❌ **不该照抄的**:completed 过滤 —— 漏斗要的正好相反

推论:**「照抄」这个词本身是可疑的。** 它把「哪些部分适用」这个判断推给了下一个人,
而那个判断恰恰是原作者才知道答案的。写「照抄」时把适用与不适用的部分各列一遍,
两句都写才算说完。


### 17. 用 `grep` 判断状态之前,先问「匹配成功意味着什么」—— 它常常和你要的答案相反

`grep` 回答的是**「有没有匹配」**;你想问的是**「有没有出错」**。
在退出码上这两个问题**正好反过来**:

```bash
npm run verify | grep -iE "error|fail" && git commit …   # ← 找到错误 ⇒ 退出码 0 ⇒ 继续提交
```

**同一轮里犯了两次,而且是同一个错的两面:**

1. 上面那条链 —— `verify` 输出里有 `FAILED`,`grep` 匹配成功、退出 0,
   于是 `git commit` **照常执行**。结果:一个带断锚的 commit 落在了本该只放文档的分支上。
2. `grep -icE "FAILED"` 数出「1 处失败」—— 数到的是 deno 的 `0 failed`。
   **把「包含这个词」当成了「处于这个状态」。**

⚠️ **最要紧的一层:那条链把一道真守卫的判决盖掉了。**
`check:doc-anchors` **当时已经红了**、已经准确指出了断锚 ——
而 `grep && commit` 让提交照样发生。
**一道门是绿还是红,取决于谁在读它的输出。**
在门外面套一层判错的封装,等于把那道门关掉,而且关得没有声音。

做法:
- **用命令自己的退出码当闸门**:`npm run verify && git commit …`。
  要看输出就分两步跑,不要把 `grep` 塞进 `&&` 链里做决定
- **`grep` 只用来读,不用来判**
- 要数就数你真正指的那个东西:`grep -c "| 0 failed"` 与 `grep -c failed` 不是一回事

与[判断标准 14](#14-有直接观测可用时先观测再推理)的关系:
14 讲**片段不是观测**;这一条更隐蔽 —— 片段的**退出码语义与问题相反**。
14 里我拿 `head -3` 的片段当观测,这里我拿 `grep` 的退出码当判决,
两次都是**用一个替代物回答了它答不了的问题**。


### 18. 死代码的危险不是占地方,是它可能在你不知道的时候被当成活的 —— 名字越像正规入口的越危险

一个从来没被引用过的东西,**恰恰因为没人碰它而一直保持着错误状态**,
然后在最需要它正确的那一刻被人捡起来用。

标本:`build:ci`。来自 Stage 1 第一个 scaffold commit(`tsc -b && vite build`),
那时候一共只有**两道门**。它从未被任何东西引用 ——
而门从 2 道长到 8 道,**它一直停在 0**。没人改它,正因为没有任何东西指向它。

**危险全在名字上。** `build:ci` 读起来像「CI 用的那个 build」,
而 PROGRESS 里早就写着「加人之后上 GitHub Actions 跑 `npm run verify`」——
那个未来时刻,来配 CI 的人会去找**名字里带 `ci` 的那个 script**,
然后无声部署一个八道门一道没跑的产物。

推论一:**判断死代码要不要删,不看它占多少地方,看「被误用时后果有多大」。**
一段没人用的工具函数删不删都行;一个没人用的**入口**要立刻删。

推论二:**要保留一个绕过检查的口子,就把它命名成看起来像在绕过检查。**
`npx tsc -b && npx vite build` 显式写出来时一眼就知道是在跳过门;
叫 `build:ci` 就像在走正门。

推论三:同类要主动扫 —— **「名字听起来是入口但没人引用」的东西**。
排在 Stage 10 之后做一次。


### 19. 改动成本远小于影响面时,先停下来问「这是不是一次产品决定」

一个比较符改起来是一分钟的事。而 `priority !== weakest[0]` 改成
「priority 不在最弱两维里」,影响面是**所有已经发出去的报告** ——
那些报告已经按旧定义高亮过第 7 板块,改完之后后台与学员手里那份对不上。

**成本与影响面不成比例的地方,正是最容易顺手改坏的地方。**
因为改的动作太小,小到不像一个需要决定的事。

判断方法:改之前问一句「这个改动会不会让**已经交出去的东西**变成错的」。
会,就不是代码问题,是产品决定 —— 那时要连「已发出的怎么处理」一起想。

同一族的还有:改 `assessment-config.json` 的 tier 区间(会让历史分数换档)、
改 subset 码位(会让已发的 PDF 与新的不一致)、改 `option_count`
(v3 那次改版正因为这条才把计分改成按 option_count 归一化)。

### 20. 关于「将来会怎样」的注释,写下的那一刻起就没有任何东西在验证它

一句对未来的断言,而未来还没到 —— 所以它**零个检查者**,而且会被后来的人
当成「已经安排好了」来读。

标本(**两个人都信了好几轮**):`syncToGhl` 里那道测试批次收口写着

> 收在这里,将来 Stage 11 的 tags 一写出来就自动被覆盖

这句话从来不成立。`syncToGhl` 是**字段写回专用**(PUT `customFields`、按字段映射核对、
记 `ghl_synced`),而 D9 要求标签独立于字段写入,所以标签必然是**另一条出站路径** ——
那条路径上没有那道收口。它同时写在代码注释里和 PROGRESS 里,而**没有任何东西在验证它**。

这与死链、与 `build:ci` 是同一族:**一句声明,零个检查者。**
区别只在介质 —— 死链是「现在就错」,这一条是「等到将来才错」,
而「将来」到的时候,写它的人已经不在这一轮的上下文里了。

处理办法只有两条,**没有第三条**:

1. **把那句话变成一道门。** 这次的做法:收口从函数级挪到传输级
   (`ghlContactRequest`),外加 `check:ghl-transport` 禁止别处出现 GHL 的域名或主机常量。
   于是那句「新的出站路径会被覆盖」不再是承诺,而是**构建时会红的事实**。
2. **删掉它。** 留着一句让人安心的假话,比什么都不写更糟。

推论:**「以后会……」「将来……」「等 Stage N 就……」这种措辞出现在注释里时,
它要么紧跟着一道门,要么应该是 PROGRESS 的「当前未完成」里的一行**
(那里的东西会被下一轮读到并处理),而不是代码里一句无人负责的旁白。
**这些都是一行改动、全库影响。**

反过来也成立:**改动成本大而影响面小的地方,不要因为「改起来麻烦」就绕开。**
这一条不是「小改动要慎重」,是「用影响面而不是改动量来决定要不要停下来」。


---

# 十一道门 —— 每一道都是撞出来的

`npm run build` 依次跑这十一道,**纯 Node,所以 Vercel 部署也跑同一条链**。
`npm run verify` 在这之上加需要 deno 的三项。

> **读这一节的目的**:没有「因为什么才加」这一列,这些门看起来像洁癖,
> 于是下一个人遇到红灯时的第一反应会是绕过它。它们没有一道是预防性的 ——
> **十一道全部是事后补的**,每一道对应一次已经付出的代价。

| 门 | 守什么 | 因为撞了什么才加 |
|---|---|---|
| `lint:cjk` | `src/**` 里禁止硬编码 CJK **字符串字面量与 JSX 文本**(注释不管;`src/config/**` 豁免) | Stage 12 要出英文全量版。文案散在组件里就没法整体切换 —— 真相源必须是 `ui-strings.ts` 与 `assessment-config.json` |
| `lint`(`eslint .`) | 全量 eslint 规则、**全仓库**(不只 `src/**`):`no-explicit-any`、`no-unused-vars`、`no-irregular-whitespace` 等 | **它一直存在,却不在任何一道门里,而且被发现时已经红着(8 个 error)** ——八道门里只有 `lint:cjk` 会跑 eslint,而那只带一条规则、只扫 `src/**`。入口审计那一轮才发现它:**名字越像正式入口,没人跑它的危害越大**。8 条里有 1 条本身就是死代码(`type ResultRow` 导进来没用过)—— 一道没人跑的门早就知道有东西该删了 |
| `check:dim` | 六个维度色**只能做填充**(`bg-dim-*` / `fill-dim-*`),不能当文字色、边框色、描边、细线 | **可访问性约束,不是风格偏好**:规则成立的前提是每个元素都有 2px 墨边框做分界,所以色块自己不必对黄底扛 3:1。维度色一跑去当文字色/无边框描边,前提就没了 |
| `check:dep-sync` | `supabase/functions/**` 用到的裸 specifier 必须在 Deno import map 里有**精确版本**;与 `src/` 共用的还要和 `package.json` 同值 | `libphonenumber-js` 的号码元数据随版本变。两边版本不同时,**同一份 `phone.ts`、同一个输入,会给出不同的 E.164** —— 入库用一个版本、登录查询用另一个,号码存进去查不出来,而代码看起来完全一致。会去查数据、查索引、查归一化,唯独不会怀疑库版本 |
| `check:env` | 环境变量清单**从代码推导**;Vercel / 前端要的必须出现在 `.env.example`;禁止静态扫不到的动态读取 | Stage 4 端到端两次 `server_misconfigured` 500(`LOGIN_HASH_PEPPER`、`SESSION_SECRET`)。两个都在 Stage 1 清单里标着「以后才用」,而合并 Stage 4 时**没有任何东西提醒去补** |
| `check:api-imports` | `api/**` 的相对导入必须①在 `api/` 内 ②带显式扩展名 ③解析得到;禁 `@/` 别名;**导入 chromium 的文件必须更早导入 `_lib/lambdaEnv`** | 线上 `ERR_MODULE_NOT_FOUND`,而**四道门全绿**。根因:`tsconfig.api.json` 用 `moduleResolution: "bundler"` —— 那是**打包器语义**(可省扩展名、可跨目录),而运行时是 **ESM 语义**。两套语义不一致,tsc 永远不会替你发现。第④条(顺序)是 libnss3 烧掉两轮之后补的 |
| `check:runtime-pin` | `package.json` 必须有 `engines.node`,且钉的主版本落在 `@sparticuz/chromium` 自己声明的范围内 | **本项目第一次纯外部环境失败**:Vercel 的默认 Node 从 22 漂到 24,而 chromium@131 只认到 22。规则化成:**依赖运行时二进制的东西,不让平台默认值决定** |
| `check:doc-anchors` | PROGRESS / README / docs 里的站内锚点必须都能解析;被链接的重名标题也拦 | 这个检查以前是**每轮手打一遍**的临时脚本,而它的 slug 算法把标题里的下划线删掉了(GitHub 保留)—— 于是 `#is_test…` 那条正确链接被**假红**过一次。手打的检查会漂,而漂的方向没人盯着。**真相源里的死链比缺一节更糟**:缺一节看得出来,死链看起来像文档在说「这里没有」 |
| `check:crons` | `api/cron/*.ts` 与 `vercel.json` 的 crons **双向**一一对应;schedule 必须是五段、非空、path 不重复 | **这道门的成因就是它自己拦的那件事**:`assessment-ghl-resync` 存在、正确、`ghlWriteback` 一直在往 `ghl_next_retry_at` 里写待重试,**而没有任何东西调它** —— GHL 写回失败在生产上从来没被重试过,且那件事只有靠人翻 `vercel.json` 才会发现。反方向拦的是「删了函数忘了删排期」:每次触发 404,而 **Vercel 的 cron 历史里 404 也算一次执行记录** ——「跑过了」是对的,「跑成了」是错的,列表里两者长得一样 |
| `check:ghl-transport` | GHL 的域名与 `GHL_API_HOST` 常量**只允许出现在** `_shared/ghlContact.ts`;例外要在代码里写理由(≥12 字符),白名单里不写 | **这个项目第一次遇到「绕过收口的方式是什么都不做」**。测试批次那道收口原本装在 `syncToGhl` 里,而那是字段写回专用;注释写着「将来 tags 一写出来就自动被覆盖」——从来不成立。前面所有收口都是翻转默认(新代码要**主动做点什么**才会出错),这次不同:新写一条出站路径,什么都不做就绕过了。**函数只是给人一条正确的路,门才是让错的路走不通** |
| `check:bundle` | 在 `dist/` 里 grep secret 名与 GHL 域名,命中即失败 | 只有 `VITE_` 前缀会被 Vite 打进客户端 bundle。**一次手滑加上前缀**,service role key 或 GHL webhook URL 就进了浏览器。这道门让手滑在构建时炸,而不是上线后 |

### 三处必须知道的细节

**`lint:cjk`:`\uXXXX` 转义绕不过去,而且不该绕。** 规则读的是 AST 的 `Literal.value`(**已经解码**),
所以写成转义序列照样命中。真正的解法是把文案挪进 `src/config/` —— 那才是规则想要的。
**守卫与自己的直觉冲突时,先假设是自己违反了约定,不是守卫太严。**

**`lint` 的 `no-irregular-whitespace` 拦的是「源码里肉眼看不见的字符」。**
撞它的三处全是**故意**的字符:`phone.ts` 里的 `U+3000`(全角空格,用户从微信 / Excel
粘号码时常带)、`csv.ts` 里的 `U+FEFF`(BOM,**Excel 靠它认 UTF-8**)。
全部改成 `\u3000` / `\uFEFF` 转义 —— 理由不是 lint 要求,是**那两个字符在源码里不可见**;
BOM 尤其:它看起来就是「文件开头什么都没有」。
一个 Excel 兼容的关键字符以没人看得见的形式待在代码里,本身就是个问题;转义之后它有名字了,
而且 `csv.ts` 那处加了注释说明为什么必须有 BOM —— 否则下一个人会当成脏数据顺手删掉,
而症状是导出的 CSV 里中文姓名全是乱码,拿去做 GHL 分群时错的是联系人名字。

**`check:dim` 明说了自己的盲区。** 「维度色填充里不能有正文」同样是硬规则,
但 JSX 的 `className` 常是模板串或 `cn()` 调用,静态检查只能覆盖一部分写法 ——
所以那条**没有**做成门,只写在注释里靠 review。
**做不到全覆盖就别装:有盲区的守卫比没有守卫更糟,它制造假安全感。**

**`check:ghl-transport` 的豁免理由写在代码里,不写在门的白名单里。**
白名单只有文件名,半年后没人知道某个文件当初为什么在里面 —— 于是要么不敢删、要么随手删
(与 `check:env` 的豁免同一条理由,只是位置不同:那边写在门里,这边写在**被豁免的那一行上方**,
因为读代码的人正是需要那个理由的人)。这道门把接受的理由**打印出来**,
所以它必须是句人话:少于 12 个字符不接受。
今天两处豁免:`ghlFieldMap`(位置级元数据,不带任何 contact 数据)、
`check-bundle-secrets`(它的工作就是 grep 这个域名,字面量是它的输入)。

**`check:env` 的豁免必须带理由,而且限定平台。**
Map 的值是**理由字符串**,不是 `true` —— 一个只有名字的白名单,半年后没人知道某项当初为什么在里面,
于是要么不敢删、要么随手删。
而且**同名变量在不同平台性质可能相反**:`SUPABASE_URL` 在 Supabase 侧是平台注入的,
在 Vercel 侧要人手配 —— 所以豁免写成 `{ on: ['supabase'], why }`。
它也写明了做不到的事:**验不了 Supabase secrets 上实际配了什么**(需要 Management API 权限)。

### 不在构建链上的几项

| 项 | 为什么不在 `build` 里 |
|---|---|
| `check:deno` / `test:deno` / `check:cross` | 需要 deno,而 Vercel 构建环境没有。在 `npm run verify` 里 |
| `npm run smoke -- --base <url>` | 它发真实请求,**只能在部署之后跑**。守的是 `api/[...path].ts` 代理链 —— 那条路径本地无处可测 |
| `npm run config:check` | 改 config 时才跑(`config:apply` 会先跑它)。32 项校验,**先校验后落地** |

⚠️ **已知开着的洞:`verify` 靠人记得跑。** Vercel 只跑 `npm run build`,所以需要 deno 的三项
**在 CI 上永远不会执行**。当前单人开发够用,**所以现在不做**;触发条件是①加人 ②开始出现漏跑。
到那时上 GitHub Actions 跑 `npm run verify`。**记在这里是为了知道它开着,不是假装它不存在。**

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
│   └── cron/retry.ts                # ⛔ 已过时:实际拆成两个,见 Stage 11 的 cron 清单
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
| `assessment_priority_high` | `total < 2.9 and monthly_marketing_budget >= 2000` |
| `assessment_mismatch` | `priority_dimension != weakest_1` |

`monthly_marketing_budget` 取 S2 `value_map`(**0 / 700 / 2000 / 5500 / 15000**),
「≥ 2000」实际命中**第 3 档及以上**(2000 / 5500 / 15000 三档)。

**在 GHL 后台要建的 tag**:`assessment_tier_*` **5 个**(tiers[].key)、
`assessment_weak_*` **5 个**(dimensions[].key),加上 4 个固定标签
(`assessment_completed` / `hot_lead` / `priority_high` / `mismatch`),共 **14 个**。
或者允许 API 自动创建标签,就只建固定的那几个。

> ⚠️ **这张表上面四个数字曾经是错的,是 Stage 11 开工前对着 config 逐项核出来的**:
> 阈值写着 `total < 55 and >= 3000`(55 是 v2 改小数计分之前的 0–100 分制遗留)、
> `value_map` 写着 `0 / 1500 / 4000 / 12000 / 30000`、
> `assessment_weak_*` 写着「六个」(维度只有 5 个)、总数写着 15。
> **而这张表正是要照着去 GHL 建标签、配 workflow 条件的那一份** ——
> 照错的建,症状是 workflow 永远不触发,或者触发在错的人身上。
>
> 所以真相源换成**可推导的**:`_shared/ghlTags.ts` 的 `tagUniverse()` 由
> `tiers[].key` / `dimensions[].key` / `tags_conditional` 推出全集,
> 有用例钉住「清单 = config 推出来的东西」。手写的清单会漂,而漂的方向没人盯着
> ([判断标准 12](#12-覆盖范围是手写的守卫会被代码悄悄长到边界外面--让覆盖由运行时事实驱动))。

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

直接 curl Supabase 函数,带 apikey(anon)+ X-Internal-Secret(**apikey 在这条路径上不被网关校验,带着只是习惯**)。Vercel Cron 的定时 wiring
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
- **Vercel Cron 定时** —— 见下面那张清单
- **Admin「刷新字段映射」按钮** —— 现靠 syncToGhl 里的自愈 force-refresh 覆盖常见场景

## Stage 11 要加的 cron 条目 —— 就这一条

盘过一遍(`grep -rln 'Cron|定时' supabase/functions api`),需要排期的一共三处,
现在两处已有,**缺的只有 GHL 写回重试**:

| 目标 | handler | vercel.json | 状态 |
|---|---|---|---|
| `assessment-maintenance`(留存清理) | `api/cron/retention.ts` | `17 3 * * *` | ✅ 已排 |
| PDF 兜底重跑 | `api/cron/pdf-sweep.ts` | `*/10 * * * *` | ✅ Stage 9 已做 |
| `assessment-ghl-resync`(写回重试) | **`api/cron/ghl-retry.ts` 未建** | **未加** | ⛔ Stage 11 |

⚠️ **[0.4 的文件树](#04-文件结构)那行已经过时**:它写的是
`api/cron/retry.ts # Stage 11,GHL 写回 + PDF 双重试` —— **一个 handler 管两件**。
实际 PDF 那半已经在 Stage 9 单独做成 `api/cron/pdf-sweep.ts` 了。
照着 0.4 建「双重试」会把 PDF 那半**重做一遍**,而两个 sweep 同时扫同一批行
会互相抢着重跑。**Stage 11 只建 GHL 那一半。**

⚠️ **`assessment-ghl-resync` 的文件头写着「由 Vercel Cron 定时调」,而它从来没被排期过。**
这句话在仓库里存在了整整一个 Stage,没有任何东西检查它成立 ——
和[判断标准 10](#10-用-css-表达的意图没有渲染断言就要假设它没生效) 同形,
只是介质从 CSS 换成了注释里的一句承诺。
**要不要给 vercel.json 的 crons 与 `api/cron/*.ts` 加一道一致性守卫,等 Stage 11 一起看**
—— 现在只有三条,加守卫的收益还不如把它记在这里。

字段映射**不需要 cron**:10 分钟内存 TTL → `app_settings` → 回源三级,
加上 Admin 那个 force-refresh 按钮就够,定时回源只会白打 GHL 的接口。

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

Node 203 / Deno 117,八道门全绿。

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

Node 203 / Deno 117,八道门全绿。

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

Node 206 / Deno 117,八道门全绿。

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

Node 206 / Deno 117,八道门全绿。

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

Node 206 / Deno 117,八道门全绿。

---

# 我引入的回归:提前创建 /tmp/fonts 让整个字体子系统失效

上一轮修完,探针从「第 2 块空白」变成**四块全空** —— 连拉丁字母和 ASCII 标题都没了。
**是我引入的,比修之前严重得多。**

## 根因:`mkdirSync` 抢跑,不是清缓存

`lambdafs.inflate()` 解压 `fonts.tar.br` 的第一件事:

```js
if (existsSync(output) === true) return resolve(output);   // 目录已存在 ⇒ 整个跳过
```

而 `fonts.tar.br` 里装着 **`fonts.conf` 本身** 以及 **Open_Sans 那套拉丁字形**。

上一版在 `chromium.font()` 阶段就 `mkdirSync('/tmp/fonts')`,而那**早于**
`executablePath()` 的解压 ⇒ `fonts.conf` 永远不落地 ⇒ `FONTCONFIG_PATH` 指向一个没有配置
文件的目录 ⇒ **fontconfig 一个字体目录都没有** ⇒ 所有文本(含拉丁)全空。

客户怀疑是清缓存那步 —— **不是**,`rmSync` 只是次要风险面;主因是顺序。

## 这次回归印证了客户的一条观察

第 1、3 块原来的正常渲染**确实依赖 fontconfig**(Open_Sans 提供实际字形),不只是 CSS
webfont。之前我们以为第 1 块只走页面 HTTP 加载的 subset woff2 —— 那个理解不完整。

## 修法(三处)

1. **顺序**:字体安装移到 `chromium.executablePath()` **之后**。两个调用点(render-pdf 与
   font-probe)都改。
2. **前提断言**:`installFallbackFont()` 一进来就检查 `/tmp/fonts/fonts.conf` 是否存在,
   不存在直接抛并说明「本函数被提前调用了」。与其静默弄坏整个字体子系统,不如在这里失败。
3. **不再清 fontconfig 缓存**:不需要 —— fontconfig 发现目录 mtime 变化会自己重建索引;
   删 cachedir 只增加一个「重建失败就全盘降级」的风险面。**少做一件事。**

顺带:日志现在打出 `/tmp/fonts` 在动它**之前和之后**的目录内容(客户要求的那两个时刻),
下次异常一眼能看出是「fonts.conf 在不在」还是「otf 复制成不成功」。

Node 206 / Deno 117,八道门全绿。

---

# Stage 9 剩下三块:异步触发 / 轮询 / Admin

兜底层第一次真正生效(四块全通,第 2 块出现 `䶮 龘 靐 齉 麤`)。粗体行糊是合成假粗
(兜底只装 Regular),预期行为。

## 1. finalize 异步触发

**不 await、失败不影响 finalize 的返回值。** 理由:同步会把附属品的失败绑到主交付上 ——
分数已经算好、报告页本来就能看,用一次 PDF 渲染失败去毁掉「客户拿到分数」,方向错了。

用 `EdgeRuntime.waitUntil()`:Edge Function 在响应返回后可能立刻终止,裸 fetch 不 await
会被取消 —— 那样触发是「有时成功」,而那种不确定比同步等待更糟。
拿不到那个 API 时退回 fire-and-forget 并记 warn,**兜底是 Admin 的按钮**(见下)。

## 2. 报告页轮询(有上限)

3 秒 × 20 次 = 60 秒(渲染约 16 秒,留三倍余量)。**轮到上限就停**,回到那句静态兜底文案。
无限转圈会让客户以为页面坏了,而实际是渲染失败了。状态到 `ready` / `failed_permanent`
也立刻停。

### signed URL 过期:让它不存在,而不是处理它

客户问「过期后再点会怎样」。答案是**不会遇到过期**:端点每次请求都现签,而前端在
**点击那一刻**重新取一条再打开,不用页面加载时那条。页面开着超过一小时再点,
存下来的那条会拿到 Storage 403 —— 那对客户完全无法解释。现取现用把这件事从错误处理
变成了不存在的问题。

## 3. Admin:PDF 状态 + 重新生成

名单页新增 PDF 列(状态 + `pdf_last_error` **原样展示** —— 「生成失败」那种话没法照着行动),
CSV 导出也带上这两列。

**按钮对任何非 ready 状态都可用,不只 `failed_permanent`** —— finalize 那次触发是尽力而为的,
丢了的话状态会一直停在 `pending`;只允许重置 `failed_permanent` 的话,那种「卡住的 pending」
就没有任何出路。这个按钮正是那条路的兜底。会先把 `pdf_attempts` 清零,否则 render-pdf 会因为
`attempts >= 3` 直接拒。

**不加确认框**(客户的判断,采纳):重置只是重渲一次,代价是几十秒和一次冷启动,误点成本很低;
确认框反而让人形成「点确认」的肌肉记忆,而那个习惯会在真正危险的操作上害人。

**Admin 这边等结果,与 finalize 不同** —— 那边客户在等分数不该被 PDF 拖住;这边是人主动点的,
要的就是结果。

## 冷启动耗时仍未测准

两次都约 16 秒,但中间隔了 font-probe,所以第二次大概率也是热的(Chromium 二进制已在 /tmp)。
真正的冷启动值要在**新部署之后的第一次调用**才拿得到,下次部署时记。
按 16 秒算:60 秒上限,即使冷启动多 10 秒也有一倍余量。

## 还没做

- **分享卡**(带分数的社交图片)—— Stage 9 范围内,未做
- **pending 的定时兜底 sweep** —— 目前靠 Admin 按钮;若要全自动,可加一条
  Vercel Cron 扫 `pdf_status <> 'ready'`(那个索引已经存在)

Node 206 / Deno 117,八道门全绿。

---

# `entitlements.status` 不跟着 finalize 走 —— 已修

## 确认过的失败链(不是推断)

一条链上四处,每一处都实际看过:

1. `assessment-score` finalize 只写 `assessment_sessions`(旧 `index.ts:278`)
2. 全仓 `grep "'completed'"`,写 status 的**只有那一处** —— 没有任何地方推 entitlement
3. `assessment-auth` 把它推到 `started` 就停下(`index.ts:112`)
4. 影响面落在三个地方,都读 entitlement 自己的 `status`:
   `Roster.tsx:307` 的徽章、`Roster.tsx:101` 的状态筛选(筛 `completed` 一个人都不出来)、
   `rosterCsv` 的「状态」与「完成时间」两列

## 修法:阶梯抽成共用,不许倒退交给数据库

**新增 `_shared/entitlementStatus.ts`。** 这条阶梯原本只活在 auth 的一句
`if (status === 'pending' || status === 'link_sent')` 里 —— 只有一份时那样写没问题,
但 finalize 一旦也要判「哪些状态算更早」,第二份就出现了。
按[判断标准 3](#3-同一份东西存两处--先想能不能取消复制):**在复制品出现的那一刻取消它,
而不是事后给它加一道一致性守卫。**

**「只往前走」落在那一次 UPDATE 上,不是先读后写:**

```ts
.update({ status: 'completed', completed_at: ... })
.eq('id', entitlementId)
.in('status', statusesBefore('completed'))
```

先读后写在客户连点两次提交时会互相覆盖 `completed_at`;过滤条件让数据库自己保证方向。
`statusesBefore()` 与 auth 用的 `canAdvance()` 出自同一个数组,不存在两套顺序。
失败只记 `console.error`,不挡 finalize 返回 —— 与旁边那句 session 同一个取向。

## 反向验证:两次变异,被两组不同的用例咬住

按[判断标准 1](#1-一道没见过它变红的门不值钱),新加的 7 条用例必须证明它们会红:

| 变异 | 红的用例 |
|---|---|
| 阶梯里 `started` / `completed` 对调 | 三条**字面**用例(含「started → completed 必须能推得动」) |
| `statusesBefore` 的 `slice` 改成含自己(off-by-one) | 「原地不动不算前进」+「每一对的方向都对」 |

**顺带记一个盲区**:「阶梯上每一对的方向都对」那条对**调换顺序是无感的** ——
它拿 `ENTITLEMENT_STATUS_ORDER` 的下标去断言 `canAdvance`,而后者也从同一个数组推导,
所以顺序怎么换它都绿。钉住顺序的是那几条写死值的用例;这条守的是**推导逻辑**
(第二次变异证明了它有用)。两组都要,少哪一组都有一半的变异漏过去。

这个盲区已经单独立成[判断标准 8](#8-从被测对象推导出来的断言验的是代码和自己一致) ——
它和[第 4 条](#4-断言的边界必须等于执行路径)是两个不同的失效方式,项目里已经撞过两次。

## 历史行回填:`20260807000000_backfill_entitlement_completed.sql`

判据是**有 `assessment_results` 行**,不是 `session.status = 'completed'` ——
后者同样是「失败只记 console.error」的尽力而为写入,拿一个可能没写上的列去判断
另一个没写上的列,会漏掉两句都失败的那批。results 行是 finalize 的主产物。

**`completed_at` 取 `coalesce(s.completed_at, r.computed_at)`,绝不用 `now()`。**
`now()` 会把所有历史行的完成时间盖成回填那一刻,而这个时间戳以后会被 Roster 的
「完成时间」列和 CSV 导出当成真实数据读 —— 那是把**「显示空白」换成「显示错误时间」**,
后者更糟,因为它看起来是对的。优先 `session.completed_at`(Roster 要显示的就是它),
回落 `results.computed_at`(该列 `not null`,与前者是同一次请求里的同一刻)。

迁移里带两条断言,不满足直接 `raise exception` 让整条迁移回滚:
①回填后不该再有「有 result 却不是 completed」的行;②`completed` 的行不许有 null 的
`completed_at`(把「不会产出新空白」这句话钉住,而不是嘴上说)。
`where status <> 'completed'` 使它可重复执行。

⚠️ **这条迁移没有被执行验证过** —— 本机没有 Postgres 也没有 Docker,
`supabase db reset` 跑不起来。只做了静态审查。**它是一次生产数据写入,应用前先确认。**

## 一件没做完的

- **未部署实测**。「写库那一句真的写对了表」本地无处可测,按[判断标准 4](#4-断言的边界必须等于执行路径)
  的后半条,它必须放到部署之后

Node 206 / Deno **124**(+7),八道门全绿。

---

# 雷达维度标签移到五个顶点旁 —— 已改

原来标签是图**下方**一排 HTML 列表(色块 + 维度名 + 分数),现在是五个顶点旁的 SVG 文本。

## 三条硬约束,以及各自的理由

**① 角度只有一份。** 新增的 `buildLabelAnchors()` 从 `point()` / `angleFor()` 取坐标,
不另起一套。雷达这块栽过三轮,第一轮就是测试自己重写了一份轴构造 ——
标签位置只要有第二处角度计算,同样的事会再发生一次。

**② 是 SVG `<text>`,不是 HTML overlay。** PDF 走 `page.pdf()`,HTML 定位的元素在打印时
可能与图形错位;SVG 内的文本跟着图形一起缩放,两者不可能走散。
「是不是 `<text>`」因此是可交付性的一部分,有一条断言专门守它(读 `</svg>` 之前的那一段)。

**③ 按象限分三档,不是统一偏移。** 五个顶点里两个在下方、两个在侧面、一个在正上方,
统一给一个偏移会让下面那两个压到图形上。判据取顶点单位向量:`cos` 决定文字往哪边展开,
`sin` 决定两行文字整体在顶点的上 / 侧 / 下。阈值取 0.5 而不是 0 ——
侧面那两个顶点的 `sin` 是 ∓0.309,归进「上 / 下」会让文字斜着飘离顶点。

## 顺带取消的两样

- **图下方那排列表整个删掉**,分数跟着搬到顶点旁。留着就是每个维度名渲染两遍。
- **`RadarAxis.color` 删了。** 雷达本身不用维度色(数据线是黄 + 墨),那排列表里的小方块
  在这张图里没有对应物;而紧邻的「每一维为什么是这个分」板块每个维度名旁就有同样的方块,
  颜色与维度的对应在那里建立。搬到顶点旁再放一遍,只会让辅助元素跟数据线抢视觉权重
  ([铁律 2](#设计系统辅助元素不能与数据竞争铁律-2))。**留一个没人读的字段,下一个人会以为雷达用得上它。**

## viewBox 从 320×320 变成 520×330

标签进 SVG 之后左右各要装下一整条标签。宽度是按**最坏情况**定的:英文最长维度名
"Drive Conversion"(16 字符,14 单位字号下约 118),右侧顶点锚点已在 `CX+121.7`。
容器同时从 `max-w-sm` 放到 `max-w-xl`,否则 viewBox 变宽会把五边形本身缩小
(现在屏幕上的五边形半径 122px,原来 132px,基本持平)。

留的余量比本地字体实际需要的多 —— **这是故意的**:PDF 那条路上是 CDN 字体 / 兜底字体,
字宽与本机不同。余量多只是五边形小一点,余量不够是标签被 viewBox 切掉,后者不可逆。

## 反向验证:四次变异,四条不同的断言

| 变异 | 红的断言 |
|---|---|
| `angleFor` 起始角翻成 `+π/2` | 「一上两侧两下」+「最上/最下是哪几个」(**写死值**那两条) |
| 去掉按象限的垂直偏移(`dyLabel` 恒为 -1) | 「一上两侧两下」 |
| `y={anchor.y + 1}` | 「每个标签和分数都以 SVG `<text>` 到达 DOM」(证明它读的是真属性) |
| 给标签组加上 `fill="#1e5fa8"` | 「雷达里不该出现任何维度色」(`check:dim` 也会拦,两道都在) |

前两条是[判断标准 8](#8-从被测对象推导出来的断言验的是代码和自己一致)要的写死值,
后两条是[判断标准 4](#4-断言的边界必须等于执行路径)要的最终 DOM。**少哪一半都漏掉一整类改动。**

## 本地看过什么,没看过什么

用真实组件渲出四种极端数据肉眼确认过:中文常规、英文最长标签、**全 5.0(数据多边形顶到
每个顶点)**、全 0.0 且无基准线。四种都没有标签压到图形或越出 viewBox。

⚠️ **没看过 PDF。** 「字形的实际墨迹有没有和线重叠 / 有没有被 viewBox 切掉」在换一套字体之后
可能不同,本地断言只能验坐标和 anchor 值。下次部署渲 PDF 时看第一页确认。

Node **212**(+6)/ Deno 124,八道门全绿。

---

# 字体下载失败时的错误归一化(在跑 Stage 9 失败路径之前先修)

## 为什么在实测之前先修

`@sparticuz/chromium` 的 `font()` 在非 200 时 reject 一个**裸字符串**
(`build/index.js:65`),不是 Error。`installFallbackFont` 里 `await chromiumFont(fontUrl)`
没包 try,那句 reject 直接穿过去;render-pdf 的 catch 按
`err instanceof Error ? err.message : String(err)` 降级,于是 `pdf_last_error` 就是:

```
Unexpected status code: 404.
```

**下面那段带 `FONTCONFIG_PATH` / `HOME` / `dirBefore` / `dirAfter` 的诊断根本走不到** ——
它只在「下载成功但文件缺失或 <1MB」时才触发。而 404 / 403(CDN 改错、对象被改名、
防盗链变了)恰恰是线上最可能的那种字体失败。

按原计划跑 Stage 9 第 4 步会拿到「状态确实 failed、错误确实非空」,然后把
「错误具体到能照着行动」勾掉 —— 这条已经立成[判断标准 9](#9-验一条失败路径要验的不只是它会失败还有它说的话够不够用来定位)。

## 顺带做的同类排查:只有这一处,所以不抽象

`err instanceof Error ? ... : String(err)` 这种降级在仓库里有 **37 处**,
但真正会收到**非 Error** 的只有一处:

| 来源 | 结论 |
|---|---|
| `chromium.font()` 非 200 | ⚠️ `reject(string)` —— 全仓唯一一处,已修 |
| `@sparticuz/chromium` 其余 | grep 过,没有第二处裸 reject |
| supabase-js 的 `throw pgError` | ✅ `PostgrestError extends Error`,`.message` 拿得到 |
| `fetch` / puppeteer / WebCrypto | ✅ 都是 Error |

**一处就地包一层,不上 `normalizeError(err, context)`。** 统一封装要养一个新概念,
而它现在只有一个用户 —— 等出现第二处再说。

⚠️ **但排查带出了一件独立的事,没在这一轮做**:`PostgrestError` 除了 `message`
还带 `code` / `details` / `hint`,而那 37 处全都只取 `.message`,
把另外三个字段丢了(权限类错误的可执行信息常在 `hint` 里)。
这与判断标准 9 是同一类问题,但改动面 37 处、跨三个运行时,**单独一轮做**。

## 修法

`chromiumFont(fontUrl)` 包一层 try,非 Error 的 rejection 归一化成带上下文的 Error:
原始成因 + url + `HOME` / `FONTCONFIG_PATH` / `dirBefore` + **三个常见成因**
(CDN_FONT_BASE 指错 / 对象被改名删除 / 访问权限变了)。

最后那条尤其要写进去:浏览器侧加载的是 `*.subset.woff2`,与这个 `.otf` 是**不同的文件** ——
「网站字体好好的」推不出「这个 URL 好好的」,而那是排查时最容易走错的一步。

两个抛点的环境事实抽成 `fontEnvFacts()` 共用([判断标准 3](#3-同一份东西存两处--先想能不能取消复制)):
往其中一处加字段而另一处落后,落后的那条恰好是你没预料到的那次失败走的路。

`fontDir` 做成了默认参数,**只为能测** —— 在测试里往真实的 `/tmp/fonts` 造文件,
恰好是[当年弄坏整个字体子系统](#我引入的回归提前创建-tmpfonts-让整个字体子系统失效)的那个动作,
不能为了测一个函数去重演它。

## 反向验证

7 条新用例(`src/lib/lambdaEnv.test.ts`)。**断言写的是「错误里必须出现哪几样」,
不是 `toThrow()`** —— 那正是判断标准 9 的要求。

把 try/catch 去掉还原成修之前:**3 条红**(裸字符串那条、Error rejection 那条、
三个成因那条),另外 4 条(落地校验、0 字节残留、前置条件、happy path)**保持绿** ——
它们走的是别的路径,不该被这次改动影响。

Node **219**(+7)/ Deno 124,八道门全绿。
---

# 名单页:失败行反而最难操作

## 报告的现象与真正的机制

「`pdf_last_error` 很长,横穿整个操作区,把重新生成按钮挤到屏幕外。」
**而失败那一行恰恰是最需要立刻操作的一行 —— 现在它反而最难操作。**

上一版把错误直接渲在 PDF 那一列,带着 `max-w-[16rem] break-words`。
**那两个类都不生效**:`Td` 上有 `whitespace-nowrap`,它会继承给里面的文本,
于是 `break-words` 没有任何换行机会,文本撑成一条不折行的长句直接溢出那个 16rem 的盒子。
`pdf_last_error` 入库截到 1000 字符,所以最坏情况就是一条 1000 字符的横线。

**写了一个上限,而它一直没有生效** —— 和判断标准 2 是同一个形状:
写下一个约束但没有任何东西检查它成立,那个约束就只是注释。

## 量出来的代价

拿真实组件 + 真实构建出的 CSS 渲同一批行(1248px 视口),改前改后:

| | 表格宽度 | 要横向滚多少才够到操作区 |
|---|---|---|
| 改之前 | 3953px | **2705px** |
| 改之后 | 1814px | 566px |

## 两处改动

**① 错误文本移出列宽,失败行在下方多渲一行。**
PDF 列只留徽章 + 一个**定宽**的「看错误 / 收起」开关。展开的是一个
`colSpan` 铺满整行的 `<tr>`,`max-w-3xl` + `whitespace-pre-wrap`(要盖掉从 `Td` 继承的
`nowrap`)。原文照登、可选中 —— 那段文本是要被整段复制走的。
**一次只开一条**:同时铺开几段千字错误会把名单本身挤没了,而排查是一条一条看的。

`colSpan` 取 `ROSTER_COLUMNS.length`,表头也从同一个数组渲
([判断标准 3](#3-同一份东西存两处--先想能不能取消复制))。

**② 重新生成按钮位置固定,ready 时留空。**
原来「非 ready 才渲」会让这一格的宽度随行变化,而列宽取所有行里最宽的那个。
现在 ready 行渲一个 `invisible` 的同款按钮占位 —— **用 visibility 而不是写死 rem**,
因为按钮宽度取决于标签文字,中英文两版不一样(「重新生成 PDF」vs "Re-generate PDF"),
写死要么夹字要么留缝。`visibility: hidden` 同时把它移出 tab 序,键盘不会停在看不见的按钮上。
实测四行(ready / failed / pending / failed-expanded)的按钮左边缘都在 x=1713。

## 为什么把行抽成了组件

`RosterRow` 从 Roster 里抽出来**不只是为了短**:Roster 自己在 SSR 下只渲得出 loading 态
(数据是 `useEffect` 拉的),抽出来之后这段 JSX 才能被 `renderToStaticMarkup` 直接渲,
断言因此落在**真实的行标记**上,而不是测试里另写一份长得差不多的副本
([判断标准 4](#4-断言的边界必须等于执行路径) 与 [8](#8-从被测对象推导出来的断言验的是代码和自己一致))。

`colSpan` 那条断言特意**不拿 `ROSTER_COLUMNS.length` 去比** —— 那是它的来源,
比了等于「代码和自己一致」。数真实渲出来的 `<td>` 个数才是独立的一方。

## 反向验证:三次变异

| 变异 | 红的断言 |
|---|---|
| 把错误文本放回 PDF 列(还原原 bug) | 「折叠时整行看不到错误文本」+「展开的详情在主行之外」 |
| 改回「非 ready 才渲按钮」 | 「ready 行仍渲按钮、只是 invisible」+「不可点」+「两种行按钮个数相同」 |
| 加一列但忘了加进 `ROSTER_COLUMNS` | 「详情行跨的列数 = 行里的单元格数」 |

## 顺带记一笔,没在这一轮改

`Roster.tsx` 的状态筛选里写死了 `['pending','link_sent','started','completed']` ——
和 `_shared/entitlementStatus.ts` 的阶梯是同一份东西的第二处。
取消不了复制的原因是方向:那个模块在 Deno 侧,前端不能从 `supabase/functions/` 导入
(真相源方向是 `api/_lib/` → 两边)。要合并就得把阶梯搬到 `api/_lib/`,
是一次跨运行时的搬迁,**单独一轮**。

Node **229**(+10)/ Deno 124,八道门全绿。

---

# PDF 定时兜底 sweep

## 它补的是哪个洞

finalize 用 `EdgeRuntime.waitUntil` 异步触发渲染,拿不到那个 API 时退化成 fire-and-forget ——
**触发可能丢**。丢了状态就永远停在 `pending`,而在此之前唯一的出路是 Admin 那个按钮,
也就是「靠人发现」。**这是异步化本身引入的失败形态,所以兜底该由这一层出。**

## 先纠两处

**① `failed_permanent` 不该扫 —— 对,但代价不是「每天烧几次 Chromium 冷启动」。**
`render-pdf` 的守卫在**开浏览器之前**就 409 了(`api/render-pdf.ts:400`,
`attempts >= MAX` 直接 return),所以扫到它的实际代价是一次没用的 Lambda 调用,不是冷启动。
排除它仍然是对的:白打的请求会把日志喂成噪音,而**噪音会让人不再看日志**。

**② 守卫看的是 `pdf_attempts`,不是 `pdf_status`。**
所以光按状态排除还不够 —— 一条 `status='failed'` 但 `attempts=3` 的行照样会被 409。
sweep 的**挑人条件照抄端点的收人条件**:`pdf_attempts < MAX_PDF_ATTEMPTS`,
两条边界才不会各走各的。`MAX_PDF_ATTEMPTS` 因此从 `render-pdf.ts` 搬进
`api/_lib/pdfState.ts` 两边共用([判断标准 3](#3-同一份东西存两处--先想能不能取消复制))——
不能直接从 `render-pdf.ts` 导入:那个文件在模块顶层就拉起 chromium 的环境探测。

## 扫三类,不是一类

| 状态 | 扫不扫 | 为什么 |
|---|---|---|
| `pending` | 陈旧 3 分钟后扫 | **就是 waitUntil 丢了的那一类**。渲染约 16 秒,3 分钟足够区分「还在跑」和「压根没被触发」 |
| `failed` | 立刻扫 | 瞬时失败,没有「在飞的那一次」要等 |
| `rendering` | 陈旧 5 分钟后扫 | 函数写下 rendering 之后超时被杀(maxDuration 60 秒),**没有任何人会把它改回来**。只扫 pending 的话这一类只能靠人发现 —— 那正是 sweep 想取消的东西 |
| `ready` / `failed_permanent` | 不扫 | 一个没事,一个重试一万次也没用 |

## 为此加了一列:`pdf_status_at`

这张表上原本**没有任何一列**记录 `pdf_status` 是什么时候变成现在这个值的
(`computed_at` 是 finalize 那一刻;`touch_updated_at` 那个 trigger 只装在 entitlements 上)。
没有年龄就只剩两个坏选择:不扫 `rendering`(留一个洞),或见到 `rendering` 就重跑
(撞上正在跑的那一次,平白多烧一次渲染并提前耗掉 attempts)。

**故意不加 trigger 自动维护。** trigger 会在任何 update 时刷新它,包括与 PDF 无关的写
(比如 GHL 重试写 `ghl_last_error`)—— 那样一条卡在 `rendering` 的行会被无关的写「续命」,
**永远够不到陈旧阈值**。一个看起来在工作、实际永不触发的兜底,比没有兜底更糟。
所以由改状态的那四处显式写(render-pdf 三处 + Admin 重置一处)。

判断年龄用 `coalesce(pdf_status_at, computed_at)`:这一列是后加的,老行为 null,
而且迁移与代码的上线顺序不保证。回落最坏是把年龄算大了 —— 那是安全的方向,
因为 attempts 有上限兜着,而漏扫没有上限。

## 放在 Vercel 而不是 Edge Function

retention 那条走 Vercel Cron → Edge Function,理由写在它的注释里:
「不想为了删库把 `SUPABASE_SERVICE_ROLE_KEY` 放进 Vercel」。
**那个理由在这里不成立** —— render-pdf 本来就要这把 key,已经在 Vercel 上了。
再绕一跳只是多一个会坏的地方。

`BATCH_CAP = 3`:这个函数自己 maxDuration 60 秒,单次渲染约 16 秒、冷启动更久,
三条并发约 20–25 秒,留了一倍余量。**必须 await** —— Vercel 的 Node 函数在 handler 返回后
会被冻结,没 await 的 fetch 会被取消,那样触发就成了「有时成功」,而那种不确定
正是这个 sweep 要消灭的东西。到上限时返回里带 `deferred`,不静默截断。

排期 `*/10 * * * *`。报告页轮询上限 60 秒,轮完会回到静态兜底文案,
所以 PDF 晚十分钟出现是可接受的 —— 客户重开报告页就看到了。
⚠️ **Vercel Hobby 只允许每天一次 cron**,如果账号是 Hobby,这条会被拒;
到时候改成 daily(兜底变慢但仍然自动)或升级。

## 反向验证:四次变异

| 变异 | 红的断言 |
|---|---|
| 按 `pdf_status <> 'ready'` 扫(把 `failed_permanent` 扫进去) | 「永远不挑 failed_permanent」 |
| 去掉 `attempts` 守卫(挑人边界 ≠ 收人边界) | 「永远不挑用完次数的行」 |
| 两个陈旧阈值对调 | 「rendering 的宽限必须比 pending 长」(**写死方向**的那条,判断标准 8) |
| 去掉 `computed_at` 回落 | 「`pdf_status_at` 还是 null 时回落 computed_at」 |

## 部署后怎么验:两条,不是一条

库里现有的行是 `ready`,sweep 应该扫到 **0 条** —— 那本身是第一条断言
(`scanned` 有数、`swept` 是 0,说明它跑了但没乱动),别把「没输出」当成「没跑」。

造给它扫的行,**两条路径都要造**,因为它们走的是不同分支:

```sql
-- ① failed:立刻重跑,不看年龄
update public.assessment_results
set    pdf_status = 'failed', pdf_attempts = 0, pdf_status_at = now()
where  session_id = '<那一条>';
```

```sql
-- ② pending + 时间戳往回拨:这才是 waitUntil 丢了的那一类,验的是陈旧判断
update public.assessment_results
set    pdf_status = 'pending', pdf_attempts = 0,
       pdf_status_at = now() - interval '10 minutes'
where  session_id = '<那一条>';
```

**只造 ① 是不够的**:`failed` 那条分支根本不看年龄,跑通它证明不了陈旧判断成立 ——
而陈旧判断正是这次为了 `pending` / `rendering` 新加一列的全部理由
([判断标准 7](#7-能不能区分-a-和-b必须两边都有样本):要证明「它能区分该扫和不该扫」,
两边都得有样本)。想更狠一点就再造一条 `pdf_status_at = now()` 的 `pending`,
**它必须【不】被扫到**。

⚠️ 两条 SQL 都带 `where`。不带的话会打到整张表 ——
症状是「别人的报告坏了」,不是「我的测试没跑通」(名单页那次的教训)。

## 未做 / 未验

- **未部署实测。** 「cron 真的被调用了、真的挑对了行」本地无处可测
  ([判断标准 4](#4-断言的边界必须等于执行路径)的后半条)
- 迁移 `20260808000000_pdf_status_at.sql` **未应用**。加一列可空、不回填,
  但仍是一次生产 schema 变更
- `assessment-ghl-resync` **至今没有排期** —— 它的文件头写着「由 Vercel Cron 定时调」,
  而 `vercel.json` 里只有 retention 和现在这条。那是 Stage 7 挂到 Stage 11 的那一项,
  这一轮没动

Node **243**(+14)/ Deno 124,八道门全绿。

---

# 分享卡

## 放什么、不放什么 —— 这是这个功能唯一重要的决定

| | |
|---|---|
| 放 | 总分、档位名、五边形的**形状**、品牌标识 |
| 不放 | 五个维度的分数、维度名、最弱维度、任何金额、任何他自己填的内容 |

**不放具体分数是因为那些是诊断,而诊断不该被公开对照。**
形状本身有辨识度又不精确 —— 那正是分享卡该有的信息密度:好看、可辨识、
但不构成对他公司的公开评估。往上加任何一维的分数,这张卡就从「我测了个好玩的」
变成「我把体检报告贴出来了」,而后者没人愿意发 —— **愿意发是这张卡存在的全部理由**。

所以那一组「卡上没有什么」的断言是**回归防护**,不是形式:以后谁往卡上加一个字段,它必须红。

## 两个尺寸,一次渲染

方形 1080×1080(朋友圈 / WhatsApp 状态)+ 竖版 1080×1920(IG / 小红书)。
两张渲在**同一页**上,截图器按元素 id 分别截 —— 一次 `page.goto`,多一次
element screenshot,边际成本只有几百毫秒。**所以「要不要两个都做」根本不是成本问题。**

尺寸与元素 id 的真相源是 `api/_lib/shareCard.ts`,页面与截图器同取一份
(方向按[「从这里开始」](#从这里开始--交接给一个没看过对话记录的人):`api/_lib` → 两边)。
各写一份的失败形态是截图器抛「找不到元素」,而那句话不会告诉你是 id 拼错了
还是页面没渲出来 —— 排查会从错的方向开始。

## 搭 PDF 的车,不另开一条管线

分享卡在 **render-pdf 的同一个浏览器实例里**顺手截掉。另开一条要把字体安装、
Lambda 环境注入、chromium 启动整套再写一遍([判断标准 3](#3-同一份东西存两处--先想能不能取消复制)),
还要多付一次冷启动(约 16 秒)。附带白拿了重试路径:
**Admin 的「重新生成」和定时 sweep 都会连带重渲分享卡**,不用再造一套。

**失败被关在三层里,一层都不许往外冒**:
渲染失败 → `renderShareCards` 自己 catch,只回一条 error;
上传失败 → 单独 catch,不抛;
两者都只写进 `share_card_error`,**`pdf_status` 该 ready 还是 ready**。
报告页那一块**只在图真的存在时才渲** —— 没出来就当它不存在,
为它显示一句「生成失败」只会让客户去操心一件与他的报告无关的事。
失败要被看见的地方是 Admin 名单页,那里有独立的一颗徽章和独立的一列 CSV。

这是「附属品的附属品」:PDF 失败只是少个下载按钮,分享卡失败只是少张图。
所以也**没有给它一整套状态机** —— status + attempts + failed_permanent 的维护成本
远大于它的分量,而且会让 sweep 的判断多出一个维度。只存「产物在哪」和「上次为什么没出来」。

## bare 模式:裁 viewBox,不动几何

`RadarPentagon` 加了一个 `bare` 开关(不画顶点标签、不画图例)。
第一版直接复用 520×330 那个画幅,渲出来五边形又小、下方又空出一大条 ——
**那个画幅的左右余量只为标签存在**,bare 没有标签就全是浪费。

改成 bare 时裁一个方形 viewBox,**`CX` / `CY` / `R` 一个都没动** ——
多边形的点完全一致,只是取景变了。这一点是硬要求:
分享卡的价值全在「这个形状是我的」,和报告里对不上就什么都不是。
另写一份轴计算正是[雷达那三轮](#雷达基准不重合结案视觉-bug不是数据也不是渲染)栽过的地方。

## 反向验证:三次变异,以及第三次没红

| 变异 | 结果 |
|---|---|
| 卡上加一个最弱维度的标签 | 「不含维度名」+「不点名最弱维度」红 ✅ |
| 雷达去掉 `bare`(维度名与各维分数一起泄露) | 三条隐私断言全红 ✅ |
| 方形卡宽度改成 1000px | **没红** ⚠️ |

第三次是这一轮最有价值的一次:那条断言只是在整段 HTML 里搜 `width:1080px`,
而**竖版卡的宽度也是 1080** —— 方形卡改坏了它照样绿。
改成先按 id 取到那一个元素再看它自己的 style,再跑同一个变异才红。
**断言的边界要落在「这一个元素」上,不是「页面上某处有这个串」**
([判断标准 4](#4-断言的边界必须等于执行路径) 在 DOM 上的又一次)。

顺带还有一次假红:第一版在整段 HTML 上搜维度分数 `4.1`,结果命中了 SVG 多边形的坐标
(`260,44.1`)。分享卡的成品是一张 PNG,**只有渲染出来的文字才可能泄露** ——
断言的边界要等于泄露的边界,所以改成先剥掉标签只看可见文字。

## 两道门当场咬人(判断标准 11 的又一例)

- **`lint:cjk`** 拦下了测试里的货币符号数组 `['RM','MYR','$','￥','元']` ——
  它们【是】被测对象,但 `src/**` 的规矩是字面量一律英文。按 `glyphCheck.test.ts` 的先例
  从码位构造(`String.fromCharCode(0xffe5)`)。
- **`check:deno`** 拦下了 `assessment-admin` 里那份**自己的** `RosterRow` 类型 ——
  前端那份加了 `share_card_error`,Deno 这份没加。Node 侧 tsc 全绿,只有 deno check 会红。
  这正是「[verify 靠人记得跑](#十一道门--每一道都是撞出来的)」那个已知洞会漏掉的东西。

## 未做 / 未验

- **未部署实测**:真的截出图没有、字体在截图里对不对、两个尺寸的构图在真机上如何
- **`20260808000100_share_card.sql` 未应用**。它放开 reports bucket 的 mime 白名单
  (原来只有 `application/pdf`)——**不应用的话分享卡会稳定上传失败**,
  而 `share_card_error` 里会写着 Storage 的原话
- 竖版卡的下半部分留白偏多,真机看过再决定要不要调

Node **255**(+12)/ Deno 124,八道门全绿。

---

# 字形自检的覆盖范围小于渲染范围

## 结论先说:™ 的方框我还没证到,但查出了两件确定的事

**① 卡上没有任何 `<img>`** —— 所以那个方框只可能是字形。品牌串
`AI 盈利增长罗盘™ 企业诊断` 里唯一的非汉字非 ASCII 字符是 **™ U+2122**。

**② subset webfont 确实缺 ™**(用 fontTools 查的 cmap,不是推测):

```
build/fonts/NotoSansSC-Regular.subset.woff2   U+2122  MISSING
assets/fonts/NotoSansSC-Regular.otf           U+2122  YES
```

成因:`scripts/subset-fonts.mjs` 扫 config / ui-strings 时只收 `0x4e00–0x9fff`(第 130 行),
™ 不在里面;而静态的 `NON_CJK_RANGES` 是 `…U+2000-206F, U+2190-21FF…` ——
**2070 到 218F 整段是空的,™ 正好掉在缝里**。
以前没撞上是因为 `name_zh` 在分享卡之前**没有任何页面渲染它**(唯一使用点是 `ShareCard.tsx`)。

## 但「加显式 fallback」这条修不动 —— 它本来就在

原本打算给品牌行显式加 `'Noto Sans SC'`。查了才发现 **字体栈里一直有**:

```css
--qai-font-head: 'Sora', 'Noto Sans SC Subset', 'Noto Sans SC', system-ui, sans-serif;
```

而 `assets/fonts/NotoSansSC-Regular.otf` 的 family name 就是 `'Noto Sans SC'`(name table 查证),
它有 ™,并且在渲染容器里被装进了 fontconfig。所以按这个栈,™ 应该由第三顺位接住。

**于是「为什么还是方框」反而更难解释了 —— 我不打算继续猜。**
查不下去的原因恰恰就是下面这件事:能回答它的那个仪器,没有覆盖那一页。

## 真正的问题:自检只跑在报告页上

`scanGlyphsInPage` 原来紧跟报告页那次导航之后执行,而分享卡是在**那之后**才 `goto` 的。
所以扫描完成时卡还没被渲染过。**缺一个字符是具体问题;扫描范围小于渲染范围是结构问题** ——
它让一个不完整的结论看起来完整。

## 修法:覆盖由运行时事实驱动,不靠手写清单

手写清单挡不住下一次 —— 再加一个渲染产物,清单照样要靠人记得改。所以:

1. **`framenavigated` 采集主 frame 真的导航过的路径**(注册早于第一次 goto)
2. 每扫一页,登记它的 pathname
3. 末尾把两个集合交给 `classifyGlyphReport(scan, { visited, scanned })`
4. 有「渲了却没扫」的路径 → `severity: 'incomplete'`,且**message 里点名是哪一页**

`'incomplete'` 与 `'inconclusive'` 刻意分开命名:后者是扫描压根没跑,前者是跑了但没跑遍 ——
该修的东西不同。`needsAttention` 把 `incomplete` 也算进去。

**覆盖缺口无论如何都附在 message 上**,不只在其他都干净时才说 ——
只在「否则就是 ok」时才报的话,一旦同时有 tofu,缺口就被吞掉了。

多页结果用 `mergeGlyphScans` 取并集而不是「取最严重的那一页」:
缺字是逐字符的事实,不是页面的属性,只留一页等于丢掉另一页的证据。

## 为什么没做成第八道门

考虑过加一道 grep `page.goto` 的构建门。没做,因为**运行时那个检查严格更强**:
门守的是源码写法(还能被 `page.evaluate('location=...')` 之类绕过),
运行时守的是**实际发生过的导航**。同一个目的,后者的边界就是执行路径本身
([判断标准 4](#4-断言的边界必须等于执行路径))。

这条已经立成[判断标准 12](#12-覆盖范围是手写的守卫会被代码悄悄长到边界外面--让覆盖由运行时事实驱动) ——
连同一个更难受的发现:**这个教训在栽第八次之前就已经写下来了**(Stage 4 那张表,第七次时记的),
只是写在交接必读之外的一张 Stage 表格里。**写在没人会先读的地方,等于没写。**

## 反向验证:四次变异

| 变异 | 红的断言 |
|---|---|
| 缺口只在 otherwise-ok 时才报 | 「有 tofu 时仍要报缺口」 |
| 有缺口仍然回 ok(还原原 bug) | 「干净但有页没扫 ≠ ok」+「要点名哪一页」 |
| merge 只取第一页 | 「取并集并求和」 |
| `needsAttention` 漏掉 incomplete | 「incomplete 也要告警」 |

## 下一步(等 PNG / 等部署)

- **subset 补 `U+2100-214F` 暂不做**:要重传 Bunny,而 zone 迁移未 cutover。
  部署后看 ™ 还在不在 —— 还在才动资产,没了就说明兜底接住了,那 subset 缺 ™ 只是理论问题
- 那张方形卡的 PNG **还没收到**(上一轮传来的是一份无关的 NurtureOS 信息图)

Node **265**(+10)/ Deno 124,八道门全绿。
# `is_test`:测试 / 演示数据与真实数据共存

## 为什么「单独一个 cohort」不够

`assessment-report` 取两个池:`cohortRows` 按 `entitlement.cohort_id` 过滤,
而 **`globalRows` 是全库所有 completed 结果,不按 cohort 过滤**;
`selectBaseline` 在同批次不足 `min_n_for_baseline` 时回落全局池。

所以把测试数据放进单独 cohort 只能让它不污染那个 cohort 的基准,**全局兜底照样被污染** ——
而真实学员在自己批次样本不足时走的正是全局兜底。

失败形态落在最不该出错的那一处:**新批次第一个学员的报告,基准是一堆假数据**,
而报告本身看起来完全正常 —— 没有报错、没有异常值,只有基准线悄悄偏了。

## 标在 cohort 上,不标在 entitlement 上

测试数据是整批造的、整批看的、整批删的。标在 entitlement 上要么每条都记得设,
要么写个 trigger 去同步,两者都是新的出错面。一个批次一个开关。

**不复用 `is_active`**:那一列管「这批还在进行中吗」,与「这批是假的吗」正交 ——
一个已结束的真实批次是 `is_active=false / is_test=false`,一个正在演示的假批次是
`is_active=true / is_test=true`。复用一列会让两个问题互相绑住。

**默认 `false`**,即新建批次默认是真实的,造测试数据的人必须显式声明。
这个方向有代价(漏标测试批次会污染真实基准),选它是因为:造数据是一个有意识的动作,
把标记当成那个动作的一部分是可控的;而默认 `true` 会让每个真实批次都依赖有人记得关掉它 ——
那是把风险挪到没人会想起来的地方。

## 分池抽成纯函数

新增 `_shared/baselinePools.ts`。原来这段就地写在 `assessment-report` 里,带着两个 `as any` ——
而「测试数据不许进全局池」这条规则一旦只活在一句 filter 里,**就没有任何东西能断言它**,
而它的失败是安静的。

三条规则,各有用例:

| 规则 | 为什么 |
|---|---|
| 全局池一律剔测试行 | 这个模块存在的理由 |
| 同批次池**不**剔 | 测试批次里的人,自己那批仍是他的基准 —— 现场模式演示时那份报告要像真的。测试数据只在**别人的**报告里才是污染 |
| 拿不到 cohort 时按「不是测试」处理 | 与列的默认值同向。反过来的话,一次写漏 `select` 的查询会把整个全局池清空,而那时基准 n=0,报告上只是「没有对比」,没人会怀疑是查询写漏了 |

⚠️ 查询里必须把 `cohort:assessment_cohorts(is_test)` 一路嵌下来 ——
少了它,`buildBaselinePools` 会把测试行当成真实行,而且**不会有任何报错**。

## Roster 与 CSV:两套规则,刻意不共享

- **名单页默认隐藏测试行,给一个开关。** 默认隐藏是因为运营看名单要的是真实学员;
  有开关是因为造完数据得能看见它们。显示出来时每行带一个「测试」徽章 ——
  **显示了却分不清,比不显示更糟**:运营会把演示记录当成真实学员去跟进。
- **藏了几条要说出来**(`testRows`)。不说的话「这批一条都没有」和「都被开关藏了」
  在页面上长得一模一样。
- **CSV 导出无条件剔除,不看那个开关,也不接受任何参数。**
  导出会被拿去做 GHL 分群 —— 测试行混进去就是**给假联系人发消息**。
  让一个前端开关的状态决定这件事,出错时没有任何迹象(导出成功、行数看起来也合理)。
  所以过滤放服务端、无条件。剔掉几条写进日志与返回值。
- **统计只看真实行**:号码解析失败率是运营阈值(>2%),而测试数据的号码是我们造的、
  必然干净 —— 混进去只会稀释比例,让一个真实的数据质量问题看起来不到阈值。
# 分享卡截进了 EN 按钮 —— 全局 chrome 的默认方向反了

## 现象与根因

方形卡右上角有个「EN」,那是语言切换按钮。**发到朋友圈的图上带一个 UI 控件,
看起来像截屏而不是设计好的卡片** —— 而这张卡的全部目的就是让人愿意展示。

根因不在卡里,**卡本身一个字都没错**:`LanguageToggle` 渲在 `<Routes>` 之外
(浮在所有页面上),靠它自己一份黑名单决定哪里不显示:

```ts
const HIDDEN_PREFIXES = ['/admin', '/_showcase'];   // ← /share-card 不在里面
```

截图截的是整个元素,DOM 里有什么就进图。这是[判断标准 12](#12-覆盖范围是手写的守卫会被代码悄悄长到边界外面--让覆盖由运行时事实驱动)的又一例,只是这次手写的是「哪里**不要**」:**路由长到了名单外面。**

## 修法:把默认方向反过来

新增 `PublicShell`(`<LanguageToggle /> + <Outlet />`),人面向的五条路由套进它;
`/share-card`、`/admin`、`/_showcase` 留在外面。`HIDDEN_PREFIXES` 整份删掉 ——
少一份要人维护的清单,`LanguageToggle` 也不再需要 `useLocation`。

| | |
|---|---|
| 之前 | 全局渲染 + 一份「哪里不要」的黑名单 → **新路由默认带 chrome** |
| 现在 | 只在 PublicShell 里渲染 + 要的人显式套进来 → **新路由默认不带 chrome** |

好处不在这一次,在下一次:**以后往 PublicShell 加页脚 / toast 容器 / cookie 提示,
都不可能漏到 `/share-card` 上**,因为那条路由压根不在这一层里 —— 不需要谁记得。

## 同类排查的结论

全仓 grep `fixed` / `createPortal`:**`LanguageToggle` 是唯一一处全局浮动 UI**,
没有页脚、没有 toast 容器、没有 portal、没有 cookie 提示。
所以这一次不存在「别的东西也漏了」;而「以后会不会」由上面那个方向解决,不靠这次的排查结论。

## 断言分两半,少哪一半都不够

| 测试 | 挂在哪 | 守什么 |
|---|---|---|
| `shareCardChrome.test.ts` | `MemoryRouter` + 真实 `AppRoutes` | **全局布局漏到卡上**(就是 EN 这次) |
| `shareCard.test.ts` 里那一组 | `ShareCardView` 直渲 | **卡面自己**混进交互元素 |

⚠️ **为此把 `AppRoutes` 从 `App` 里拆了出来**(`BrowserRouter` 留在 `App`)——
不拆的话断言只能落在卡组件上,而 EN 那次卡组件是无辜的([判断标准 4](#4-断言的边界必须等于执行路径))。

⚠️ **两半不能合并成一半**:SSR 下 `/share-card` 的 `ShareCard` 渲出来是 `null`
(数据是 `useEffect` 拉的),所以路由那一组**根本没看到卡面本身**。
两半合起来才等于「截图里不会出现 UI 控件」。

## 反向验证:三次变异

| 变异 | 红的断言 |
|---|---|
| 测试行也进全局池(还原「单独 cohort 就够」的错觉) | 三条,含「新批次第一个人走的正是这条路」 |
| 缺 cohort 时当成测试(默认方向反过来) | 三条 |
| 剔除顺手把同批次池也清掉 | 「测试批次里的人自己那批仍是基准」 |

## 未做 / 未验

- **迁移 `20260809000000_cohort_is_test.sql` 未应用**
- **造数据脚本还没写**(下一步)。要求:可重复跑、幂等、每个 tier 至少一条
- Stage 10 的四个模块的测试数据处理**已经定了,见下面那一节** ——
  结论不是「跟名单页一致」,聚合与名单的判据不同

Node **257**(+2)/ Deno **132**(+8),八道门全绿。
| `LanguageToggle` 回到 `Routes` 之外(还原原 bug) | 4 条,含「specifically carries no language toggle」与 /admin、/_showcase 那两条 |
| 把 `LanguageToggle` 整个删掉 | **反向锁**「客户页仍要有切换按钮」—— 没有它,删掉整个功能也能让上面全绿 |
| 卡面里混进一个 `<button>` | 卡面那一组 |

## ™ 结案

**™ 渲出来了**,之前那个方框是缩略图太小的误读。所以:

- `subset` 补 `U+2100-214F` **不做** —— fontconfig 兜底接住了,`subset` 缺 ™ 只是理论问题,
  不用为它动 CDN(zone 迁移未 cutover)
- 上一轮「兜底本来就在」的判断成立;那个「加了显式 fallback 看 ™ 会不会出来」的判别实验
  本来就没有前提,因为字体栈里一直有 `'Noto Sans SC'`

Node **262**(+5)/ Deno 124,八道门全绿。**Stage 9 至此收尾。**

---

# 造测试数据的脚本

`scripts/seed-test-data.ts`(`npm run seed:test` / `seed:test:clean`)。
15 条已答完的记录,放进一个 `is_test = true` 的批次。

## 四个设计决定

**① 批次由脚本自己建,不让人手动建。** 手动建的话总有一次会忘了勾 `is_test`,
而那个错误的症状是**新学员的基准里混了假数据**,没有任何东西会报错。
批次是这批数据的一部分,所以由造数据这个动作创建 —— 标记不是一个要人记得的步骤。
建完还**立刻回读 `is_test` 并断言为 true**:一个只写不读的关键标记就是没有被检查的标记
([判断标准 2](#2-打印一个值但不对它做判断等于没打印))。

**② 分数走真实 `computeResult`,脚本只挑 `option_index`。**
手写 `dim_scores` 的话:看板上的分布是假的分布;而且 config 改版(再调 `option_count`)时
这批数据会**静默变成另一个含义**,而真实数据会跟着改版走。
`option_index` 是不受标度影响的事实,分数不是 —— 这与 finalize「以 option_index 为准,
不信库里可能残留的 score」是同一条理由。

**③ 确定性 PRNG(mulberry32 + 固定种子),不用 `Math.random`。**
「可重复跑」要名副其实:同一个种子跑两次写的是同一批值,于是重跑是 upsert 覆盖,
而不是每次把 15 条的分数搅一遍 —— 那样看板上的数字会无缘无故变,而你会以为是代码动了。

**④ 不产出 PDF 与分享卡**,`pdf_status` 留在默认 `pending`。
15 份渲染约 4 分钟 + 一串 Chromium 冷启动,而 PDF 那一列的呈现在名单页已经验过。
要看真 PDF 就对其中一条点 Admin 的「重新生成」。

## 分档:随机,但每档至少一条

分布刻意不刻意 —— 随机本身就不会平均,而「偏态」没有真实样本支撑。
唯一的硬要求是五个档位都有样本,否则批次看板的档位分布图看不出东西。
脚本末尾**断言这一条**(缺档就抛,并说出缺哪几个),不是「大概会覆盖到」。

反推下标是**搜索**而不是闭式计算:总分 = 每题按 `option_count` 归一化 → 维度均值 → 五维均值,
而 `option_count` 有 3 和 4 两种。从档位中点起步、不中就朝区间中心收,上限 40 次
(实测都在个位数次内命中);跑满就抛,并提示先看 config 的 tier 区间是不是变窄了。

## 三条「像假的」的硬要求

| | 做法 | 为什么 |
|---|---|---|
| 姓名 / 邮箱 | `seed-test-01` / `seed-test-01@seed.invalid` | 万一开关坏了、测试行漏到名单上,要**一眼**认出来,而不是去查 cohort |
| 手机号 | `+6012345xxxx`,**造完过一遍 `normalizePhone` 并断言非 null** | 用假号码会污染「号码解析失败率」那个运营阈值 —— 而 admin 特意把统计限定成只看真实行,不能在造数据这一步又绕回来 |
| `access_token` | 由 id 派生的 sha256(**可预测,这里接受**) | 幂等需要它确定。后果是读过脚本的人能算出这 15 条的报告链接 —— 而那些报告的数字全是编的、批次标着 is_test。**不要把这个做法搬到真实记录上** |

## 它绕过 finalize —— 这一点必须知道

直接写库,所以**不经过** GHL 写回与 PDF 异步触发。换来的是不给假联系人发消息、不烧渲染;
代价是这批数据**验不了那两条路径**(它们各有自己的验证:Stage 7 的实测、Stage 9 的 sweep)。
问卷那一段与 `saveSurvey` 用同一套 `mapOption` / `mapOptions`,并断言 required 的字段一条不缺 ——
config 以后加一道 required 问卷题时会当场抛,而不是静默写进一份缺字段的 survey。

## 清理

`--clean --yes`:按 `seed-test-` 前缀删 entitlement,cascade 带走 session / answers /
survey / results,再删那个批次。**`--clean` 与 `--dry-run` 互斥** ——
清理没有预演模式,两个开关一起给多半是手滑。删了几条会打出来:
「删完了」与「一条都没匹配上」必须能区分。

## `check:env` 当场咬人(判断标准 11 又一次)

第一版写的是 `env('SUPABASE_URL')`,里面 `process.env[name]` 动态取值 ——
`check:env` 直接红:「键不是字面量,静态扫不到 …… 漏掉的清单比没有清单更糟」。
改成与 `api/render-pdf.ts` 同样的字面量清单写法。
**新脚本第一次跑门,红的是自己刚写的那一行。**

## 未验

- **脚本没有对真库跑过** —— 只跑了 `--dry-run`(不碰数据库,15 条全部算出、五档齐、
  号码全过断言)。真跑要先 `db push` 三条迁移(`pdf_status_at` / `share_card` / `cohort_is_test`)
- 跑完先确认 is_test 那一轮的三条验收:**Roster 默认隐藏、开关能显示且带「测试」徽章、
  CSV 导出不含它们** —— 这三条至今没实测过

Node **274** / Deno **132**,八道门全绿。

---

# 轮换 anon key 时最容易漏的一步

## 症状不会告诉你原因

`VITE_SUPABASE_ANON_KEY` 是 **build-time** 的:Vite 构建时把它替换成字面量编译进 `dist`。
所以轮换 key 之后**只改 Vercel 环境变量是不够的,必须重新构建 + 部署**。

漏了这一步的症状是 **Admin 登录坏掉** —— 前端拿着一把已失效的 anon key 去 Supabase Auth,
拿回来的是一个语义无关的鉴权错误。**没有任何一处会说「这把 key 旧了」。**

这与「`supabase secrets set` 成功 ≠ 函数拿到新值」是同一族:
**两个东西属于同一个部署,却各自按不同的时刻取值。** 已记进[「从这里开始」](#从这里开始--交接给一个没看过对话记录的人)
的走位常识,紧挨着那一条。

## 守它的那条 smoke 检查

手法**照抄 `api/font-probe.ts` 的 `checkBundleBase`** —— 这个项目已经解决过同一类问题一次
(网页从一个 CDN 取字体、PDF 从另一个取)。抓自己站点的 HTML → 模块脚本 →
在 JS 里找那个字面量,与本地的 `SUPABASE_ANON_KEY` 比对。

放 `npm run smoke` 而不是构建门:**这条路径本地不存在** ——
要有一份真的线上产物才能比([判断标准 4](#4-断言的边界必须等于执行路径)的后半条)。

三条设计细节:

- **anon key 可以这样比,`service_role` 绝不可以。** anon 本来就是要发到浏览器的公开凭证,
  拿它比对不额外泄露任何东西;service_role 连截断都不该出现在冒烟输出里
- **拿不到本地值时报 `unverified`,并且算失败。** 让一次「没法比」伪装成「比过了」
  正是这套检查最该避免的事(与 `font-probe` 同一个取向)
- **错误里报 sha256 前 8 位 + 从 payload 解出的 `iat`**,不报 key 的任何片段

## 那条错误消息的第一版是废的

第一版报的是两边各头 12 个字符。而 **JWT 的头部对同一个 alg 完全一样**,于是输出成了:

```
bundle=eyJhbGciOiJI… local=eyJhbGciOiJI…
```

**门确实红了,可它说的话没法照着行动** —— 判断标准 9,而且这次犯的人是刚写完那条标准的我。
**是真跑了一次红路径才发现的,不是读代码读出来的**:正向绿、反向红两条都跑,
第一版的反向输出摆在眼前才看出它没有信息量。

改成 fp + iat 之后:

```
bundle: fp=9a7c2fa4 iat=2023-11-14 | local: fp=afe8151a iat=2026-08-06
```

`iat` 直接回答「哪一把是旧的」,`fp` 让重新部署之后能确认两边相等。

## 顺带确认过的事实(轮换前查的,不是记忆)

| | |
|---|---|
| 仓库里有没有真值 | **没有**,`.env.example` 五行全是空占位符 |
| supabase-js 2.110.8 认不认新 key | **认**,`@supabase/functions-js` 里写明 `sb_publishable_` / `sb_secret_` 不走 Bearer。所以 `createClient` 那四处迁移时不用改代码 |
| 迁新 key 要改哪几处 | **三处手写 header**:`api/[...path].ts:131`、`api/cron/retention.ts:48`(新 key 不能进 `Authorization: Bearer`),以及 `_shared/supa.ts`(Edge Function 侧注入的是 `SUPABASE_SECRET_KEYS`,**JSON 对象**不是字符串) |
| 轮换 legacy JWT secret 的连带 | anon 与 service_role **同时**失效;Admin 全部要重新登录(access token 用 JWT secret 签);**客户答题 session 不受影响**(我们自己的 HMAC,用 `SESSION_SECRET`)、魔法链接 `access_token` 与渲染令牌同样不受影响 |

⚠️ 官方 troubleshooting 页面有一句说「已经不再可能轮换 legacy anon / service / JWT secret」,
推荐直接迁移。**界面上有按钮不等于可用** —— 点之前先确认,报错的话迁移就得提前。

---

# 迁到 publishable / secret keys(legacy 已不能轮换)

## 为什么这不是可选项

service_role key 泄露。Legacy 那个 tab **没有 regenerate 按钮** ——
只有 anon(Copy)、service_role(Reveal),和下方的 "Disable JWT-based API keys"。
官方文档也这么说。**所以补救路径只有一条:迁到新 key,然后 Disable legacy。**

⚠️ **Disable 是可逆的**(官方:迁移期内可随时 disable / re-enable),而且
**anon 与 service_role 只能一起 disable**,没有分开的开关。

⚠️ **Disable ≠ 那把泄露的 key 被销毁。** 它是「停用,而且任何有后台权限的人能再打开」。
真正的销毁要等 legacy JWT secret 被 revoke(那是迁到 JWT signing keys 之后的另一件事)。
所以按下 Disable 之后的正确心态是「已止血」,不是「已作废」。

## 代码改了哪些,以及为什么不是一刀切

**一刀切会毁掉「开回来」这条退路。** Disable 可逆意味着出问题要能回滚,
而回滚之后代码得照样能跑。所以**两代并存,新的优先**:

| 位置 | 改动 |
|---|---|
| `api/_lib/apiKeys.ts`(新) | 判代次 + 决定发哪些头 + 两代挑选。**三个运行时共用一份** |
| `_shared/apiKeys.ts`(新) | Deno 侧一行 re-export(照 renderToken 的先例) |
| `api/[...path].ts` | 头由 `supabaseKeyHeaders()` 决定;key 由 `pickPublishableKey()` 挑 |
| `api/cron/retention.ts` | 同上,共用同一份判断 |
| `_shared/supa.ts` | `pickSecretKey(SUPABASE_SECRET_KEYS, SUPABASE_SERVICE_ROLE_KEY)` |
| `api/render-pdf.ts` / `api/cron/pdf-sweep.ts` | `pickSecretKeyFromPlainEnv()` |
| `src/lib/supabase.ts` | `pickPublishableKey(VITE_…_PUBLISHABLE_KEY, VITE_…_ANON_KEY)` |
| `scripts/seed-test-data.ts` | 同上 |
| `scripts/smoke-deploy.mjs` | bundle 比对改成两代都接受(否则迁移后**假红**) |
| `scripts/check-env.mjs` | 豁免平台注入的 `SUPABASE_SECRET_KEYS`;新增「二选一」标签 |

**核心那条规则**:legacy 是 JWT → `apikey` **和** `Authorization: Bearer` 都发;
新 key 不是 JWT → **只发 `apikey`**,进 Bearer 会被拒。
判错的失败形态是**鉴权被拒**,而鉴权被拒从来不会说「你把 key 放错头了」——
所以它有用例,四次变异都咬得住(新 key 也发 Bearer / legacy 不发 Bearer /
优先顺序反过来 / 未知值当成新格式)。

**「至少有一个」不是「都要有」**:三处 `missing` 检查都改了。
把新变量并进「全都必须有」里,等于在配它之前就先 500 —— 滚动迁移根本走不通。

**`check:env` 的清单原来在说假话**:两代都标「必须配置」,而实际是二选一
(挑选逻辑在函数里,静态扫不出来);`SUPABASE_SECRET_KEYS` 被标成要人配,
而它是平台注入的。这道门的全部理由就是「清单必须可信」,所以两条都修了 ——
只改标签,不放宽任何检查。

## 操作顺序(每一步都有退路)

```
1. 合这条分支 + 部署      ← 此时仍然吃 legacy,行为零变化
2. Supabase 后台创建 publishable + secret key
3. Vercel 加 4 个新变量(见下),legacy 那几个【先别删】
4. 重新构建 + 部署         ← VITE_ 是 build-time,这一步不能省
5. npm run deploy:functions ← Edge Function 要拿到 SUPABASE_SECRET_KEYS
6. 按下 Disable JWT-based API keys
7. 跑下面那份验收清单
8. 有一条不过 → 立刻 re-enable,回来看日志;全过 → 删掉 legacy 那几个变量
```

**Vercel 要加的是 3 个,不是 4 个**(legacy 那 3 个先留着当退路):

| 变量 | 值 |
|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 同 publishable。⚠️ **build-time**,改完必须重新构建 |

**本地 shell** 另外要设 `SUPABASE_SECRET_KEY`(给 `npm run seed:test` 与 `npm run smoke`)——
那是**同一个变量名的另一处位置**,不是第四个变量。
> 这张表的第一版把它列成了「Vercel 要加的第 4 个」,而它既不在 Vercel、
> 也和第 2 行同名。数变量的时候按【平台 × 名字】数,不是按行数数。

**Supabase Edge Function 侧一个都不用配。**
`SUPABASE_SECRET_KEYS`(**复数**,按名字索引的 JSON)与 `SUPABASE_URL` 一样是**平台注入**的 ——
`check:env --print` 里它标着「平台注入」,而那条豁免的理由就写着「写进 .env.example
会让下一个人以为要手动配一个平台变量」。
但**必须重新部署函数**:平台注入的变量在旧实例上不会变。

权威清单以 `node scripts/check-env.mjs --print` 为准 —— 它是**从代码推导**的,
而这张表是手抄的。两者不一致时信前者(手抄的那份刚刚就错过一次)。

## Disable 之后的验收清单

⚠️ **为什么必须在 Disable 之后跑,而不是之前。**
两代 key 并存时,**你无法分辨流量走的是哪一代** —— legacy 还有效,所以一条请求成功
既可能是新 key 起了作用,也可能是它悄悄回落到了 legacy。
Disable 是唯一能把两者区分开的动作([判断标准 7](#7-能不能区分-a-和-b必须两边都有样本):
要证明「能区分 A 和 B」,另一边必须也有样本)。
**Disable 之前 smoke 全绿,只证明「有一代能用」,不证明「新的那代能用」。**

**判据不是「代码改了」,是「Disable 之后每一条都真跑过」。**
每条都写明怎么跑、看什么。⚠️ 任何一条不过,先 re-enable 再排查 —— 别边坏边查。

| # | 路径 | 怎么跑 | 通过标准 |
|---|---|---|---|
| 1 | **代理链 + bundle key** | `SUPABASE_PUBLISHABLE_KEY=… npm run smoke -- --base <域名>` | 6/6 通过。**含 bundle 那条** —— 它同时验了「重新构建过」 |
| 2 | **Admin 登录** | 浏览器走一遍魔法链接登录 | 进得去名单页。这条走 `src/lib/supabase.ts` 那把 publishable key |
| 3 | **名单页取数** | 登录后看 Roster | 15 条 seed + 真实行都在。这条走 `assessment-admin` → `_shared/supa.ts` 的 secret key |
| 4 | **答题 → 报告** | 用一条 seed 的链接打开 `/report` | 报告完整。走 `assessment-report` + 代理链 |
| 5 | **PDF 渲染** | 对一条 seed 点 Admin「重新生成」 | `pdf_status` 变 `ready`。走 render-pdf 的 secret key + Storage |
| 6 | **分享卡** | 同上那次渲染 | 报告页出现两张卡(与 PDF 同一次渲染产出) |
| 7 | **GHL 写回** | `curl -X POST <SUPABASE_URL>/functions/v1/assessment-ghl-resync -H "apikey: <publishable>" -H "X-Internal-Secret: …"` | 200。⚠️ **这一条【验不了】key** —— 已实测推翻:apikey 写成没替换的占位符,请求照样通、照样回我们函数的 JSON。原因是所有函数都 `verify_jwt = false`,**网关不校验那个头**(鉴权全在函数内部:这里是 `X-Internal-Secret`)。原文写着「同时验了网关认不认新 key」,那是错的。key 对不对由 `npm run smoke` 的**字符串比对**和 Admin 登录(走 Supabase Auth)验 |
| 8 | **cron: retention** | `curl <域名>/api/cron/retention -H "Authorization: Bearer $CRON_SECRET"` | 200。**这条专门验 header 那个改动** —— 它是手写 apikey 的两处之一 |
| 9 | **cron: pdf-sweep** | `curl <域名>/api/cron/pdf-sweep -H "Authorization: Bearer $CRON_SECRET"` | 200 + `scanned` 有数。走 Vercel 侧 secret key |
| 10 | **seed 脚本** | `SUPABASE_SECRET_KEY=… npm run seed:test`(**不是 --dry-run**) | 15 行 + `cohort … (is_test=true)`。⚠️ **`--dry-run` 验不了 key**:那条路径下 `supa = null`、`requireEnv()` 压根不会被调用。而重跑真实模式是安全的 —— 脚本本来就幂等(固定种子 + upsert),重跑写的是同一批值 |

**第 1、8 条是这次改动的直接靶子**(手写 header 的两处);
**第 3、5、7 条是 Edge Function 侧 `SUPABASE_SECRET_KEYS` 的靶子**;
**第 2 条是 build-time 那条的靶子**。其余是回归。

⚠️ **第 8 条别只看 200。** retention 会真的删过期数据 —— 那是它的正常职责,
但要知道你按了它。只想验 header 不想触发清理的话,看 Vercel 日志里那次
cron 的既有执行记录也行,只是那不算「Disable 之后跑过」。

## 没做完的

- **没有对真环境跑过任何一条** —— 我这边没有凭据。上面十条要你按顺序跑
- Vercel 的 legacy 变量在第 8 步之后才删。删之前那三个是唯一的退路
- 之后还有一件独立的事:迁到 **JWT signing keys** 并 revoke legacy JWT secret ——
  那才是让泄露的那把 key **永久失效**的一步。单独排

Node **287**(+13)/ Deno 132,八道门全绿。

---

# 测试数据的收口(两个出口 + 一处选行)+ 第八道门

## 收在哪,由「这个出口上两种来源的答案一样吗」决定

按[判断标准 13](#13-过滤的判据是请求的来源不是数据的属性):

| 出口 | 两种来源的答案 | 所以收在 |
|---|---|---|
| `syncToGhl()` | **相同** —— 谁发起都不该对假 contact 发请求 | **这个出口**(resync + finalize 都覆盖) |
| `sendMagicLink()` | **相同** —— 谁发起都不该对假联系人发消息 | **这个出口**(Admin 重发 + login-request 都覆盖) |
| PDF 渲染 | **不同** —— cron 该跳过,Admin 点按钮该照做 | **pdf-sweep 的选行处**,不是 `render-pdf` |

**在出口收口的价值不在这一次,在下一次**:Stage 11 的 tags 一定走 `syncToGhl`,
所以它**在写出来之前就被覆盖了**。而在 resync 的选行处加过滤只挡住 resync,
tags 会再漏一次 —— 那就是「发现一处补一处」。

## `syncToGhl` 里怎么表达「跳过」

复用 D9 的 **CONFIG** 类,不加新状态:

```
ghl_next_retry_at = null
ghl_last_error    = 'CONFIG: test cohort — writeback intentionally skipped'
```

CONFIG 的语义本来就是「重试一万次也没用」,而 sweep 已经会跳过 CONFIG ——
**这一点在真实数据上验过**(第二次调用回 `nothing due for retry`)。
**不用 `ghl_synced = true` 表示跳过**:那是在数据里说谎。

## 判断的方向:只认 `true`

`isTestCohort()` 只在 `is_test === true` 时回 true;null / 缺字段一律「不是测试」。
反过来的话,**一次写漏 `select` 的查询会把所有真实数据都当成测试数据跳过** ——
而那种「什么都不发了」的故障会安静地持续到有人投诉。回 false 的方向是「照常发」。

## 代价:每次外发前多一次 DB 查询

接受。**不要为了省这一次查询而把判断交给调用方传参** ——
那就又回到「调用方必须记得」,也就是这一整条的病因。

## 第八道门:`check:doc-anchors`

它自己就是一次教训:**这个检查以前是每轮手打一遍的临时脚本**,而它的 slug 算法
把标题里的下划线删掉了(GitHub 保留)—— 于是 `#is_test…` 那条正确链接被**假红**过一次。

进仓库之后**第一次跑抓到 27 处,而其中 22 处是门自己的错**:新写的 slug 用 `\s+`
折叠了连续空白,而 GitHub **每个空白各转一个 `-`**(` —— ` → `--`)。
**判断标准 11 又一次,而这次红的是我刚写完那道门的算法。**

另一处自我修正:第一版把**所有**重名标题都报错,而文档里有好几组没人链接的同名小节
(`## 修法`、`## 未做 / 未验`)。为那个失败构建就是误报,**而误报会让人开始习惯性
忽略这道门** —— 改成只在**真的有链接指向**那个重名 slug 时才报。

四次变异反向验证:改坏一条链接 ✅ / 改一个被链接的标题 ✅ /
造一个被链接的重名标题 ✅ / 造一个**未被链接**的重名标题 → **保持绿**(误报抑制生效)。

## 未做 / 未部署

- **收口没有对真环境跑过** —— 要 `npm run deploy:functions` 之后才生效
- 部署后的判据:再跑一次 resync,应当回 `nothing due for retry`(那 15 条已经是 CONFIG);
  而**新造一批 seed 之后再跑**,它们应当**一次 GHL 请求都不发**,
  `ghl_last_error` 里是 `CONFIG: test cohort — skipped`
- pdf-sweep 的判据:返回里的 `skippedTest` 应当等于测试行数,`swept` 不含它们

Node **290**(+3)/ Deno 132,**八道门**全绿。

---

# Stage 10 开工前定下的一条:聚合数字不受开关控制

## 问题

名单页那个「显示测试数据」开关只影响那张表。Stage 10 的漏斗监控与批次聚合看板
要不要也受它控制?**现场模式会把聚合数字投影出去,而那是最不该出错的地方。**

## 结论:不用开关控制聚合,用【批次范围】

**聚合一律按批次(cohort)取,而「全部批次」这个视图无条件剔除测试批次;
那个开关只决定测试批次**能不能出现在选择器里**,不决定它**混不混进数字里**。**

| | 开关控制聚合(不采用) | 批次范围(采用) |
|---|---|---|
| 看某个真实批次 | 要记得关开关 | 天然不含测试数据 |
| 看演示批次 | 要记得开开关 | 显式选它 |
| 「全部批次」 | 开关一变数字就变 | **永远不含测试数据** |
| 出错的样子 | **一个混合过的数字,看起来完全正常** | 「你还没选批次」——看得见 |

## 为什么不用开关

**这与你给 CSV 定的那条是同一条理由**:让一个 UI 开关的状态决定一个数字的含义,
出错时没有任何迹象。CSV 的后果是给假联系人发消息;聚合的后果是
**投影出去的数字混了假数据,而它看起来完全正常** ——
两者都属于「错了也不会有人当场发现」。

而且开关这种**模式**已经在这个项目里连坑三次(测试数据被 sweep、被 resync、
被基准线当成真数据)。差别在于:开关让错误状态**可表示**,而批次范围让它
**不可表示** —— 后者不需要任何人记得。

## 与判断标准 13 的关系:这是另一个轴

[判断标准 13](#13-过滤的判据是请求的来源不是数据的属性) 的判据是「谁发起的」。
但聚合看板的两种用途(运营看真实批次 / 演示投影)**都是有人请求**,
所以那个判据在这里区分不出来。

真正区分它们的是**「这个数字是关于哪一群人的」** ——
而那正好由批次范围表达。所以这一条不是判断标准 13 的应用,是它旁边的一条:
**当「谁发起」区分不出来时,看那个结果是关于哪个总体的,把总体做成显式参数。**

## 落到代码上(等模块真的写的时候)

- 聚合查询**必须带 cohort 范围参数**,没有「默认全部」这种隐式状态
- 「全部批次」这个选项在服务端展开成「所有 `is_test = false` 的批次」,
  **不是「不加过滤」** —— 两者的差别就是这一整条
- 判断仍然走那个共享谓词 `isTestCohort`(`api/_lib/testCohort.ts`),不另写一份
- **暂不预先加聚合专用的辅助函数**:四个模块还没写,现在抽出来的形状大概率是猜的。
  等第二个模块要用同一段查询时再抽(与 `entitlementStatus` 那次同一个时机判断:
  出现第二个调用点的那一刻才取消复制)

## 现在库里的数据

15 条 seed(五个 tier 各三条,在 `is_test = true` 的批次里)+ 2 条真实。
**看板与漏斗因此有数据可看,但「全部批次」视图应当只看到那 2 条** ——
这本身就是第一个模块最好的第一条验收。

---

# Stage 10-1:批次聚合看板

## 阈值不下在「显示 / 不显示」上,下在【说法的性质】上

这是这个模块最重要的一条设计。

**平均值永远是事实**(「这 2 个人的平均分是 3.1」为真);
**比例是关于总体的断言**(「60% 在这一档」暗示了一个可推广的分布)。
n=2 时前者仍然可读,后者是误导。

所以:

| n | 给什么 |
|---|---|
| `n < min_n_for_baseline` | **只给计数**。比例字段(`topShare`)**根本不在响应里**,是 `null` |
| `n ≥ min_n_for_baseline` | 附上比例 |

**「前端渲不出百分比」不是因为前端记得别渲,是因为那个数字不存在。**
(与判断标准 15 的推论同一个取向:让错的状态不可表示。)

**为什么不按面板设阈值**:按数量给每个面板定阈值是任意的,而且不指向任何动作 ——
这条判断在 `glyphCheck` 的分级注释里写过一次(「按成因分,不按数量分」)。
「计数 vs 比例」是成因;「n≥3 才画雷达」是任意数字。

**阈值复用 `config.cohorts.min_n_for_baseline`(=10)**,不另立常量:
它的语义本来就是「样本够到可以做群体判断」。
⚠️ 但**行为与报告页刻意不同**:报告页在同一阈值下**隐藏**整个 cohort_rank 板块
(给学员看,少一块好过给一个不可靠的分位);看板**明说「样本不足」而不是静静少一块**
(给运营看,少一块会被当成功能坏了)。**受众不同,选择不同。**

## n=2 的验收判据(现在库里就是这个状态)

真实批次只有默认批次 2 人,测试批次 15 人。所以「全部批次」= 2 人。
**那不是 bug,下面这张表就是验收清单:**

| 板块 | n=2(全部批次) | n=15(选中测试批次) | n=0 |
|---|---|---|---|
| 范围选择器 + 人数 + 平均总分 | ✅ 正常(平均值是事实) | ✅ | 只显示人数 |
| 「样本不足」提示条 | ✅ **出现**(2 < 10) | ✅ **出现**(15 ≥ 10 → **不出现**) | — |
| 五维平均雷达 | ✅ 正常(它是平均值) | ✅ | ❌ 整块不渲 |
| 档位分布 | ✅ 只有人数,五档含 0 | ✅ 人数 | ❌ |
| 最弱维度分布 | ✅ 只有人数 | ✅ | ❌ |
| 每题选项分布 | ✅ 只有人数,按集中度排序 | ✅ | ❌ |
| **任何百分比** | ❌ **一处都不该出现** | ✅ 可以出现 | — |
| 测试批次警告条 | 不出现 | ✅ **必须出现** | — |
| n=0 时 | — | — | 只有「这个范围里还没有人完成测评」 |

**最后两行是这次验收真正要看的**:选中测试批次时那条黄底警告必须显眼 ——
看板的数字会被投影给一屋子人,而忘了自己在看假数据的代价比名单页大得多。

## 每题选项分布:按集中度排序,因为用途决定排序

**这条是上课素材,不是统计报表。** 一道全场都选同一个选项的题是当天最直接的开场;
而「造流量平均 2.8」讲不出东西。所以最一边倒的排最前。

集中度 = 最多那个选项的占比,**分母是这一题的实际作答数,不是批次人数** ——
有人没答完,拿 n 当分母会低估集中度(有用例钉住)。
集中度相同时按题号排,保证同一批数据两次请求顺序一致 ——
不定序的输出会让「看板变了」与「数据变了」分不清。

## 反向验证:五次变异

| 变异 | 红的断言 |
|---|---|
| 样本不足时也给比例 | 「比例字段是 null」+「topIndex 总是给」 |
| n=0 时平均分回 0 | 「n=0 是 null 不是 0」 |
| 用 n 当分母算集中度 | 「answered 与 n 可以不等」 |
| 阈值写成 `>` 而不是 `>=` | 三条(含边界那条) |
| 去掉集中度相同时的 tie-break | 「两次请求顺序一致」 |

## 未做

- **没有对真环境跑过** —— 上面那张表要你登录看
- 漏斗监控 / 现场模式 / 问卷洞察三个模块未开始。
  它们复用同一条范围约束(`cohort_id` 必填、`'all'` 服务端展开)
- **聚合专用的辅助函数暂不抽** —— 等第二个模块要用同一段查询时再抽
  (与 `entitlementStatus` 那次同一个时机判断:出现第二个调用点的那一刻)

Node **290** / Deno **147**(+15),八道门全绿。

---

# Stage 10-1 的四处修正(三处布局 + 一处功能)

## 布局三处:都是为「一眼看出全场卡在哪一档」服务的

**① 选项文本被截断 —— 截掉的恰恰是有用的那半句。**
上一版用 `w-40 truncate`,于是「有内容在成交前就讲清…」这种标签被切掉。
而 **C2 的第 3、4 档差别全在后半句** —— 看不清选项文本,这块就完全失去用途。
改成**标签整行铺开放在条形上方**(选项是整句话,不是短标签)。
档位 / 最弱维度那两处的标签是短标签,仍然留在左侧 —— 两种布局按标签的性质分,不是一刀切。

**② 人数被拆成两行。**「6 人」变成「6」一行「人」一行,因为那一列既没定宽也没 `nowrap`。
**数字与单位分开就不是一个数了。** 改成 `w-14 shrink-0 whitespace-nowrap`。

**③ 一屏只看到四题。** 这块的用途是**扫**,不是精读。
既然已经按集中度降序排过,**默认只展开前 5 题**,其余折叠并写明「展开其余 10 题」。
条形高度与卡片间距一并压缩。

## 一处功能:「查看报告」按钮从来就没有启用条件

它是**硬编码 `disabled`** 的 Stage 8 占位(`title="Stage 8"`)——
所以点「重新生成 PDF」永远不可能让它变。

**启用条件定成「有 result」,不是 `pdf_status = ready`。**
报告页读的是 `assessment_results`,与 PDF 渲染无关 ——
**PDF 失败的人报告照样能看**,那正是整条异步化的取向。

### 点开之后走的是哪条身份

**签一条 180 秒的渲染令牌,不碰学员自己的 `access_token`。**

| 方案 | 为什么不用 / 用 |
|---|---|
| 学员的 `access_token` | ❌ 长期凭证、不自动过期、可转发。交到 Admin 手上就多了一份**与学员手里完全等价**的链接,而且没法区分谁看过 |
| `renderToken`(PDF 渲染器那条) | ✅ HMAC、绑定单个 session、**TTL 180 秒**。一条只活三分钟的链接**存不住** |

**这个能力唯一的审计痕迹是那行 `console.log`**:
`admin <email> opened the report for session <id> (render token, ttl 180s)`。
没有它就是「Admin 能静默看任何人的报告」—— 那种能力不该没有记录。
前端每次点击都**现签**,不缓存 URL(与报告页下载 PDF 同一个取向:
把「会过期」变成不存在的问题)。

## 反向验证:四次变异 + 一次假红

| 变异 | 红的断言 |
|---|---|
| 选项标签改回 `truncate` | 「不含 truncate 类」 |
| 人数列去掉定宽与 nowrap | 「每个人数格都是 nowrap + 定宽」 |
| 默认全展开 | 「默认只展开 5 题」+「写明还有几题」 |
| 0 人也画 3px 假条形 | 「0 人不画条形」 |
| 按钮改回硬编码 `disabled` | 三条(ready / failed / pending 各一条) |

⚠️ **一次假红,以及它暴露的一个原理性限制。**
「查看报告是否禁用」第一版搜子串 `"disabled"` —— 而 className 里有 Tailwind 的
`disabled:pointer-events-none`,于是三条断言全部假红。改成匹配 `disabled=""` 属性。
**断言的边界要落在属性上,不是整段字符串上。**

⚠️ **更要紧的一条**:变异 1 只被「不含 truncate 类」咬住,
而那条**看起来更强**的「完整选项句出现在可见文字里」**照样绿** ——
因为 **CSS 截断不会把文字从 DOM 里删掉**,`renderToStaticMarkup` 看不到 CSS。
所以静态断言**原理上**验不了截断([判断标准 10](#10-用-css-表达的意图没有渲染断言就要假设它没生效))。
那条类名断言是**代理指标**,不是被测行为本身 —— 已写进测试注释,
免得下一个人以为那条更强的断言在做这件事。真正验截断要量渲染宽度,那需要浏览器。

## 你还没验的两条

- **「全部批次」**:应当是 2 人 + 「样本不足」提示 + **零百分比**。
  上次看到的是测试批次(15 人)的分布 —— 切回「全部批次(不含测试)」再看
- **测试批次的黄底警告**在页面上方(范围选择器下面第一块),截图截中段会漏掉

Node **302**(+12)/ Deno 147,八道门全绿。

---

# Stage 10 剩下三个模块:开工前定死的几件

## ① 看板只算 completed —— **这条不能照抄进漏斗**

看板的取数带着 `.eq('session.status', 'completed')`,**是有意的**:
平均分与分布只能由答完的人构成。文案也写着「本批 N 人**已完成**」。
所以「2 条真实记录里 1 条 PENDING 没答完 → 显示 1 人」是正确行为。

⚠️ **但漏斗要的正好相反。** 它必须包含**每一个人**,包括:
- 连 session 都还没有的(`pending` / `link_sent` —— 那些人没登录过,`assessment_sessions` 里没有行)
- 登录了但一题没答的

所以**漏斗的取数起点是 `assessment_entitlements`(左连 session / answers),
不是 `assessment_results`**。照抄看板那条查询会得到一个「只统计已完成的人」的漏斗 ——
而那个漏斗的每一段都会是 100%,恰恰是要避免的东西。
**这是三个模块里最容易照抄错的一处。**

## ② 漏斗:「已付款」是基数,不是分段

**查证结论**:`assessment-ghl-webhook` 的文件头原话是「GHL **付款** workflow 的 webhook 入口」——
所以 **「已付款」≡ entitlement 这一行存在**。把它画成一段,那一段永远 100%。

而 `entitlement.status` 只有四态,**「已登录」与「已开始答题」在 status 上是同一个事件**
(`assessment-auth` 同时盖 `first_login_at` 与 `status='started'`)。
但它们**在数据上是可分的** —— 靠别的表:

| 分段 | 判据 | 来自 |
|---|---|---|
| 已付款(**基数**) | 行存在 | `assessment_entitlements` |
| 已发链接 | `link_sent_at` 非 null | `sendMagicLink` 一定会盖 |
| 已登录 | `first_login_at` 非 null | `assessment-auth` |
| **已开始答题** | **有 ≥1 条 `assessment_answers`**(或 `profile` 非空) | `assessment-quiz` —— **不是 status** |
| **已进问卷** | `session.status = 'survey'` | quiz 答满 15 题时置 |
| 已完成 | `session.status = 'completed'` | finalize |

**所以是「1 个基数 + 5 段」,不是「5 段」。** 建议把已付款渲成标题上的
「本批 N 人已付款」,后面五段各自给人数与流失数 —— 这样没有任何一段是 100%。

**「已进问卷」是你没列但值得加的一段**:finalize 要求 survey 行存在,
所以「答满 15 题却没交问卷」是一个真实的流失点,而它现在完全看不见。

## ③ 现场模式:批次名进标题,不是提示条

**它是唯一会被投影给一屋子人的东西。** 所以:
- 「我在看哪个批次」必须**永远在屏幕上**,而且是**标题的一部分** ——
  提示条会被滚出视野,而投影时没人会往上滚
- 测试批次投影时要比看板那条黄底警告**更强**:看板是一个人看,
  现场模式是当着所有人讲。讲一组假数字的代价不可逆

## ④ 问卷洞察:seed 验渲染,不验内容

S5「90 天最想达成什么」与 S6「最卡住你的是什么」是开放题,那两栏对后端销售最有用。
但 **seed 的开放题是脚本生成的固定串**(`'seed test data — not a real answer'`),
所以这个模块:
- ✅ 可以验渲染、排版、长文本换行、空值处理
- ❌ **验不了内容是否有用** —— 要等真实学员

⚠️ 顺带一条**隐私**:那两栏是学员自己写的原话,而看板 / 洞察页会被投影。
现场模式里**不该出现开放题原文** —— 那与分享卡不放维度分数是同一条理由
(那是他自己交的东西,不该被公开对照)。问卷洞察页可以给,现场模式不给。

## 三个模块共用的那条范围约束

`cohort_id` 必填、`'all'` 在服务端展开成「排除测试批次」、判据是「不是测试批次」
而不是「在这批 id 里」—— 已在看板里落成代码([判断标准 15](#15-一个结果的正确性取决于它涵盖了哪些数据时那个范围必须是参数不能是默认值))。
后面三个照抄**这一条**,但**不要照抄 completed 过滤**(见上面第 ①)。

Node **302** / Deno 147,八道门全绿(本条只改文档)。

---

# Stage 10-2:漏斗监控(1 基数 + 5 段)

## 取数起点:`assessment_entitlements`,不是 `assessment_results`

**这是这个模块唯一容易写错的地方,而写错的症状是每一段都 100%。**
漏斗必须包含连 session 都还没有的人(`pending` / `link_sent` —— 他们没登录过,
`assessment_sessions` 里根本没有行)。从 results 起查只能看到已完成的人。
已立成[判断标准 16](#16-说照抄-x时要说清照抄的是-x-的哪一部分)。

## 分段与判据

| | 判据 | 为什么不是 status |
|---|---|---|
| 已付款(**基数**) | 行存在 | webhook 是付款入口。画成分段永远 100%,**一个永远满格的分段不携带信息** |
| 已发链接 | `link_sent_at` 非 null | `sendMagicLink` 一定会盖 |
| 已登录 | `first_login_at` 非 null **或 session 存在** | 那次盖时间戳是「失败只记 console.error」的,可能缺;session 是 auth 建的,存在即登录发生过 |
| 已开始答题 | **profile 非空 或 有 ≥1 条 answer** | `entitlement.status` 上它与「已登录」是同一个事件 |
| 已进问卷 | `session.status = 'survey'` 或 `completed` | 这一段在四态的 status 上完全看不见 |
| 已完成 | `session.status = 'completed'` | |

⚠️ **profile 的空对象要算「没填」**:quiz 是逐题 merge 写进去的,所以中途可能是 `{}`;
把 `{}` 当填过会把「登录了什么都没做」误判成「已开始答题」。

## 单调级联,但抹平的矛盾要报出来

分段语义是「**至少**走到这一步」,所以从最后一段往前级联:走到后面就必然算走过前面。
不级联的话,数据一有不一致(completed 却没有 `link_sent_at`)就会出现
**后一段比前一段大** —— 那看起来像代码 bug,还会让人怀疑整块数据。

**但级联会把矛盾抹平,而抹平等于隐藏。** 所以另数一个 `inconsistent`:
原始判据非单调的行数,前端显式报出来并写明
「那说明**别处**有问题,不是这块统计有问题」。
它不为 0 就是一个真实信号(比如链接不是经 `sendMagicLink` 发出去的)。

## 「已进问卷」是新加的一段,而且可能最好修

答满 15 题却没交问卷 —— finalize 要求 survey 行存在,所以这是真实流失。
**人已经答完 15 题、卡在最后 7 题上,那多半是 UI 问题不是意愿问题**,
所以如果真实数据显示这一段掉得多,那是个明确的改进信号。
而它在只有四态的 `entitlement.status` 上完全看不见。

## 不给百分比

与看板同一条:比例是关于总体的断言,而这里的样本同样可能只有个位数。
每段给「到达 N 人」+「掉 N 人」——**漏斗的用途是找掉在哪,不是看还剩多少**。

## 反向验证:五次变异

| 变异 | 红的断言 |
|---|---|
| 去掉单调级联(各段独立判断) | 「永不上升」+「矛盾被级联补上」 |
| 抹平了但不报 `inconsistent` | 「必须把它报出来」 |
| 已开始答题只看 answers 不看 profile | 「只答了背景题也算已开始」 |
| 第一段流失不相对基数算 | 两条(含「付了款但链接没发出去」那批不出现在任何流失里) |
| 登录只看 `first_login_at` 不看 session | 「有 session 就算登录过」 |

## 验收预期(比全绿有用)

真实批次 2 人(1 completed + 1 pending):

```
已付款 2 → 已发链接 ? → 已登录 1 → 已开始 1 → 已进问卷 1 → 已完成 1
```

**那条 pending 必须在第一段之后掉出去。** 它没掉出去就说明取数起点错了 ——
而那正是这个模块最可能出的错,所以那条掉落是第一条验收,不是「全绿」。
(用例里也钉了这一条:`一个 pending 的人在第一段之后就掉出去`。)

## 未做

- **没有对真环境跑过**
- 现场模式 / 问卷洞察未开始。约束已定死(批次名进标题、开放题原文不进现场模式)

Node **302** / Deno **159**(+12),八道门全绿。

---

# 八道门的调用入口审计(以及删掉的那个关门开关)

## 起因

`grep && commit` 那次把 `check:doc-anchors` 已经红了的判决盖掉了 ——
于是问题变成:**这八道门一共有几个调用入口,有没有哪个入口本身就是关着的。**

## 结果:`;` 与 `|` 一处都没有,但有一个 0/8 的入口

`package.json` 里所有 script **全部用 `&&` 串联**,没有 `;`、没有管道 ——
「前一条失败后一条照样跑」那种形态不存在。

递归展开 `npm run` 之后的真实覆盖:

| 入口 | 门 | |
|---|---|---|
| `npm run build` | **8/8** | Vercel 的 `buildCommand` 就是它 |
| `npm run verify` | **8/8** | 经 `build` 间接包含 |
| `npm run deploy:functions` | **8/8** | 经 `verify` |
| `npm test` / `npm run smoke` | 0/8 | **正确** —— 它们不是构建 |
| 各个 `check:*` | 1/8 | **正确** —— 单独跑一道 |
| ~~`npm run build:ci`~~ | **0/8** | ⚠️ **已删,见下** |

没有 GitHub Actions、没有 git hook,所以入口就这些。

## `build:ci`:一个长成了陷阱的脚手架残留

它来自 **Stage 1 的第一个 scaffold commit**(`tsc -b && vite build`),
那时候一共只有**两道门**。它**从来没被任何东西引用过** ——
而门从 2 道长到 8 道,**它一直停在 0**。没人碰它,因为没有任何东西指向它。

**危险在名字上。** `build:ci` 读起来像「CI 用的那个 build」——
而 PROGRESS 里[早就写着](#十一道门--每一道都是撞出来的)「加人之后上 GitHub Actions 跑 `npm run verify`」。
那个未来的时刻,一个来配 CI 的人会去找**名字里带 ci 的那个 script** ——
然后无声地部署一个八道门一道没跑的产物。

**这就是「一道门是绿还是红,取决于谁在读它的输出」的静态版本**:
门本身没问题,是入口把它绕开了,而绕开的那个入口名字听起来最正规。

已删。真要一个不带门的构建就显式写 `npx tsc -b && npx vite build` ——
**那样看起来就是在绕过检查,而不是像在走正门。**

## 顺带:审计脚本自己骗了我两次

- 第一版只按**字面**在 script 内容里找门名 —— 于是 `verify` 报 **0/8**
  (它经 `npm run build` 间接包含)。**那是选择性的错**:三个入口对、一个错,
  而如果信了它我会去「修」一个本来没问题的 `verify`
- 第二版递归展开时把门名 **replace 掉了**,于是**全部**报 0/8。
  那是**均匀的错** —— 一眼就知道不可能,所以更安全

**选择性的错比均匀的错危险**:后者自己会露馅,前者看起来像一份体检报告。
这与[判断标准 17](#17-用-grep-判断状态之前先问匹配成功意味着什么-它常常和你要的答案相反)
是同一件事的第三次:**用来检查的工具本身也要被检查一次。**

Node **302** / Deno 159,八道门全绿。

---

# Stage 10-3:问卷洞察

## 最重要的一件:那个判断**已经有一份实现**,而且已经给学员看了

`Report.tsx:186` 原本就有一句 `priority !== result.weakest[0]` ——
报告第 7 板块靠它决定要不要高亮。**问卷洞察要用同一个判断。**

如果两边各写一份,失败形态是:**同一个人在后台被标成「不一致」,而在他自己的报告里没有**
(或者反过来)。那种不一致没有任何东西会报错,只会让运营拿着一份**和学员看到的不一样**的
名单去沟通。所以在出现第二个调用点的这一刻抽成 `api/_lib/surveySignals.ts`
两边共用([判断标准 3](#3-同一份东西存两处--先想能不能取消复制),
与 `entitlementStatus` 那次同一个时机判断)。

## 判据保持 `!== weakest[0]`,尽管「不在最弱两维里」更纯

考虑过改:选中 weakest[1] 的人方向基本是对的,把他算成「方向选错了」偏严。
**但没改** —— 报告里已经按 `weakest[0]` 高亮并**发出去了**,
改定义会让已发出的报告与后台对不上。那是一次产品决定,不是顺手改一个比较符。

折中:**布尔判定不动,另给三分** `aligned / second_weakest / mismatched`。
名单页把「偏了」排在「挨着」前面,而布尔与报告保持一致 ——
有一条用例专门钉住「三分与布尔必须对得上」。

## 三块

| 块 | 做法 |
|---|---|
| **高意向名单** | S7 前两项(`asap` / `later`)。有一条用例把「前两项」这个产品说法与 config 的 `option_to_value` 对上 —— 以后有人调选项顺序,那条会红,而不是名单静静变成另一批人 |
| **想修的 ≠ 该修的** | 理由**写在板块里**,不在 tooltip |
| **开放题原文** | S5/S6 原样、可搜(前端筛,与 roster 同一个规模判断) |

## 理由为什么必须在板块里

> 半年后回来看这个页面时,它要**当场**说清为什么这批人排在前面。
> 一个只有筛选结果、没有理由的名单,过一阵会被当成「不知道怎么来的一批人」而不再被信。

板块里那段话说的是:他们**已经有改进意愿**,只是方向选错了 ——
沟通成本比「没意愿」的人低得多;而错的方向会让他们把力气花在收益最小的那一环上。

## 取数:只取已完成的人 —— 与漏斗相反

问卷是答完 15 题之后才填的,没完成的人没有 S1/S5/S6/S7。
**这一条与看板同向、与漏斗相反** ——
漏斗要看没完成的人掉在哪,洞察要看填过问卷的人说了什么
([判断标准 16](#16-说照抄-x时要说清照抄的是-x-的哪一部分))。

## 导出:无条件剔测试行

`high_intent_export` 与 roster 导出同一条:这份 CSV 拿去做 GHL 分群,
**测试行混进去就是给假联系人发消息**。不看页面上的任何状态,剔掉几条写进日志。

## ⚠️ 开放题原文绝不进现场模式

S5/S6 是学员自己写的话。**一个学员写「我们现在现金流很紧」被投在屏幕上,他会知道那是自己写的**
—— 而他就坐在台下。与分享卡不放维度分数是同一条理由,但更重的一层:
分享卡是**学员自己**决定发不发,现场模式是**我们**决定投不投。
已写进代码注释与现场模式的开工约束。

## 反向验证:四次变异

| 变异 | 红的断言 |
|---|---|
| 判据改成「不在 weakest 里」(与报告脱钩) | 两条,含「三分与布尔必须对得上」 |
| 高意向取前三项 | 两条,含「与 config 的 option_to_value 对上」 |
| priority 缺失时算「不一致」 | 「没选方向的人不该进名单」 |
| 三分把 second_weakest 当成 aligned | 两条 |

## 未做

- **没有对真环境跑过**
- **内容验不了**:seed 的开放题是脚本生成的固定串,所以这个模块只能验渲染、
  排版、搜索、空值 —— 要等真实学员
- **现场模式**是 Stage 10 最后一个。约束已定死(批次名进标题、警告要更强、开放题不进)

Node **313**(+11)/ Deno 159,八道门全绿。

# 问卷洞察的 500,以及「`internal_error` 什么都不说」

## 先说清一件事:堆栈**没有被贴进来**

上一条消息里是 `[粘贴堆栈]` 这个占位符。所以下面这个成因是**从迁移文件推出来的,
不是从报错看出来的** —— 部署后要拿真实的那一行确认。
([判断标准 14](#14-有直接观测可用时先观测再推理) 的直接后果:我没有观测,就不假装有。)

## 推出来的成因:PostgREST 的嵌套需要一条**真实的**外键

`20260731000000_assessment_init.sql` 里:

| 表 | 外键 |
|---|---|
| `assessment_survey.session_id` | → `assessment_sessions(id)` |
| `assessment_results.session_id` | → `assessment_sessions(id)` |

两张表之间**没有** FK —— 它们只是共用一个父表。而我把 `result` 写成了 `session` 的**兄弟**:

```
survey → session(...)                 ← 有关系
       → result:assessment_results(…)  ← ✗ 兄弟之间没有关系,PostgREST 解析不出来
```

改成嵌进去:

```
survey → session:assessment_sessions!inner(
           result:assessment_results!inner(weakest), …)
```

读取路径跟着变成 `r.session?.result?.weakest`。

## `internal_error` 对两种完全不同的故障说同一句话

这次真正花时间的不是那个嵌套,是**报错什么都没说**。`query_failed` 让人直接去看那条查询,
`config_missing` 让人去看环境变量 —— 两者的排查动作毫无重叠,
而光秃秃的 `internal_error` 逼人每次都去翻 Supabase 日志。

做法与 `server_misconfigured` 那次同一条:**细节进日志,响应体只多一个分类**。
新增 `_shared/errorKind.ts`(纯函数):

| 字段 | 回给客户端? | 理由 |
|---|---|---|
| `kind` | ✅ | 我们自己定义的四个词,不含任何库内信息 |
| `code` | ✅ | `PGRST200` / `42501` 是**公开的错误分类学**,不是数据;而它恰好是「去哪找」最有用的一格 |
| `details` / `hint` / `message` | ❌ 只进日志 | 权限类错误(`42501`)的 `hint` 是一句**可以直接跑的 GRANT**,含表名与角色名 |

四类:`query_failed` / `config_missing` / `upstream_failed` / `unexpected`。
认不出的一律 `unexpected` —— **不猜**:猜错的分类比不分类更糟,
它会把人送到错误的地方,而且送得很有信心。

## 两个 `internal_error` 出口**区别对待**

`index.ts:111` 那一处(名单查询失败)在**授权判定之前** —— `verdict` 要到下面才算出来,
此刻只知道「有一个能通过 `getUser` 的 JWT」,不知道这个人在不在名单里。
「Admin 侧可以带分类」的前提是**对方已经是确认过的管理员**;
名单外的人拿到 `query_failed` + 错误码,等于免费获得一个探后台内部状态的探针。
**那一处只写日志,响应体保持光秃秃的 `internal_error`。**

⚠️ 这个区别**没有断言守着** —— 它只有注释和代码审查。
Edge Function 的 `Deno.serve` 入口本地无处可测(与判断标准 4 后半条同一类)。

## 只回不显示等于没回

后端回了分类,但 `adminApi.ts` 那一行原本只取 `error` 字段,
于是界面上仍然是光秃秃的 `internal_error` —— 而「不用每次翻日志」正是这次的目的。
抽出纯函数 `adminErrorMessage()` 单独导出(为了能测),拼成
`internal_error (query_failed PGRST200)`,5 条用例。

## 反向验证:一次变异**证明我自己的断言是空的**

| 变异 | 结果 |
|---|---|
| `hint` 塞进 `code`(泄露细节) | 3 条红 ✅ |
| `log` 丢掉 `details` / `hint` | 1 条红 ✅ |
| `adminApi` 退回只取 `error` | 2 条红 ✅ |
| 去掉 `credentials missing` 这个措辞 | 1 条红 ✅ |
| **把「上游」判断挪到「配置」判断之前** | **168 条全绿 ❌** |

最后那条是重点。我给那段写的注释是「顺序反了会把 GHL 凭证缺失归错类」,
用例名叫「顺序不能反」—— **两个都是编的**:今天没有任何一条真实消息同时命中两套模式,
所以顺序怎么排都一样。这正是[判断标准 8](#8-从被测对象推导出来的断言验的是代码和自己一致)
说的那种断言:它验的是我脑子里的故事,不是代码的行为。

处理方式不是把用例删掉,而是**改成它真正钉住的东西**:仓库里 grep 出来的两条真实消息
(`GHL credentials missing (GHL_PRIVATE_TOKEN)` 和 `GHL credentials missing for field-map fetch`)
都必须归 `config_missing` —— 注意第二条**以 `fetch` 结尾**,而它属于配置。
顺序留着,但理由降级为**预防**:一旦有人把上游模式放宽成裸 `fetch`,顺序立刻承重。

## 顺带兑现了一小块挂了很久的债

`PostgrestError` 的 `code` / `details` / `hint` 被仓库里 37 处 `.message` 降级一律丢掉。
这一轮的日志把四个都打出来 —— **但只在这一处**。其余 36 处仍未改,单独一轮。

## 未做

- **`survey_insights` 没有对真环境跑过**,成因也还没被真实堆栈确认
- **现场模式**未合并,所以这次的 500 与它无关

Node **318**(+5)/ Deno **168**(+9),八道门全绿(`npm run verify` 退出码 0 —— 不看 grep)。

---

# Stage 10-4:现场模式(Stage 10 收尾)

## 三条约束各自的落法

**① 批次名与测试警告出现在【每一屏】,不是第一屏。**
任何一屏都可能是被投出去的那一屏 —— 讲的人会直接跳到第三屏开始讲。
「一条提示条」会被滚出视野,而**投影时没人往上滚**。
有用例逐屏断言,还有一条反向锁:**真实批次绝不能出现警告**
(否则「永远显示警告」也能让前一条绿,而那会让警告失去意义)。

测试警告比看板那条强得多:满宽、墨底反白、每屏都在。
看板是一个人看;现场模式是当着所有人讲一组数字,而**讲错了不可逆**。

**② 绝不自动切屏。** 没有 `setInterval`、没有计时器。
自动轮播会在讲一半的时候把画面换走,而讲的人没法把它拨回来继续讲同一句话。
切屏只有两个来源:方向键、按钮。

**③ 全屏投的是那一个元素,不是整页。**
`slideRef.current.requestFullscreen()` —— 浏览器地址栏、标签页、Admin 导航、
控制条**全部在那个元素之外**,所以它们**不可能**进投影。
与[分享卡截进 EN 按钮](#分享卡截进了-en-按钮--全局-chrome-的默认方向反了)是同一类问题,
解法同样是结构性的(把要投的东西放进它自己的元素),不是「记得隐藏导航」——
只是这次的观众是一屋子人。
(用 ESC 退出全屏时浏览器不通知,所以监听 `fullscreenchange` 而不是只记自己的状态。)

## 「开放题绝不进」由数据源保证,不靠渲染时记得

现场模式**复用 `cohort_dashboard`**,而那个 payload **根本不含 S5/S6**。
所以「学员写的话被投在屏幕上」在这条路径上**不可表示** ——
不是一条要人遵守的规则,是一个做不到的动作。
(与 PublicShell 那次同一个取向:让错的状态没有表达方式。)

顺带也没新建 action:aggregate 已经有全部要的东西,新建一个就是第二份聚合。

## 字号按投影距离,不按屏幕

全部用 `vmin`:全屏之后一个数字占屏高的十分之几,后排才看得清。
代价是**一屏只能放三四个数字** —— 那不是妥协,是这个模块的形态:
**投影不是仪表盘,是一次只讲一件事。**

四屏:概况(只有两个数字)→ 五维平均雷达 → 档位分布 → 最弱维度分布。
**每题选项分布不投** —— 15 题 × 3~4 个选项,后排看不清;那个是课前自己扫的。
有用例断言任何一屏都不出现题干(而它在 payload 里**是有的**,所以那条断言有意义)。

⚠️ **字号那条断言是代理指标**:静态标记看不到实际渲染尺寸
([判断标准 10](#10-用-css-表达的意图没有渲染断言就要假设它没生效))。
它只能拦住「有人把 vmin 换回 rem/px」,**拦不住「vmin 数值太小以致后排看不清」**——
那要真投一次才知道。

## 反向验证:五次变异

| 变异 | 红的断言 |
|---|---|
| 批次名只放第一屏 | 「每一屏都有批次名」 |
| 测试警告只放第一屏 | 「每一屏都有警告」 |
| 警告永远显示(不看 isTest) | **反向锁**「真实批次不显示警告」 |
| 把每题选项分布也投出去 | 「任何一屏都不出现题干」 |
| 字号换回 rem | 「用 vmin 不用 rem」 |

## Stage 10 收尾:四个模块的代码都完成了

| 模块 | 状态 |
|---|---|
| 批次聚合看板 | ✅ 已部署验过(范围约束、样本不足、零百分比) |
| 漏斗监控 | ✅ 已部署验过(pending 在第一段掉出去) |
| 问卷洞察 | 代码完成,**未部署**;内容验不了(seed 开放题是固定串) |
| 现场模式 | 代码完成,**未部署**;字号要真投一次才知道够不够大 |

**未验的三件**:问卷洞察整块、现场模式的投影效果、以及全屏在会场那台机器上行不行
(浏览器可能因为非用户手势或权限拒绝 —— 代码里那次失败会说出来,不会静默)。

Node **322**(+9)/ Deno 159,八道门全绿。

# 现场模式第一屏被读成「14.3」

## 现象与根因

第一屏把**人数**与**平均总分**同尺寸并排(两个 22vmin),于是 `1` 和 `4.3`
被读成了 `14.3` —— 第一眼就读错。而这一屏是投给一屋子人的,
**读错的成本是讲课的人要停下来解释**。

根因不是间距不够,是**两个量纲不同的数被排成了同一层级**:
人数是背景信息,平均分才是全场关心的那个数字。
所以修法不是把间距拉大 —— 拉间距只是让同一个错法更难触发,
而这一屏本来就该只有一个主数字(这个模块自己的话:「投影不是仪表盘,是一次只讲一件事」)。

改成:平均分独占主位 30vmin → 「平均总分」→ 「N 人已完成」3vmin 小字。
**标签夹在两串数字中间**,所以连缀读法在布局上不成立。

小字里**没有「本批」**:这一屏也可能是「全部批次」范围,那时「本批」是错的;
而范围已经写在标题上了。

## 断言钉的是「主尺寸只出现一次」,不是文本相邻

旧标记的可见文本是「1 已完成 4.3 平均总分」—— 两串数字在**文本里根本不相邻**,
所以任何「相邻子串」式的断言**都抓不到那个 bug**:它是**视觉**相邻。
真正变了的是「有几个元素处在主尺寸这一层级」:旧版两个,新版一个。

字号抽成 `HEADLINE_MAIN_VMIN` / `HEADLINE_SUB_VMIN` 导出,断言引用它们并钉**比值**
(≥3 倍)—— 复制字面量到测试里的话,改了代码不改测试仍然绿,而且看起来还在守着。

## 其余三屏:没有同样的并排

| 屏 | 为什么不构成同一个错法 |
|---|---|
| 五维平均(雷达) | 五个数各自钉在自己的顶点标签旁,且**同一个单位**(0–5 分) |
| 档位分布 | 数字全是同一个单位(人数),各自贴着自己那一行,纵向排列 |
| 最弱维度分布 | 同上 |

另加一条断言把「主尺寸只出现一次」**推广到全部四屏** —— 它拦的是以后有人往别的屏加第二个大数字。

## 顺带看出来的一件(未修,等定夺)

档位 / 最弱那两屏的**数字不成一列**:计数跟在条形后面,所以 0 的行数字紧贴标签、
非 0 的行数字被推到条形末端,x 位置参差。这是「值放在条形末端」的常见做法,不算错,
但投影时扫一列数字会比较费劲。**与这次的读错不是同一个错法,所以没顺手改。**

## 反向验证:四次变异

| 变异 | 红的断言 |
|---|---|
| 人数那行放回主尺寸(重现读错的层级) | **3 条**,含「主尺寸只出现一次」与全四屏那条 |
| 主数字换成人数 | 「主数字是平均分,不是人数」 |
| 删掉人数那一行 | 同上(反向锁:降级 ≠ 删掉) |
| 辅助行调到 12vmin(层级被拉平) | 比值那条 |

## 真看了一眼 —— 以及看的方法本身踩了一个坑

断言只是代理指标(判断标准 10),而这次的问题是**视觉**的,所以用构建产物的 CSS
把四屏渲成静态页在浏览器里看了(含测试批次那屏,确认满宽反白警告条没挤掉主数字)。

⚠️ **第一版看法是错的**:把四屏嵌进一个大页面里,`vmin` 按**整页视口**算,
于是字号全错、数字溢出边框 —— 我差点把那个溢出当成新 bug。
`vmin` 排版的东西**必须在自己的视口里看**:改成一屏一个整页 + 视口固定 960×540,
才与「全屏投影」是同一个关系。(临时文件只写 scratchpad;中途有一个副本被我放进了
`public/`,当场删掉了 —— 范围外的临时改动该**事先**说。)

## ⚠️ 待验,**不算已验证**

- **会场投影距离下的可读性验不了**。我能验的只有「在我的屏幕上不难看」。
  30vmin 够不够要**真投一次**才知道 —— 这条要等第一场 MasterClass。
- **真实效果要等第一场课**。seed 那 15 条都是 completed,所以测试批次投出来是 15 人;
  而真实批次只有 1 人,「全部批次」这一屏**永远是 1**。
  不影响验收,但意味着这个模块投出来的样子(条形的疏密、雷达的形状)现在看不到。

# 档位 / 最弱两屏:计数不成列

条形与计数原本是**同级**,而条形宽度是整行的百分比 —— 于是 0 的行数字紧贴标签、
非 0 的行数字被推到条形末端,x 位置参差。而这两屏的用途正是
**扫一眼看哪一档最多**,数字不成列时那一眼就得来回找。

改成三段:定宽标签 | `flex-1` 轨道(条形按**轨道**的百分比伸) | 定宽计数。
顺带修掉一个隐患:百分比原本相对整行算,100% 的条形会把计数挤出去。

## 断言钉「轨道存在」,渲染另外真量了一次

jsdom 不做布局(`getBoundingClientRect()` 全是 0),所以「五行的 x 是否相同」
在测试环境里**测不了**。轨道元素的存在是那个视觉性质的**结构载体** ——
去掉它,百分比就又回到整行、x 就又跟着数值跑。这与第一屏那次是同一个手法:
**把视觉问题翻译成结构性质**,而不是去验渲染尺寸(验不了)。

而真实的 x 位置在浏览器里量过:视口 960×540(= 全屏投影的关系,`vmin=540`),
五行计数的左右边缘**逐像素相同**(left 664 / right 712)。那是一次性观测,不在套件里。

## 反向验证:三次变异 + 两次我自己的断言边界错

| 变异 | 红的断言 |
|---|---|
| 去掉轨道(退回同级) | 「每条条形都在 flex-1 轨道里」 |
| 计数不再定宽 | 「计数定宽且在行尾」 |
| 0 人也给 1px 假条形 | 「0 行不画条形」 |

写断言时自己踩了两次:
- `width:\s*\d` 先命中了**标签**的 `width:22vmin`(位置 70 < 轨道 133),
  断言红在一个与被测性质无关的元素上 —— 改成只匹配百分比 `width:[\d.]+%`;
- 「0 行不画条形」那条用的 fixture 是 15 人 seed(**档位计数全是 3,一个 0 都没有**),
  于是它在验一个不存在的行。改用真实批次的形状(1 个人只落在一档里,其余四档全 0)。

两次都是**跑变异**才发现的,读代码读不出来。

# 「名字像入口但没人引用」六类清单(**只列不删**)

判断标准 18 推论三那一遍。**六类都只出清单** —— `build:ci` 那次我的审计脚本
自己骗过我两次,而这一轮判的是「删不删」,错了代价更大。

## 先说三条:审计脚本这次又骗了我三回

都是自检抓到的,不是读代码看出来的:

| 骗法 | 后果 | 修法 |
|---|---|---|
| `npm run X` 是**前缀匹配** | `test` 显示「被 verify 调用」,而 verify 里根本没有 `npm run test` | 名字后面加边界字符判断 |
| 只数 `npm run`,忘了 **`npm test`** 这个内置别名 | 同上,`test` 一度被列成死脚本 | 两种写法都数 |
| 一条 `alter table` 只认**第一个** `add column` | `share_card.sql` 里三列只抽到一列 → 列审计的「0 个候选」不可信 | 先切语句块再块内 matchAll |

第三条是**自检点名了漏掉的那一个**(`share_card_error` → `cols.has === false`)才暴露的。
而我的第一版自检本身也是空的:假列被塞在检查循环**之后**,于是它打印「应当被报出来」
而报告里仍然是「无」—— 一句没有被任何东西验证的声明,正是这一轮在找的东西
(判断标准 1 推论三的第三种绿)。

## ① npm scripts(25 个)

判据是**三个来源都为 0**:被别的 script 调用 / 被文档提到 / 被 `scripts/*.mjs` 提到。
给人用的入口天然没有调用方,所以不能只看调用关系。

| 名字 | 结论 |
|---|---|
| ⚠️ **`lint`**(`eslint .`) | **不在任何一道门里,而且现在就是红的(8 个 error)** —— 见下,这是本轮最值钱的一条 |
| `preview`、`test:watch` | Vite / Vitest 脚手架自带,措辞是约定俗成的,误导性低 → **建议留** |
| 其余 22 个 | 都有调用方或文档引用 |

`scripts/` 目录里 13 个文件全部有引用方(`dump-phone.ts` 在 package.json 里 0 次,
但被 `check-cross-runtime.mjs` 当子进程跑 —— 那是**第四类调用方**,
只看 package.json 会把它误判成死的)。

### ⚠️ `npm run lint` 现在是红的,而它不在任何门里

八道门里只有 `lint:cjk` 会跑 eslint,而它只带 CJK 那一条规则、只扫 `src/**`。
`eslint .`(全量规则、全仓库)**没有任何门会跑到** —— 于是它红了不知多久,没人知道。
这正是判断标准 18 说的形状:**名字越像正式入口,危害越大**。

| 位置 | 规则 | 我的判断 |
|---|---|---|
| `src/lib/phone.ts:30` | `no-irregular-whitespace` | **误报,但值得改**:那是 `U+3000` 全角空格的字面量(马来西亚用户粘贴号码常带),改成 `\u3000` 转义后意图反而更清楚 |
| `_shared/csv.ts:35`、`csv_test.ts:6` | 同上 | 同上:那是 `U+FEFF` BOM,Excel 靠它认 UTF-8。改成 `\uFEFF` |
| `assessment-admin/index.ts` ×3、`assessment-report/index.ts` ×1 | `no-explicit-any` | **真问题** |
| `assessment-report/index.ts:21` | `no-unused-vars` | **真死代码**:`type ResultRow` 导进来没用过 —— 这条本身就是一个「入口审计」的结果,而那道没人跑的门早就知道了 |

**没动**。要不要把 `lint` 收进 `build`、以及那三条空白改不改,是你的决定 ——
收进去之前得先把 8 条清掉,否则八道门立刻全红。

## ② `api/**` 路由(5 个):**0 个死的**

| 文件 | 入口 |
|---|---|
| `api/[...path].ts` | SPA rewrite 之外的全部 `/api/*` 转发 |
| `api/render-pdf.ts`、`api/font-probe.ts` | `vercel.json` 的 `functions` 配置;font-probe 带 `INTERNAL_FN_SECRET`,且 `src/styles/fonts.ts` 与它共用同一份 `@font-face` |
| `api/cron/retention.ts`、`api/cron/pdf-sweep.ts` | `vercel.json` 的 `crons` |

## ③ `vercel.json`:**0 个死的**,但缺一条

两条 cron 都指向存在的文件;rewrite 就是 SPA 兜底。
**缺的是 `assessment-ghl-resync` 的排期** —— 见 ⑥ 下面那条。

## ④ Edge Function 的 action(11 个):**0 个死的**,而朴素扫描说有 3 个

字面量扫描报 `resend` / `revoke` / `rotate` 无人调用 —— **三个都是假阳性**:
`Roster.tsx` 通过**变量**调(`adminPost(action, …)`,action 是联合类型)。
与 `build:ci` 那次「字面量匹配报 verify: 0/8」是同一个失效方式。

## ⑤ `api/_lib` 与 `_shared` 的导出(104 个)

「27 个无人 import」这个数字**不能直接报** —— 里面 24 个是**类型**,
被当注解用不需要 import 名字;另有 2 个(`REQUIRED_FIELD`、`SESSION_DAYS`)
在自己文件内被用,是我审计的假阳性。真正的候选只有一个:

- ⚠️ **`_shared/ghlFieldMap.ts` 的 `_resetFieldMapCache()`** ——
  注释写着「供测试重置内存缓存」,而 **`ghlFieldMap` 根本没有测试文件**。
  它是一个为不存在的测试准备的钩子,而那句注释会让下一个人以为字段映射缓存是有覆盖的。
  两条路:补测试(缓存逻辑值得测),或连注释一起删。**建议补测试。**

另外单列一类(**不是死代码**,但产品代码没在用,只有测试 import):11 个,
如 `PDF_PENDING_STALE_MS`、`FUNNEL_STAGES`、`ENTITLEMENT_STATUS_ORDER`。
它们都在自己模块内被用、被测试钉住,属于正常形态。

## ⑥ Supabase 侧:表 / 列 / 索引 / 函数 / bucket

| 类别 | 数量 | 结论 |
|---|---|---|
| 表 | 9 | 全部有 `.from()` 引用 |
| 列 | 56 | **0 个未引用**(修好抽取器、且埋的假列确实被报出来之后) |
| 函数 | 2 | `upsert_assessment_entitlement` 有 3 处调用;`touch_updated_at` 代码里 0 次但**被 trigger 用着** —— SQL 内部的引用不在代码里,这是这一类的固有盲点 |
| bucket | 1（`reports`) | 用着(PDF 与分享卡共用);rev3 预留的 `internal` bucket 当时就取消了 |
| 索引 | 11 | **1 个候选**,见下 |

### ⚠️ `assessment_results_tier_idx` —— 没有任何查询按 tier 过滤或排序

`(tier)` 上的索引,而全仓库 0 处 `.eq('tier')` / `.order('tier')`。
tier 只是被 select 出来读值,那用不到索引。它在每次写入时都要维护,
而且会让人以为「有个按档位捞人的查询」。**不用现在删**,但记一笔。

### ⚠️ 真正要紧的一条:`assessment-ghl-resync` 存在、正确、**没有任何东西触发它**

这个 Edge Function 存在,鉴权(`X-Internal-Secret`)与 maintenance 同套,
候选查询也是对的(`ghl_synced = false` + `ghl_next_retry_at`,那条索引因此**是活的**)。
但:

- `vercel.json` 的 crons 里只有 `retention` 与 `pdf-sweep`;
- `retention` 只打给 `assessment-maintenance`,而 maintenance 没有任何对外 fetch。

**所以 `ghlWriteback` 失败时写下的 `ghl_next_retry_at` 没有任何东西会去读 ——
GHL 写回失败在生产上从来没有被重试过。** PROGRESS 里早有一行写着它「无人请求」
(Stage 11 待做),但那行读起来像「还没接上」,而实际后果是**一个已经上线的重试机制从未运行**。
这是这一遍里最像判断标准 18 的一条:**东西是好的,名字是对的,只是没人叫它。**

## 汇总:该动手的四件(按我的排序)

| # | 事 | 为什么排这里 | 状态 |
|---|---|---|---|
| 1 | 给 `assessment-ghl-resync` 加 cron(Stage 11 本来就要做) | 唯一一条**正在影响真实数据**的 | ✅ 已做,**未部署验证** |
| 2 | 把 `lint` 收进 `build`(先清掉 8 条) | 一道红着的门没人看,比没有门更糟 | ✅ 已做(第九道门) |
| 3 | `_resetFieldMapCache` → 补 `ghlFieldMap` 的测试 | 注释在声称一个不存在的覆盖 | ✅ 已做(+10 条用例,7 次变异) |
| 4 | `assessment_results_tier_idx` | 只是维护成本 + 误导,最不急 | ✅ 留着,已标明「建了没人用」(见下) |

# 补上从未运行过的 GHL 重试,以及第九道门

## ① `api/cron/ghl-retry.ts` —— 那个「东西都在,只是没人叫它」的缺口

`ghlWriteback` 在 TRANSIENT 失败时写 `ghl_next_retry_at`(2^attempts 分钟,上限 6 小时),
`assessment-ghl-resync` 按它挑候选行重跑,索引也在 —— **缺的只是排期**。

这个缺口的失败形态特别安静:**写回失败 → 标记待重试 → 没人来 → 数据永远停在那里,
而 Admin 名单页上那一列显示的是「失败」,看起来像是要人手动处理的东西,
实际是系统本该自动处理的。** 没有任何东西会报错,因为从系统的角度看什么都没发生。

**每 15 分钟一次**:第一次退避是 2 分钟,更密只会让首次重试早几分钟到;
而 resync 的 `BATCH_CAP` 是 50,这个节奏把最坏情况下的 GHL 请求量压在 200/小时 ——
GHL 有限流,而重试打爆限流会把 TRANSIENT 变成更多 TRANSIENT。

### 开这条 cron 之前先确认的一件事:测试批次不会被打到

resync 的候选查询**确实没有 `is_test` 过滤**(PROGRESS 里早标着)。但收口在更里面,而且两层:

1. `syncToGhl` 在**发出任何请求之前**查 `isTestSessionCohort` 并直接返回;
2. 它把结果记成 `CONFIG:` 前缀,而 resync 的候选过滤会跳过 CONFIG/AUTH 行 ——
   所以测试行即使反复被挑中,也不会有任何对外请求。

**先验证了这两层才加排期。** 一条定时向外部系统发请求的 cron,
开之前要能说清「它绝不会打到假联系人」,而不是开完再看。

## ② 第九道门:`lint`(`eslint .`)

它一直存在,却不在任何一道门里,**而且被发现时已经红着(8 个 error)**。
八道门里只有 `lint:cjk` 会跑 eslint,而那只带一条规则、只扫 `src/**`。

### 8 条怎么处理的

| 类 | 处理 |
|---|---|
| `no-explicit-any` ×4 | 写了三个**最小** interface(`SurveyInsightRow` / `FunnelEntitlementRow` / `DashboardResultRow`)+ 一处就地形状。只写下游真正读到的字段 —— 完整写一遍 PostgREST 的嵌套形状,下一个人改 select 时那份类型不会报错、只会悄悄与现实脱节 |
| `no-unused-vars` ×1 | `assessment-report` 里 `type ResultRow` 导进来没用过,删。**那道没人跑的门早就知道这里有死代码** |
| `no-irregular-whitespace` ×3 | 改成 `\u3000` / `\uFEFF` 转义,见下 |

### 换掉 `any` 立刻炸出一个真问题

那三处原来是 `as any[]`,而且带着 `// deno-lint-ignore no-explicit-any` ——
**deno 的 linter 当年被安抚过,eslint 那条同名规则从来没跑到。**

换成最小类型后 `deno check` 报了 6 个错,全部指向同一处:
`const ent = r.session?.entitlement ?? {}`。
`?? {}` 是把一个不可能的状态假装成空对象,而在 `any` 之下
`ent.id as string` 在 entitlement 缺失时会**静默变成 `undefined`,一路流到导出的 CSV 里**。
改成在过滤阶段就要求 session / entitlement 存在(查询两处都是 `!inner`,
所以这个条件在运行时是空转的 —— 它是**类型上**必要,而那正说明它原本就该在)。

### 不可见字符那三处:理由不是 lint 要求

`phone.ts` 的 `U+3000`(全角空格,用户从微信 / Excel 粘号码时常带)、
`csv.ts` 的 `U+FEFF`(BOM,**Excel 靠它认 UTF-8**)。都改成转义,
因为**那两个字符在源码里肉眼不可见** —— BOM 尤其:它看起来就是「文件开头什么都没有」。
一个 Excel 兼容的关键字符以没人看得见的形式待在代码里,本身就是个问题;转义之后它有名字了。
`csv.ts` 那处补了注释说明为什么必须有 BOM,否则下一个人会当脏数据顺手删掉 ——
症状是导出 CSV 里中文姓名全乱码,而那份 CSV 是拿去做 GHL 分群的。

**而这条规则第一个抓到的是我自己**:我在 `ghl-retry.ts` 的注释里为了不让 cron 表达式
提前闭合块注释,塞了两个**零宽空格**。新门当场把它抓了 —— 判断标准 11
(一道门的第一个收获通常是它作者自己的东西)又一次,而这次它抓的正是它要拦的那一类。

## 反向验证:两个方向

| 变异 | 结果 |
|---|---|
| 在 `assessment-report` 里塞一个 `as any` | `build` 退出码 1,点名 `no-explicit-any` |
| 把 `phone.ts` 的转义换回全角空格字面量 | `build` 退出码 1,点名 `no-irregular-whitespace` |
| 复原 | `build` 退出码 0 |

BOM 那条用例仍绿,说明转义与原字符**逐字节等价**(`csv_test.ts` 里
`csv.startsWith('\uFEFF')` 那条断言本来就在守着它)。

## ⚠️ 未做 / 待验

- **cron 未部署验证**。要看的是 Vercel 的 Invocations 里 `/api/cron/ghl-retry`
  每 15 分钟出现一次,以及它带回的上游结果(`swept` 的数字)——
  「跑了」和「跑了但一条都没处理」在日志里必须有区别。
- **没有门守着「每个 cron 文件都有排期」**。这次的缺口正是这一类,
  而它现在仍然靠人看。做成 `check:crons`(比对 `api/cron/*.ts` 与 `vercel.json` 的 crons 双向)
  是很小的一件 —— **但没顺手做**,因为它是新增一道门,该你点头。

Node **334** / Deno **168**,九道门全绿(`npm run build` 退出码 0)。

# 三件收尾:字段映射测试、tier 索引标注、第十道门

## ① `ghlFieldMap` 补了 10 条用例 —— 处理方式是**补上被服务的对象**

入口审计发现 `_resetFieldMapCache()` 的注释写着「供测试重置内存缓存」,
而这个模块**根本没有测试文件** —— 那句注释在替一份不存在的覆盖作证。
删掉那个函数也能消除误导,但**它存在的理由是对的,缺的是它服务的对象**。

覆盖的是三级读取链(内存缓存 → `app_settings` → 回源 GHL)。选这些用例的判据是
「错了会不会有人知道」:

| 用例 | 错了的症状 |
|---|---|
| `app_settings` 有值就不回源 | 每个冷启动多打一次 GHL —— 不报错,只偶尔撞限流 |
| TTL 内不重读 / TTL 过期要重读 | 后者反向锁:缓存永不过期 = Admin 点了「刷新字段映射」而别的实例还在用旧的,**没有任何东西会说** |
| `force` 跳过缓存**和** `app_settings`,且把结果写回 | 不写回,「刷新对所有实例生效」就不成立 |
| upsert 失败**不**抛 | 写缓存失败让整次写回崩掉 = 把「下次再查一遍」升级成一次故障 |
| `app_settings` 读失败要抛 | 回空映射就无法验证字段被接受,而 `syncToGhl` 会因此**把 synced 标成 true** |
| 非 2xx / 非 JSON 的措辞 | 排查时唯一的线索 |
| **缺凭证的措辞** | 它把两个模块钉在一起:`errorKind_test.ts` 里有一条直接引用「GHL credentials missing for field-map fetch」这句**真实字面量**。这里改措辞,那边就会把它归成 `unexpected` —— 排查方向从「去配变量」变成「不知道去哪」 |
| `_resetFieldMapCache` 自己 | 它自己的那一条,现在有了 |

**`nowMs` 是为可测加的参数**(默认 `Date.now()`,生产行为不变)。TTL 是个跟时间有关的分支,
不注入时钟就只能真等 10 分钟,或者 stub 全局 `Date.now` —— 后者会影响同进程里别的用例。
与 `lambdaEnv.fontDir` 那次同一个手法。

`deno.json` 的 test task 加了 **`--allow-env=GHL_PRIVATE_TOKEN,GHL_LOCATION_ID`** ——
按名字放开两个,不用裸 `--allow-env`。回源全走 stub 掉的 `globalThis.fetch`,
所以**不需要 `--allow-net`**:一个真实请求都不发。

**七次变异,七条各自红在预期那条**:去掉内存缓存早返回 / TTL 设成无限 /
`force` 不跳过 `app_settings` / upsert 失败改成抛 / 读失败改成静默回空 /
改掉凭证措辞 / `_resetFieldMapCache` 改成空实现(这条级联红了 7 条,
因为每条用例都依赖那个重置 —— 它正是这个函数存在的证明)。

### 第十道门第一个抓到的又是我自己

我在这个测试文件里写了一句注释「**不用 `any`**」,然后两行之后就 `as any` ——
`eslint .` 当场抓了。而它抓的正是「注释在声称一件代码马上就违反的事」,
也就是这道门加进来的那个理由本身。改成经 `unknown` 转到真的 `SupabaseClient`。

## ② `assessment_results_tier_idx`:建了没人用,**留着,但标明**

```sql
create index assessment_results_tier_idx on public.assessment_results (tier);
```

全仓库 **0 处** `.eq('tier')` / `.order('tier')` / `.in('tier')` ——
`tier` 只是被 select 出来读值,那用不到索引。批次看板做档位分布是**在内存里数**的
(`aggregateCohort`),不是按 tier 查库。

**留着**(它只是每次写入多维护一点),但记在这里:
**不要以为有查询依赖它。** 以后真出现「按档位捞人」的需求,它现成;
在那之前,它是一个会让人误以为存在某条查询的东西。

⚠️ **没有去改那条迁移文件里的注释。** 迁移已经应用过了,而改一个已应用迁移的内容
不会改变数据库、只会让文件与实际执行过的东西不一致(Supabase CLI 按版本号追踪已应用的迁移)。
真相源写在这里,不写在那里。

## ③ 第十道门 `check:crons` —— **成因就是它自己拦的那件事**

双向:

| 方向 | 拦的事故 |
|---|---|
| 有文件没排期 | **这次的缺口**:函数永远不跑,而它看起来是装好了的 |
| 有排期没文件 | 删了函数忘了删排期 → 每次触发 404,而 **Vercel 的 cron 历史里 404 也算一次执行记录**:「跑过了」是对的,「跑成了」是错的,列表里两者长得一样 |

另外拦 schedule 缺失 / 不是五段 / 同一个 path 排两次(后一条会静默盖掉前一条)。

**明说做不到的事:不校验频率对不对。** 「每 15 分钟」写成 `15 * * * *`
(每小时的第 15 分钟)是个真实存在的手滑,但判它需要知道作者想要的频率 ——
**而作者的意图不在文件里**。所以只做形状校验,频率靠部署后看 Invocations。
(与 `check:dim` 那条盲区同一个交代:做不到全覆盖就别装。)

四次变异:删掉 ghl-retry 的排期 / 排一条不存在的函数 / schedule 写成四段 /
同一个 path 排两次 —— 四条各自红。

Node **334** / Deno **178**(+10),十道门全绿。

# Stage 11 标签:先做纯派生,外发那半**等确认**

## ⚠️ 你点名要我先确认的那件:**收口不覆盖标签**

`syncToGhl` 里那道测试批次收口的注释写着:

> 收在这里,将来 Stage 11 的 tags 一写出来就自动被覆盖

**这句话是假的**,而它是我自己写的。查证:

| 事实 | 后果 |
|---|---|
| `syncToGhl` 是**字段写回专用**:它 PUT `{customFields}` 到 `/contacts/{id}`、用字段映射核对响应、把结果记进 `ghl_synced` | 标签走它就等于把标签的成败塞进字段的状态列 —— 那正是 D9「标签独立于字段写入」要避免的 |
| 所以标签必须是**另一条出站路径** | 那条路径上**没有**那道收口 |

也就是说:收口是**按函数**收的,而不是按**出站传输**收的。
一个新的外发功能只要不从那个函数走,就绕过了它 ——
**而绕过的方式是「什么都不做」,不是「做错什么」。**

### 我建议的修法:把收口挪到传输层

一个 `ghlContactRequest(supa, sessionId, ...)`,**所有 contact 级的 GHL 调用都必须经它**,
测试批次判断在它里面。这样新增外发功能时,绕过它需要**自己写一个 fetch** ——
那是个显式动作,而不是一次遗忘。

配套的门(**没做,等你点头**):禁止 `services.leadconnectorhq.com/contacts` 出现在
那个模块之外。`getFieldMap` 打的是 `/locations/{id}/customFields`(位置级元数据、
不带任何客户数据、与标签污染无关),所以那条要显式豁免。

⚠️ **在这件事落地之前,标签的外发代码一行都不该写。** 给假 contact 打标签的后果比
字段写回失败重:GHL 的标签是**全局的**,`seed-test-*` 那类值会污染整个标签选择器,
而那比清一条失败记录难得多。

## 已做:纯派生 `_shared/ghlTags.ts`(13 条用例,5 次变异)

### 三件你要的,逐条

**① 前缀从 config 推导。** 读 `tags_always` 的模板并填占位符,代码里没有第二份格式串。
占位符登记表把 `{tier_key}` 绑到 `tiers[].key`、`{weakest_1}` 绑到 `dimensions[].key`;
**取值不在域内就不产出那个标签**并报 problem ——
因为拼错的后果不是「字符串不好看」,是在 GHL 里创建一个**永久的全局标签**。

**② mismatch 复用 `isPriorityMismatch`。** 报告页第 7 板块、问卷洞察名单、这个标签
是同一个定义。各写一份的失败形态:同一个人在报告里没被高亮、却被打上了 mismatch 标签,
于是销售拿着一份和学员看到的不一样的判断去沟通,**而没有任何东西会报错**。
`hot_lead` 同理复用 `isHighIntent`。

**③ 旧标签怎么处理 —— 我的判断:要移除,但要有前提。**

一个人身上挂两个互斥的档位标签会让两条 workflow 都触发,所以必须移。成本上:

| 做法 | 代价 | 问题 |
|---|---|---|
| 先 GET contact 的现有标签再算差集 | **多一次读** | 而且拿回来的是客户全部标签,包含大量与本系统无关的 |
| **存我们上次打了什么,只对自己的做差集** | **0 次额外读**,差集非空时才多一次 DELETE | 需要一列 `ghl_tags_applied` |

选后者。两条硬规则:
1. **只移除 `assessment_` 前缀且在上次记录里的标签** —— 客户在 GHL 里有大量别的标签,
   误删不可逆;
2. 差集为空就**不发** DELETE(重答但档位没变的人最常见,那种情况不该多一次 API 调用)。

`TAG_NAMESPACE` 与「全集在命名空间内」那条用例就是这条规则的前提。

### `when` 那些表达式**不求值**

config 里的 `when` 是给人看的(`"total < 2.9 and monthly_marketing_budget >= 2000"`)。
写一个表达式求值器等于在项目里引入一门小语言,而它与那句话的语义会悄悄分叉。
改成**每个条件标签一个具名判定**,外加一条用例断言
「config 里每个 `tags_conditional` 都有对应判定」——
以后有人只在 config 里加一条标签、忘了写代码,**测试会红**,
而不是那个标签静默地永远不打。

阈值那两个数**另有一条用例把 config 的 `when` 与代码里的常量对上**
(从 `when` 里抠出数字来比)。我在注释里写了「有一条用例把两者对上」,
所以那条用例必须真的存在 —— 这个项目栽过太多次「注释声称了一件没人验证的事」。

## 顺带核出来的:PROGRESS 里那份标签清单**四个数字都是错的**

| 文档写的 | config 实际 |
|---|---|
| `total < 55 and >= 3000` | `total < 2.9 and >= 2000`(55 是 0–100 分制的遗留) |
| value_map `0/1500/4000/12000/30000` | `0/700/2000/5500/15000` |
| `assessment_weak_*` **六个** | 5 个(维度只有 5 个) |
| 共 **15 个** | **14 个** |

**而这正是要照着去 GHL 建标签、配 workflow 条件的那一份。** 照错的建,
症状是 workflow 永远不触发、或者触发在错的人身上。已改正,并把真相源换成可推导的
`tagUniverse()`(有用例钉住「清单 = config 推出来的东西」)。

## 反向验证:五次变异

| 变异 | 红的用例 |
|---|---|
| mismatch 自己写一个比较(不复用 surveySignals) | 1 条 |
| 阈值改成旧文档的 55 / 3000 | 2 条,含「与 config 的 when 对上」 |
| 去掉取值域检查(脏值直接拼进标签) | 1 条 |
| 删掉一个条件标签的判定 | 5 条,含「每个 conditional 都要有判定」 |
| 前缀在代码里硬写、不读 config | 2 条,含 `tagUniverse` |

写用例时我自己还栽了一条:最后那条「多占位符要抛」的第一版**在测试里重写了一遍那个判断**
(自己拼 names、自己 throw)—— 验的是我在测试里写的代码,与 `tagUniverse` 会不会抛毫无关系
([判断标准 8](#8-从被测对象推导出来的断言验的是代码和自己一致))。
给 `tagUniverse` 加了可注入的 templates 参数,那条分支才真的被走过。

## 未做(等确认)

- **传输层收口 + 配套的门** —— 见上。这件不落地,外发代码不写
- **`ghl_tags_*` 状态列的迁移**:字段有 `ghl_synced` / `ghl_last_error`,标签要自己一组
  (`ghl_tags_synced` / `ghl_tags_last_error` / `ghl_tags_applied` / `ghl_tags_next_retry_at`)。
  **是一次生产 schema 变更,应用前先确认**
- **GHL 标签 API 的形状没实测过**:按文档假设 `POST/DELETE /contacts/{id}/tags`,
  body `{ tags: [...] }`。与 `customFields` 那次同一个处境 ——
  ⚠️ **绝不能用 contact 的 PUT 带 `tags` 数组**:那是**整体替换**,会抹掉客户其它标签

Node 334 / Deno **192**(+14),十道门全绿。

# Stage 11 标签外发:传输层收口 + 第十一道门

## ① 收口挪到传输层,门比函数重要

`_shared/ghlContact.ts` 是**所有 contact 级 GHL 调用的唯一出口**:
测试批次判断、凭证检查、以及那条不可逆错误的断言都在里面。
`ghlWriteback` 的字段 PUT 也改走它 —— 出口只有一个才叫出口。

`check:ghl-transport`(第十一道门)禁止 GHL 的域名与 `GHL_API_HOST` 常量出现在别处。
**连常量一起守**:只禁域名字面量是不够的,把 `GHL_API_HOST` 导进去拼 URL 一样能绕过,
而且看起来更正当 —— 三次变异里第二条就是这个。

豁免理由**写在被豁免的那一行上方**,不写在门的白名单里:读代码的人正是需要那个理由的人。
门把接受的理由打印出来,所以少于 12 个字符不接受(第三条变异)。
今天两处:`ghlFieldMap`(位置级元数据,不带任何 contact 数据)、
`check-bundle-secrets`(它的工作就是 grep 这个域名)。

### 那条不可逆的断言

GHL 的 contact PUT 接受 `tags` 数组,而那是**整体替换** ——
一次请求抹掉客户在 GHL 里其它所有标签,而那些是他们业务流程在用的。
症状要等某条 workflow 不再触发才被发现,那时没有东西可以还原。

所以 `ghlContactRequest` 对「PUT 且 body 里有 tags」**直接抛**:
这是代码写错了,不是运行时状况 —— 运行时状况要分类要重试,代码写错要在第一次跑到时炸掉。
用例断言两件事:抛,**而且一个请求都没发出去**。第二条才是真正要紧的。

反向锁:`DELETE /contacts/{id}/tags` 带 `tags` 是**合法的增量移除**,不能被这条拦住 ——
写成「任何带 tags 的请求都拦」的话,旧标签就永远移不掉了。
(第一版我确实把 DELETE 也括进了外层条件、再在里面筛一次 PUT,
留下一段什么都不做的结构;已改成它真正的意思。)

## ② 标签写回:独立状态,共享分类

四列已建(`20260812000000_ghl_tags_status.sql`):
`ghl_tags_synced` / `ghl_tags_last_error` / `ghl_tags_next_retry_at` / `ghl_tags_applied`,
加一条与字段那条同形的部分索引。

| 面 | 做法 |
|---|---|
| **独立** | 标签失败不碰 `ghl_synced`,字段失败也不阻止标签尝试。finalize 里两个调用**互不看成败** |
| **共享** | TRANSIENT / CONFIG / AUTH 复用 `classifyGhlError`,退避公式照抄同一条(2^attempts 分钟,上限 6 小时) |

### 移除旧标签的两条硬规则

1. **只碰 `assessment_` 前缀且在 `ghl_tags_applied` 里的**。有一条用例专门喂进
   `vip_customer` / `webinar_2026`,断言它们一个都不被 DELETE ——
   误删客户标签不可逆,而且要等他某条 workflow 不触发才会发现;
2. **差集为空就一个请求都不发**(重答但档位没变最常见),但仍把 `synced` 标上。

`ghl_tags_applied` 存的是**「现在应该是什么」,不是「这次加了什么」**;
而且**失败时不落库** —— 落了就等于宣称当前状态如此,而下一次差集全靠它。
有一条用例专门验「POST 成了 DELETE 被限流」这种半成功:`applied` 不写,下次会重算。

## ③ 一条 cron 扫两组,但用**两条查询**

按你的判断:同一条 cron。频率一样、退避一样、都打同一个上游,分两条只会让 GHL
在同一时刻收到两倍请求。

但取数用**两条各自成形的查询**再按 session 合并,而不是一条嵌套 `or(and(...),and(...))`:
那个形状**本地无处可验**(没有 PostgREST),而写错的后果是整次 sweep 直接报错 ——
**一个静默停摆的重试机制,正是这一轮在补的那个坑**。两条查询各自与已经跑通的那条同形,
而且各走自己的部分索引。两次 DB 读不影响 GHL 并发。

CONFIG/AUTH 的跳过判据改成**各看自己那一列**:字段因为「字段没建」永久失败,
不该让标签也停下来;反过来也一样。

返回值里两组分开数(`fields: {tried, synced}` / `tags: {tried, synced}`)——
「字段成了标签没成」必须在返回值里看得出来,否则又是一个不可表示的状态。

## ④ 建标签的清单:`npm run tags:list`

由 config 推导直接打印,分组给出(每次都打 / 档位 5 个 / 最弱 5 个 / 有条件 3 个 + 条件原文),
**共 14 个**。手抄一遍就会再漂一次 —— 而 PROGRESS 里那份手写清单已经漂过:
`assessment_weak_*` 写着六个、总数写着 15、阈值还是 0–100 分制的 55/3000。

脚本自己还有一条自检:分组没覆盖全就退出码 1 并点名漏了哪个 ——
少列几个的后果是 GHL 里少建几个标签,而对应 workflow 永远不触发。

## 反向验证

| 变异 | 结果 |
|---|---|
| 别处写一个裸的 GHL contact fetch | 门红,点名文件行号 |
| 改成 `import { GHL_API_HOST }` 拼 URL(更正当的绕法) | 门红两处 |
| 豁免理由写成 `ok` | 门红,「理由是给半年后的人读的」 |
| 删掉 PUT-tags 那条断言 | 1 条红 |
| 收口挪到凭证检查之后 | 1 条红(「测试批次的判断在凭证检查之前」)|
| 派生/移除相关 8 条(见 `ghlTagsWriteback_test.ts`) | 全绿基线,单条变异各自红 |

**假 client 的形状错了一次,而是断言把它抓住的**:`isTestSessionCohort` 查的是
`entitlement:assessment_entitlements(cohort:...)` 两层嵌套,我第一版只给了一层,
于是收口读到 `undefined` 判成「不是测试批次」,**请求真的发了出去**。
「测试批次一个请求都不发」那条断言当场红了 ——
而如果那条只看返回值(`ok === false`),这个假货会一直骗着我。

## ⚠️ 未做 / 待验

- **迁移未应用**:`20260812000000_ghl_tags_status.sql` 是加列 + 加索引(附加式,不改已有数据),
  但仍是**一次生产 schema 变更**。本机没有 Postgres,只做了静态审查
- **标签 API 的形状没实测过**:按文档假设 `POST` / `DELETE /contacts/{id}/tags` + `{ tags: [...] }`。
  第一次真实调用会把响应体**完整记进日志**(标签名不是 PII),据此再定判据 ——
  与当初 `customFields` 那次同一个处理,而那次的教训正是「200 不代表写进去了」
- **`ghl_tags_applied` 的历史行是 null**:老数据第一次 sweep 时会把当前该有的标签
  全部 POST 一遍(GHL 对已存在的标签是幂等的,但这一点也**未实测**)

Node 334 / Deno **207**(+15),十一道门全绿。

# 标签一个都没打上 —— 而那次 curl **无法区分两种解释**

## 先排除掉猜测,再给仪器

猜测是「标签那条查询要求 `ghl_tags_next_retry_at` 非 null,而历史行是 null」。
**代码本身就能排除它**:

```ts
.eq('ghl_tags_synced', false)
.or(`ghl_tags_next_retry_at.is.null,ghl_tags_next_retry_at.lte.${'{nowIso}'}`)
```

`is.null` 在 or 里 —— 「从没试过」是被**包含**的。所以那行不是被这个条件排掉的。

## 那次 curl 的输出对两种假设**都成立**

加标签之前,空批次回的是:

```json
{"ok":true,"swept":0,"note":"nothing due for retry"}
```

而加标签之后,空批次回的**逐字相同**(git 对比确认过)。于是:

| 解释 | 与观测一致? |
|---|---|
| ① 部署的还是旧代码 —— 它只查 `ghl_synced = false`,而那行已经 `true`,**根本不挑它** | ✅ 完全自洽 |
| ② 新代码在跑,但标签那条查询没挑中 | ✅ 也说得通 |

**一个对两种假设都成立的观测,不是观测**([判断标准 14](#14-有直接观测可用时先观测再推理))。
所以这一轮**不改逻辑** —— 先把这个响应变成能分辨的东西。

顺带一个推断(**是推断,不是结论**):迁移已经应用了(你读到了 `ghl_tags_synced=false`),
而如果新代码在跑,那行必然被标签查询挑中;而如果标签查询报错,外层 catch 会回 500 而不是 200。
三者合起来,①的可能性大得多。**但仍然要用观测确认,不要用这段推理代替它。**

## 装的仪器:`candidates` 常驻响应

```json
{"ok":true,"swept":0,"note":"nothing due for retry",
 "candidates":{"fields":{"raw":0,"due":0},"tags":{"raw":16,"due":16},"merged":16}}
```

- **响应里有没有 `candidates` 这个键** → 直接说明跑的是哪一版,不用去猜;
- `tags.raw` vs `tags.due` → 分开「查询没挑中」与「挑中了又被 CONFIG/AUTH 前缀过滤掉」。

它**常驻**,不是临时探针:这次排查缺的正是这一格,而下一个人会再缺一次。

非空路径还多两样:`skippedTestCohort`(被传输层收口拦下的条数)与那行 `console.log`。
**「一个请求都没发」与「发了但都失败了」在原来的返回值里长得一样** ——
而两者的差别是 GHL 的全局标签选择器里会不会多出一堆 `assessment_*` 挂在假联系人身上。

## 收口在标签路径上生效吗 —— 这次要**跑**,不靠推理

seed 那 15 条 `ghl_tags_synced=false` / `applied=null`,所以标签查询会挑中它们。
上一轮我说「`ghlContact.ts` 是唯一出口,判断在它里面」——那是**结构上**的论证,
而这次的经历正好说明结构论证不够(上一次的结构论证是
「收在 `syncToGhl` 里,将来 tags 会自动被覆盖」,而那句是假的,见判断标准 20)。

判据定死:`skippedTestCohort` **必须等于被挑中的 seed 行数**,
且那 15 个 session 的 `ghl_tags_applied` **仍然是 null**、
`ghl_tags_last_error` 是 `CONFIG: test cohort — tags intentionally skipped`。

## 顺带:`apikey` 头在这条路径上确实是装饰品

你那条 curl 里 `SUPABASE_PUBLISHABLE_KEY` 是没替换的占位符,而请求照样通了。
本地能查证的那一半:`supabase/config.toml` 里**所有函数都是 `verify_jwt = false`** ——
鉴权全在函数内部(`X-Internal-Secret` / cookie / `X-Admin-Token`),
所以网关不校验那个头,你的观测正是它的证据。

**但边界要说清,别把它当成「key 无所谓」:**

| 路径 | `apikey` 有用吗 |
|---|---|
| Edge Function(`verify_jwt = false`) | ❌ 网关不校验 —— 这条路径上是装饰品 |
| Supabase **Auth**(Admin 的 magic link 登录) | ✅ GoTrue 会校验;key 错了 Admin 登录就坏,那才是换 key 时会炸的地方 |

而**换 key 那轮的结论没有塌**:`npm run smoke` 那条守的是
「线上 bundle 里烘的公开 key **字符串等于**本地那把」—— 它是字符串比对,
不是「请求通了就算」,所以它不依赖网关校验任何东西。

要改的是文档口径:验收步骤里那个头**不是一层保护**,写成必需会让下一个人
以为它在挡什么。已改。

## 未做

- **没有改任何取数逻辑**。要等 `candidates` 的实际值回来再决定改什么
- 收口在标签路径上的真实验证(见上面那条判据)

Node 334 / Deno 207,十一道门全绿。

# Stage 12 地基:语言跟着人走(那个边界**等你定**)

## 已做:判定 + 那一列(与边界无关的部分)

`_shared/lang.ts` 纯函数 + `20260812100000_entitlement_lang.sql`(**未应用**)。

判定给三态,**刻意不合并**:

| 输入 | 判定 | 为什么不合并 |
|---|---|---|
| 没给 / 空串 | `absent` | 正常路径 |
| `zh` / `en` | `set` | 写库 |
| `EN` / `en-US` / `english` | **`invalid`** | 它说明**上游配错了**,与「没给」是两件事 |

合并成一个「回落 zh」会让后者变成静默 —— 而它的症状是「英文客户收到中文链接」,
要等客户投诉才知道。所以判定只做判断,**处置留给各个入口**:
它们的代价不一样(webhook 是**付款**入口,阻塞它的代价比一次语言错大得多)。

大小写**不做兼容**:兼容一个 `EN`,下一次就要兼容 `en_US` / `English` / `eng`,
而每兼容一样,「配错了」这个信号就弱一分。

`?lang=` 是**设置**不是覆盖:`shouldPersistLang` 只在「合法且与库里不同」时给出要写的值 ——
每次页面打开都写会让 `updated_at` 的 trigger 把「有人打开了页面」记成「这行数据变了」。

四次变异:合并 invalid 与 absent / 兼容大小写 / invalid 也写库 / 每次都写库 —— 各自红。

## ⚠️ 你问的那个边界:我的答案与你的倾向**不同**,而且有实测依据

你倾向「webhook 带了 lang 但值不合法 → 400」。理由(拼错的语言码静默变中文,
要等投诉才知道)**我同意前半**。但两件事查证之后我建议不要 400:

### ① 仓库里已经有两条同形的决定,都选了「不阻塞」

`assessment-ghl-webhook` 第 41–43 行,关于 cohort_tag 给错:

> tag 给了但库里没有对应的 active 批次时,**回落到默认批次并带 warning**,
> …应该让它可见(warning + Admin 能看到)而不是让它**阻塞客户**

`webhookPayload.ts` 里 `phone_unparseable` 同样:「记录仍然入库,Admin 标红由人修」。
**只有 `ghl_contact_id` 一个字段能让整个 payload `ok: false`。**

### ② 400 的影响面不是一个人,是一条 workflow 的**全部**客户

那是**付款入口**。GHL 的 workflow webhook 对 4xx 不会有意义地重试
(payload 不变,重试永远同样失败)。所以一个字段映射里的拼写错误 →
**经那条 workflow 付款的每一个人都没有 entitlement、没有链接**。
症状是「我付了钱没收到链接」。

拿它换掉「一个英文客户收到中文链接」,方向反了 ——
后者可以补发,前者要靠客户投诉才知道,而且已经收了钱。

### ③ 但你担心的静默是真的,而问题出在别处:那句「Admin 能看到」**今天是假的**

查证:`assessment_entitlements` **没有 warnings 列**,roster 的 select 里也没有。
warning 只存在于两处 —— 函数日志,和 webhook 的 HTTP 响应体,
**而响应体被 GHL 吞掉**。

所以今天选「warning」等于选「只有日志」,而那对语言错误来说**确实近乎静默**。
你的顾虑成立,只是解法不是拒绝,是**把不可见变可见**。

(这句「warning + Admin 能看到」本身又是判断标准 20 那一族 ——
它读起来像一个已经成立的事实,而不是一个待验证的承诺。这次是第三例。)

### 我的建议:回落 + warning + **让 warning 真的可见**

`assessment_entitlements` 加一列 `warnings text[]`(或 jsonb),webhook 落库时写进去,
Roster 里显示成一格标记。它同时**追补**了 `phone_unparseable` 与 cohort_tag 那两条
早就该可见的 warning —— 那三条现在都只在日志里。

代价:一列 + Roster 一格。收益:「上游配错了」这件事在**运营每天都会看的那个页面上**,
而不是在没人翻的日志里。

**如果你仍然要 400,我照做** —— 那时请一起定:GHL 那边配错时你**怎么知道**?
(否则 400 的症状是「客户付了钱系统里没记录」,而那也要等投诉。)

## 未做

- **webhook 的 lang 入口**(等上面那个边界定下来)
- **另外四处读同一列**:magic link、报告页、PDF 渲染、分享卡、GHL 消息
- **迁移未应用**(加列 + check 约束,附加式;本机无 Postgres,只做静态审查)

Node 334 / Deno **215**(+7),十一道门全绿。

---

## 变更日志

- 2026-08-12 — **标签一个都没打上;而那次 curl 无法区分两种解释,所以先装仪器不改逻辑**。
  猜测(「标签查询要求 next_retry_at 非 null」)被代码排除:`is.null` 就在 or 里。
  真正的问题是**空批次的响应在新旧两版里逐字相同**,于是
  「部署的是旧代码」与「新代码但查询没挑中」都与观测一致 —— 一个对两种假设都成立的观测
  不是观测(判断标准 14)。给 resync 的响应加**常驻**的 `candidates`
  (两条查询各自的 raw / due + merged):**有没有这个键**就说明跑的是哪一版,
  raw 与 due 的差说明是没挑中还是被 CONFIG/AUTH 前缀过滤掉。
  非空路径加 `skippedTestCohort` —— 「一个请求都没发」与「发了但都失败了」
  在原来的返回值里长得一样。
  顺带查清 `apikey`:所有函数 `verify_jwt = false`,网关不校验它,
  在 Edge Function 这条路径上确实是装饰品(Supabase Auth 那条路径上有用);
  而换 key 那轮的结论没塌 —— smoke 守的是 bundle 里 key 的**字符串相等**,不是「请求通了」
- 2026-08-12 — **Stage 11 标签外发 + 第十一道门 `check:ghl-transport`**:
  ①收口从函数级挪到**传输级**(`_shared/ghlContact.ts` 是所有 contact 级 GHL 调用的唯一出口),
  字段 PUT 也改走它;门禁止 GHL 域名**与 `GHL_API_HOST` 常量**出现在别处
  (只禁字面量不够 —— 导入常量拼 URL 一样能绕,而且看起来更正当),
  豁免理由写在被豁免那一行的上方、少于 12 字符不接受
  ②`ghlContactRequest` 对「PUT 带 tags」**直接抛**并断言一个请求都没发出去 ——
  那是整体替换,会抹掉客户其它所有标签,不可逆;反向锁保住 `DELETE /tags` 的合法增量移除
  ③标签写回:四列迁移(独立状态)+ 复用 D9 分类与退避(共享);移除只碰
  `assessment_` 前缀且在 `ghl_tags_applied` 里的,差集为空不发请求;
  `applied` 存「现在应该是什么」且**失败时不落库**
  ④一条 cron 扫两组,但取数用**两条各自成形的查询**再合并 ——
  嵌套 `or(and(),and())` 本地无处可验,而写错会让整次 sweep 报错
  ⑤`npm run tags:list` 由 config 推导打印建标签清单(14 个),脚本自带覆盖自检
  ⑥新增[判断标准 20](#20-关于将来会怎样的注释写下的那一刻起就没有任何东西在验证它)
  ⑦**假 client 形状错了一次**(少了 `entitlement` 那一层),请求真的发了出去 ——
  是「测试批次一个请求都不发」那条断言抓住的
- 2026-08-12 — **Stage 11 标签:纯派生已做,外发等确认**。
  ⚠️ **先确认出来一件要紧的**:`syncToGhl` 里那道测试批次收口的注释写着
  「将来 tags 一写出来就自动被覆盖」——**那句话是假的**。`syncToGhl` 是字段写回专用
  (PUT customFields、按字段映射核对、记 `ghl_synced`),而 D9 要求标签独立,
  所以标签必然是**另一条出站路径**,那条路径上没有收口。收口是按**函数**收的,
  不是按**出站传输**收的,而绕过它的方式是「什么都不做」。
  建议挪到传输层(`ghlContactRequest`)+ 一道禁止裸 GHL contact fetch 的门 ——
  **在那之前标签外发一行都不写**(给假 contact 打标签会污染 GHL 的全局标签选择器)。
  已做:`_shared/ghlTags.ts` 纯派生,前缀与取值域全从 config 推导、
  `when` 不求值改成具名判定 + 一条「每个 conditional 都要有判定」的断言、
  mismatch/hot_lead 复用 surveySignals、`tagUniverse()` 让清单可推导。13 条用例,5 次变异。
  旧标签移除的判断:**要移**,但只碰 `assessment_` 前缀且在 `ghl_tags_applied` 里的,
  差集为空不发请求(0 次额外读)。
  顺带核出 PROGRESS 那份标签清单**四个数字都是错的**(阈值 55/3000、value_map、
  weak 六个、共 15 个)—— 而那正是要照着去 GHL 建标签的一份
- 2026-08-12 — **三件收尾**:①`ghlFieldMap` 补 10 条用例 —— `_resetFieldMapCache` 那句
  「供测试」的注释原本在替一份不存在的覆盖作证,处理是**补上被服务的对象**而不是删掉服务者;
  为可测加了 `nowMs` 参数(默认 `Date.now()`),test task 按名字放开两个 GHL 环境变量、
  **不需要 `--allow-net`**(回源全走 stub 的 fetch)。其中一条把措辞钉给了 `errorKind_test`:
  改掉「credentials missing」那句,分类就从 `config_missing` 掉成 `unexpected`。七次变异
  ②`assessment_results_tier_idx` **留着但标明「建了没人用」**(0 处按 tier 过滤/排序;
  档位分布是在内存里数的)。**没改那条已应用的迁移注释** —— 改了不会动数据库,
  只会让文件与实际执行过的东西不一致
  ③第十道门 `check:crons`:`api/cron/*.ts` 与 `vercel.json` 的 crons **双向**对应。
  成因就是它自己拦的那件事;反方向拦「删了函数忘了删排期」(404 在 cron 历史里也算一次执行记录)。
  明说不校验频率 —— 那需要知道作者的意图,而意图不在文件里。四次变异
  ④**第十道门第一个抓到的又是我自己**:测试文件里写了「不用 `any`」的注释,
  两行后就 `as any`(判断标准 11,连续两轮)
- 2026-08-12 — **补上从未运行过的 GHL 重试 + 第九道门 `lint`**:
  ①新增 `api/cron/ghl-retry.ts` 与 15 分钟排期 —— `ghlWriteback` 写的
  `ghl_next_retry_at` 从来没有任何东西去读,而失败形态极安静(名单页显示「失败」,
  看起来像要人手动处理,实际是系统本该自动处理)。开排期前先确认了测试批次的两层收口
  ②`eslint .` 收进 `build`,清掉 8 条:4 个 `any` 换成三个**最小** interface、
  1 个真死类型 `ResultRow` 删掉、3 处不可见字符改成 `\u3000`/`\uFEFF` 转义并补 BOM 注释
  ③**换掉 `any` 立刻炸出一个真问题**:`?? {}` 让 `ent.id as string` 在 entitlement
  缺失时静默变 `undefined` 并流到导出 CSV;改成在过滤阶段就要求存在(查询是 `!inner`,
  运行时空转,但类型上必要 —— 那正说明它原本就该在)
  ④**新门第一个抓到的是我自己**:我在新 cron 的注释里塞了两个零宽空格来躲开
  `*` 加斜杠闭合块注释,而那正是这条规则要拦的东西(判断标准 11 又一次)
- 2026-08-12 — **记一条元规则:工具用来检查 X 时,它自己也在 X 的作用域内**。
  审计死代码的脚本可以有死代码;检查空断言的测试可以是空断言。
  标本就在上一轮:那个专门找「没被验证的声明」的审计脚本,它的第一版自检
  把假列塞在检查循环**之后** —— 于是它打印「应当被报出来」而报告里仍然是「无」。
  写在[判断标准 1](#1-一道没见过它变红的门不值钱) 里,与推论三(三种绿)相邻
- 2026-08-12 — **「名字像入口但没人引用」六类清单(只列不删)**:npm scripts / `api/**` /
  `vercel.json` / Edge action / `_lib`+`_shared` 导出 / Supabase 表列索引函数 bucket。
  最值钱的两条:①**`npm run lint`(eslint 全量)不在任何一道门里,而且现在就是红的**
  (8 个 error,其中 3 个是 `U+3000`/`U+FEFF` 字面量的误报、1 个是真死类型
  `ResultRow`)②**`assessment-ghl-resync` 存在且正确,但没有任何东西触发它 ——
  GHL 写回失败在生产上从未被重试过**(PROGRESS 里那行「无人请求」读起来像「还没接上」)。
  另有 `_resetFieldMapCache`(为不存在的测试准备的钩子)与
  `assessment_results_tier_idx`(0 处按 tier 过滤)。
  ④ 的朴素扫描报 3 个死 action **全是假阳性**(经变量调用)。
  ⚠️ 审计脚本这次又骗了我三回,全靠自检才暴露(前缀匹配、漏了 `npm test` 别名、
  一条 alter table 只认第一个 add column),而**第一版自检本身是空的**
  (假列塞在检查之后,打印了「应当被报出来」而报告里是「无」)
- 2026-08-12 — **判断标准 1 增加推论三:变异要能区分三种绿** —— 真的守住了 /
  永远绿(tautology)/ **无事可做(断言的前提在 fixture 里不成立)**。
  第三种的标本是「0 行不画条形」那条用了没有 0 的 fixture,与「顺序不能反」同形态。
  关键:**永远绿与无事可做在正常运行时长得一模一样**,所以变异之后要多走一步 ——
  去 fixture 里找那个触发条件的数据
- 2026-08-12 — **判断标准 14 增加推论四:观测环境必须与被观测对象的运行环境一致**。
  与推论二(截断的输出)同族但换了介质:`vmin` 排版的东西嵌在大页面里看,
  尺寸按整页视口算,**失真的观测看起来和真的一样**。同一条标准的另一头占掉了整个
  Stage 9(serverless 的行为只能在部署环境里看)
- 2026-08-12 — **档位 / 最弱两屏的计数不成列**:条形与计数原本同级、宽度按整行百分比,
  0 的行数字贴标签、非 0 的被推到条形末端。改成「定宽标签 | flex-1 轨道 | 定宽计数」,
  顺带修掉「100% 条形挤出计数」。断言钉**轨道存在**(jsdom 不做布局),
  渲染另外在 960×540 视口里真量了一次:五行计数左右边缘逐像素相同。
  三次变异反向验证;写断言时自己踩了两次(`width:\s*\d` 命中标签的 22vmin;
  0 行那条用了没有 0 的 fixture),都是跑变异才发现的
- 2026-08-12 — **现场模式第一屏被读成「14.3」**:人数与平均分同尺寸并排(两个 22vmin),
  两个**量纲不同**的数被排成了同一层级。改成平均分独占主位 30vmin、人数降级成
  「N 人已完成」小字、标签夹在两串数字中间。**断言钉的是「主尺寸只出现一次」** ——
  旧标记的可见文本里两串数字根本不相邻(是**视觉**相邻),文本式断言抓不到;
  字号抽成常量导出、断言钉比值 ≥3。其余三屏逐屏确认没有同样的并排,
  并把那条断言推广到全四屏。四次变异反向验证。
  用构建产物的 CSS 真渲出来看了 —— **第一版看法本身是错的**:嵌在大页面里 `vmin`
  按整页视口算,字号全错;`vmin` 的东西必须在自己的视口里看。
  ⚠️ **会场投影距离下的可读性与真实批次的样子都还没验**(真实批次只有 1 人)
- 2026-08-12 — **问卷洞察 500 + Admin 错误分类**:①`survey_insights` 里 `result` 被写成
  `session` 的兄弟,而 `assessment_survey` 与 `assessment_results` 之间**没有 FK**,
  PostgREST 解析不出来 —— 改为嵌进 `session` 里(**成因是从迁移推出来的,堆栈没贴进来,待部署确认**)
  ②新增 `_shared/errorKind.ts`:四类分类,`kind` + 公开错误码回客户端,
  `details`/`hint`/`message` 只进日志(`42501` 的 hint 是可执行 GRANT)
  ③**两个 `internal_error` 出口区别对待**:名单查询那一处在授权判定之前,只写日志不带分类
  ④`adminApi` 原本只取 `error` 字段 —— 只回不显示等于没回,抽出 `adminErrorMessage()`
  ⑤**五次变异里有一次证明我自己的断言是空的**:那条叫「顺序不能反」的用例对调后仍全绿,
  注释和用例名都是编的([判断标准 8](#8-从被测对象推导出来的断言验的是代码和自己一致));
  改成钉 grep 出来的两条真实消息,顺序保留但理由降级为预防
- 2026-08-08 — **字形自检的覆盖范围小于渲染范围**:扫描只跑在报告页,分享卡上线后
  `glyph: ok` 一直是不完整的结论。改为 `framenavigated` 运行时采集导航路径,
  末尾比对「访问过 / 扫过」,漏扫 → `severity: 'incomplete'` 并点名页面;
  多页结果取并集。四次变异反向验证。查证 ™ 确实不在 subset(cmap),
  但字体栈**本来就有** `'Noto Sans SC'` 兜底,所以方框成因未定 —— 不猜,等自检自己说。
  新增[判断标准 12](#12-覆盖范围是手写的守卫会被代码悄悄长到边界外面--让覆盖由运行时事实驱动)
  (这条已栽八次,且第八次发生在它被写下来之后 —— 因为写在了交接必读之外)
- 2026-08-09 — **分享卡截进了 EN 按钮**:`LanguageToggle` 渲在 `Routes` 之外,靠一份
  `HIDDEN_PREFIXES` 黑名单决定哪里不显示,而 `/share-card` 不在名单里(判断标准 12 又一例,这次手写的是「哪里不要」)。改为新增 `PublicShell` 承载全局 chrome、人面向路由显式套进来 ——
  **默认不带 chrome**,黑名单整份删掉。断言分两半:路由级(MemoryRouter + 真实 AppRoutes)
  守布局漏出,组件级守卡面自己 —— SSR 下 ShareCard 渲成 null,所以路由级看不到卡面,
  两半缺一不可。三次变异反向验证。**Stage 9 收尾**
- 2026-08-09 — ™ 结案:方框是缩略图误读,兜底本就生效,`subset` 补码位取消(不动 CDN)
- 2026-08-08 — **分享卡**(Stage 9 收尾):方形 1080×1080 + 竖版 1080×1920,同一次渲染产出;
  只放总分 / 档位 / 形状 / 品牌,**不放维度分数**(诊断不该被公开对照),
  并配了一组「卡上没有什么」的回归断言;搭 render-pdf 的车不另开管线,
  失败三层关住不许拖累 PDF 与报告页;`RadarPentagon` 加 bare 模式(裁 viewBox 不动几何)。
  三次变异反向验证,**第三次暴露出断言边界没落到元素上**,已修。**未部署、两条迁移未应用**
- 2026-08-08 — **判断标准增至十一条**:新增[第 11 条「新守卫先对现有代码全量跑」](#11-新标准--新守卫上线先对现有代码全量跑一遍--第一批命中的往往是自己刚写的)。
  同时盘清 **Stage 11 只缺一条 cron**(GHL 写回重试),并就地标掉
  [0.4 文件树](#04-文件结构)里那行过时的「双重试」—— 照它建会把 PDF 那半重做一遍,
  两个 sweep 会互相抢着重跑同一批行
- 2026-08-08 — **PDF 定时兜底 sweep**(Stage 9):扫 pending(陈旧 3 分)/ failed /
  rendering(陈旧 5 分),排除 ready 与 failed_permanent,并照抄端点的 `attempts < MAX` 守卫;
  新增 `pdf_status_at` 列(故意不加 trigger)与 `api/_lib/pdfState.ts` 纯函数;
  Vercel Cron `*/10`,BATCH_CAP 3。四次变异反向验证。**未部署、迁移未应用**
- 2026-08-08 — **判断标准增至十条**:新增[第 10 条「用 CSS 表达的意图」](#10-用-css-表达的意图没有渲染断言就要假设它没生效) ——
  CSS 的失效从不抛异常,`max-w` / `overflow` / `truncate` 没有渲染断言就要假设它没生效
- 2026-08-07 — **名单页失败行反而最难操作**:`pdf_last_error` 渲在 PDF 列里,
  而 `max-w-[16rem] break-words` 被 `Td` 继承的 `whitespace-nowrap` 架空,
  1000 字符横线把操作区推出屏幕(表格 3953px,要横滚 2705px)。
  错误移到整行铺开的详情行,PDF 列只留徽章 + 定宽开关;重新生成按钮改为定位留空。
  改后 1814px / 566px。行抽成 `RosterRow` 组件以便断言落在真实标记上,三次变异反向验证
- 2026-08-07 — **字体下载失败的错误归一化**:`chromium.font()` 非 200 时 reject 裸字符串,
  导致最可能的字体失败给出最没信息量的错误(`Unexpected status code: 404.`)。
  包一层带 url + 环境事实 + 三个常见成因的 Error;两个抛点共用 `fontEnvFacts()`。
  同类排查:37 处降级里只有这一处会收到非 Error,**故不抽象**。
  新增[判断标准 9](#9-验一条失败路径要验的不只是它会失败还有它说的话够不够用来定位)。
  **另记一笔:`PostgrestError` 的 `code`/`details`/`hint` 被那 37 处一律丢掉,单独一轮做**
- 2026-08-07 — **雷达维度标签移到五个顶点旁**:新增 `buildLabelAnchors()`(角度仍只有一份),
  标签改为 SVG `<text>` 以免 PDF 打印错位,按象限分三档垂直偏移;删掉图下方那排列表与
  `RadarAxis.color`;viewBox 520×330 + `max-w-xl`。四次变异反向验证。**PDF 里的样子未确认**
- 2026-08-07 — **判断标准增至八条**:新增[第 8 条「从被测对象推导出来的断言」](#8-从被测对象推导出来的断言验的是代码和自己一致)
  (tautology 型)。它与第 4 条(边界太短)是两个不同的失效方式,项目里已撞过两次:
  雷达轴那份重写的副本、状态阶梯那条推导式断言
- 2026-08-07 — **回填迁移** `20260807000000_backfill_entitlement_completed.sql`:
  判据用「有 result」而不是 `session.status`;`completed_at` 取
  `coalesce(session.completed_at, results.computed_at)`,**不用 `now()`**;
  带两条会让迁移回滚的断言。**未应用,也未被执行验证(本机无 Postgres / Docker)**
- 2026-08-07 — **修 `assessment_entitlements.status` 不跟着 finalize 走**:阶梯抽成
  `_shared/entitlementStatus.ts` 两处共用,「只往前走」交给 `.in()` 过滤而不是先读后写;
  7 条新用例经两次变异反向验证。**未部署、历史行未回填**

- 2026-08-07 — **交接整理**:补上四类只活在对话里的东西 —— ①「[判断标准](#判断标准--这个项目反复用到的二十条)」七条(每条附它对应的那次返工)②「[七道门](#十一道门--每一道都是撞出来的)」合并成一节,每道门写明**因为撞了什么才加**③ 状态总览按实际进度更正(4/5/6 原本还写着「未开始」,Stage 6 是 15 题不是 24 题)④ 新增「[当前未完成](#当前未完成)」,含已确认未修的 `assessment_entitlements.status` bug
- 2026-07-31 — rev1 初稿
- 2026-07-31 — rev2:PDF 异步化 + Storage;字体 CDN 化;GHL Inbound Webhook 替代 workflow ID;环境变量改名与新增;D1–D5 批准;新增 D6/D7
- 2026-07-31 — rev4 **Stage 0 定稿**:「8 张表」约束解除,D8 采用第 9 张 `app_settings` 表;D9 定稿(标签独立于字段写入、TRANSIENT/CONFIG/AUTH 三类错误分流、错误具体到字段 key);字体源文件位置与 `.gitignore` 规则确定;0.12 字段清单标记作废(实际前缀为 `qai_assessment_*`);`assessment-config.json` 第三次未送达
- 2026-07-31 — rev3:D6 细则定稿(3 次上限 / `failed_permanent` / 200 字截断 / Admin 重置);GHL scope 批准 + 映射缓存与刷新机制;字体砍到 3 个文件并补三个坑;运维备注 0.17;新增 D8/D9;本地路径确认;`assessment-config.json` 仍未收到
