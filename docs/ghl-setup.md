# GHL 配置手册

照这份配 GHL 后台。字段名区分大小写,**一个字符都不能改** —— 后端只认这些名字。

---

## 1. 付款 workflow → Webhook action

在付款成功的 workflow 里加一个 **Webhook** action。

### 基本设置

| 项 | 值 |
|---|---|
| Method | `POST` |
| URL | `https://compass.qiai.tech/api/assessment-ghl-webhook` |
| Content-Type | `application/json` |

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

**`magic_link` 必须被映射进 contact 的一个自定义字段**,否则到了发链接那一步 GHL 手上没有链接可发。

在 GHL 的 Webhook action 里把响应字段 `magic_link` 映射到自定义字段(建议 key:`qai_assessment_magic_link`,类型单行文本)。

> 这一处在 Stage 0 的方案里没写清 —— 当时只写了「到指定时间由 GHL 批量发链接」,没说 GHL 从哪拿到链接。**初始链接必须走这条响应映射**;`qai_assessment_report_url` 是答完题之后由 Stage 11 的写回填的,时间点完全不同,不能拿来当发链接的来源。

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

(Stage 4 才会用到,先建好即可)

在发链接的 workflow 里加一个 **Inbound Webhook** trigger,GHL 会生成一个 URL —— 那个 URL 填进 Supabase 的 `GHL_RESEND_WEBHOOK_URL`。

本系统重发时会 POST:

```json
{
  "contact_id": "...",
  "magic_link": "https://compass.qiai.tech/?t=...",
  "name": "...",
  "phone": "...",
  "email": "...",
  "lang": "zh"
}
```

workflow 里用 `{{inboundWebhookRequest.magic_link}}` 取值,发 WhatsApp + Email 双通道。

> 那个 URL 本身没有密钥,拿到的人可以任意触发这个 workflow。风险有限(最坏是给已在名单里的人多发一条重复链接,`magic_link` 是我们生成后放进 payload 的,攻击者造不出有效链接),但**要当 secret 对待,只进环境变量**。泄露时在 GHL 重新生成该 trigger URL 并更新环境变量即可,不用改代码。

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
