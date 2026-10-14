// Retake step 2, full walkthrough on production, on the step-1 TEST entitlement only (GHL is skipped for test cohorts).
// Usage: node scripts/e2e/retake-step2-walkthrough.mjs   (needs a linked supabase CLI; read-only except attempt 2 below)
// The entitlement is looked up only inside a cohort with is_test = true — a real person cannot be selected.
// Run at or after 2026-10-15T05:56:03Z (24 h after attempt 1). Writes: attempt 2 of that test person (+ its answers,
// survey, result, report files). Never prints the token, the cookie or any signed URL.
import { spawnSync } from 'node:child_process';
const BASE = 'https://compass.qiai.tech';
const REPO = new URL('../..', import.meta.url).pathname;
const CONTACT = 'seed-test-e2e-20261014';
if (Date.now() < Date.parse('2026-10-15T05:56:03Z')) { console.error('too early: the 24 h rule refuses until 2026-10-15T05:56:03Z'); process.exit(2); }
function sql(q) {
  const r = spawnSync('supabase', ['db', 'query', '--linked', q], { cwd: REPO, encoding: 'utf8' });
  const out = r.stdout ?? ''; const i = out.indexOf('{');
  const parsed = i >= 0 ? JSON.parse(out.slice(i)) : null;
  if (!parsed?.rows) throw new Error(`sql failed: ${(out + r.stderr).slice(0, 300)}`);
  return parsed.rows;
}
const ENT = `(select e.id from assessment_entitlements e join assessment_cohorts c on c.id = e.cohort_id and c.is_test where e.ghl_contact_id = '${CONTACT}')`;
// attempt 1 fingerprint: md5 of every row it owns (answers, survey, result, report files) + the session row itself
const attempt1 = () => sql(`select * from (select
  (select md5(string_agg(a::text, '|' order by a.question_id)) from assessment_answers a where a.session_id = s.id) answers,
  (select md5(v::text) from assessment_survey v where v.session_id = s.id) survey,
  (select md5(r::text) from assessment_results r where r.session_id = s.id) result,
  (select md5(string_agg(f::text, '|' order by f.lang)) from assessment_report_files f where f.session_id = s.id) files,
  md5(s::text) session
  from assessment_sessions s where s.entitlement_id = ${ENT} and s.attempt_no = 1) q`)[0];
const before1 = attempt1();
const [{ access_token: token }] = sql(`select * from (select access_token from assessment_entitlements where id = ${ENT}) q`);
let cookie = '';
async function api(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith('compass_session=')) cookie = c.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 120); }
  return { status: res.status, json };
}
const results = [];
const check = (what, cond, seen) => results.push({ what, ok: !!cond, seen });

await api('assessment-auth', { body: { token } });
const s1 = (await api('assessment-quiz', { body: { action: 'bootstrap' } })).json.sessionId;
const start = await api('assessment-quiz', { body: { action: 'start_retake' } });
check('start_retake → 200, attempt 2, no answers, prefill from attempt 1', start.status === 200 && start.json.attemptNo === 2 && Object.keys(start.json.answers ?? {}).length === 0
  && start.json.prefill?.fromAttempt === 1 && JSON.stringify(start.json.prefill?.profile) === JSON.stringify({ P1: 2, P2: 1, P3: 1 }), { attemptNo: start.json.attemptNo, prefill: start.json.prefill, profile: start.json.profile });
const s2 = start.json.sessionId;
const again = await api('assessment-quiz', { body: { action: 'start_retake' } });
check('second start_retake while one is open → 409 open_attempt', again.status === 409 && again.json.error === 'open_attempt', again.json);
const login = await api('assessment-auth', { body: { token } });
check('login with an open retake → still /report', String(login.json.target).startsWith('/report'), login.json.target);
const stale = await api('assessment-quiz', { body: { action: 'answer', question_id: 'G1', option_index: 0, session_id: s1 } });
check('old page (attempt 1) writes → 409 session_changed', stale.status === 409 && stale.json.error === 'session_changed', stale.json);
const repMid = await api('assessment-report', { method: 'GET' });
check('report while the retake is open → still attempt 1, openAttempt 2', repMid.json.attempt?.no === 1 && repMid.json.retake?.openAttempt === 2, { attempt: repMid.json.attempt, retake: repMid.json.retake });

for (const [id, idx] of Object.entries({ P1: 2, P2: 1, P3: 1 })) await api('assessment-quiz', { body: { action: 'profile', answers: { [id]: idx }, session_id: s2 } });
const answers = { G1: 2, G2: 2, G3: 2, T1: 2, T2: 3, T3: 2, C1: 2, C2: 3, C3: 3, V1: 2, V2: 2, V3: 2, M1: 2, M2: 2, M3: 2 };
for (const [qid, idx] of Object.entries(answers)) await api('assessment-quiz', { body: { action: 'answer', question_id: qid, option_index: idx, session_id: s2 } });
const early = await api('assessment-score', { body: { action: 'finalize', session_id: s2 } });
check('finalize without submitting the survey → 409 survey_missing (prefill is not an answer)', early.status === 409 && early.json.error === 'survey_missing', early.json);
const survey = start.json.prefill.survey;
check('survey prefill = attempt 1 survey (as the page sends it)', JSON.stringify(survey) === JSON.stringify({ S1: 1, S2: 2, S3: 1, S4: [0, 2], S5: 'seed-test e2e: config stamp + retake step 1', S6: 'seed-test', S7: 2 }), survey);
await api('assessment-score', { body: { action: 'survey', responses: survey, session_id: s2 } });
const fin = await api('assessment-score', { body: { action: 'finalize', session_id: s2 } });
check('finalize attempt 2 → 200', fin.status === 200 && fin.json.ok === true, { total: fin.json.result?.total, tier: fin.json.result?.tier, writeback: fin.json.writeback, tags: fin.json.tagSync?.detail });

const rep = await api('assessment-report', { method: 'GET' });
check('report default → attempt 2 (latest), two in history', rep.json.attempt?.no === 2 && rep.json.attempt?.isLatest === true && rep.json.attempts?.length === 2, { attempt: rep.json.attempt, attempts: rep.json.attempts, retake: rep.json.retake });
const rep1 = await api('assessment-report?attempt=1', { method: 'GET' });
check('report ?attempt=1 → attempt 1, not latest, total 2.5', rep1.json.attempt?.no === 1 && rep1.json.attempt?.isLatest === false && rep1.json.result?.total === 2.5, rep1.json.attempt);
const hist = await api('assessment-report-file', { body: { lang: 'en', attempt: 1 } });
check('history attempt asks for another language → 409 history_attempt', hist.status === 409 && hist.json.error === 'history_attempt', hist.json);
const next = await api('assessment-quiz', { body: { action: 'start_retake' } });
check('start_retake right after attempt 2 → 409 too_soon', next.status === 409 && next.json.error === 'too_soon', next.json);

const t0 = Date.now(); let ready = false;
while (Date.now() - t0 < 180_000) { const r = await api('assessment-report', { method: 'GET' }); const zh = r.json.files?.find?.((f) => f.lang === 'zh'); if (zh?.availability === 'ready' && zh.cardUrl && zh.cardTallUrl) { ready = true; break; } await new Promise((x) => setTimeout(x, 3000)); }
check('attempt 2: zh PDF + both cards ready', ready, `${Math.round((Date.now() - t0) / 1000)} s`);

const after1 = attempt1();
check('attempt 1: session, answers, survey, result, files byte-identical', JSON.stringify(before1) === JSON.stringify(after1), { before1, after1 });
const db = sql(`select * from (select s.attempt_no, s.status, r.config_version, left(r.ghl_last_error, 40) ghl, left(r.ghl_tags_last_error, 40) tags,
  (select e.ghl_tags_applied is null from assessment_entitlements e where e.id = s.entitlement_id) ent_tags_null
  from assessment_sessions s left join assessment_results r on r.session_id = s.id where s.entitlement_id = ${ENT} order by s.attempt_no) q`);
check('GHL skipped for the test cohort on attempt 2; nothing recorded on the person', db.length === 2 && db[1].ghl?.startsWith('CONFIG: test cohort') && db[1].tags?.startsWith('CONFIG: test cohort') && db[1].ent_tags_null === true, db);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what}\n      ${JSON.stringify(r.seen)}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} as expected`);
process.exit(failed ? 1 : 0);
