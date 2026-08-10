/**
 * 造测试 / 演示数据 —— 15 条已答完的记录,放进一个 `is_test = true` 的批次。
 *
 *   node scripts/seed-test-data.ts              造(可重复跑,幂等)
 *   node scripts/seed-test-data.ts --dry-run    只打印将要写什么,不碰数据库
 *   node scripts/seed-test-data.ts --clean --yes 反向清理(按前缀删,cascade 带走其余)
 *
 * 需要 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY(与 render-pdf 用的是同两个)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【它为什么自己建批次,不让人手动建】
 * 手动建的话总有一次会忘了勾 is_test,而那个错误的症状是**新学员的基准里混了假数据**,
 * 没有任何东西会报错(见 _shared/baselinePools.ts)。批次是这批数据的一部分,
 * 所以它由造数据这个动作创建 —— 标记不是一个要人记得的步骤。
 *
 * 【分数走真实 computeResult,不手写 dim_scores】
 * 脚本挑的是 option_index,分数由 `src/lib/scoring.ts` 的同一个 computeResult 算出来 ——
 * finalize 走的就是它。手写 dim_scores 的话:①看板上的分布是假的分布;
 * ②config 改版(比如又调 option_count)时这批数据会静默变成另一个含义,
 * 而真实数据会跟着改版走。option_index 是不受标度影响的事实,分数不是。
 *
 * 【不产出 PDF 与分享卡】pdf_status 留在默认的 pending。
 * 15 份渲染约 4 分钟、一串 Chromium 冷启动,而 PDF 那一列的呈现在名单页已经验过了。
 * 要看真 PDF 就对其中一条点 Admin 的「重新生成」。
 *
 * 【它绕过 finalize,这一点必须知道】直接写库,所以**不经过** GHL 写回与 PDF 异步触发。
 * 换来的是不给假联系人发消息、不烧渲染。代价是这批数据验不了那两条路径 ——
 * 那两条各有自己的验证方式(Stage 7 的实测、Stage 9 的 sweep)。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@supabase/supabase-js';
import { computeResult } from '../src/lib/scoring.ts';
import { mapOption, mapOptions } from '../src/lib/optionMap.ts';
import { normalizePhone, phoneTail } from '../src/lib/phone.ts';
import config from '../src/config/assessment-config.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { pickSecretKeyFromPlainEnv } from '../api/_lib/apiKeys.ts';

const COUNT = 15;
/** 所有种子数据的共同前缀 —— 既是幂等键,也是清理时唯一的判据 */
const PREFIX = 'seed-test-';
const COHORT_TAG = 'seed-test-cohort';
const COHORT_NAME = 'SEED TEST DATA (not real)';

const QUESTIONS = config.questions;
const DIMENSIONS = config.dimensions.map((d) => ({ key: d.key, order: d.order }));
const TIERS = config.tiers.map((t) => ({ key: t.key, min: t.min, max: t.max }));
const SCALE = config.meta.score_scale;

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const CLEAN = args.has('--clean');

/**
 * 确定性 PRNG(mulberry32),固定种子。
 *
 * 【为什么不用 Math.random】「可重复跑」要名副实实:同一个种子跑两次写的是同一批值,
 * 于是重跑是 upsert 覆盖,而不是每次都把 15 条的分数搅一遍 ——
 * 那样看板上的数字会无缘无故变,而你会以为是代码动了。
 */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每条记录的答案下标 —— 目标总分决定大致水平,抖动制造真实的不平整 */
function pickIndices(targetTotal: number, rand: () => number): number[] {
  return QUESTIONS.map((q) => {
    // ±1.4 分的抖动:够让五个维度长得不一样,又不至于把总分推出目标档位
    const wanted = targetTotal + (rand() - 0.5) * 2.8;
    const clamped = Math.max(0, Math.min(SCALE, wanted));
    return Math.round((clamped / SCALE) * (q.option_count - 1));
  });
}

function scoreOf(indices: number[]) {
  return computeResult(
    QUESTIONS.map((q, i) => ({
      dimension: q.dimension,
      optionIndex: indices[i],
      optionCount: q.option_count,
    })),
    DIMENSIONS,
    TIERS,
    { scale: SCALE },
  );
}

/**
 * 造一条落在指定档位里的记录。
 *
 * 【为什么是搜索而不是直接算】总分是「每题按 option_count 归一化 → 维度取均值 →
 * 五维再取均值」,而 option_count 有 3 和 4 两种,所以从目标总分反推下标不是闭式的。
 * 从档位中点起步、不中就往区间中心收,最多 40 次 —— 实测都在个位数次内命中。
 */
function seedRow(targetTier: string, rand: () => number) {
  const tier = TIERS.find((t) => t.key === targetTier)!;
  const mid = (tier.min + tier.max) / 2;
  let aim = mid;
  for (let attempt = 0; attempt < 40; attempt++) {
    const indices = pickIndices(aim, rand);
    const result = scoreOf(indices);
    if (result.tier === targetTier) return { indices, result };
    // 没中就朝档位中心挪一步 —— 抖动会让下一次落点不同
    aim += (mid - result.total) * 0.6;
    aim = Math.max(0, Math.min(SCALE, aim));
  }
  throw new Error(
    `could not land a row in tier ${targetTier} after 40 attempts — ` +
      `档位区间是 [${tier.min}, ${tier.max}],而抖动幅度可能盖不住它。` +
      `改 config 的 tiers 之后如果这里抛了,先看那个区间是不是变窄了。`,
  );
}

/**
 * 15 条怎么分档 —— **每个档位至少一条,剩下的按顺序摊平**。
 *
 * 分布刻意不刻意:随机本身就不会平均。唯一的硬要求是五个档位都有样本,
 * 否则批次看板的档位分布图看不出东西(而那正是造这批数据的目的之一)。
 */
function tierPlan(): string[] {
  const keys = TIERS.map((t) => t.key);
  return Array.from({ length: COUNT }, (_, i) => keys[i % keys.length]);
}

/** 手机号:马来西亚合法移动号段。**造完必须过一遍 normalizePhone** —— 见下面的断言 */
function phoneFor(n: number): string {
  return `+6012${String(3450000 + n).padStart(7, '0')}`;
}

const id = (n: number) => `${PREFIX}${String(n).padStart(2, '0')}`;

/**
 * access_token:由 id 派生的确定性 64 位十六进制。
 *
 * 【它是可预测的,这里接受这个代价】真实 token 是 32 字节随机;这里要幂等,
 * 所以从 id 派生。后果是任何读过这个脚本的人能算出这 15 条的报告链接 ——
 * 而那 15 份报告的数字全是编的、批次标着 is_test。
 * 【不要把这个做法搬到真实记录上】。
 */
function tokenFor(seedId: string): string {
  return createHash('sha256').update(`${seedId}::seed-test-data`).digest('hex');
}

/** 问卷:与 assessment-score 的 saveSurvey 同一套映射(mapOption / mapOptions) */
function surveyFor(rand: () => number): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const q of config.survey_questions as unknown as SurveyQuestion[]) {
    if (q.type === 'single_select') {
      const opts = q.zh.options!;
      const idx = Math.floor(rand() * opts.length);
      const table = q.option_to_dimension ?? q.option_to_value ?? q.value_map;
      stored[q.field] = table ? mapOption<string | number>(idx, table)! : idx;
    } else if (q.type === 'multi_select') {
      const opts = q.zh.options!;
      const pick = opts.map((_, i) => i).filter(() => rand() < 0.35);
      stored[q.field] = mapOptions(pick.length ? pick : [0], opts)!;
    } else {
      // open_text:明显是造的,不写像真人的话
      stored[q.field] = 'seed test data — not a real answer';
    }
  }
  /**
   * 【断言:required 的一条都不能缺】config 以后加一道 required 问卷题时,
   * 这里必须当场抛,而不是静默写进一份缺字段的 survey ——
   * 那种数据会让报告里某一块无声地空掉,而没人会想到是造数据这一步的问题。
   */
  for (const q of config.survey_questions as unknown as SurveyQuestion[]) {
    if (q.required && stored[q.field] === undefined) {
      throw new Error(`survey field missing for required question ${q.id} (field=${q.field})`);
    }
  }
  return stored;
}

interface SurveyQuestion {
  id: string;
  type: 'single_select' | 'multi_select' | 'open_text';
  field: string;
  required?: boolean;
  zh: { options?: string[] };
  option_to_dimension?: string[];
  option_to_value?: string[];
  value_map?: number[];
}

/**
 * 变量名必须以【字面量】出现在 process.env.X 里 —— 与 api/render-pdf.ts 同一个理由:
 * 动态的 process.env[name] 会让这两个变量从 check:env 的清单里消失,
 * 而漏掉的清单比没有清单更糟(那道门的原话)。
 * 第一版就是写成 env('SUPABASE_URL') 的,check:env 当场拦下 —— 判断标准 11 又一次。
 */
const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function requireEnv(): { url: string; key: string } {
  // 两代 secret key「至少有一个」,新的优先 —— Disable 之后 legacy 不认了
  const key = pickSecretKeyFromPlainEnv(ENV.SUPABASE_SECRET_KEY, ENV.SUPABASE_SERVICE_ROLE_KEY);
  const missing = [
    ...(ENV.SUPABASE_URL ? [] : ['SUPABASE_URL']),
    ...(key ? [] : ['SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY']),
  ];
  if (missing.length) {
    console.error(`missing ${missing.join(', ')} —— 与 render-pdf 用的是同一套,在你的 shell / .env 里。`);
    process.exit(1);
  }
  return { url: ENV.SUPABASE_URL!, key: key! };
}

// ── 主流程 ──────────────────────────────────────────────────────
const supa = DRY
  ? null
  : (() => {
      const { url, key } = requireEnv();
      return createClient(url, key, { auth: { persistSession: false } });
    })();

if (CLEAN) {
  // --clean 是破坏性的,没有「预演」这个概念;两个开关一起给多半是手滑
  if (DRY) {
    console.error('--clean 与 --dry-run 不能一起用:清理没有预演模式,要么删要么不删。');
    process.exit(1);
  }
  if (!args.has('--yes')) {
    console.error(
      `--clean 会删掉 ghl_contact_id 以 "${PREFIX}" 开头的所有 entitlement,` +
        `级联带走它们的 session / answers / survey / results,以及批次 "${COHORT_TAG}"。\n` +
        `确认无误后加上 --yes 再跑。`,
    );
    process.exit(1);
  }
  const { data: gone, error } = await supa!
    .from('assessment_entitlements')
    .delete()
    .like('ghl_contact_id', `${PREFIX}%`)
    .select('ghl_contact_id');
  if (error) throw error;
  const { error: cErr } = await supa!.from('assessment_cohorts').delete().eq('source_tag', COHORT_TAG);
  if (cErr) throw cErr;
  // 删了几条要说出来 —— 「删完了」与「一条都没匹配上」必须能区分
  console.log(`[seed] deleted ${gone?.length ?? 0} entitlement(s) and the cohort ${COHORT_TAG}`);
  process.exit(0);
}

// ── 1. 先在内存里把 15 条算出来,并逐条自检 ──────────────────
const plan = tierPlan().map((targetTier, i) => {
  const n = i + 1;
  const rand = rng(0x5eed + n * 7919);
  const { indices, result } = seedRow(targetTier, rand);
  const phone = phoneFor(n);

  /**
   * 【手机号必须真的过得了 normalizePhone】用假号码的话,「号码解析失败率」那个
   * 运营阈值会被这批数据污染 —— 而 assessment-admin 特意把统计限定成只看真实行,
   * 不能在造数据这一步又把它绕回来。所以这里断言,而不是「看起来像个号码」就算了。
   */
  const e164 = normalizePhone(phone);
  if (e164 === null) {
    throw new Error(`seeded phone ${phone} does not parse — 换号段,不要留一个解析失败的种子`);
  }

  return {
    n,
    id: id(n),
    targetTier,
    indices,
    result,
    phone: e164,
    tail: phoneTail(e164),
    survey: surveyFor(rng(0xbeef + n * 104729)),
    profile: Object.fromEntries(
      config.profile_questions.map((p, k) => [p.id, (n + k) % (p.zh.options?.length ?? 5)]),
    ),
  };
});

// ── 2. 自检:每个档位至少一条 ────────────────────────────────
const covered = new Set(plan.map((p) => p.result.tier));
const missing = TIERS.map((t) => t.key).filter((k) => !covered.has(k));
if (missing.length) {
  throw new Error(
    `tier(s) with no sample: ${missing.join(', ')} —— ` +
      `档位分布图会缺格,而那正是造这批数据要避免的。seedRow 的搜索没有把它们都命中。`,
  );
}

console.log(`[seed] ${plan.length} row(s), tiers: ${[...covered].join(', ')}`);
for (const p of plan) {
  console.log(
    `  ${p.id}  total=${p.result.total.toFixed(1)}  tier=${p.result.tier}  ` +
      `dims=${DIMENSIONS.map((d) => p.result.dimensions[d.key].toFixed(1)).join('/')}  ${p.phone}`,
  );
}
if (DRY) {
  console.log('[seed] --dry-run: nothing written');
  process.exit(0);
}

// ── 3. 批次(is_test = true)—— 由脚本创建,不靠人记得勾 ──────
const { data: cohort, error: cohortErr } = await supa!
  .from('assessment_cohorts')
  .upsert(
    { name: COHORT_NAME, source_tag: COHORT_TAG, is_test: true, is_active: false, is_default: false },
    { onConflict: 'source_tag' },
  )
  .select('id, is_test')
  .single();
if (cohortErr) throw cohortErr;
/**
 * 【建完立刻回读 is_test】这一列是整批数据安全性的全部依赖:
 * 它要是 false,这 15 条会进真实学员的基准全局池。
 * 迁移没应用时 upsert 会直接报错,但「写进去了但值不对」也要挡住 ——
 * 一个只写不读的关键标记就是没有被检查的标记(判断标准 2)。
 */
if (cohort.is_test !== true) {
  throw new Error(`cohort ${cohort.id} has is_test=${cohort.is_test} — refusing to seed into a non-test cohort`);
}
console.log(`[seed] cohort ${cohort.id} (is_test=true)`);

// ── 4. 逐条写:entitlement → session → answers → survey → results ──
const now = new Date();
for (const p of plan) {
  const completedAt = new Date(now.getTime() - p.n * 3_600_000).toISOString();

  const { data: ent, error: entErr } = await supa!
    .from('assessment_entitlements')
    .upsert(
      {
        ghl_contact_id: p.id,
        cohort_id: cohort.id,
        phone_e164: p.phone,
        phone_tail: p.tail,
        phone_raw: p.phone,
        email_lower: `${p.id}@seed.invalid`,
        name: p.id, // 明显是假的 —— 万一测试行漏到名单上,要一眼认出来,而不是去查 cohort
        access_token: tokenFor(p.id),
        status: 'completed',
        link_sent_at: completedAt,
        first_login_at: completedAt,
        completed_at: completedAt,
      },
      { onConflict: 'ghl_contact_id' },
    )
    .select('id')
    .single();
  if (entErr) throw entErr;

  const { data: ses, error: sesErr } = await supa!
    .from('assessment_sessions')
    .upsert(
      {
        entitlement_id: ent.id,
        locale: 'zh',
        profile: p.profile,
        status: 'completed',
        completed_at: completedAt,
      },
      { onConflict: 'entitlement_id' },
    )
    .select('id')
    .single();
  if (sesErr) throw sesErr;

  const { error: ansErr } = await supa!.from('assessment_answers').upsert(
    QUESTIONS.map((q, i) => ({
      session_id: ses.id,
      question_id: q.id,
      option_index: p.indices[i],
      answered_at: completedAt,
    })),
    { onConflict: 'session_id,question_id' },
  );
  if (ansErr) throw ansErr;

  const { error: svErr } = await supa!
    .from('assessment_survey')
    .upsert({ session_id: ses.id, responses: p.survey, submitted_at: completedAt }, { onConflict: 'session_id' });
  if (svErr) throw svErr;

  /**
   * 结果:分数来自真实 computeResult。**pdf_status 不设** —— 留在默认的 pending,
   * 也不设 pdf_path。要看真 PDF 就对其中一条点 Admin 的「重新生成」。
   */
  const { error: resErr } = await supa!.from('assessment_results').upsert(
    {
      session_id: ses.id,
      dim_scores: p.result.dimensions,
      total: p.result.total,
      tier: p.result.tier,
      weakest: p.result.weakest,
      strongest: p.result.strongest,
      computed_at: completedAt,
    },
    { onConflict: 'session_id' },
  );
  if (resErr) throw resErr;

  console.log(`[seed] ${p.id} → total ${p.result.total.toFixed(1)} (${p.result.tier})`);
}

console.log(
  `[seed] done. ${plan.length} row(s) in cohort ${cohort.id}. ` +
    `PDF 一律 pending(刻意不渲)。清理:node scripts/seed-test-data.ts --clean --yes`,
);
