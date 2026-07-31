-- PDF 报告私有 bucket。public = false,只有 service_role 能读写;
-- 客户与 Admin 一律通过 Edge Function 现签 signed URL 下载(D7)。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- 不为 anon / authenticated 建任何 storage policy —— 与 9 张表同一个思路。
-- (rev3 里为 D8 预留的 `internal` bucket 已取消:字段映射改存 app_settings 表)
