/**
 * access_token 生成。
 *
 * 32 字节 CSPRNG → base64url 无填充,43 个字符。
 * 用 base64url 而不是 hex:同样 256 bit 熵,长度从 64 降到 43,
 * 魔法链接在 WhatsApp 里少折一行。
 *
 * 【重发不轮换】这个函数只在【首次创建】entitlement 时调用一次。
 * webhook 重复触发时不会重新生成 —— 客户可能同时收到新旧两条消息,
 * 两条链接都得能用。见 PROGRESS.md D4 与 access_revoked_at 的列注释。
 */
export function generateAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 拼魔法链接。lang 不带 —— 初始链接一律默认语言,客户自己切 */
export function magicLink(appBaseUrl: string, accessToken: string): string {
  const base = appBaseUrl.replace(/\/$/, '');
  return `${base}/?t=${accessToken}`;
}
