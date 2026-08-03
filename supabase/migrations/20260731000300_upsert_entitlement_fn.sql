-- 原子化的准入记录 upsert。
--
-- 【为什么要它】GHL 重复触发是常态不是异常:网络重试、workflow 配置失误、手动重跑。
-- 应用层的「查 → 有则更新,无则插入」+ 唯一键冲突兜底是正确的补救,但那条补救路径
-- 会被反复走,而且冲突后还要再查一次才能拿到 access_token 返回给 GHL,分支变多。
-- 一条 insert ... on conflict do update 从根上消除竞态。
--
-- 【为什么白名单该待在 SQL 里】可变列的清单原来同时存在于 TypeScript 常量和这条
-- 语句里 —— 同一份东西存两处、靠人同步。现在只存在于下面的 do update set 中,
-- 那也是它唯一该待的地方:改错一列会立刻在数据上体现,而不是等某个分支被走到。

create or replace function public.upsert_assessment_entitlement(
  p_ghl_contact_id text,
  p_access_token   text,
  p_cohort_id      uuid,
  p_phone_e164     text,
  p_phone_tail     text,
  p_phone_raw      text,
  p_email_lower    text,
  p_name           text
)
returns table (entitlement_id uuid, token text, was_created boolean)
language sql
-- security invoker(默认):调用方是 service_role,本就绕过 RLS,不需要 definer 提权。
-- search_path 仍然钉住,避免被调用方的 search_path 影响解析。
set search_path = public
as $$
  insert into public.assessment_entitlements (
    ghl_contact_id, access_token, cohort_id,
    phone_e164, phone_tail, phone_raw, email_lower, name
  )
  values (
    p_ghl_contact_id, p_access_token, p_cohort_id,
    p_phone_e164, p_phone_tail, p_phone_raw, p_email_lower, p_name
  )
  on conflict (ghl_contact_id) do update set
    -- ── 冲突时【会】被覆盖的列,这是唯一的白名单 ──────────────
    cohort_id   = excluded.cohort_id,
    phone_e164  = excluded.phone_e164,
    phone_tail  = excluded.phone_tail,
    phone_raw   = excluded.phone_raw,
    email_lower = excluded.email_lower,
    name        = excluded.name
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
    -- xmax = 0 表示这一行是本次 insert 产生的;非 0 表示走了 do update 分支。
    -- 这是判断「新建还是更新」的标准做法,比比较 created_at/updated_at 可靠。
    -- xid 类型不能直接和整数比,所以经 text 转 bigint。
    (assessment_entitlements.xmax::text::bigint = 0);
$$;

comment on function public.upsert_assessment_entitlement is
  'GHL webhook 的原子写入。冲突键 ghl_contact_id。'
  '返回 (entitlement_id, token, was_created);was_created 由 xmax 判定。'
  '冲突时只覆盖 cohort_id / phone_* / email_lower / name —— '
  'access_token、status、三个时间戳、access_revoked_at 一律不动,原因见函数体注释。';

-- 函数默认对 PUBLIC 授予 execute,而 anon / authenticated 继承 PUBLIC ——
-- 不收回的话它们能通过 REST 的 /rpc 端点调用这个函数。虽然 security invoker
-- 下 RLS 仍会拦住写入(9 张表零 policy),但多一个可达的写入入口本身就不该存在。
revoke all on function public.upsert_assessment_entitlement(
  text, text, uuid, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.upsert_assessment_entitlement(
  text, text, uuid, text, text, text, text, text
) to service_role;
