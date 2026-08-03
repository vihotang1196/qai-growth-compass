/**
 * 共享密钥校验。
 *
 * 【为什么先哈希再比】直接逐字节比较两个不等长的串,长度本身就会泄露信息;
 * 而提前 return 也会让比较耗时随匹配前缀长度变化。先 sha256 把两边压成
 * 等长的 32 字节,再做无分支的全量异或累加,耗时与输入无关。
 *
 * 与 api/font-probe.ts 的 secretMatches 同一套做法(那边用 node:crypto 的
 * timingSafeEqual,这边是 Deno 的 Web Crypto,没有现成的定长比较原语)。
 */

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

export async function secretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!provided || !expected) return false;
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
