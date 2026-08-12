/**
 * 把一个 catch 到的东西分成几类 —— **纯函数,没有 IO**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要分类:`internal_error` 不带任何信息,等于每次都得去翻日志】
 *
 * 与 `server_misconfigured` 那次同一个做法:**响应体不回细节,但要回一个分类** ——
 * 够判断「去哪找」就行。`query_failed` 让人直接去看那条查询;
 * `config_missing` 让人去看环境变量;两者的排查动作完全不同,
 * 而 `internal_error` 对这两种情况说的是同一句话。
 *
 * 【什么可以回给客户端,什么只能进日志】
 *   ✅ `kind` —— 我们自己定义的四个词,不含任何库内信息
 *   ✅ `code` —— PostgREST / Postgres 的公开错误码(`PGRST200`、`42501`)。
 *      它们是公开的错误分类学,不是数据;而它恰恰是「去哪找」最有用的那一格
 *   ❌ `details` / `hint` / `message` —— **只进日志**。
 *      权限类错误(`42501`)的 `hint` 里是**可执行的 SQL**,含表名与角色名;
 *      那种东西回给浏览器就是在教对方怎么绕过。
 *
 * 【顺带兑现一件挂了很久的事】`PostgrestError` 除了 `message` 还带
 * `code` / `details` / `hint`,而仓库里 37 处降级全都只取 `.message`,把另外三个丢了 ——
 * 权限类错误的可执行信息常常正在 `hint` 里。这里的日志把四个都打出来。
 * 其余 36 处仍未改,单独一轮(PROGRESS 里已记)。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ErrorKind = 'query_failed' | 'config_missing' | 'upstream_failed' | 'unexpected';

export interface ClassifiedError {
  kind: ErrorKind;
  /** 公开错误码,可以回给客户端;拿不到就是 null */
  code: string | null;
  /** 给 `console.error` 的那一行 —— **不要回给客户端** */
  log: string;
}

/** PostgREST 回的是 `PGRST###`,Postgres 回的是 5 位 SQLSTATE(如 `42501`、`23505`) */
function looksLikeDbCode(code: unknown): code is string {
  return typeof code === 'string' && (/^PGRST\d{3}$/.test(code) || /^[0-9A-Z]{5}$/.test(code));
}

export function classifyError(err: unknown): ClassifiedError {
  const e = (err ?? {}) as Record<string, unknown>;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);

  // ① 数据库 / PostgREST —— 有公开错误码,而且 hint 常常直接说了怎么修
  if (looksLikeDbCode(e.code)) {
    const parts = [
      `code=${e.code}`,
      `message=${message}`,
      e.details ? `details=${String(e.details)}` : '',
      e.hint ? `hint=${String(e.hint)}` : '',
    ].filter(Boolean);
    return { kind: 'query_failed', code: e.code, log: parts.join(' | ') };
  }

  /**
   * ② 配置缺失 —— 我们自己抛的那几种措辞。
   *
   * 【环境变量名那部分【区分大小写】】环境变量是 SCREAMING_SNAKE,
   * 而带 `/i` 的 `[A-Z_]{3,}` 会把「missing the file」这种也吃进来。
   * 大小写本身就是这里的判别依据,不是随手加的严格。
   *
   * 【`missing\W*` 而不是 `missing `】第一版写成了后者,于是
   * `GHL credentials missing (GHL_PRIVATE_TOKEN)` 掉进了 unexpected ——
   * `missing` 后面是括号。那条用例本来是钉「顺序不能反」的,
   * 结果抓到的是覆盖太窄:**它比我写它时想的更有用。**
   */
  const configCaseSensitive = /missing\W*[A-Z_]{3,}|neither [A-Z_]{3,} nor [A-Z_]{3,}/;
  const configPhrases = /not configured|server_misconfigured|credentials missing/i;
  if (configCaseSensitive.test(message) || configPhrases.test(message)) {
    return { kind: 'config_missing', code: null, log: message };
  }

  /**
   * ③ 外部调用失败。
   *
   * 【配置在前、上游在后是一条【预防性】的优先级,不是在修一个现存 bug】
   * 我第一版的注释写的是「顺序反了会把 GHL 凭证缺失归错类」—— 那是**编的**:
   * 把这两段对调后跑测试,168 条全绿,因为今天没有任何一条真实消息同时命中两套模式。
   *
   * 但它确实离重叠只差一步:真实消息里有
   * `GHL credentials missing for field-map fetch` —— 结尾那个 `fetch`
   * 正是「把上游模式放宽成裸 `fetch`」时会踩到的词,而那么放宽之后
   * 顺序就立刻承重了,排查方向会从「去配变量」变成「去查 GHL 是不是挂了」。
   * 所以顺序留着,理由降级为预防;而下面那条用例改成钉**真实消息的归类**,
   * 不再假装自己钉住了顺序(判断标准 8:同义反复的断言)。
   */
  if (/fetch failed|ECONN|ETIMEDOUT|network|returned \d{3}|upstream/i.test(message)) {
    return { kind: 'upstream_failed', code: null, log: message };
  }

  // ④ 认不出的一律 unexpected —— **不猜**。猜错的分类比不分类更糟:
  // 它会把人送到错误的地方,而且送得很有信心
  return { kind: 'unexpected', code: null, log: message };
}
