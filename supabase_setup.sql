-- ============================================
-- ระบบจัดการบริษัท - Supabase Setup Script
-- วิธีใช้: คัดลอกทั้งหมดไปวางใน SQL Editor ของ Supabase แล้วกด Run
-- ============================================

-- 1. ตาราง พนักงาน
create table if not exists employees (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  position text default '',
  department text default '',
  created_at timestamp with time zone default now()
);

-- 2. ตาราง งาน (Todo)
create table if not exists todos (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text default '',
  assigned_to uuid,
  assigned_name text default 'ทุกคน',
  created_by uuid,
  created_by_name text default '',
  status text default 'pending',
  priority text default 'normal',
  due_date text default '',
  created_at timestamp with time zone default now(),
  completed_at timestamp with time zone
);

-- 3. ตาราง ผลงาน
create table if not exists works (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid,
  employee_name text not null,
  title text not null,
  description text default '',
  file_path text default '',
  file_name text default '',
  file_type text default '',
  created_at timestamp with time zone default now()
);

-- 4. ตาราง การแจ้งเตือน
create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  message text not null,
  type text default 'info',
  related_id text default '',
  is_read boolean default false,
  created_at timestamp with time zone default now()
);

-- ============================================
-- เปิด Row Level Security (RLS) + อนุญาตทุกคน
-- ============================================
alter table employees enable row level security;
alter table todos enable row level security;
alter table works enable row level security;
alter table notifications enable row level security;

drop policy if exists "allow_all_employees" on employees;
drop policy if exists "allow_all_todos" on todos;
drop policy if exists "allow_all_works" on works;
drop policy if exists "allow_all_notifications" on notifications;

create policy "allow_all_employees" on employees for all to anon, authenticated using (true) with check (true);
create policy "allow_all_todos" on todos for all to anon, authenticated using (true) with check (true);
create policy "allow_all_works" on works for all to anon, authenticated using (true) with check (true);
create policy "allow_all_notifications" on notifications for all to anon, authenticated using (true) with check (true);

-- ============================================
-- เปิด Realtime
-- ============================================
alter publication supabase_realtime add table employees;
alter publication supabase_realtime add table todos;
alter publication supabase_realtime add table works;
alter publication supabase_realtime add table notifications;

-- ============================================
-- Storage Bucket สำหรับอัพโหลดไฟล์
-- ============================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'works',
  'works',
  true,
  20971520,
  array['image/jpeg','image/png','image/gif','image/webp','application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain']
)
on conflict (id) do nothing;

drop policy if exists "allow_upload" on storage.objects;
drop policy if exists "allow_read" on storage.objects;
drop policy if exists "allow_delete" on storage.objects;

create policy "allow_upload" on storage.objects for insert to anon, authenticated with check (bucket_id = 'works');
create policy "allow_read" on storage.objects for select to anon, authenticated using (bucket_id = 'works');
create policy "allow_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'works');

-- ============================================
-- เสร็จแล้ว! กลับไปที่แอปและใส่ URL + Key
-- ============================================
