import { describe, expect, it } from 'vitest';
import { RENDER_TOKEN_TTL_SEC, signRenderToken, verifyRenderToken } from './renderToken';

const SECRET = 'internal-fn-secret-for-tests';
const OTHER = 'a-different-secret';
const NOW = 1_800_000_000_000;
const SID = '7f3a2b10-0000-4000-8000-000000000001';

describe('renderToken', () => {
  it('round-trips the session id', async () => {
    const t = await signRenderToken(SID, SECRET, NOW);
    expect(await verifyRenderToken(t, SECRET, NOW)).toBe(SID);
  });

  it('still valid just before expiry, invalid just after', async () => {
    const t = await signRenderToken(SID, SECRET, NOW);
    const justBefore = NOW + (RENDER_TOKEN_TTL_SEC - 1) * 1000;
    const justAfter = NOW + (RENDER_TOKEN_TTL_SEC + 2) * 1000;
    expect(await verifyRenderToken(t, SECRET, justBefore)).toBe(SID);
    expect(await verifyRenderToken(t, SECRET, justAfter)).toBeNull();
  });

  it('a token signed with another secret does not verify', async () => {
    /**
     * 渲染令牌与 session cookie 用不同的密钥,所以两者不可互换 ——
     * 一个泄漏的渲染令牌不能当成 30 天登录态用。这条钉住那个隔离。
     */
    const t = await signRenderToken(SID, OTHER, NOW);
    expect(await verifyRenderToken(t, SECRET, NOW)).toBeNull();
  });

  it('a tampered payload does not verify', async () => {
    const t = await signRenderToken(SID, SECRET, NOW);
    const [, sig] = t.split('.');
    const forged = `${btoa('other-session.99999999999').replace(/=+$/, '')}.${sig}`;
    expect(await verifyRenderToken(forged, SECRET, NOW)).toBeNull();
  });

  it('malformed input returns null rather than throwing', async () => {
    for (const bad of [null, undefined, '', 'nodot', '.onlysig', 'payload.', '!!!.???']) {
      expect(await verifyRenderToken(bad as string | null, SECRET, NOW)).toBeNull();
    }
  });

  it('two tokens for the same session differ once time moves (exp is inside the payload)', async () => {
    const a = await signRenderToken(SID, SECRET, NOW);
    const b = await signRenderToken(SID, SECRET, NOW + 2000);
    expect(a).not.toBe(b);
  });
});
