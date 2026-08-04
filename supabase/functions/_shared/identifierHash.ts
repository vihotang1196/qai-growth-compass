/**
 * 登录尝试记录里的标识哈希。
 *
 * 【为什么要加 pepper】手机号的取值空间很小,裸 sha256 一个马来西亚手机号
 * 暴力反推只需要几秒。加一个只存在于环境变量里的 pepper,`login_attempts` 这张表
 * 即使整表泄露也反推不出号码。
 *
 * 【为什么不直接存明文】这张表的用途只是「同一个标识最近试了几次」,
 * 不需要知道它是谁。存明文等于凭空多一份联系方式副本。
 */
export async function hashIdentifier(identifier: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${pepper}:${identifier}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
