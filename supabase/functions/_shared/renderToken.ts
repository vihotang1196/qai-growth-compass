/**
 * Deno 侧再导出 —— 实现只有一份,在 api/_lib/renderToken.ts。
 * (放在 api/ 下是因为 Vercel 只编译 /api 内的 TS,见那个文件头的说明。)
 * assessment-report 用 verifyRenderToken 接受渲染器那条入口;
 * 签发在 Node 侧(api/render-pdf.ts),两边同一份实现、同一个密钥。
 */
export { RENDER_TOKEN_TTL_SEC, signRenderToken, verifyRenderToken } from '../../../api/_lib/renderToken.ts';
