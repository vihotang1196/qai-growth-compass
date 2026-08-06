/**
 * Deno 侧再导出 —— 实现只有一份,在 src/lib/renderToken.ts。
 * assessment-report 用 verifyRenderToken 接受渲染器那条入口;
 * 签发在 Node 侧(api/render-pdf.ts),两边同一份实现、同一个密钥。
 */
export { RENDER_TOKEN_TTL_SEC, signRenderToken, verifyRenderToken } from '../../../src/lib/renderToken.ts';
