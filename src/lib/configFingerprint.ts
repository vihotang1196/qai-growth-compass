/**
 * config 的内容指纹 —— 出分时写进 `assessment_results`,事后追溯「这份分数是按哪一版 config 算的」(PROGRESS ⑩)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么指纹为主、版本号只作标签】版本号要人记得升,而 git 历史里已经有一次没升:
 * 2026-08-14 `659082f` 改了 config,`meta.version` 仍是 3.2.0。指纹不靠任何人记得。
 * 版本号仍然一起记(人看得懂),并由 `config-fingerprints.json` 登记表 + 测试让它说真话。
 *
 * 【规范化】键排序、数组保序,其余与 JSON.stringify 相同 —— 所以文件的空格、换行、键的先后都不影响指纹,
 * 而题目或选项的先后会(那是真的改动)。整份 config 一起算,不挑段:挑段迟早漏段。
 *
 * 【两个运行时】出分函数在 Deno 里算,登记表由 Node 写。两边都用 Web Crypto + 同一个 V8 的数字格式;
 * 「两边算出同一个值」不靠推理,由 Node 与 Deno 两边各一条「等于登记的那个」的测试量出来。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 键排序的 JSON。对 JSON 能表示的值,除键序外与 JSON.stringify 逐字相同 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 64 位小写十六进制的 sha256(规范化 JSON 的 UTF-8 字节) */
export async function configFingerprint(config: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(config));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 出分时写进结果的那两列 */
export interface ConfigStamp {
  config_version: string | null;
  config_sha256: string | null;
}

/**
 * 两列一起算。**从不抛**:出分不能因为记不了版本而失败 ——
 * 算不出指纹时两列都写空(只写版本号会让它看起来像一份完整的记录),记一行日志。
 */
export async function configStamp(
  config: unknown,
  log: (line: string) => void = console.error,
): Promise<ConfigStamp> {
  try {
    const sha = await configFingerprint(config);
    const version = (config as { meta?: { version?: unknown } } | null)?.meta?.version;
    return { config_version: typeof version === 'string' ? version : null, config_sha256: sha };
  } catch (err) {
    log(`config fingerprint failed, scoring continues without it: ${err instanceof Error ? err.message : String(err)}`);
    return { config_version: null, config_sha256: null };
  }
}
