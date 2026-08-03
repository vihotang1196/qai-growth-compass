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
import { mutableFields, parseWebhookPayload } from '../_shared/webhookPayload.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Postgres 唯一键冲突 */
const UNIQUE_VIOLATION = '23505';

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
    // 为什么不用单条 upsert:upsert 会把提供的所有列一起覆盖,而 access_token
    // 与 status / 三个时间戳【不能】被覆盖(重发不轮换、不能把已完成的人打回 pending)。
    // 所以走「查 → 有则更新可变列,无则插入」,并用唯一键冲突兜住并发重复触发。
    const { data: existing, error: selError } = await supa
      .from('assessment_entitlements')
      .select('id, access_token, status')
      .eq('ghl_contact_id', value.ghl_contact_id)
      .maybeSingle();
    if (selError) throw selError;

    let entitlementId: string;
    let accessToken: string;
    let created: boolean;

    if (existing) {
      const { error } = await supa
        .from('assessment_entitlements')
        .update(mutableFields(value, cohort.cohort_id))
        .eq('id', existing.id);
      if (error) throw error;
      entitlementId = existing.id;
      accessToken = existing.access_token;
      created = false;
    } else {
      const token = generateAccessToken();
      const { data, error } = await supa
        .from('assessment_entitlements')
        .insert({
          ghl_contact_id: value.ghl_contact_id,
          access_token: token,
          ...mutableFields(value, cohort.cohort_id),
        })
        .select('id, access_token')
        .single();

      if (error) {
        // 并发重复触发:另一个请求刚插进去。退化成更新,不新建 token
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          const { data: raced, error: raceError } = await supa
            .from('assessment_entitlements')
            .select('id, access_token')
            .eq('ghl_contact_id', value.ghl_contact_id)
            .single();
          if (raceError) throw raceError;
          const { error: updError } = await supa
            .from('assessment_entitlements')
            .update(mutableFields(value, cohort.cohort_id))
            .eq('id', raced.id);
          if (updError) throw updError;
          entitlementId = raced.id;
          accessToken = raced.access_token;
          created = false;
        } else {
          throw error;
        }
      } else {
        entitlementId = data.id;
        accessToken = data.access_token;
        created = true;
      }
    }

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
