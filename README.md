# AI 盈利增长罗盘™ — 学员诊断系统

Q.AI Growth Compass。学员付款后由 GHL 触发准入,凭魔法链接登录,做 3 题背景 + 24 题测评 + 7 题问卷,即时出诊断报告,结果写回 GHL 触发跟进。

**本系统不做支付,也不做发链接。** 支付是 GHL 的事,发链接是 GHL workflow 的事。

进度与全部设计决策见 [PROGRESS.md](./PROGRESS.md) —— 那是唯一真相源。

## 技术栈

Vite + React + TypeScript + Tailwind + Radix primitives + Supabase + Vercel

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入实际值
npm run dev
```

组件展示页在 `/_showcase`。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | CJK 检查 → 类型检查 → 打包 → 产物泄密检查 |
| `npm run lint` | 完整 ESLint |
| `npm run lint:cjk` | 只查组件里的硬编码中文(构建门禁) |
| `npm run check:bundle` | 检查 secret 有没有被打进客户端 bundle |
| `npm run fonts:subset` | 从 `assets/fonts/` 生成 subset woff2 |

## 两条容易踩的规矩

**1. 组件里不许出现中文。** 所有界面文案放 `src/config/ui-strings.ts`,题库与报告文案放 `src/config/assessment-config.json`。`npm run build` 会拦,拦到就构建失败。

**2. 只有 `VITE_` 前缀的变量会进客户端 bundle。** 任何 secret 都不许加这个前缀。`npm run build` 末尾会扫产物,扫到 service role key、GHL token 之类的字样就失败。

## 字体

网页与 PDF 共用一套家族名,顺序不能改:

```
'Sora' / 'Plus Jakarta Sans'  → 拉丁字母与数字
'Noto Sans SC Subset'         → CDN 上的 subset woff2,常用中文
'Noto Sans SC'                → PDF 渲染时 chromium.font() 装的完整字体,生僻字兜底
```

后两个的家族名**必须不同**。若 `@font-face` 也叫 `Noto Sans SC`,它会遮蔽同名系统字体,缺字时不会回落,整个兜底层失效。详见 PROGRESS.md 0.14。

原始字体放 `assets/fonts/`(已 gitignore,不进仓库)。
