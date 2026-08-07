-- 回填修复之前答完的人:entitlement.status 停在 started、completed_at 是 null。
--
-- 根因见 PROGRESS.md「entitlements.status 不跟着 finalize 走」——
-- finalize 只写了 assessment_sessions,entitlement 自己那两列没有任何地方推动。
-- 代码已修,这一条只管修复之前留下的行。
--
-- 【判据】有 assessment_results 就是答完了。不用 session.status = 'completed' 做判据:
-- 那一句同样是「失败只记 console.error」的尽力而为写入,拿一个可能没写上的列
-- 去判断另一个没写上的列,会漏掉两句都失败的那批。results 行是 finalize 的主产物,
-- 它存在就说明分数确实算出来了。
--
-- 【completed_at 绝对不能用 now()】用 now() 会把所有历史行的完成时间盖成回填那一刻,
-- 而这个时间戳以后会被当成真实数据读(Roster 的「完成时间」列、CSV 导出)。
-- 那是把「显示空白」换成「显示错误时间」—— 后者更糟,因为它看起来是对的。
-- 取 coalesce(s.completed_at, r.computed_at):
--   * 优先 session.completed_at —— 它就是 Roster 要显示的那个「实际完成时间」;
--   * 回落 results.computed_at —— session 那句写失败时的兜底。该列 not null default now(),
--     由 finalize 显式赋值,与 session.completed_at 是同一次请求里的同一刻。
-- 两者都取不到是不可能的(computed_at 非空),所以回填不会产出新的空白时间戳 ——
-- 下面第二条断言把这句话钉住。
--
-- 【不会扇出成多行】assessment_sessions.entitlement_id 上有 unique,
-- assessment_results.session_id 是主键,所以 entitlement → session → result 一路一对一。
--
-- 【只往前走】where status <> 'completed' —— 与代码里那条 UPDATE 的
-- .in('status', statusesBefore('completed')) 同一个方向约束。
-- 重复执行是 no-op。
--
-- 【不管 access_revoked_at】被停用的人如果答完了,状态照样是 completed:
-- 停用是独立的一列,status 记的是进度,不是能不能访问。

do $$
declare
  backfilled int;
  still_open int;
  blank_stamp int;
begin
  update public.assessment_entitlements e
  set    status       = 'completed',
         completed_at = coalesce(s.completed_at, r.computed_at)
  from   public.assessment_sessions s
  join   public.assessment_results  r on r.session_id = s.id
  where  s.entitlement_id = e.id
    and  e.status <> 'completed';

  get diagnostics backfilled = row_count;
  raise notice 'backfilled % entitlement row(s) to completed', backfilled;

  -- 【断言一】判据本身:回填之后不该再有「有 result 却不是 completed」的行。
  -- 打一个数出来但不判断它等于没打 —— 见 PROGRESS.md 判断标准 2
  select count(*) into still_open
  from   public.assessment_entitlements e
  join   public.assessment_sessions s on s.entitlement_id = e.id
  join   public.assessment_results  r on r.session_id = s.id
  where  e.status <> 'completed';

  if still_open > 0 then
    raise exception 'backfill missed % row(s) that have a result but are not completed', still_open;
  end if;

  -- 【断言二】不许把「空白」换成另一种空白:completed 的行必须有 completed_at
  select count(*) into blank_stamp
  from   public.assessment_entitlements
  where  status = 'completed' and completed_at is null;

  if blank_stamp > 0 then
    raise exception 'backfill left % completed row(s) with a null completed_at', blank_stamp;
  end if;
end $$;
