-- 出分时记下所用 config 的版本与内容指纹(PROGRESS ⑩)。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【为什么】报告上的分数是出分时存下的,而结果里没有任何一列说明用的是哪一版 config ——
-- 改一次 config 之后,「哪些人的分数是按旧版算的」只能按部署时间推。
--
-- 【指纹为主,版本号作标签】`config_sha256` = 整份 config 规范化 JSON 的 sha256(src/lib/configFingerprint.ts),
-- 不靠人记得升版本;`config_version` = `meta.version`,给人看。git 历史里 3.2.0 就对应过两份不同的内容,
-- 所以单看版本号不够。由指纹找回那一版:`npm run config:fingerprint -- --history`。
--
-- 【已有的行不回填】(Viho 2026-10-14 定)两列都可空,空 = 「出分时没有记录」。
-- 这条迁移只加两列,**不改任何一行已有数据**。旧版本的出分函数不写这两列,照常工作 ——
-- 所以先跑迁移、再部署函数,中间没有断档。
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.assessment_results
  add column if not exists config_version text,
  add column if not exists config_sha256 text;

-- 【刻意不加形状约束】(比如「64 位十六进制」的 check)约束一旦不满足,失败的是那一次出分的整条写入 ——
-- 学员拿不到分数,只因为一个追溯用的标签。出分不能因为它失败;形状由 configFingerprint 的测试看着。

comment on column public.assessment_results.config_version is
  '出分时 config 的 meta.version(标签)。空 = 出分时没有记录(2026-10-14 之前的结果不回填)。以 config_sha256 为准。';
comment on column public.assessment_results.config_sha256 is
  '出分时整份 config 规范化 JSON 的 sha256(src/lib/configFingerprint.ts)。空 = 出分时没有记录。查哪一版:npm run config:fingerprint -- --history';
