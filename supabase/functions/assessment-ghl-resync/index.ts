/**
 * assessment-ghl-resync —— GHL 写回的重试 sweep(D2 的消费端)。
 *
 * 挑 ghl_synced=false 且 ghl_next_retry_at 已过(或为 null)的结果,重新走一次写回。
 * 内部接口,鉴权走 X-Internal-Secret(与 assessment-maintenance 同一套),不对外、不进
 * /api 代理白名单。由 Vercel Cron 定时调,也可手动 curl 触发一次。
 *
 * 【为什么现在才建】上一轮只建了三列 + 记录失败(markSyncFailure 设 ghl_next_retry_at),
 * 但没有任何东西读它们 —— 把 ghl_synced 重置成 false 本身什么都不会发生。这个函数就是
 * 那个缺失的消费端。写回实现与 finalize 共用 _shared/ghlWriteback,不造第二份。
 *
 * ⚠️ 成功判据仍是「HTTP 200 → synced」,已知不可靠(见 _shared/ghlWriteback 文件头)。
 * 这次重跑的目的正是采集「字段存在时」GHL 的响应体,据此再定判据。
 */
import { serviceClient } from '../_shared/supa.ts';
import { secretMatches } from '../_shared/secret.ts';
import { buildWritebackPayload, syncToGhl, type WritebackResult } from '../_shared/ghlWriteback.ts';
import { syncTagsToGhl } from '../_shared/ghlTagsWriteback.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** 一次最多处理多少条 —— 防止一次 sweep 打爆 GHL 限流。到上限会在返回里说明,不静默截断 */
const BATCH_CAP = 50;

interface Candidate {
  session_id: string;
  total: number;
  tier: string;
  weakest: string[];
  ghl_last_error: string | null;
  ghl_tags_last_error: string | null;
  ghl_tags_applied: unknown;
  session: { entitlement: { ghl_contact_id: string } | null } | null;
}

/** 一行要补的是哪一半(可以两半都要) */
interface Todo {
  row: Candidate;
  fields: boolean;
  tags: boolean;
}

const SELECT_COLS =
  `session_id, total, tier, weakest, ghl_last_error, ghl_tags_last_error, ghl_tags_applied,
   session:assessment_sessions(entitlement:assessment_entitlements(ghl_contact_id))`;

/**
 * CONFIG / AUTH 的行不自动重试 —— 判据是**它自己那一列**的前缀。
 * 【字段与标签各看各的】字段因为「字段没建」永久失败,不该让标签也停下来;
 * 反过来也一样。共用一列判断的话,两者会互相拖死。
 */
const permanent = (err: string | null) => !!err && /^(CONFIG|AUTH):/.test(err);

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', expected: 'POST' }, 405);

  const expected = Deno.env.get('INTERNAL_FN_SECRET');
  if (!expected) {
    console.error('INTERNAL_FN_SECRET is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }
  if (!(await secretMatches(req.headers.get('X-Internal-Secret'), expected))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supa = serviceClient();
  const nowIso = new Date().toISOString();

  try {
    /**
     * 待重试 = 未同步 + (从没排过重试 或 重试时间已到)。
     *
     * 【字段与标签用两条查询,而不是一条带嵌套 or 的】
     * 一条 `or(and(...),and(...))` 写得出来,但那个形状**本地无处可验**
     * (没有 PostgREST),而写错的后果是整次 sweep 直接报错 —— 一个静默停摆的重试机制,
     * 正是这一轮在补的那个坑。两条查询各自与已经跑通的那条同形,
     * 而且各走自己的部分索引(`..._ghl_retry_idx` / `..._ghl_tags_retry_idx`)。
     *
     * 【为什么仍然是一条 cron】两次 DB 读不影响 GHL 的并发;
     * 而分两条 cron 会让同一个上游在同一时刻收到两倍请求 —— GHL 有限流,
     * 而重试打爆限流会把 TRANSIENT 变成更多 TRANSIENT。
     */
    const [fieldRes, tagRes] = await Promise.all([
      supa
        .from('assessment_results')
        .select(SELECT_COLS)
        .eq('ghl_synced', false)
        .or(`ghl_next_retry_at.is.null,ghl_next_retry_at.lte.${nowIso}`)
        .limit(BATCH_CAP + 1),
      supa
        .from('assessment_results')
        .select(SELECT_COLS)
        .eq('ghl_tags_synced', false)
        .or(`ghl_tags_next_retry_at.is.null,ghl_tags_next_retry_at.lte.${nowIso}`)
        .limit(BATCH_CAP + 1),
    ]);
    if (fieldRes.error) throw fieldRes.error;
    if (tagRes.error) throw tagRes.error;

    /**
     * 【跳过 CONFIG / AUTH 行】这两类失败把 next_retry_at 置成了 null,而「从没试过 /
     * 手动重置」的行同样是 null —— 两者用 last_error 的前缀区分。CONFIG/AUTH 重试同样的
     * 请求无意义(字段没建、token 失效),靠前缀在这里排除掉,不靠 next_retry_at 那个歧义信号。
     */
    const fieldRows = (fieldRes.data ?? []) as unknown as Candidate[];
    const tagRows = (tagRes.data ?? []) as unknown as Candidate[];
    const dueFields = fieldRows.filter((r) => !permanent(r.ghl_last_error));
    const dueTags = tagRows.filter((r) => !permanent(r.ghl_tags_last_error));
    const skippedPermanent =
      fieldRows.length - dueFields.length + (tagRows.length - dueTags.length);
    if (skippedPermanent > 0) console.log(`resync: skipped ${skippedPermanent} CONFIG/AUTH rows (no auto-retry)`);

    /** 同一个 session 两半都要补时**只处理一次**,顺序是先字段后标签 */
    const todos = new Map<string, Todo>();
    for (const row of dueFields) todos.set(row.session_id, { row, fields: true, tags: false });
    for (const row of dueTags) {
      const existing = todos.get(row.session_id);
      if (existing) existing.tags = true;
      else todos.set(row.session_id, { row, fields: false, tags: true });
    }

    const all = [...todos.values()];
    const capped = all.length > BATCH_CAP;
    const batch = all.slice(0, BATCH_CAP);

    if (batch.length === 0) {
      return json({ ok: true, swept: 0, note: 'nothing due for retry' });
    }

    // 一次拉齐这批 session 的问卷,避免逐条查库
    const sessionIds = batch.map((t) => t.row.session_id);
    const { data: surveys, error: svErr } = await supa
      .from('assessment_survey')
      .select('session_id, responses')
      .in('session_id', sessionIds);
    if (svErr) throw svErr;
    const surveyBy = new Map(
      (surveys ?? []).map((s) => [s.session_id as string, (s.responses ?? {}) as Record<string, unknown>]),
    );

    const results: Array<{
      session_id: string;
      fields?: { ok: boolean; detail?: string };
      tags?: { ok: boolean; added: string[]; removed: string[]; detail?: string };
      detail?: string;
    }> = [];
    for (const todo of batch) {
      const { row } = todo;
      const contactId = row.session?.entitlement?.ghl_contact_id;
      if (!contactId) {
        // 结果在,但连不回 contact —— 数据不一致,记下来跳过,不静默
        console.error(`resync: session ${row.session_id} has no ghl_contact_id, skipped`);
        results.push({ session_id: row.session_id, detail: 'no ghl_contact_id' });
        continue;
      }
      const survey = surveyBy.get(row.session_id) ?? {};
      const entry: (typeof results)[number] = { session_id: row.session_id };

      if (todo.fields) {
        const result: WritebackResult = {
          total: row.total,
          tier: row.tier,
          weakest: [row.weakest?.[0], row.weakest?.[1]] as [string, string],
        };
        const payload = buildWritebackPayload(result, survey);
        const outcome = await syncToGhl(supa, row.session_id, contactId, payload, 'resync');
        entry.fields = { ok: outcome.ok, detail: outcome.detail };
      }

      /**
       * 【标签那半不看字段那半的成败】D9:字段炸了标签照打。
       * 而 `ghl_tags_applied` 从库里读出来,所以差集算的是「上次我们实际打上去的」——
       * 移除只会碰到那批里的 `assessment_` 标签,客户自己的标签一个都不动。
       */
      if (todo.tags) {
        const outcome = await syncTagsToGhl(
          supa,
          row.session_id,
          contactId,
          {
            tier: row.tier,
            weakestPrimary: row.weakest?.[0] ?? null,
            total: row.total,
            responses: survey,
          },
          row.ghl_tags_applied,
          'resync',
        );
        entry.tags = {
          ok: outcome.ok,
          added: outcome.added,
          removed: outcome.removed,
          detail: outcome.detail,
        };
      }
      results.push(entry);
    }

    // 两组分开数 —— 「字段成了标签没成」必须在返回值里看得出来,否则又是一个不可表示的状态
    const fieldsOk = results.filter((r) => r.fields?.ok).length;
    const tagsOk = results.filter((r) => r.tags?.ok).length;
    const fieldsTried = results.filter((r) => r.fields).length;
    const tagsTried = results.filter((r) => r.tags).length;
    // 到批上限时明说还有剩,别让「swept 50」被误读成「全清了」
    if (capped) console.log(`resync: hit batch cap ${BATCH_CAP}, more remain — run again`);
    console.log(
      `resync: swept ${batch.length} — fields ${fieldsOk}/${fieldsTried}, tags ${tagsOk}/${tagsTried}`,
    );
    return json({
      ok: true,
      swept: batch.length,
      fields: { tried: fieldsTried, synced: fieldsOk },
      tags: { tried: tagsTried, synced: tagsOk },
      capped,
      results,
    });
  } catch (err) {
    console.error(`resync failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});
