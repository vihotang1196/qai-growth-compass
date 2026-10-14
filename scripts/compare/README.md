# 改版前后的本地比对(2026-10-14,PROGRESS ⑦ 边框那一次用的)

只在本机跑:Chrome(默认 macOS 的 Google Chrome,别处用 `CHROME_PATH`)+ `swiftc`(macOS 自带 PDFKit)。不连后端:
每个 `/api/*` 都在浏览器里用固定数据回答;后台用的是本地占位 session。唯一的外网请求是公开 CDN 上的字体。

1. **两份构建**:改之前、改之后各 `VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_PUBLISHABLE_KEY=offline-preview-not-a-real-key npx vite build --outDir <dir>`
2. **报告数据**:`npm run snapshot:reports -- --out=<snap.json> --reader=latest`(只读;不含姓名 / 电话 / 邮箱 / token,问卷只留指纹),
   取测试批次里的人(`test: true`)。`batch-pdfs.mjs` 直接读 snap.json;`render-artifacts.mjs` / `shoot-pages.mjs` 要一份单人的 payload
   (把 `survey` 置 `{}`、`files` 全部 absent、各个 URL 置 null —— PDF 渲染那一刻线上也是这个状态)
3. **渲染**:`render-artifacts.mjs`(中英文 PDF + 两张分享卡,步骤照抄 `api/render-pdf.ts`)、`batch-pdfs.mjs`(所有测试人的中英文 PDF)、
   `shoot-pages.mjs`(落地 / 答题 / 问卷 / 报告 / 后台名单 / 现场模式,手机 390 与电脑 1366,首屏 + 整页)
4. **比对**:`swiftc -O pdftool.swift -o pdftool`;`pdftool pages` 把 PDF 拆成每页 PNG + 每页文字与最低一行的位置,`pdftool diff` 逐像素比两张图;
   `compare-pdfs.mjs` 出逐页表(页数、页面尺寸、每页文字、首行 / 末行、最低一行、变了多少像素);`compose.mjs` 拼前后对比图
5. **噪声底**:同一份构建跑两遍,PDF 与分享卡应当逐像素相同(2026-10-14 实测为 0)—— 先确认这一条,之后的差别才能算到改动头上

与线上的差别(所以是代理观测):本机 Chrome 155、CoreText 光栅化;线上是 @sparticuz Chromium 149、FreeType + 中文兜底字体层。
