-- ============================================================================
-- NFC Tap-In Attendance — initial schema
-- One tag per teacher. Timetable-driven. Geofenced. Device-bound students.
-- ============================================================================

-- TEACHERS: mirrors auth.users. Each teacher owns one tag + a timetable.
create table if not exists teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  timezone text not null default 'Asia/Phnom_Penh',
  created_at timestamptz not null default now()
);

-- TAGS: one per teacher. tag_code is the value in the NFC URL: /t/<tag_code>
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  tag_code text unique not null,
  label text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists one_tag_per_teacher on tags (teacher_id);

-- LOCATIONS: reusable saved places owned by a teacher. Radius set per place.
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null default 50 check (radius_m between 5 and 5000),
  created_at timestamptz not null default now()
);

-- LESSONS: weekly recurring timetable entries.
-- Location is EITHER a saved location (location_id) OR a one-off override.
-- Exactly one must be set (enforced by location_xor_override).
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  subject text not null,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Sun (JS getDay)
  start_time time not null,
  end_time time not null,
  location_id uuid references locations(id) on delete set null,
  override_lat double precision,
  override_lng double precision,
  override_radius_m integer check (override_radius_m is null or override_radius_m between 5 and 5000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint end_after_start check (end_time > start_time),
  constraint location_xor_override check (
    (location_id is not null
      and override_lat is null and override_lng is null and override_radius_m is null)
    or
    (location_id is null
      and override_lat is not null and override_lng is not null and override_radius_m is not null)
  )
);
create index if not exists lessons_teacher_day on lessons (teacher_id, day_of_week);

-- STUDENTS: bound to a single device via device_token.
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  student_id text unique not null,
  full_name text not null,
  device_token text unique not null,
  created_at timestamptz not null default now()
);

-- CHECKINS: the attendance record.
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete set null,
  lesson_id uuid references lessons(id) on delete set null,
  tag_id uuid not null references tags(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  distance_m double precision,
  status text not null check (status in ('ok', 'flagged')),
  flag_reason text,
  created_at timestamptz not null default now()
);
create index if not exists checkins_teacher_time on checkins (teacher_id, checked_in_at desc);
create index if not exists checkins_lesson on checkins (lesson_id);
create index if not exists checkins_status on checkins (status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Teacher UI talks to Supabase directly with the logged-in JWT; RLS confines
-- each teacher to their own rows. Students NEVER touch the DB directly — the
-- checkin Edge Function uses the service role key (bypasses RLS).
-- ============================================================================
alter table teachers  enable row level security;
alter table tags      enable row level security;
alter table locations enable row level security;
alter table lessons   enable row level security;
alter table students  enable row level security;
alter table checkins  enable row level security;

drop policy if exists teacher_self on teachers;
create policy teacher_self on teachers
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists tags_own on tags;
create policy tags_own on tags
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists locations_own on locations;
create policy locations_own on locations
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists lessons_own on lessons;
create policy lessons_own on lessons
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- Teachers may READ their own checkins. No insert/update/delete for anyone via
-- the API — only the service-role Edge Function writes checkins.
drop policy if exists checkins_read_own on checkins;
create policy checkins_read_own on checkins
  for select using (teacher_id = auth.uid());

-- students table has NO policy => no anon/auth access at all. Service role only.
