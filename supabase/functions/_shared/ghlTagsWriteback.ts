/**
 * 标签写回 —— finalize 与重试 sweep 共用的一份。派生在 `ghlTags.ts`(纯函数)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【独立于字段写入,但共享错误分类】D9 定的是前者:字段炸了标签照打,
 * 标签炸了不影响 `ghl_synced`。所以状态是**另外四列**
 * (`ghl_tags_synced` / `ghl_tags_last_error` / `ghl_tags_next_retry_at` / `ghl_tags_applied`)——
 * 塞进同一列的话「字段成了标签没成」这个状态**没有表达方式**,
 * 而那是最常见的一种:字段一次 PUT,标签一次 POST 加可能一次 DELETE。
 *
 * 而 TRANSIENT / CONFIG / AUTH 那套分类**是共享的**:那三类的语义跟「写什么」无关,
 * 只跟「重试有没有用」有关。标签遇到 429 是 TRANSIENT,遇到「标签不存在」是 CONFIG ——
 * 判据与字段一模一样,所以复用 `classifyGhlError`,退避公式也照抄同一条。
 *
 * 【移除旧标签:只对我们自己上次打的那批做差集】
 * 重答或重算后档位可能从 spot 变成 semi_auto,旧的 `assessment_tier_spot` 必须移除 ——
 * 否则一个人身上挂两个互斥的档位标签,GHL 里两条 workflow 都会触发。
 *
 * 两条硬规则:
 *   ① **只移除 `assessment_` 前缀且在 `ghl_tags_applied` 里的** ——
 *      客户在 GHL 里有大量与本系统无关的标签,误删不可逆;
 *   ② 差集为空就**不发** DELETE。重答但档位没变是最常见的情况,那种不该多一次调用。
 *
 * 【绝不用 contact 的 PUT 带 tags 数组】那是**整体替换**,会抹掉客户其它所有标签。
 * 这一条在传输出口里是一句会抛的断言(`ghlContact.ts`),不只是注释。
 *
 * ⚠️ **标签 API 的形状没有实测过**:按文档假设 `POST` / `DELETE /contacts/{id}/tags`,
 * body `{ tags: [...] }`。与当初 `customFields` 那次同一个处境 ——
 * 所以第一次真实调用把响应体**完整记进日志**(标签名不是 PII),据此再定判据。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyGhlError, type GhlErrorClass } from './ghlVerify.ts';
import { dbFail, dbLogLine } from './dbError.ts';
import { ghlContactRequest } from './ghlContact.ts';
import { deriveTags, TAG_NAMESPACE, type TagInput } from './ghlTags.ts';

export interface TagSyncOutcome {
  attempted: boolean;
  ok: boolean;
  added: string[];
  removed: string[];
  detail?: string;
}

/** 与字段那条同一个公式:2^attempts 分钟,上限 6 小时 */
function nextRetryAt(attempts: number, nowMs: number): string {
  return new Date(nowMs + Math.min(2 ** attempts, 360) * 60_000).toISOString();
}

/** 上次打上去的标签 —— 只取我们命名空间内的字符串,别的一概忽略 */
function readApplied(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string' && t.startsWith(TAG_NAMESPACE));
}

async function recordTagFailure(
  supa: SupabaseClient,
  sessionId: string,
  klass: GhlErrorClass,
  detail: string,
  logTag: string,
  nowMs: number,
): Promise<void> {
  console.error(`${klass}: [${logTag}] tags for session ${sessionId}: ${detail}`);
  const { data, error: attemptsErr } = await supa
    .from('assessment_results')
    .select('ghl_sync_attempts')
    .eq('session_id', sessionId)
    .maybeSingle();
  // 读不到就按第一次算 —— 退避会从头开始;原来连这一行日志都没有
  if (attemptsErr) {
    console.error(dbLogLine({ fn: `syncTagsToGhl/${logTag}`, op: 'assessment_results.select ghl_sync_attempts', session: sessionId }, attemptsErr));
  }
  const attempts = ((data?.ghl_sync_attempts as number) ?? 0) + 1;
  const { error } = await supa
    .from('assessment_results')
    .update({
      /**
       * 【失败时把 synced 置回 false】否则:一行已经 synced 的记录被重算
       * (重答 → 再 finalize)、而这次同步失败 —— `synced` 还是 true,
       * 于是 **sweep 永远挑不到它**(候选查询要求 `ghl_tags_synced = false`)。
       * 一次失败因此变成永久失败,而且没有任何东西会说。
       *
       * 语义上也该是 false:我们刚试着写的东西**没有**落在 GHL 上,那就不是「已同步」。
       */
      ghl_tags_synced: false,
      ghl_tags_last_error: `${klass}: ${detail}`.slice(0, 1000),
      // CONFIG / AUTH 不排重试;只有 TRANSIENT 设下次时间。与字段那边同一条规则
      ghl_tags_next_retry_at: klass === 'TRANSIENT' ? nextRetryAt(attempts, nowMs) : null,
    })
    .eq('session_id', sessionId);
  if (error) console.error(dbLogLine({ fn: `syncTagsToGhl/${logTag}`, op: 'assessment_results.update (record tag failure)', session: sessionId }, error));
}

/**
 * 把这个人该有的标签同步到 GHL。
 *
 * @param target     哪一份(写它的结果行)与哪个人(写人身上的标签现状)—— 两个 id 都必填,放进对象里免得两个字符串传反
 * @param appliedRaw 上次打了什么:`previousAppliedTags` 的返回值
 * @param nowMs      只为可测;默认取当前时间
 */
export async function syncTagsToGhl(
  supa: SupabaseClient,
  target: { sessionId: string; entitlementId: string },
  ghlContactId: string,
  input: TagInput,
  appliedRaw: unknown,
  logTag: string,
  nowMs: number = Date.now(),
): Promise<TagSyncOutcome> {
  const { sessionId } = target;
  const { tags, problems } = deriveTags(input);

  /**
   * 【派生出了问题就不外发,记 CONFIG】problems 非空意味着 config 与代码不一致
   * (脏取值、未登记的占位符、缺判定)。重试同样的输入不会变好,而**硬打上去的后果是
   * 在 GHL 里创建一个永久的全局标签** —— 那比一条失败记录难清理得多。
   */
  if (problems.length) {
    await recordTagFailure(supa, sessionId, 'CONFIG', `tag derivation: ${problems.join(' | ')}`, logTag, nowMs);
    return { attempted: false, ok: false, added: [], removed: [], detail: problems.join(' | ') };
  }

  const applied = readApplied(appliedRaw);
  const want = new Set(tags);
  const toAdd = tags.filter((t) => !applied.includes(t));
  // ① 只移除自己命名空间内、且上次确实打过的(readApplied 已经把命名空间筛过一遍)
  const toRemove = applied.filter((t) => !want.has(t));

  /**
   * ② 什么都不用变时**一次请求都不发**,并且把 synced 标上。
   * 重答但档位没变是最常见的情况 —— 那种情况下发两次空请求纯属浪费 GHL 的限流额度。
   */
  if (toAdd.length === 0 && toRemove.length === 0) {
    const { error } = await supa
      .from('assessment_results')
      .update({ ghl_tags_synced: true, ghl_tags_last_error: null, ghl_tags_next_retry_at: null })
      .eq('session_id', sessionId);
    if (error) console.error(dbLogLine({ fn: `syncTagsToGhl/${logTag}`, op: 'assessment_results.update (tags already in sync)', session: sessionId }, error));
    await recordAppliedOnEntitlement(supa, target.entitlementId, tags, logTag);
    return { attempted: false, ok: true, added: [], removed: [], detail: 'already in sync' };
  }

  const added: string[] = [];
  const removed: string[] = [];

  for (const [method, batch, bucket] of [
    ['POST', toAdd, added],
    ['DELETE', toRemove, removed],
  ] as const) {
    if (batch.length === 0) continue;
    let sent;
    try {
      sent = await ghlContactRequest(supa, sessionId, ghlContactId, '/tags', {
        method,
        body: { tags: batch },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await recordTagFailure(supa, sessionId, 'TRANSIENT', `${method} /tags threw — ${detail}`, logTag, nowMs);
      return { attempted: true, ok: false, added, removed, detail };
    }

    if (!sent.sent) {
      if (sent.skipped === 'test_cohort') {
        // 与字段那边同一个处理:归 CONFIG,不在数据里说「同步成功了」
        await recordTagFailure(supa, sessionId, 'CONFIG', 'test cohort — tags intentionally skipped', logTag, nowMs);
        return { attempted: false, ok: false, added: [], removed: [], detail: 'skipped: test cohort' };
      }
      await recordTagFailure(
        supa,
        sessionId,
        'TRANSIENT',
        `GHL credentials missing (${sent.missing.join(', ')})`,
        logTag,
        nowMs,
      );
      return { attempted: false, ok: false, added: [], removed: [], detail: `missing ${sent.missing.join(', ')}` };
    }

    /**
     * ⚠️ 形状未实测,所以**完整记响应体**。标签名不是 PII(它们是我们自己定义的枚举),
     * 所以可以安全全量记 —— 第一次真实调用就能确认「200 是不是真的等于打上了」。
     * 与 `customFields` 那次同一个处理:那次的教训正是「200 不代表写进去了」。
     */
    console.log(
      `[${logTag}] ${method} /tags for session ${sessionId} → ${sent.status}; ` +
        `tags=${JSON.stringify(batch)}\nRAW response (tag names are not PII):\n${sent.text.slice(0, 2000)}`,
    );

    if (!sent.ok) {
      const klass = classifyGhlError(sent.status);
      await recordTagFailure(
        supa,
        sessionId,
        klass,
        `${method} /tags HTTP ${sent.status} — ${sent.text.slice(0, 300)}`,
        logTag,
        nowMs,
      );
      return { attempted: true, ok: false, added, removed, detail: `${klass} ${sent.status}` };
    }
    bucket.push(...batch);
  }

  /**
   * 【`ghl_tags_applied` 存「现在应该是什么」,而不是「这次加了什么」】
   * 存增量的话,一次失败之后这一列就与 GHL 的实际状态永久脱节 ——
   * 而它是下一次算差集的唯一依据。
   */
  const { error } = await supa
    .from('assessment_results')
    .update({
      ghl_tags_synced: true,
      ghl_tags_last_error: null,
      ghl_tags_next_retry_at: null,
      ghl_tags_applied: tags,
    })
    .eq('session_id', sessionId);
  if (error) console.error(dbLogLine({ fn: `syncTagsToGhl/${logTag}`, op: 'assessment_results.update (record applied tags)', session: sessionId }, error));
  await recordAppliedOnEntitlement(supa, target.entitlementId, tags, logTag);

  return { attempted: true, ok: true, added, removed };
}


/**
 * 【标签的现状也记在人身上】(重填第 2 步,docs/retake-design.md 第 3 节)
 * GHL 上一个联系人只有一套标签,而「上次打了哪些」原来只记在每份结果上 —— 第 2 份完成时读的是它自己那份(空的),
 * 第 1 份打的旧档位标签就永远不会被去掉。现在每次同步成功都把现状写到 entitlement 上;结果上那一列照写(那一份当时打了什么)。
 * 写不进去只记日志:下一次的差集会回落到「编号最大、记过标签的那一份」(`previousAppliedTags`),不会因此多删。
 */
async function recordAppliedOnEntitlement(supa: SupabaseClient, entitlementId: string, tags: string[], logTag: string): Promise<void> {
  const { error } = await supa.from('assessment_entitlements').update({ ghl_tags_applied: tags }).eq('id', entitlementId);
  if (error) console.error(dbLogLine({ fn: `syncTagsToGhl/${logTag}`, op: 'assessment_entitlements.update ghl_tags_applied', entitlement: entitlementId }, error));
}

/**
 * 上次打了哪些标签 —— 算差集的依据。人身上有记录就用它;没有(第 2 步之前的数据,迁移不回填)→
 * 这个人编号最大、记过标签的那一份结果。哪里都没有 → null(第一次完成,与原来一样)。
 *
 * 今天每人只有一份,所以回落取到的就是原来读的那一列(finalize / resync 读的都是这一份自己的)—— 对现有数据零变化。
 */
export async function previousAppliedTags(supa: SupabaseClient, entitlementId: string): Promise<unknown> {
  const { data: ent, error } = await supa
    .from('assessment_entitlements')
    .select('ghl_tags_applied')
    .eq('id', entitlementId)
    .maybeSingle();
  if (error) dbFail({ fn: 'previousAppliedTags', op: 'assessment_entitlements.select ghl_tags_applied', entitlement: entitlementId }, error);
  const own = (ent as { ghl_tags_applied?: unknown } | null)?.ghl_tags_applied;
  if (own !== null && own !== undefined) return own;

  const { data: rows, error: rErr } = await supa
    .from('assessment_results')
    .select('ghl_tags_applied, session:assessment_sessions!inner(attempt_no)')
    .eq('session.entitlement_id', entitlementId)
    .not('ghl_tags_applied', 'is', null);
  if (rErr) dbFail({ fn: 'previousAppliedTags', op: 'assessment_results.select ghl_tags_applied (fallback)', entitlement: entitlementId }, rErr);
  const list = (rows ?? []) as unknown as { ghl_tags_applied: unknown; session: { attempt_no?: number | null } | null }[];
  let best: { no: number; tags: unknown } | null = null;
  for (const r of list) {
    const no = r.session?.attempt_no ?? 1;
    if (!best || no > best.no) best = { no, tags: r.ghl_tags_applied };
  }
  return best ? best.tags : null;
}
