-- ============================================================
-- setup_v2.sql — additive migration for the Study Planner upgrade
-- Run in Supabase SQL Editor. Safe to run multiple times.
-- Nothing here deletes rows or touches existing `completed` values.
-- ============================================================

-- 1) New columns on routine_tasks (all IF NOT EXISTS — existing rows
--    keep their id/title/section/description/completed/order_index
--    exactly as they are; new columns just start out NULL/default).
alter table routine_tasks add column if not exists progress_percent integer not null default 0;
alter table routine_tasks add column if not exists day_number integer;
alter table routine_tasks add column if not exists week_number integer;
alter table routine_tasks add column if not exists phase text;
alter table routine_tasks add column if not exists subject text;
alter table routine_tasks add column if not exists task_type text;
alter table routine_tasks add column if not exists order_index integer;

-- Keep progress_percent consistent with any rows already marked completed
-- (only affects rows where completed=true AND progress_percent is still 0 —
-- i.e. rows completed before this column existed. Never lowers a value.)
update routine_tasks
set progress_percent = 100
where completed = true and progress_percent = 0;

-- Helpful indexes for the new filtering (day/week/phase/subject views)
create index if not exists routine_tasks_order_index_idx on routine_tasks (order_index);
create index if not exists routine_tasks_day_number_idx on routine_tasks (day_number);
create index if not exists routine_tasks_phase_idx on routine_tasks (phase);
create index if not exists routine_tasks_subject_idx on routine_tasks (subject);

-- ============================================================
-- 2) New tables: daily_reports, weekly_reports, user_settings
-- ============================================================

create table if not exists daily_reports (
  id uuid primary key default gen_random_uuid(),
  day_number integer unique not null,
  report_text text default '',
  updated_at timestamptz default now()
);

create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_number integer unique not null,
  report_text text default '',
  updated_at timestamptz default now()
);

-- Single-user "current day" pointer. No login exists in this app, so this
-- is not per-user isolation — it's one shared row acting as app state.
-- Anyone with the anon key can read/write it, same as every other table
-- here. If you ever add real auth, revisit this table's design.
create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  current_day integer default 1,
  updated_at timestamptz default now()
);

insert into user_settings (current_day)
select 1
where not exists (select 1 from user_settings);

-- ============================================================
-- 3) Row Level Security
--
-- Same reasoning as before: this app talks to Supabase with the
-- publishable/anon key directly from the browser, and there is no
-- login. That is a deliberate, appropriate choice for a personal,
-- single-user tool — but it means RLS policies (not application code)
-- are the only thing standing between "anyone with this key" and your
-- data. Since the key is embedded in a client-side file, treat these
-- tables as accessible to anyone who has that file, not as
-- authenticated-user-private data.
-- ============================================================

alter table routine_tasks enable row level security;
alter table daily_reports enable row level security;
alter table weekly_reports enable row level security;
alter table user_settings enable row level security;

drop policy if exists "anon full access routine_tasks" on routine_tasks;
create policy "anon full access routine_tasks"
on routine_tasks for all
to anon
using (true)
with check (true);

drop policy if exists "anon full access daily_reports" on daily_reports;
create policy "anon full access daily_reports"
on daily_reports for all
to anon
using (true)
with check (true);

drop policy if exists "anon full access weekly_reports" on weekly_reports;
create policy "anon full access weekly_reports"
on weekly_reports for all
to anon
using (true)
with check (true);

drop policy if exists "anon full access user_settings" on user_settings;
create policy "anon full access user_settings"
on user_settings for all
to anon
using (true)
with check (true);

-- If you'd rather split select/insert/update/delete into separate named
-- policies (functionally identical to the "for all" ones above, just
-- more visible in the dashboard UI), see setup.sql from the original
-- delivery for that pattern — apply the same shape to the 3 new tables.
