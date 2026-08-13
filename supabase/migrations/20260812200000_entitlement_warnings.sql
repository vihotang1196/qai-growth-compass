-- warnings 落库 + upsert RPC 接受 lang / warnings。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 【为什么这一列比语言那件事更重要】
--
-- 代码注释里写着「回落 + warning,应该让它可见(warning + Admin 能看到)而不是
-- 阻塞客户」—— 而 **`Admin 能看到` 这半从来没有实现过**:没有这一列、roster 也没选它。
-- warning 只存在于函数日志和 webhook 的 HTTP 响应体里,而响应体被 GHL 吞掉。
--
-- 所以在这一列存在之前,过去每一次选「warning 而不是拒绝」,实际选的都是**静默**。
-- 那句话已经在三个 Stage 里当过决策依据(cohort_tag 配错、phone_unparseable,
-- 现在又加上 lang_invalid)。这一列要做的不是显示,是让「不阻塞 + 可见」真正成立。
--
-- 【为什么是 jsonb 数组而不是单值】一个 contact 可以同时
-- phone_unparseable + lang_invalid + cohort_tag_unknown。单值会丢信息,
-- 而丢掉的那条恰好可能是要紧的那条。每项带 code 与 context ——
-- `lang_invalid` 不带上收到的那个值(`EN`),就不知道 GHL 那边填了什么。
--
-- 【为什么每次覆盖而不是累加】warnings 描述的是**最近一次 payload 的状态**。
-- 累加的话,GHL 那边修好之后旧告警永远留着,而一个永远亮着的告警等于没有告警。
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.assessment_entitlements
  add column if not exists warnings jsonb;

comment on column public.assessment_entitlements.warnings is
  'webhook 最近一次写入时产生的告警数组:[{code, context?}]。每次覆盖,不累加 —— 它描述当前状态,不是历史。code 的取值域见 api/_lib/entitlementWarnings.ts。';

-- ⚠️ 【必须先 DROP 旧签名】`create or replace function` 在参数列表变了的时候
-- 建的是一个**新重载**,不是替换。旧的 8 参版本会留在库里,而那时:
-- TypeScript 那边少传两个参数 → PostgREST 照样能解析到旧重载 → 调用成功、
-- **lang 与 warnings 静默不写**。一个「名字对、签名对不上」的入口比没有更危险。
drop function if exists public.upsert_assessment_entitlement(
  text, text, uuid, text, text, text, text, text
);

create or replace function public.upsert_assessment_entitlement(
  p_ghl_contact_id text,
  p_access_token   text,
  p_cohort_id      uuid,
  p_phone_e164     text,
  p_phone_tail     text,
  p_phone_raw      text,
  p_email_lower    text,
  p_name           text,
  p_lang           text,
  p_warnings       jsonb
)
returns table (entitlement_id uuid, token text, was_created boolean)
language sql
set search_path = public
as $$
  insert into public.assessment_entitlements (
    ghl_contact_id, access_token, cohort_id,
    phone_e164, phone_tail, phone_raw, email_lower, name,
    lang, warnings
  )
  values (
    p_ghl_contact_id, p_access_token, p_cohort_id,
    p_phone_e164, p_phone_tail, p_phone_raw, p_email_lower, p_name,
    coalesce(p_lang, 'zh'), p_warnings
  )
  on conflict (ghl_contact_id) do update set
    -- ── 冲突时【会】被覆盖的列,这是唯一的白名单 ──────────────
    cohort_id   = excluded.cohort_id,
    phone_e164  = excluded.phone_e164,
    phone_tail  = excluded.phone_tail,
    phone_raw   = excluded.phone_raw,
    email_lower = excluded.email_lower,
    name        = excluded.name,
    -- warnings 每次覆盖:它描述最近一次 payload 的状态,不是历史
    warnings    = excluded.warnings,
    /**
     * ⚠️ lang 【只在 payload 显式给了合法值时】才覆盖。
     *
     * 学员自己在报告页切成英文之后,这一列是 'en'。而 GHL 重复触发是常态
     * (重发、重复付款回调、workflow 配置失误)—— 那些 payload 大多不带 lang。
     * 若无条件覆盖,`coalesce(p_lang,'zh')` 会把他自己选的 'en' **打回 'zh'**:
     * 一个用户动作被一次无关的重试静默撤销,而他只会发现「怎么又变中文了」。
     *
     * 所以这里用库里的现值兜底,而不是用默认值兜底。
     * (`p_lang` 在「没给」与「给了但不合法」两种情况下都由调用方传 null。)
     */
    lang        = coalesce(p_lang, assessment_entitlements.lang)
    -- ── 刻意【不】在上面出现的列,每一条都有原因 ──────────────
    --   access_token       重发不轮换。客户可能同时收到新旧两条消息,
    --                      两条链接都得能用。p_access_token 只在 insert 分支落库
    --   status             重复触发不能把一个已完成的人打回 pending
    --   first_login_at     不能抹掉
    --   completed_at       不能抹掉
    --   link_sent_at       发送记录归发送方,webhook 不发链接也不该动它
    --   access_revoked_at  作废是 Admin 的决定,webhook 无权撤销
    --   created_at         首次创建时间
    --   updated_at         由 assessment_entitlements_touch trigger 维护
  returning
    assessment_entitlements.id,
    assessment_entitlements.access_token,
    (assessment_entitlements.xmax::text::bigint = 0);
$$;

comment on function public.upsert_assessment_entitlement is
  'GHL webhook 的原子写入。冲突键 ghl_contact_id。'
  '返回 (entitlement_id, token, was_created);was_created 由 xmax 判定。'
  '冲突时覆盖 cohort_id / phone_* / email_lower / name / warnings;'
  'lang 只在 p_lang 非 null 时覆盖(否则会把学员自己切过的语言打回默认);'
  'access_token、status、三个时间戳、access_revoked_at 一律不动,原因见函数体注释。';

revoke all on function public.upsert_assessment_entitlement(
  text, text, uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.upsert_assessment_entitlement(
  text, text, uuid, text, text, text, text, text, text, jsonb
) to service_role;
