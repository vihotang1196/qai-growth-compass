/**
 * assessment-quiz —— 答题过程的读写。按 action 分发,cookie 鉴权。
 *
 * POST { action, ... }  Cookie: compass_session=<签名过的 session>
 *   bootstrap → { locale, profile, answered, status }   续答要的全部状态
 *   profile   → 存 3 道背景题
 *   answer    → upsert 一道测评题
 *
 * 【分数一律服务端算,不收客户端传来的 score】那是唯一能改自己成绩的入口。
 * 这份报告最终要拿去做 offer 分流 —— 有人把自己刷成高分档,我们就把他从名单里漏掉了。
 * 客户端只能传 option_index,分数由服务端按 config.scoring.option_values 查表得出。
 *
 * 【每次请求都重新查 access_revoked_at,不只在登录时查】cookie 有 30 天,
 * 而 Stage 4 的 token 校验只在换 cookie 那一刻发生。中途被 revoke 的人如果还能答题,
 * 那个「停用」就只是停了入口没停人。
 */
import { serviceClient } from '../_shared/supa.ts';
import { readSessionCookie, verifySession } from '../_shared/session.ts';
import { missingKeys } from '../_shared/env.ts';
import { isComplete, scoreForOption } from '../_shared/quizFlow.ts';
import config from '../../../src/config/assessment-config.json' with { type: 'json' };

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * 【服务端也读同一份配置文件】题目、选项数、分数标度全部以它为准。
 * 前端各一份的话,改题库时必然有一侧漏改,而漏改的那侧不会报错 ——
 * 它会照旧接受一个已经不存在的 question_id,或者按旧标度算分。
 */
const OPTION_VALUES = config.scoring.option_values;
const QUESTIONS = new Map(config.questions.map((q) => [q.id, q]));
const PROFILE = new Map(config.profile_questions.map((p) => [p.id, p]));
const PROFILE_IDS = config.profile_questions.map((p) => p.id);
const QUESTION_IDS = config.questions.map((q) => q.id);

interface SessionRow {
  id: string;
  locale: string;
  profile: Record<string, number> | null;
  status: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', expected: 'POST' }, 405);
  }

  const env = { SESSION_SECRET: Deno.env.get('SESSION_SECRET') };
  const missing = missingKeys(env);
  if (missing.length) {
    console.error(`server_misconfigured: missing ${missing.join(', ')}`);
    return json({ error: 'server_misconfigured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not object');
    body = raw as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const verified = await verifySession(readSessionCookie(req), env.SESSION_SECRET!, Date.now());
  if (!verified) return json({ error: 'unauthorized' }, 401);

  const supa = serviceClient();

  try {
    // ── 每次都重查准入,不信 cookie 的年龄 ────────────────────
    const { data: ent, error: entError } = await supa
      .from('assessment_entitlements')
      .select('id, access_revoked_at')
      .eq('id', verified.entitlementId)
      .maybeSingle();
    if (entError) throw entError;
    // 记录被删掉的情况也走这里 —— cookie 还在但准入没了
    if (!ent || ent.access_revoked_at) {
      console.warn(`quiz denied for entitlement ${verified.entitlementId}: revoked or missing`);
      return json({ error: 'revoked' }, 403);
    }

    const { data: sessionRow, error: sessionError } = await supa
      .from('assessment_sessions')
      .select('id, locale, profile, status')
      .eq('entitlement_id', ent.id)
      .maybeSingle();
    if (sessionError) throw sessionError;
    // session 由 assessment-auth 在首次登录时创建。没有就是状态不一致,不在这里补建 ——
    // 补建会掩盖「登录路径没建成」这个真正的问题
    if (!sessionRow) {
      console.error(`no session for entitlement ${ent.id} — assessment-auth should have created it`);
      return json({ error: 'no_session' }, 409);
    }
    const session = sessionRow as SessionRow;

    const action = typeof body.action === 'string' ? body.action : '';

    switch (action) {
      case 'bootstrap':
        return json(await snapshot(supa, session));

      case 'profile': {
        const answers = body.answers;
        if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
          return json({ error: 'invalid_answers' }, 400);
        }
        const incoming = answers as Record<string, unknown>;

        /**
         * 【合并而不是覆盖】客户端可能一题一题发。整份覆盖的话,
         * 先答的两题会被第三次请求抹掉 —— 而那正好是「每答一题即存库」的用法。
         */
        const merged: Record<string, number> = { ...(session.profile ?? {}) };
        for (const [id, value] of Object.entries(incoming)) {
          const q = PROFILE.get(id);
          if (!q) return json({ error: 'unknown_profile_question', id }, 400);
          if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= q.zh.options.length) {
            return json({ error: 'option_out_of_range', id }, 400);
          }
          merged[id] = value as number;
        }

        const { error } = await supa
          .from('assessment_sessions')
          .update({ profile: merged })
          .eq('id', session.id);
        if (error) throw error;

        return json(await snapshot(supa, { ...session, profile: merged }));
      }

      case 'answer': {
        const questionId = typeof body.question_id === 'string' ? body.question_id : '';
        const optionIndex = body.option_index;

        const question = QUESTIONS.get(questionId);
        // 未知题号一律拒绝 —— 接受它会往库里塞一条永远不参与算分的孤儿答案
        if (!question) return json({ error: 'unknown_question', id: questionId }, 400);

        if (typeof optionIndex !== 'number') return json({ error: 'invalid_option_index' }, 400);
        // 先按题目的实际选项数卡一次,再交给 scoreForOption ——
        // 两者长度理论上相等(有测试锁),但这里不假设它
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.zh.options.length) {
          return json({ error: 'option_out_of_range', id: questionId }, 400);
        }

        const score = scoreForOption(optionIndex, OPTION_VALUES);
        if (score === null) return json({ error: 'option_out_of_range', id: questionId }, 400);

        // unique (session_id, question_id) 支撑改答案:同一题再答就是更新
        const { error } = await supa.from('assessment_answers').upsert(
          {
            session_id: session.id,
            question_id: questionId,
            option_index: optionIndex,
            score,
            answered_at: new Date().toISOString(),
          },
          { onConflict: 'session_id,question_id' },
        );
        if (error) throw error;

        return json(await snapshot(supa, session));
      }

      default:
        return json({ error: 'unknown_action', action }, 400);
    }
  } catch (err) {
    console.error(`quiz failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ error: 'internal_error' }, 500);
  }
});

/**
 * 当前状态的完整快照 —— 每个 action 都返回它。
 *
 * 【为什么每次都回全量而不是只回本次的结果】客户端据此重算「下一题是哪一题」。
 * 只回增量的话,一次响应丢失(移动网络下很常见)就会让客户端的已答集合与库里不一致,
 * 而那种不一致的表现是「答过的题又出现一次」或者「跳过了一题」——
 * 后者正是我们花力气防的那个静默错误。24 个短字符串的代价可以忽略。
 */
async function snapshot(supa: ReturnType<typeof serviceClient>, session: SessionRow) {
  const { data, error } = await supa
    .from('assessment_answers')
    .select('question_id, option_index')
    .eq('session_id', session.id);
  if (error) throw error;

  const rows = (data ?? []) as { question_id: string; option_index: number }[];
  const answers: Record<string, number> = {};
  for (const r of rows) answers[r.question_id] = r.option_index;

  const profile = session.profile ?? {};
  const answered = new Set([...Object.keys(profile), ...Object.keys(answers)]);

  /**
   * 【答满就把 status 推到 survey】status 是给后台名单页与 Stage 7 的问卷页看的。
   * 用 isComplete 而不是「计数等于 27」—— 库里可能留着改版前删掉的题的答案,
   * 那样计数会凑够而覆盖没够。见 quizFlow.ts 的注释。
   */
  const complete = isComplete(PROFILE_IDS, QUESTION_IDS, answered);
  let status = session.status;
  if (complete && status === 'in_progress') {
    const { error: statusError } = await supa
      .from('assessment_sessions')
      .update({ status: 'survey' })
      .eq('id', session.id);
    // 推进失败不该让这次答题失败 —— 答案已经存好了,状态下次请求会再试
    if (statusError) console.error(`failed to advance session ${session.id}: ${statusError.message}`);
    else status = 'survey';
  }

  return { locale: session.locale, profile, answers, status, complete };
}
