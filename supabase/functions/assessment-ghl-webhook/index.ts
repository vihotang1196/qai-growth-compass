/**
 * assessment-ghl-webhook —— GHL 付款 workflow 的 webhook 入口。
 *
 * 职责:建立 / 更新准入记录。**不发链接、不发消息** —— 那是 GHL workflow 的事。
 *
 * 四条硬约束(PROGRESS.md 0.6):
 *   1. 校验共享密钥。X-QAI-Secret 对比 QAI_WEBHOOK_SECRET,失败 401 且【不写库】
 *   2. 幂等。以 ghl_contact_id 为冲突键(邮箱会变,不能用)
 *   3. 批次映射。payload 带 cohort_tag 则匹配 source_tag,不带则落 is_default
 *   4. 号码解析失败降级。仍写记录,phone_e164 置 null,phone_raw 保留原值
 *
 * 请求 / 响应契约见 docs/ghl-setup.md —— 那份是给 GHL 后台照着配的。
 */
import { secretMatches } from '../_shared/secret.ts';
import { serviceClient } from '../_shared/supa.ts';
import { generateAccessToken, magicLink } from '../_shared/token.ts';
import { parseWebhookPayload } from '../_shared/webhookPayload.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** upsert_assessment_entitlement 的返回行 */
interface UpsertRow {
  entitlement_id: string;
  token: string;
  was_created: boolean;
}

interface CohortResolution {
  cohort_id: string | null;
  source: 'tag' | 'default' | 'none';
  warning?: string;
}

/**
 * 批次解析。
 *
 * tag 给了但库里没有对应的 active 批次时,**回落到默认批次并带 warning**,
 * 不拒绝 —— 拒绝会丢掉一条付过款的准入记录,而 tag 拼错属于配置问题,
 * 应该让它可见(warning + Admin 能看到)而不是让它阻塞客户。
 */
async function resolveCohort(
  supa: ReturnType<typeof serviceClient>,
  cohortTag: string | null,
): Promise<CohortResolution> {
  if (cohortTag) {
    const { data, error } = await supa
      .from('assessment_cohorts')
      .select('id')
      .eq('source_tag', cohortTag)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (data) return { cohort_id: data.id, source: 'tag' };
  }

  const { data: def, error: defError } = await supa
    .from('assessment_cohorts')
    .select('id')
    .eq('is_default', true)
    .maybeSingle();
  if (defError) throw defError;

  if (!def) {
    // seed migration 里有断言,正常不该走到这里。走到了就是有人手动删了默认批次
    return {
      cohort_id: null,
      source: 'none',
      warning: 'no default cohort exists — cohort_id left null, baselines will not work',
    };
  }
  return {
    cohort_id: def.id,
    source: 'default',
    warning: cohortTag
      ? `cohort_tag "${cohortTag}" matched no active cohort — fell back to the default cohort`
      : undefined,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', expected: 'POST' }, 405);
  }

  // ── 1. 密钥校验。必须在任何 DB 操作之前 ──────────────────────
  const expected = Deno.env.get('QAI_WEBHOOK_SECRET');
  if (!expected) {
    console.error('QAI_WEBHOOK_SECRET is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }
  if (!(await secretMatches(req.headers.get('X-QAI-Secret'), expected))) {
    // 不写库,也不回显任何关于密钥的信息
    console.warn('webhook rejected: bad or missing X-QAI-Secret');
    return json({ error: 'unauthorized' }, 401);
  }

  // ── 2. 解析 body ────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseWebhookPayload(raw);
  if (!parsed.ok) {
    // 回显收到的 key 名(不含值)—— GHL 侧字段映射配错时一次就能定位
    return json({ error: 'invalid_payload', detail: parsed.error, received_keys: parsed.receivedKeys }, 400);
  }
  const { value, warnings } = parsed;

  const appBaseUrl = Deno.env.get('APP_BASE_URL');
  if (!appBaseUrl) {
    console.error('APP_BASE_URL is not configured');
    return json({ error: 'server_misconfigured' }, 500);
  }

  try {
    const supa = serviceClient();

    // ── 3. 批次 ───────────────────────────────────────────────
    const cohort = await resolveCohort(supa, value.cohort_tag);

    // ── 4. 幂等写入 ───────────────────────────────────────────
    // 一条 insert ... on conflict do update,原子、无竞态。
    // 可变列白名单唯一定义在那个 SQL 函数里(migration 20260731000300),
    // TypeScript 这边不再持有第二份 —— 同一份东西存两处本身就是 bug 源。
    //
    // p_access_token 每次请求都生成,但只在 insert 分支落库:
    // access_token 不在 do update set 的白名单里,所以重复触发时它被丢弃,
    // 返回的仍是原有 token。这正是「重发不轮换」。
    const { data, error } = await supa.rpc('upsert_assessment_entitlement', {
      p_ghl_contact_id: value.ghl_contact_id,
      p_access_token: generateAccessToken(),
      p_cohort_id: cohort.cohort_id,
      p_phone_e164: value.phone_e164,
      p_phone_tail: value.phone_tail,
      p_phone_raw: value.phone_raw,
      p_email_lower: value.email_lower,
      p_name: value.name,
    });
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as UpsertRow | undefined;
    if (!row) throw new Error('upsert_assessment_entitlement returned no row');

    const entitlementId = row.entitlement_id;
    const accessToken = row.token;
    const created = row.was_created;

    const allWarnings = [...warnings, ...(cohort.warning ? [cohort.warning] : [])];
    if (allWarnings.length) {
      console.warn(
        `entitlement ${entitlementId} (${created ? 'created' : 'updated'}) warnings: ${allWarnings.join('; ')}`,
      );
    }

    return json({
      ok: true,
      created,
      entitlement_id: entitlementId,
      // GHL 要拿这个值去建魔法链接。重复触发返回的是同一个 token
      magic_link: magicLink(appBaseUrl, accessToken),
      cohort_source: cohort.source,
      phone_parsed: value.phone_e164 !== null,
      warnings: allWarnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`webhook failed for ${value.ghl_contact_id}: ${message}`);
    // 回 500 让 GHL 的 workflow 显示失败并可重试;不回显内部细节
    return json({ error: 'internal_error' }, 500);
  }
});
