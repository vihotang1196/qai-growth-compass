# GHL 配置手册

照这份配 GHL 后台。字段名区分大小写,**一个字符都不能改** —— 后端只认这些名字。

---

## 1. 付款 workflow → Webhook action

在付款成功的 workflow 里加一个 **Webhook** action。

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
