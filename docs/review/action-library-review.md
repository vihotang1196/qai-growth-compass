# action_library 文案审阅稿

> 生成自 `src/config/assessment-config.json`(config 3.2.0,action_library 指纹 `0c22a1c35ee0`),2026-10-08。
> **这是快照,不是真相源。** 改文案改 config(`npm run config:apply`),然后 `npm run calib:actions` 重新生成这份。
> 同目录的 `action-library-review.csv` 是同样的内容,一行一条,方便在表格里逐条标。

**这些文案出现在哪**:
- **根因**(每维三档,按该维得分取一档)→ 报告「最该先补的两环」板块,只给最弱的两维显示
- **30 天行动**(每维 5 条)→ 报告「接下来 30 天做这 3 件」板块:从最弱两维里挑「该维得分 < 适用上限」的,按排序取前 3 条;
  有「对应题」的那条会显示「现在:你选的选项 → 目标:那题的最高一档」

**怎么标**:读的时候问一句「这像不像我会对学员说的话」。不对的,在那一条的 `[ ]` 里打 x,后面写改成什么(或者只写哪里不对)。

内部说明(不渲染给学员):报告第 6 板块「30 天行动清单」的内容源。选取逻辑：从最弱 2 维各取 applies_below > 该维得分的动作，按 roi_rank 排序，合并后取前 3 条；取不满 3 条则从次弱维补。root_cause 按该维得分落在 low(<2.0) / mid(2.0–3.5) / high(>3.5) 三档取文案。 related_question:该动作要解决的那道题;报告里渲染成「现在的选项 → 顶格选项」的前后对比。null 表示没有合适对应,那条不显示对比行(不为了统一而编)。

## 定目标(Set the Target · `goal`)

### 根因

- **goal.root_cause.low** · low(该维 < 2.0)
  - 中文:你的增长目标还停留在「多赚一点」这种模糊状态。没有具体数字，团队就没有共同方向，每个人凭感觉做事，努力互相抵消。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **goal.root_cause.mid** · mid(2.0–3.5)
  - 中文:你有方向，但没算到底。目标停在营收层，没往下拆到「每月要多少条询盘、成交率多少、能花多少钱获客」——所以你无法判断这个月的投入是多了还是少了。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **goal.root_cause.high** · high(> 3.5)
  - 中文:目标体系已经成形，剩下的是让它活起来：公开、定期对、按实际数据调整。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

### 30 天行动

- **goal_01** · 排序 1 · 难度 中 · 影响 高 · 该维 < 3 时可选 · 对应题 G1
  - 中文:用利润而不是营收给客户类型排序，列出前两类，接下来三个月只主动接这两类
  - English:Rank customer types by profit rather than revenue; list the top two and only pursue those for the next three months
  - [ ] 语气要改 —— 改成 / 意见:

- **goal_02** · 排序 2 · 难度 低 · 影响 高 · 该维 < 3.5 时可选 · 对应题 G3
  - 中文:把今年营收目标倒推成月度询盘量：营收 ÷ 客单价 ÷ 成交率 = 每月需要的询盘数
  - English:Reverse-engineer the annual revenue target into monthly enquiries: revenue ÷ deal value ÷ close rate
  - [ ] 语气要改 —— 改成 / 意见:

- **goal_03** · 排序 3 · 难度 低 · 影响 高 · 该维 < 3 时可选 · 对应题 G3
  - 中文:算出获客成本上限：客单价 × 毛利率 × 30% = 一条成交最多能花多少钱。超过这个数的渠道立刻停
  - English:Calculate your max acquisition cost: deal value × margin × 30%. Cut any channel that exceeds it
  - [ ] 语气要改 —— 改成 / 意见:

- **goal_04** · 排序 4 · 难度 中 · 影响 中 · 该维 < 4 时可选 · 对应题 G2
  - 中文:写一句差异化定位，标准是同行说不出口，然后让三个老客户复述给你听——他们复述不出来就是还没成立
  - English:Write one differentiator competitors can't claim, then ask three existing customers to repeat it back. If they can't, it isn't real yet
  - [ ] 语气要改 —— 改成 / 意见:

- **goal_05** · 排序 5 · 难度 低 · 影响 中 · 该维 < 4 时可选 · 对应题 无(不显示前后对比)
  - 中文:把目标数字放在团队每天看得见的地方，每周固定十五分钟对一次实际值
  - English:Put the target numbers where the team sees them daily; spend fifteen minutes a week comparing against actuals
  - [ ] 语气要改 —— 改成 / 意见:

## 造流量(Create Traffic · `traffic`)

### 根因

- **traffic.root_cause.low** · low(该维 < 2.0)
  - 中文:内容是想起来才发的，所以流量也是想起来才有。没有稳定的内容产出，就不会有稳定的询盘——这一环断了，后面四环再强也没有原料。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **traffic.root_cause.mid** · mid(2.0–3.5)
  - 中文:你在发内容，但产能卡住了。一条视频花好几天，意味着一个月只能试三五个角度——试错次数太少，你永远不知道哪个角度真的有效。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **traffic.root_cause.high** · high(> 3.5)
  - 中文:产能已经不是问题，接下来是把跑得动的那几条放大：加投放、做矩阵、把公域流量沉淀成私域名单。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

### 30 天行动

- **traffic_01** · 排序 1 · 难度 低 · 影响 高 · 该维 < 3 时可选 · 对应题 T1
  - 中文:建一个 Hook 库：把过去三个月表现最好的十条开头抄下来，以后所有内容开头都从这十条改
  - English:Build a hook library: copy the ten best-performing openings from the last three months and adapt all future content from them
  - [ ] 语气要改 —— 改成 / 意见:

- **traffic_02** · 排序 2 · 难度 中 · 影响 高 · 该维 < 3.5 时可选 · 对应题 T2
  - 中文:用 AI 把出片流程标准化，目标是一天十条而不是一周三条——试错次数才是内容的胜负手
  - English:Standardise production with AI: aim for ten pieces a day, not three a week. Iteration count is what wins at content
  - [ ] 语气要改 —— 改成 / 意见:

- **traffic_03** · 排序 3 · 难度 中 · 影响 高 · 该维 < 3 时可选 · 对应题 T1
  - 中文:按客户认知阶段 × 平台排一张内容矩阵表，每格至少一条，避免所有内容都在讲同一件事
  - English:Map a content matrix by awareness stage × platform with at least one piece per cell, so you stop saying the same thing everywhere
  - [ ] 语气要改 —— 改成 / 意见:

- **traffic_04** · 排序 4 · 难度 低 · 影响 中 · 该维 < 3.5 时可选 · 对应题 C1
  - 中文:所有内容的落点统一指向一个入口，不要有的引私信、有的引官网——分散的入口等于没有入口
  - English:Point every piece of content at one entry point. Scattered CTAs are the same as no CTA
  - [ ] 语气要改 —— 改成 / 意见:

- **traffic_05** · 排序 5 · 难度 中 · 影响 高 · 该维 < 4 时可选 · 对应题 T3
  - 中文:挑出自然流量表现最好的三条，用小预算投放测试，ROI 跑正的那条才放大
  - English:Take your three best organic pieces, test them with a small paid budget, and scale only the one that returns positive
  - [ ] 语气要改 —— 改成 / 意见:

## 接客户(Capture Leads · `capture`)

### 根因

- **capture.root_cause.low** · low(该维 < 2.0)
  - 中文:你在漏询盘，而且漏得看不见。客户问了没人回、回了没记录、记录了找不回——每一环都在流失，但没有任何一环会报警。这是五环里最贵的漏洞，因为流失的是已经花钱买来的人。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **capture.root_cause.mid** · mid(2.0–3.5)
  - 中文:你能接住客户，但接住之后就断了。没有统一入口和标签体系，三个月后想找回一个咨询过的人，只能翻聊天记录。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **capture.root_cause.high** · high(> 3.5)
  - 中文:入口和存储都在，接下来是让 AI 承担第一轮对话，把人力留给真正有意向的那部分。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

### 30 天行动

- **capture_01** · 排序 1 · 难度 中 · 影响 高 · 该维 < 3.5 时可选 · 对应题 C2
  - 中文:上 AI 自动对话，先做到十分钟内必有回应——响应速度是转化率最便宜的杠杆，不用改产品不用降价
  - English:Deploy AI conversation to guarantee a reply within ten minutes. Response speed is the cheapest lever on conversion
  - [ ] 语气要改 —— 改成 / 意见:

- **capture_02** · 排序 2 · 难度 低 · 影响 高 · 该维 < 3 时可选 · 对应题 C3
  - 中文:所有询盘统一入 CRM，最少三个字段：来源、产品意向、跟进状态。没入库的询盘等于没来过
  - English:Route every enquiry into a CRM with at least three fields: source, product interest, follow-up status
  - [ ] 语气要改 —— 改成 / 意见:

- **capture_03** · 排序 3 · 难度 中 · 影响 高 · 该维 < 3 时可选 · 对应题 C1
  - 中文:做一个 Lead Magnet（测评 / 清单 / 报告），给感兴趣的人一个比「私信问一句」门槛更低的动作
  - English:Build a lead magnet (quiz, checklist, or report) that gives interested people a lower-friction first step than sending a DM
  - [ ] 语气要改 —— 改成 / 意见:

- **capture_04** · 排序 4 · 难度 低 · 影响 中 · 该维 < 3.5 时可选 · 对应题 C3
  - 中文:给每个投放渠道加 UTM，让「这个客户从哪来」变成可查的事实而不是印象
  - English:Add UTM tags to every channel so "where did this customer come from" becomes a fact you can query
  - [ ] 语气要改 —— 改成 / 意见:

- **capture_05** · 排序 5 · 难度 中 · 影响 中 · 该维 < 4 时可选 · 对应题 C3
  - 中文:建标签体系：按意向度、产品线、阶段打标，为后面的自动培育留接口
  - English:Set up a tagging scheme by intent, product line, and stage — it's the hook automated nurture will need later
  - [ ] 语气要改 —— 改成 / 意见:

## 促成交(Drive Conversion · `convert`)

### 根因

- **convert.root_cause.low** · low(该维 < 2.0)
  - 中文:成交完全靠个人发挥。每一单谈法都不一样，所以好的经验留不下来，新人上手要从零开始，而你自己变成了唯一的成交瓶颈。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **convert.root_cause.mid** · mid(2.0–3.5)
  - 中文:你有流程，但客户在「再考虑一下」那一步大量流失——因为你在讲产品有多好，而不是在讲不解决这个问题的代价。前者是你的事，后者才是他的事。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **convert.root_cause.high** · high(> 3.5)
  - 中文:成交路径已经稳定，剩下的是把异议处理和价值叠加也标准化，让成交率不依赖具体是谁在谈。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

### 30 天行动

- **convert_01** · 排序 1 · 难度 中 · 影响 高 · 该维 < 3 时可选 · 对应题 V1
  - 中文:写一份「不解决的代价」内容：把客户拖着不做的损失换算成具体数字，在报价之前就发给他
  - English:Write a cost-of-inaction piece that converts their delay into a concrete number, and send it before you quote
  - [ ] 语气要改 —— 改成 / 意见:

- **convert_02** · 排序 2 · 难度 中 · 影响 高 · 该维 < 3.5 时可选 · 对应题 V2
  - 中文:整理一套选择标准教客户怎么挑供应商，标准按你的强项设计——他拿去比价反而更信你
  - English:Publish buying criteria that teach customers how to choose, designed around your strengths. Comparison shopping then works in your favour
  - [ ] 语气要改 —— 改成 / 意见:

- **convert_03** · 排序 3 · 难度 中 · 影响 高 · 该维 < 3 时可选 · 对应题 V3
  - 中文:把成交路径写成固定步骤：咨询 → 诊断 → 方案 → 报价 → 跟进，每一步的目标和话术都写死
  - English:Fix the close path into steps — enquiry, diagnosis, proposal, quote, follow-up — with a defined goal and script for each
  - [ ] 语气要改 —— 改成 / 意见:

- **convert_04** · 排序 4 · 难度 低 · 影响 高 · 该维 < 3.5 时可选 · 对应题 V3
  - 中文:收集过去六个月最常听到的五个异议，各写一段标准回应，做成话术库
  - English:Collect the five objections you heard most in the last six months and write a standard response for each
  - [ ] 语气要改 —— 改成 / 意见:

- **convert_05** · 排序 5 · 难度 低 · 影响 中 · 该维 < 4 时可选 · 对应题 无(不显示前后对比)
  - 中文:分渠道分产品记录成交率——不知道成交率，就无法判断问题出在流量还是成交
  - English:Track close rate by channel and product. Without it you can't tell whether the problem is traffic or closing
  - [ ] 语气要改 —— 改成 / 意见:

## 增价值(Increase Value · `value`)

### 根因

- **value.root_cause.low** · low(该维 < 2.0)
  - 中文:你的生意是一次性的。交付完就结束，每个月都要从零开始找新客——而新客成本是老客的五到十倍。这一环不补，前面四环再强也只是在填一个漏底的桶。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **value.root_cause.mid** · mid(2.0–3.5)
  - 中文:你有复购意识，但靠人力驱动。想起来才联系，忙起来就断了，所以老客贡献始终上不去。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

- **value.root_cause.high** · high(> 3.5)
  - 中文:复购机制已经在跑，接下来是设计价值阶梯和转介绍，让老客不只是回购，还带人来。
  - English:(没有英文版 —— 英文报告里这里显示的是中文,Stage 12 的已知缺口)
  - [ ] 语气要改 —— 改成 / 意见:

### 30 天行动

- **value_01** · 排序 1 · 难度 中 · 影响 高 · 该维 < 3.5 时可选 · 对应题 M2
  - 中文:建自动培育序列：交付后第 7 天、第 30 天、到期前 14 天各一次自动触达，不依赖你记得
  - English:Build an automated nurture sequence: day 7, day 30, and 14 days before renewal — none of it depending on you remembering
  - [ ] 语气要改 —— 改成 / 意见:

- **value_02** · 排序 2 · 难度 低 · 影响 高 · 该维 < 3 时可选 · 对应题 M3
  - 中文:在交付完成那一刻要评价——那是客户满意度最高的时刻，过了这个点就难要了
  - English:Ask for the review the moment delivery completes. That's peak satisfaction; ask later and you won't get it
  - [ ] 语气要改 —— 改成 / 意见:

- **value_03** · 排序 3 · 难度 中 · 影响 高 · 该维 < 3 时可选 · 对应题 M3
  - 中文:设计转介绍机制，给推荐人明确的好处——不要指望客户主动帮你介绍
  - English:Design a referral mechanism with a concrete benefit for the referrer. Don't rely on goodwill alone
  - [ ] 语气要改 —— 改成 / 意见:

- **value_04** · 排序 4 · 难度 中 · 影响 高 · 该维 < 3.5 时可选 · 对应题 M1
  - 中文:设计一个低门槛前端产品，把新客第一次成交的决策成本降到最低
  - English:Create a low-friction front-end offer that minimises the decision cost of a first purchase
  - [ ] 语气要改 —— 改成 / 意见:

- **value_05** · 排序 5 · 难度 高 · 影响 高 · 该维 < 4 时可选 · 对应题 M1
  - 中文:梳理完整 Value Ladder：低门槛前端 → 主产品 → 高价后端，每一层都有明确的升级理由
  - English:Map a full value ladder — front-end, core, premium — with an explicit reason to move up at each step
  - [ ] 语气要改 —— 改成 / 意见:
