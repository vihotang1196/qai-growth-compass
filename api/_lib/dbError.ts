/**
 * 数据库错误的统一出口 —— **纯函数,没有 IO,没有导入**。
 *
 * Node(Vercel)与 Deno(Edge Functions)共用:Deno 侧 `_shared/errorKind.ts`
 * 从这里再导出(`.ts` 直接路径,与 `_shared/testCohort.ts` 同一做法 —— 本文件没有导入,
 * 所以不需要 `deno.json` 里的 `.js` 重映射)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么要有它:supabase-js 返回的 `error` 不是 Error】
 *
 * `const { error } = await supa.from(...)` 里的 `error` 是 `JSON.parse(body)` 出来的
 * **普通对象**【实测 postgrest-js 2.110.8 源码 + stub fetch 跑真客户端】;
 * 只有 `.throwOnError()` 才 `new PostgrestError(...)`。于是:
 *   - `if (error) throw error` 抛出的是普通对象,没有堆栈;
 *   - catch 处的 `err instanceof Error ? err.message : String(err)` 得到 `[object Object]`。
 * 2026-10-07 盘点:全仓 49 处这样抛,其中 35 处最终只记下 `[object Object]`。
 *
 * 【四个出口】
 *   dbFail(ctx, error)      取代 `if (error) throw error` —— 抛一个带上下文的真 Error
 *   dbLogLine(ctx, error)   取代「打印 .message 然后继续」—— 只返回一行,从不抛
 *   describeError(err)      取代 catch 处的 `String(err)`;也是原来的 `classifyError`
 *   DbError                 上面抛出的那个类(给 instanceof 用)
 *
 * 【什么可以回给客户端,什么只能进日志】(沿用 errorKind 的约定)
 *   ✅ `kind` —— 我们自己定义的四个词
 *   ✅ `code` —— PostgREST / Postgres 的公开错误码(`PGRST200`、`23505`)
 *   ❌ `log` / `details` / `hint` / `message` —— **只进日志**
 *
 * 【日志也要脱敏,而且先脱敏后截断】见 `redactText`。
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

/**
 * 一次数据库操作的上下文。**只收 id 与我们自己的常量** —— 邮箱、手机号、token 不该进这里;
 * entitlement / session 不像 UUID、lang 不像语言码时,输出里会被替换掉(见 `ctxPrefix`)。
 */
export interface DbCtx {
  /** 函数名,如 'assessment-quiz' */
  fn: string;
  /** 操作,如 'assessment_answers.upsert' */
  op: string;
  entitlement?: string | null;
  session?: string | null;
  lang?: string | null;
}

export const REDACTED = '<redacted>';

/** 每个字段(message / details / hint)脱敏之后的长度上限 */
const FIELD_MAX = 300;

/** PostgREST 回的是 `PGRST###`,Postgres 回的是 5 位 SQLSTATE(如 `42501`、`23505`) */
function looksLikeDbCode(code: unknown): code is string {
  return typeof code === 'string' && (/^PGRST\d{3}$/.test(code) || /^[0-9A-Z]{5}$/.test(code));
}

interface Fields {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * 从任何东西里取出 message / code / details / hint。
 *
 * 【message 的取法是这次修的地方】原来是 `err instanceof Error ? err.message : String(err)` ——
 * 对 supabase-js 的普通对象,那是 `[object Object]`。现在先看对象上有没有字符串 `message` 字段。
 * 两样都没有的对象记 JSON,而不是 `[object Object]`。
 */
function fieldsOf(err: unknown): Fields {
  if (typeof err === 'string') return { message: err, code: null, details: null, hint: null };
  if (err === null || typeof err !== 'object') {
    return { message: String(err), code: null, details: null, hint: null };
  }
  const o = err as Record<string, unknown>;
  const message =
    typeof o.message === 'string' ? o.message : err instanceof Error ? err.message : safeJson(err);
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return { message, code: str(o.code), details: str(o.details), hint: str(o.hint) };
}

/**
 * Postgres 在 details 里把冲突的值写成 `Key (列)=(值) already exists.`(23505)、
 * `… is not present in table …` / `… is still referenced from table …`(23503)、
 * `… conflicts with existing key (列)=(值).`(23P01)。**列留着,值换掉。**
 *
 * 【列那一组按括号配对扫,不用正则】函数式唯一索引的列是 `lower(email)` 这种,自己带括号。
 * 【值那一组优先找后缀锚点】值里可能有不配对的括号;找不到锚点就切到整串最后一个 `)` ——
 * 那会多换掉一些(包括第二个 key 的列名),是**安全的方向**。
 */
function redactKeyValues(s: string): string {
  const keyOpen = /\bkey \(/gi;
  let out = '';
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = keyOpen.exec(s))) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < s.length && depth > 0) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')') depth--;
      j++;
    }
    if (s.slice(j, j + 2) !== '=(') continue;
    const valueStart = j + 2;
    const anchor = /\)(?= already exists| is not present| is still referenced| conflicts with)/.exec(
      s.slice(valueStart),
    );
    const last = s.lastIndexOf(')');
    const valueEnd = anchor ? valueStart + anchor.index : last >= valueStart ? last : s.length;
    out += s.slice(from, valueStart) + REDACTED;
    from = valueEnd;
    keyOpen.lastIndex = valueEnd;
  }
  return out + s.slice(from);
}

/**
 * 「长得像 token」:≥32 字符的 hex / base64url 串。
 *
 * 【不是「含数字就换」】约束名也能 ≥32 且带数字(`assessment_entitlements_phone_e164_check`)。
 * Postgres 标识符是小写 snake_case,所以判据是:
 *   - 纯 hex 且带数字(sha256、identifier_hash、去掉横线的 UUID),或
 *   - 有大写,且同时有小写或数字(base64url、JWT 段、大写 hex)。
 * 盲区:一个**完全没有大写**的随机 base64url —— 43 字符时概率约 2×10⁻¹⁰;
 * 以及 ≥32 字符、全大写带数字的常量名(会被误换)。
 */
function looksLikeToken(t: string): boolean {
  const hasUpper = /[A-Z]/.test(t);
  const hasLower = /[a-z]/.test(t);
  const hasDigit = /\d/.test(t);
  const hexLike = /^[0-9a-fA-F-]+$/.test(t) && hasDigit;
  return hexLike || (hasUpper && (hasLower || hasDigit));
}

/**
 * 日志脱敏。**必须在截断之前跑** —— 先截断的话,一个 43 字符的 token 会被切成
 * 一段不足 32 字符的残片,从而躲过下面的长度规则。
 *
 * 顺序:结构化的值(Key / Failing row)→ 邮箱 → token → 电话。
 * 邮箱在 token 之前(本地部分可能很长);电话在 token 之后(token 里的数字已经没了)。
 *
 * 盲区(写在这里,不装作覆盖了):
 *   - 不带 `+`、带分隔符的本地号码(`138-1234-5678`、`(555) 123-4567`)抓不到;
 *     库里存的是 E.164(带 `+`),那种形状只会出现在归一化之前的输入里
 *   - 8–15 位的独立数字串一律当电话换掉(时间戳也会被换)
 *   - 值里有 `Key (` 字样、或者错误文本换了措辞,结构化那一步会失手 —— 后面的模式规则是第二张网
 */
export function redactText(s: string): string {
  return redactKeyValues(s)
    .replace(/Failing row contains \(.*\)/gs, `Failing row contains (${REDACTED})`)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, REDACTED)
    .replace(/[A-Za-z0-9_-]{32,}/g, (t) => (looksLikeToken(t) ? REDACTED : t))
    .replace(/\+\d[\d\s()-]{6,}\d/g, REDACTED)
    .replace(/(?<![\w-])\d{8,15}(?![\w-])/g, REDACTED);
}

function clip(s: string): string {
  return s.length > FIELD_MAX ? `${s.slice(0, FIELD_MAX)}…` : s;
}

/** 脱敏 → 截断,顺序不能反 */
function sanitize(f: Fields): Fields {
  const clean = (v: string | null) => (v === null ? null : clip(redactText(v)));
  return { message: clean(f.message) ?? '', code: f.code, details: clean(f.details), hint: clean(f.hint) };
}

/**
 * ② 配置缺失 —— 我们自己抛的那几种措辞。
 *
 * 【环境变量名那部分【区分大小写】】环境变量是 SCREAMING_SNAKE,
 * 而带 `/i` 的 `[A-Z_]{3,}` 会把「missing the file」这种也吃进来。
 * 【`missing\W*` 而不是 `missing `】`GHL credentials missing (GHL_PRIVATE_TOKEN)` 里
 * `missing` 后面是括号。
 */
const CONFIG_CASE_SENSITIVE = /missing\W*[A-Z_]{3,}|neither [A-Z_]{3,} nor [A-Z_]{3,}/;
const CONFIG_PHRASES = /not configured|server_misconfigured|credentials missing/i;

/**
 * ③ 外部调用失败。配置在前、上游在后是**预防性**的优先级:真实消息
 * `GHL credentials missing for field-map fetch` 以 `fetch` 结尾,
 * 一旦有人把这里放宽成裸 `fetch`,顺序就立刻承重。
 */
const UPSTREAM = /fetch failed|ECONN|ETIMEDOUT|network|returned \d{3}|upstream/i;

/** 分类用**原始**字段(脱敏不改变判别所依据的那些词) */
function classify(f: Fields): ErrorKind {
  if (looksLikeDbCode(f.code)) return 'query_failed';
  if (CONFIG_CASE_SENSITIVE.test(f.message) || CONFIG_PHRASES.test(f.message)) return 'config_missing';
  if (UPSTREAM.test(f.message)) return 'upstream_failed';
  // ④ 认不出的一律 unexpected —— **不猜**:猜错的分类会把人送到错误的地方,而且送得很有信心
  return 'unexpected';
}

/** 字段那一段。数据库错误四样都打(hint 里常常就是修法);其余只打 message(和 hint,如果有) */
function fieldsLine(f: Fields): string {
  if (looksLikeDbCode(f.code)) {
    return [
      `code=${f.code}`,
      `message=${f.message}`,
      f.details ? `details=${f.details}` : '',
      f.hint ? `hint=${f.hint}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  }
  return f.hint ? `${f.message} | hint=${f.hint}` : f.message;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * `[fn] op=… entitlement=… session=… lang=…`
 *
 * 【ctx 也过一遍】ctx 按约定只装 id;但「按约定」没有检查者 ——
 * 有人把 token 当 entitlement 传进来时,那个值不像 UUID,就被换掉。
 */
function ctxPrefix(ctx: DbCtx): string {
  const parts = [`[${redactText(ctx.fn)}]`, `op=${redactText(ctx.op)}`];
  const id = (v: string) => (UUID.test(v) ? v : REDACTED);
  if (ctx.entitlement) parts.push(`entitlement=${id(ctx.entitlement)}`);
  if (ctx.session) parts.push(`session=${id(ctx.session)}`);
  if (ctx.lang) parts.push(`lang=${LANG.test(ctx.lang) ? ctx.lang : REDACTED}`);
  return parts.join(' ');
}

function lineFor(ctx: DbCtx, raw: Fields): { kind: ErrorKind; code: string | null; line: string } {
  const kind = classify(raw);
  const f = sanitize(raw);
  return {
    kind,
    code: looksLikeDbCode(f.code) ? f.code : null,
    line: `${ctxPrefix(ctx)} failed [${kind}]: ${fieldsLine(f)}`,
  };
}

/**
 * `dbFail` 抛出的东西:**真 Error**,有堆栈;`message` 就是那一整行日志(已脱敏、已截断)——
 * 所以还没迁移的 catch 处哪怕只打 `err.message`,也拿得到上下文。
 *
 * 【只存脱敏后的字段】原始的 details / hint 不留在对象上:
 * 这个对象将来被谁 `JSON.stringify` 进响应体,也带不出 token。
 */
export class DbError extends Error {
  readonly ctx: DbCtx;
  readonly kind: ErrorKind;
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(ctx: DbCtx, error: unknown) {
    const raw = fieldsOf(error);
    const { kind, code, line } = lineFor(ctx, raw);
    super(line);
    this.name = 'DbError';
    this.ctx = ctx;
    this.kind = kind;
    this.code = code;
    const f = sanitize(raw);
    this.details = f.details;
    this.hint = f.hint;
  }
}

/** 取代 `if (error) throw error`。用法:`if (error) dbFail({ fn, op, session: id }, error);` */
export function dbFail(ctx: DbCtx, error: unknown): never {
  throw new DbError(ctx, error);
}

/** 取代「打印 .message 然后继续」:返回一行日志(已脱敏、已截断),从不抛 */
export function dbLogLine(ctx: DbCtx, error: unknown): string {
  return lineFor(ctx, fieldsOf(error)).line;
}

/**
 * 取代 catch 处的 `err instanceof Error ? err.message : String(err)`;也是原来的 `classifyError`
 * (`_shared/errorKind.ts` 以那个名字再导出它)。
 */
export function describeError(err: unknown): ClassifiedError {
  if (err instanceof DbError) return { kind: err.kind, code: err.code, log: err.message };
  const raw = fieldsOf(err);
  const f = sanitize(raw);
  return { kind: classify(raw), code: looksLikeDbCode(f.code) ? f.code : null, log: fieldsLine(f) };
}
