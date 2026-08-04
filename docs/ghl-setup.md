# GHL 配置手册

照这份配 GHL 后台。字段名区分大小写,**一个字符都不能改** —— 后端只认这些名字。

## 关于本文档的可信度分级

GHL 后台的实际行为跟它的文档、以及跟「一般 webhook 工具长什么样」都有出入。第 1 节原本写错过一次(说基础 Webhook action 能做响应映射,实际不能),所以本文档里凡是涉及 **GHL 界面怎么操作** 的内容一律标注来源:

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 在真实 GHL 后台跑通过,可以照做 |
| ⚠️ **推测** | 从 GHL 文档或通用模式推的,**没有验证过**。照做时如果对不上,以实际界面为准并回来更新本文档 |

**涉及我们自己后端的部分(URL、header、payload 字段、响应结构、状态码)没有这个问题** —— 那些有代码和测试兜着,不是推测。

---

## 1. 付款 workflow → Webhook action

在付款成功的 workflow 里加一个 **Custom Webhook** action(✅ 实测。**不是基础 Webhook** —— 那个做不到响应写回,原因见下方「Response」一节)。

### 基本设置

| 项 | 值 |
|---|---|
| Method | `POST` |
| URL | `https://<project-ref>.supabase.co/functions/v1/assessment-ghl-webhook` |
| Content-Type | `application/json` |

> **URL 直接指向 Supabase,不走 `compass.qiai.tech/api/`。** 那个 `/api/*` 代理(Stage 4)的存在理由是**浏览器发起的请求**需要 session cookie 保持第一方 —— 跨站 cookie 会被 Safari / Chrome 拦掉。
>
> GHL → 我们是**服务器到服务器**,没有 cookie 参与,走代理只是多一跳、多一个故障点。所以这个 URL **永久指向 Supabase,以后也不需要改**。
>
> 不需要 `Authorization` 或 `apikey` header —— 这个函数以 `verify_jwt = false` 部署,鉴权完全由下面的 `X-QAI-Secret` 承担。

### Custom Header(必须)

| Key | Value |
|---|---|
| `X-QAI-Secret` | 与 Supabase 的 `QAI_WEBHOOK_SECRET` 完全相同的那串 |

**缺这个 header 或值不对 → 401,而且一个字都不会写进数据库。**

### Request Body

```json
{
  "ghl_contact_id": "{{contact.id}}",
  "phone": "{{contact.phone}}",
  "email": "{{contact.email}}",
  "name": "{{contact.name}}",
  "cohort_tag": "2026-08-kl"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ghl_contact_id` | string | ✅ **必填** | 幂等键。**不接受 `contact_id` / `contactId` 等别名** —— 名字配错会直接 400 并把收到的 key 列表回给你,一次就能定位 |
| `phone` | string | 否 | 任意格式都行:`012-436 1382`、`+60124361382`、`0124361382`、全角数字都能解析。解析不出来也不会丢记录(见下方「降级」) |
| `email` | string | 否 | 自动 `trim().toLowerCase()` |
| `name` | string | 否 | 自动 trim |
| `cohort_tag` | string | 否 | 对应 `assessment_cohorts.source_tag`。**不填就落默认批次** |

**为什么只有 `ghl_contact_id` 必填**:客户已经付过钱了。因为一个烂号码、或者 GHL 侧漏映射一个字段,就把整条准入记录丢掉,代价比存一条需要人工修的记录大得多。所以除了幂等键之外全部可选、缺了就降级 + 告警。

多传字段不会报错,会被忽略(GHL 的 webhook action 常常自动塞一堆 `location_id`、`workflow_id` 之类)。

### Response —— ⚠️ 这一步必须配,否则链接发不出去

响应体:

```json
{
  "ok": true,
  "created": true,
  "entitlement_id": "uuid",
  "magic_link": "https://compass.qiai.tech/?t=<43 字符 token>",
  "cohort_source": "tag",
  "phone_parsed": true,
  "warnings": []
}
```

**`magic_link` 必须被写进 contact 的一个自定义字段**,否则到了发链接那一步 GHL 手上没有链接可发。

### ✅ 实测:要两个 action,而且不能用基础 Webhook

**基础 Webhook action 做不到** —— 它是 fire-and-forget,根本不保存响应。

正确做法是两步:

**第一步 —— Custom Webhook action**

| 项 | 值 |
|---|---|
| Action 类型 | **Custom Webhook**(Premium action,**按执行次数计费**) |
| Method / URL / Header / Body | 与上面「基本设置」各节相同 |
| 必须勾上 | **Save response from this Webhook** |
| 配置时 | 先发一次测试请求,让 GHL 记住响应结构 |

**第二步 —— Update Contact Field action**

Custom Webhook 自己**没有映射区域**,它只把响应存起来。所以后面还要接一个 `Update Contact Field`:

| 项 | 值 |
|---|---|
| 字段 | `qai_assessment_magic_link` |
| 值 | `{{custom_webhook.1.response.magic_link}}` |

**⚠️ 变量路径里是 `response.magic_link`,不是 `response.data.magic_link`。**
GHL 把响应包成 `{"status":200,"data":{...}}` 之后,`response` 指向的是 **`data` 那一层**,所以后面直接接我们 JSON 的根字段名。这一条是实测确认的,别按直觉写成 `data.magic_link`。

> ⚠️ **推测**:`custom_webhook.1` 里那个 `1` 应该是 workflow 内 Custom Webhook action 的序号。如果一个 workflow 里有多个 Custom Webhook,序号会变 —— 没验证过,加第二个的时候留意。

### 成本要知道

Custom Webhook 是 **Premium action,按执行次数计费**。这条 workflow 每有一个人付款就执行一次,所以这是**每个付费客户一次的持续成本**,不是一次性的。当前量级下可忽略,但它会随成交量线性增长 —— 记着有这笔。

> 这一处在 Stage 0 的方案里没写清 —— 当时只写了「到指定时间由 GHL 批量发链接」,没说 GHL 从哪拿到链接。**初始链接必须走这条响应写回**;`qai_assessment_report_url` 是答完题之后由 Stage 11 的写回填的,时间点完全不同,不能拿来当发链接的来源。

| 响应字段 | 用途 |
|---|---|
| `magic_link` | **必须映射到自定义字段。** 重复触发返回的是同一个链接(token 不轮换) |
| `created` | `true` 首次建立,`false` 已存在(重复触发)。可用来加分支,不必须 |
| `cohort_source` | `tag` 按标识匹配到 / `default` 落了默认批次 / `none` 连默认批次都没有 |
| `phone_parsed` | `false` 表示号码没解析出来,Admin 名单页会标红 |
| `warnings` | 见下表 |

### 状态码

| 码 | 含义 | 该怎么处理 |
|---|---|---|
| 200 | 成功(新建或更新) | 映射 `magic_link` |
| 400 | payload 不合规,响应里有 `detail` 与 `received_keys` | 对照字段名改 workflow 配置 |
| 401 | `X-QAI-Secret` 缺失或不对。**没有任何写库** | 检查 header |
| 405 | 不是 POST | 改 method |
| 500 | 服务端问题 | 可安全重试 —— 整个入口是幂等的 |

### warnings 的含义

| 值 | 含义 | 要不要处理 |
|---|---|---|
| `phone_unparseable` | 号码给了但解析不出有效 E.164。记录已入库、原值保留在 `phone_raw` | Admin 名单页会标红,人工修 |
| `no_contact_channel` | 手机和邮箱**都**没有。这个人没法走备用路径找回链接 | 要查 GHL 侧的字段映射 |
| `cohort_tag "x" matched no active cohort — fell back to the default cohort` | 标识拼错了或那个批次被停用了 | 修 `cohort_tag` 或去后台激活批次 |
| `no default cohort exists — ...` | 默认批次被人删了 | 立刻处理:基准线与批次看板会整块失效 |

---

## 2. 幂等行为(重复触发时会发生什么)

GHL 会重复触发,这是设计内的。以 `ghl_contact_id` 为冲突键。

| 会被更新 | 绝不会被动 |
|---|---|
| `phone_e164` / `phone_tail` / `phone_raw` | `access_token` —— 重发不轮换,老链接必须继续有效 |
| `email_lower` | `status` —— 不能把一个已完成的人打回 `pending` |
| `name` | `first_login_at` / `completed_at` / `link_sent_at` |
| `cohort_id` | `access_revoked_at` —— 作废是 Admin 的决定,webhook 无权撤销 |

**为什么冲突键用 `ghl_contact_id` 而不是邮箱**:邮箱会变。同一个人改一次邮箱就会变成两条准入记录,两个 token,两份报告。

---

## 3. 重发链接 workflow → Inbound Webhook trigger

Stage 4 的备用路径要用它。**先建好把 URL 给我**,否则重发链接那半边做不完。

### 3.1 建 workflow

GHL 后台 → **Automation → Workflows → Create Workflow → Start from Scratch**。

命名建议 `Compass — Resend Assessment Link`。

### 3.2 Trigger 选 Inbound Webhook

**Add New Trigger → Inbound Webhook**。

选中之后 GHL 会生成一个 URL,长这样:

```
https://services.leadconnectorhq.com/hooks/<location-id>/webhook-trigger/<uuid>
```

**这个 URL 就是我要的 `GHL_RESEND_WEBHOOK_URL`。** 复制给我。

> ✅ **实测确认(原为推测,已升级):**
>
> 1. **必须先打一次样本请求**,字段才会出现在变量选择器里
> 2. 打完之后变量选择器里会出现一个 **"Inbound Webhook Trigger"** 分组,六个字段与样本**逐字对应**:Contact Id / Magic Link / Name / Phone / Email / Lang
> 3. **没有多包一层** —— 直接 `{{inboundWebhookRequest.magic_link}}` 就能取到,不是 `...request.data.magic_link`
>
> 第 3 条与 Custom Webhook 的行为**不一致**:那边响应被包成 `{"status":200,"data":{...}}` 且 `response` 指向 `data` 层,这边 payload 没有被包。**GHL 在这两处的解析规则不同,别互相类推。**
>
> 先用下面的 curl 打一发样本:
>
> ```bash
> curl -X POST '<你的 Inbound Webhook URL>' \
>   -H 'Content-Type: application/json' \
>   -d '{
>     "contact_id": "SAMPLE_CONTACT_ID",
>     "magic_link": "https://compass.qiai.tech/?t=SAMPLE",
>     "name": "Sample Learner",
>     "phone": "+60124361382",
>     "email": "sample@example.com",
>     "lang": "zh"
>   }'
> ```
>
> 字段名要与上面**逐字一致** —— 后续 action 里的 `{{inboundWebhookRequest.<字段>}}` 是按这次样本的结构解析的。样本打完记得别让这个 workflow 真的发消息出去(先别 Publish,或者把 action 暂时禁用)。

### 3.3 本系统实际会发的 payload

```json
{
  "contact_id": "ghl 的 contact id",
  "magic_link": "https://compass.qiai.tech/?t=<43 字符 token>",
  "name": "学员姓名,可能为 null",
  "phone": "+60124361382,可能为 null",
  "email": "learner@example.com,可能为 null",
  "lang": "zh"
}
```

| 字段 | 一定有值? | 用途 |
|---|---|---|
| `contact_id` | ✅ 一定有 | 在 workflow 里定位 contact。**这是唯一可靠的收件人来源** |
| `magic_link` | ✅ 一定有 | 消息正文里的链接 |
| `name` | ⚠️ 可能没有这个键 | 称呼。**必须给它准备兜底**,见下。建议不映射进 Create Contact(3.4.1) |
| `phone` | ⚠️ 可能没有这个键 | Create Contact 的匹配键之一 |
| `email` | ⚠️ 可能没有这个键 | 同上 |
| `lang` | ✅ 一定有 | `zh` 或 `en`,用来分支选模板 |

> **没有值的字段是「这个键不出现」,不是「键在但值为 `null`」。** 例如只有邮箱的学员,payload 里根本不会有 `phone` 这个键。GHL 遇到编译不出值的字段会整个跳过、不写空值 —— 实测确认,见 3.4.1。

### 3.4 Action 结构 —— ✅ 实测:必须先有 Create Contact

```
Inbound Webhook Trigger
  → Create Contact        ← 少了这一步,后面两个 action 挂不上收件人
  → Send Email
  → Send WhatsApp / SMS
```

**为什么必须有 Create Contact**:Inbound Webhook 是外部触发,workflow **没有 contact 上下文**。`Send Email` / `Send WhatsApp` 找不到收件人。Create Contact 按 phone/email 去重,所以它实际是 upsert,不会产生重复联系人。

> 这一步一开始被判断成「不该有」—— 理由是「这条 workflow 是给已在名单里的人重发链接的,不该创建联系人」。那个理由听起来对,但**它假设了 workflow 有 contact 上下文,而 Inbound Webhook 触发的 workflow 没有**。删掉它会得到一条挂不上人的 workflow,而症状是「消息没发出去」,不会指向缺了这个 action。
>
> ⚠️ **推测,值得一试**:我们的 payload 里**一定带 `contact_id`**。如果 GHL 有办法直接按 contact id 绑定 workflow(而不是按 phone/email upsert),那会严格更好 —— 没有 upsert 就没有下面那个覆盖风险。没验证过。

### 3.4.1 ✅ 实测:缺失键不会覆盖,风险不存在

**Create Contact 是 upsert,映射了哪个字段就覆盖哪个字段** —— 而我们 payload 里的 `name` / `phone` / `email` 都可能没有(webhook 入库时就缺)。当时担心的最坏情况是:

> 给一个只有邮箱的学员重发链接 → `phone` 被写空 → **这条 workflow 亲手拆掉自己发 WhatsApp 的通道**。症状是「WhatsApp 没发出去」,没人会往这一步查,而且我们库里那个号码也是 null,补不回来。

**实测证明这个风险不存在。** GHL 执行日志原文:

```
Existing Contact with ID N8GL7vMz64lLeyWfwNJp was found and updated.
Fields included: Email
Skipped Fields: phone (Why? Field {{inboundWebhookRequest.phone}} was invalid
after compiling)
```

三件事一次确认了:

| | |
|---|---|
| **缺失键 → 整个字段被跳过** | GHL 编译不出值就 skip,**不写空值**。`Skipped Fields: phone` |
| **按 email 匹配到已有 contact** | `Existing Contact ... was found and updated`,没有产生重复 |
| **我们这一侧的做法足够** | payload 省掉值为 null 的键,GHL 侧不需要再做任何防护 |

`assessment-login-request` 发出的 payload **不会出现 `null`** —— `buildResendPayload()` 只带有值的键,并且有一条测试穷举 27 种组合断言序列化结果里不含 `null`。

**⚠️ 这个结论的边界:只覆盖「键完全不存在」这一种。**

| 送什么 | 验证状态 |
|---|---|
| **payload 里没有这个键** | ✅ 实测 —— 跳过,不覆盖。**这是我们实际会发的唯一一种** |
| 字段值是 JSON `null` | ❓ 未测 |
| 字段值是空字符串 `""` | ❓ 未测 |

后两种没测,因为我们永远不会发。但**如果哪天有人改了 `buildResendPayload()` 让它开始送 `null` 或 `""`,这个结论就不适用了** —— 那时要重新测,不能假设"缺失键会跳过"能推广到"空值也会跳过"。`resendPayload_test.ts` 里那条穷举断言就是防这个的。

**`name` 要不要映射**:数据丢失的理由消失了(缺失就跳过)。剩下的理由弱一些但仍成立 —— GHL 匹配到人之后名字本来就在,而我们那份可能是残缺的。**建议仍然不映射,但这已经是偏好而不是风险。**

### 3.4.2 双通道发送

按 Stage 0 定的,**同时发 WhatsApp 与 Email**,两条都发,不做二选一 —— 客户丢了链接时我们不知道他哪个渠道能收到。

**Action 1 — Send WhatsApp / SMS**

```
Hi {{contact.first_name}},

这是你的 AI 盈利增长罗盘诊断链接:
{{inboundWebhookRequest.magic_link}}

链接不会过期,随时可以回来继续。
```

**Action 2 — Send Email**,正文同样用 `{{inboundWebhookRequest.magic_link}}`。

三个坑:

1. **收件人用 contact 自己的号码/邮箱,不要用 payload 里的 `phone`/`email`。** trigger 已经带了 `contact_id`,GHL 会把 workflow 挂在那个 contact 上;payload 里那两个字段只是给你排查用的。用 payload 的值反而会绕过 GHL 自己的号码格式处理。
2. **`name` 可能是 null**,别直接插 `{{inboundWebhookRequest.name}}`。用 `{{contact.first_name}}`,或给它配 fallback 值。
3. **`lang` 分支**:如果要中英双模板,加一个 If/Else,条件是 `{{inboundWebhookRequest.lang}}` equals `en`。Stage 4–11 只会发 `zh`,英文要到 Stage 12,所以现在可以先只做中文分支。

### 3.5 建完之后

```bash
# URL 是 secret,只进 Supabase 的 Edge Function secrets。
# 不进 Vercel、不进代码、不进本仓库任何文件。
supabase secrets set GHL_RESEND_WEBHOOK_URL="<Inbound Webhook 的 URL>"
supabase secrets list
```

**Publish workflow 放在最后** —— 等 `assessment-login-request` 部署好、能真正触发一次之后再 Publish。在那之前保持 Draft,免得样本请求或联调把真消息发出去。

### ✅ 实测:trigger 是否有效,可以从响应体判断

**trigger 重建会换 UUID。** 在 GHL 里删掉重建 Inbound Webhook trigger,URL 里的 UUID 就变了,必须重新 `supabase secrets set`。

好消息是这个失败形态**不是静默的** —— 虽然状态码看不出来:

| | 状态码 | 响应体 |
|---|---|---|
| 真 trigger | 200 | `{"status":"Success: request sent to trigger execution server","id":"jgQ3xUHIHauEHadGtRmM"}` |
| 失效 / 不存在的 trigger | **200** | `{"status":"Success: test request received"}` |

差别是**真 trigger 带一个 `id`**。`assessment-login-request` 据此判读,并在缺 `id` 时打 error 日志明确指向 `GHL_RESEND_WEBHOOK_URL` 过期。

**判据用 `id` 有无,不匹配 `status` 文案** —— 文案是 GHL 的实现细节,改一个字检测就静默失效了;`id` 有无是行为差异(进没进执行队列),更稳。

### 能检测什么、不能检测什么 —— 以及一个已知盲区

| 响应 | 能推出什么 |
|---|---|
| 有 `id` | **trigger 存在 且 workflow 已 Publish。两者合一,分不开。** |
| 无 `id` | 请求没进执行队列。**两种可能:** ① trigger 不存在 / UUID 变了 ② **workflow 还是 Draft** |

**Draft 状态下 GHL 回的响应体与假 trigger 完全相同**(都是 `{"status":"Success: test request received"}`),所以这个检测**无法单独证明「trigger 有效」** —— 它证明的是「trigger 存在且处于可执行状态」。

**这是检测本身的边界,不是 bug。** 对生产用途够用:线上 workflow 必然是 Publish 的,无 `id` 就是真出事了。但别让人以为它能单独证明 trigger 有效。

#### 看到「returned no trigger id」时的排查顺序

```
1. 先看 workflow 是不是 Draft        ← Draft 是开发期的常态
2. 再看 GHL_RESEND_WEBHOOK_URL       ← UUID 变了是罕见事件
```

**先查常见的那个。** 反过来会花很长时间去核对一个其实没问题的 URL。函数日志里那条 error 已经按这个顺序写好了。

> 开发期尤其容易撞到:如果先合 main 让 `/api` 代理生效、但 workflow 还没 Publish,那时提交重发表单会走完整流程并留下这条 error —— **那是误报**。避开办法是先 Publish 再测。

#### 仍然检测不到的:消息送达

即使进了执行队列,中途某个 action 可能报错、contact 可能没有可用号码。要闭环到「送达」只有一条路:让 workflow 发完之后回调我们一个端点。那是新功能,目前没建。

> 这一节最初写成了「无法检测,失败是静默的」—— 那个结论错在**只测了假 trigger 一个样本**。一个样本只能说明「假的长这样」,证明不了「真假一样」。做「能不能区分 A 和 B」的判断,两边都要有样本。

### 3.6 安全说明

那个 URL 本身**没有密钥**,拿到的人可以任意触发这个 workflow。

风险是有限的:最坏情况是给**已经在名单里**的人多发一条重复链接。`magic_link` 是我们生成后放进 payload 的,攻击者造不出一个有效链接,也没法让 workflow 发给名单外的人(收件人由 `contact_id` 决定,而那个 id 得先存在)。

但**要当 secret 对待,只进 Supabase 的 Edge Function secrets**,不进 Vercel、不进代码、不进前端 bundle。泄露时在 GHL 重新生成 trigger URL、更新环境变量即可,不用改代码。

我们自己那一侧的防护(IP 限流 15 分钟 5 次 / 超限锁 1 小时 / 同一记录重发间隔 ≥ 60 秒)**始终保留**,不因为这个 URL 的风险有限而放松。

---

## 4. 自定义字段与标签

答完题之后的写回(Stage 11)需要 9 个自定义字段和 6 个标签,清单见 PROGRESS.md 0.12。**那些现在还不用建**,Stage 11 前建好就行。

现在只需要建一个:

| Field Name | Unique Key | 类型 | 用途 |
|---|---|---|---|
| Compass 魔法链接 | `qai_assessment_magic_link` | Single Line Text | 接收 webhook 响应里的 `magic_link` |

---

## 5. 配置密钥

`QAI_WEBHOOK_SECRET` 与 `APP_BASE_URL` 配在 **Supabase 的 Edge Function secrets**,不是 Vercel:

```bash
cd ~/qai-growth-compass
supabase secrets set QAI_WEBHOOK_SECRET="$(openssl rand -hex 32)"
supabase secrets set APP_BASE_URL="https://compass.qiai.tech"
supabase secrets list
```

生成的那串同时填进 GHL 的 `X-QAI-Secret` header —— 两边必须完全一致。

> `supabase secrets set` 需要先 `supabase link --project-ref <ref>`。
> `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 由平台自动注入,**不要手动设**。

---

## 6. 部署顺序(有依赖,别反过来)

```bash
cd ~/qai-growth-compass && git pull

# 1) 先应用 migration —— 四个,含原子 upsert 函数
supabase db push

# 2) 再部署函数。走 npm 脚本而不是裸 CLI ——
#    它会先跑一遍 npm run verify(含 check:dep-sync,那道门现在会校验
#    import_map 是否声明、deploy 时拿不拿得到 import map)
npm run deploy:functions
```

本机没跑 Docker 的话:`npm run verify && supabase functions deploy --use-api`

**顺序反了的话**:函数会调用一个还不存在的 RPC `upsert_assessment_entitlement`,每次请求都 500,而且 500 的响应体不带细节(故意的),排查得去看函数日志。

### `config.toml` 里的两条声明,都是必需的

```toml
[functions.assessment-ghl-webhook]
verify_jwt = false
import_map = "./functions/deno.json"     # 路径相对 supabase/
```

**`verify_jwt = false`** —— 不需要再加 `--no-verify-jwt` flag。config.toml 是持久化的、进仓库的、换机器一致;flag 只作用于那一次 deploy。两个都写重复但无害。

**`import_map`** —— 这条是第一次 deploy 失败的根因。我们的 import map 在 `supabase/functions/deno.json`,也就是**函数目录的上一层**;CLI 为某个函数查找 import map 时不会往上找,于是那份文件根本没被上传,服务端打包器拿不到映射:

```
Relative import path "@supabase/supabase-js" not prefixed with / or ./ or ../
  at .../_shared/supa.ts:1:51
```

map 放共享位置是有理由的 —— `libphonenumber-js` 的版本必须与 `package.json` 一致(`check:dep-sync` 守着),一份共享的 map 才守得住。所以修法不是把 map 复制到每个函数目录下,而是显式声明路径。

**这条声明现在由 `npm run check:dep-sync` 强制**:函数目录存在却没有对应的 `[functions.<name>]` + `import_map`,或者 `import_map` 指向另一份没人校验的 map,构建直接失败。

> 如果 deploy 仍然报同样的错,说明这个 CLI 版本不认 config.toml 里的 `import_map`(我没能在本地证明它认 —— `supabase config push` 对未知 key 和合法 key 报同一个错)。那就退到 flag,它在 `--help` 里是明确存在的:
> ```bash
> npm run verify && supabase functions deploy --import-map supabase/functions/deno.json
> ```
> 两种都失败再走 B 方案(源码里写全 `npm:@supabase/supabase-js@2.110.8`),但那要同时改 `check:dep-sync` 去扫源码里的版本号,否则守卫就变成在验一份没人用的配置。

### 为什么这个函数不校验 JWT 是安全的

| | |
|---|---|
| **必须关** | GHL 没有 Supabase 身份,它签不出 JWT。开着 `verify_jwt` 的话每一个真实调用都会在我们的代码运行之前被平台以 401 拒掉 —— 功能直接不可用 |
| **鉴权由谁承担** | `X-QAI-Secret` 与 `QAI_WEBHOOK_SECRET` 定长比较(先 sha256 压等长,再无分支异或),**在任何数据库操作之前**返回 401 |
| **失败形态** | 401 + 零写入 + 响应体不透露任何与密钥相关的信息 |
| **service role key 的暴露面** | 未变。它由平台注入进函数进程,不经过请求、不进响应、不进 bundle |

**代价要说清楚,不粉饰**:`verify_jwt = false` 意味着这个 URL 对整个互联网可达 —— 任何人都能 POST 它并拿到 401。丢掉的是"平台层先挡掉匿名流量"这一层,剩下的是**函数调用次数会被垃圾流量消耗**。

这跟 Stripe / GHL 之类所有 webhook 接收端是同一处境:接收端必须公开可达,鉴权只能靠共享密钥。当前量级下不需要处理;真被刷了再上 IP 限流或 Cloudflare 前置。

> 顺带一句:`supabase link` 可能会把 `project_id = "<ref>"` 写进 `config.toml`,让工作区变脏。**建议直接 commit 它** —— project ref 不是密钥,它出现在每一个 API URL 里,Supabase 官方模板也是提交它的。别为了它把 `config.toml` 加进 `.gitignore`,那会连 `verify_jwt` 的声明一起丢掉。
