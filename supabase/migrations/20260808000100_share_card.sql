-- 分享卡(Stage 9 最后一件):带分数的社交图片,学员自己发朋友圈 / WhatsApp。
--
-- 【为什么和 PDF 共用 reports bucket】同一批人的同一次诊断产出,同样的私有 + 现签
-- signed URL 下载路径,同样的留存策略。再开一个 bucket 只是多一处要记得配 policy 的地方。
-- 但那个 bucket 建的时候把 mime 白名单钉死成 application/pdf,所以要放开 image/png ——
-- 不放开的话 upload 会被 Storage 直接拒,而那种失败长得像代码 bug。
-- 【必须断言它真的改到了那一行】
-- 裸 update 匹配 0 行时【迁移照样成功】,而后果要到运行时才出现:
-- 每一次分享卡上传被 Storage 以 mime 不允许拒掉,错误落进 share_card_error,
-- 看起来像代码 bug —— 而真因是一条「跑过了但什么都没改」的迁移。
-- 所以这里回读那一列,而不是相信 update 语句跑过了(PROGRESS.md 判断标准 2)。
do $$
declare
  changed int;
  mimes text[];
begin
  update storage.buckets
  set    allowed_mime_types = array['application/pdf', 'image/png']
  where  id = 'reports';
  get diagnostics changed = row_count;

  if changed <> 1 then
    raise exception
      'expected to update exactly 1 storage bucket named "reports", updated % —— '
      '这条迁移的前提是 20260731000100 已经建好那个 bucket。'
      'bucket 不存在或改名了的话,分享卡会在运行时被 Storage 拒,而不是在这里失败。', changed;
  end if;

  -- 断言的是【我们要的性质】,不是「语句执行了」
  select allowed_mime_types into mimes from storage.buckets where id = 'reports';
  if not ('image/png' = any(mimes)) then
    raise exception 'reports bucket still does not allow image/png (mime list = %)', mimes;
  end if;
end $$;

-- 【为什么不给分享卡一整套状态机】它是【附属品的附属品】:PDF 失败只是少个下载按钮,
-- 分享卡失败只是少张图。给它 status + attempts + failed_permanent 那一整套,
-- 维护成本远大于它的分量,而且会让 sweep 的判断多出一个维度。
-- 这里只存「产物在哪」和「上次为什么没出来」——
-- 重试路径直接复用 PDF 那条(Admin 的「重新生成」与定时 sweep 都会连带重渲分享卡)。
alter table public.assessment_results
  add column if not exists share_card_path      text,
  add column if not exists share_card_tall_path text,
  add column if not exists share_card_error     text;

comment on column public.assessment_results.share_card_path is
  '方形分享卡(1080×1080,朋友圈 / WhatsApp 状态)在 reports bucket 里的对象路径。'
  '与 pdf_path 同为私有,下载时现签 signed URL。null = 这一次没出来,原因看 share_card_error。';
comment on column public.assessment_results.share_card_tall_path is
  '竖版分享卡(1080×1920,IG / 小红书)。与方形同一次渲染产出,多一次 element screenshot。';
comment on column public.assessment_results.share_card_error is
  '分享卡渲染失败的原因,left(msg,500)。【它非空不代表 PDF 失败】——'
  '分享卡的失败被单独 catch 住,不许拖累 PDF,更不许拖累报告页。'
  '成功时置 null,免得上一次的错误一直挂着骗人。';
