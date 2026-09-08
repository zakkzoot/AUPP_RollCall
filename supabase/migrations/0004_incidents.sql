-- ============================================================================
-- INCIDENTS: a way back from a lost device, a log of every refusal, and an
-- emergency route for when the teacher isn't there to intervene.
--
-- A phone is recognised only by a random device_token in localStorage. That
-- token disappears for reasons no student can control — an origin change,
-- iOS Safari's 7-day storage cap, an in-app browser, clearing site data — and
-- because students.student_id is unique, re-registering hit id_already_bound
-- with no way back. The lockout was not an edge case: it was the guaranteed end
-- state of a lost token.
-- ============================================================================

-- Nullable so a binding can be cleared. Postgres allows many nulls under a
-- unique constraint, and a null token is what tells the check-in function to
-- re-bind this student on their next tap instead of turning them away.
alter table students alter column device_token drop not null;

-- ============================================================================
-- THE LOG
--
-- Every refusal, recorded against the lesson it was refused for. teacher_id is
-- nullable because an unknown tag has no teacher to attribute it to, and those
-- attempts are exactly the ones worth seeing.
-- ============================================================================
create table if not exists checkin_events (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id) on delete cascade,
  tag_id uuid references tags(id) on delete set null,
  lesson_id uuid references lessons(id) on delete set null,
  tag_code text,
  attempted_student_id text,
  error_code text not null,
  http_status integer not null,
  had_device_token boolean not null default false,
  lat double precision,
  lng double precision,
  distance_m double precision,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists checkin_events_teacher_time
  on checkin_events (teacher_id, created_at desc);
create index if not exists checkin_events_lesson on checkin_events (lesson_id);

-- ============================================================================
-- EMERGENCY CHECK-INS
--
-- Held pending until the teacher approves. No attendance record exists until
-- then, so approving is a deliberate act rather than a rubber stamp.
-- ============================================================================
create table if not exists emergency_checkins (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  tag_id uuid references tags(id) on delete set null,
  student_id text not null,
  full_name text not null,
  -- Storage object path, <teacher_id>/<id>.jpg. Nulled when the image is
  -- deleted at review; the decision outlives the photograph.
  selfie_path text,
  lat double precision,
  lng double precision,
  distance_m double precision,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  checkin_id uuid references checkins(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists emergency_checkins_teacher_time
  on emergency_checkins (teacher_id, created_at desc);
create index if not exists emergency_checkins_status
  on emergency_checkins (status);

-- One outstanding request per student per lesson: a student who taps the button
-- five times queues one review, not five.
create unique index if not exists one_pending_per_student_per_lesson
  on emergency_checkins (lesson_id, student_id) where status = 'pending';

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table checkin_events      enable row level security;
alter table emergency_checkins  enable row level security;

drop policy if exists checkin_events_read_own on checkin_events;
create policy checkin_events_read_own on checkin_events
  for select using (teacher_id = auth.uid());

drop policy if exists emergency_checkins_read_own on emergency_checkins;
create policy emergency_checkins_read_own on emergency_checkins
  for select using (teacher_id = auth.uid());

-- ============================================================================
-- SELFIE STORAGE
--
-- Private bucket. The Edge Function writes with the service role; a teacher may
-- read and delete only what sits under their own id.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('emergency-selfies', 'emergency-selfies', false)
on conflict (id) do nothing;

drop policy if exists emergency_selfies_read_own on storage.objects;
create policy emergency_selfies_read_own on storage.objects
  for select using (
    bucket_id = 'emergency-selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists emergency_selfies_delete_own on storage.objects;
create policy emergency_selfies_delete_own on storage.objects
  for delete using (
    bucket_id = 'emergency-selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- REVIEW ACTIONS
--
-- students has RLS enabled with no policy — only the service role touches it —
-- so a teacher's session cannot create or amend a student row directly. These
-- security-definer functions are the sanctioned exception, and each one proves
-- ownership before doing anything.
-- ============================================================================

create or replace function public.approve_emergency_checkin(emergency_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  s_id uuid;
  new_checkin_id uuid;
begin
  select * into e from emergency_checkins
   where id = emergency_id and teacher_id = auth.uid();
  if not found then
    raise exception 'not found';
  end if;
  if e.status <> 'pending' then
    raise exception 'already reviewed';
  end if;

  -- Find the student, or create them with no device bound so their next tap
  -- registers this phone properly.
  select id into s_id from students where student_id = e.student_id;
  if s_id is null then
    insert into students (student_id, full_name, device_token)
    values (e.student_id, e.full_name, null)
    returning id into s_id;
  end if;

  insert into checkins (
    student_id, lesson_id, tag_id, teacher_id,
    checked_in_at, lat, lng, distance_m, status, flag_reason
  )
  values (
    s_id, e.lesson_id, e.tag_id, e.teacher_id,
    e.created_at, e.lat, e.lng, e.distance_m, 'flagged', 'emergency_approved'
  )
  returning id into new_checkin_id;

  update emergency_checkins
     set status = 'approved', reviewed_at = now(), checkin_id = new_checkin_id
   where id = emergency_id;

  return new_checkin_id;
end;
$$;

create or replace function public.reject_emergency_checkin(emergency_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update emergency_checkins
     set status = 'rejected', reviewed_at = now()
   where id = emergency_id and teacher_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'not found or already reviewed';
  end if;
end;
$$;

-- Clear a student's device binding. The next tap re-binds them, which is the
-- one-press answer to a phone that lost its token.
create or replace function public.reset_student_device(target_student_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only for a student the caller has actually taught: proven through a
  -- check-in against one of their own lessons, or a place on one of their
  -- registers. Without this a teacher could unbind anyone in the school.
  if not exists (
    select 1 from checkins c
      join students s on s.id = c.student_id
     where c.teacher_id = auth.uid() and s.student_id = target_student_id
  ) and not exists (
    select 1 from class_students cs
      join classes cl on cl.id = cs.class_id
     where cl.teacher_id = auth.uid() and cs.student_id = target_student_id
  ) then
    raise exception 'not your student';
  end if;

  update students set device_token = null where student_id = target_student_id;
end;
$$;
