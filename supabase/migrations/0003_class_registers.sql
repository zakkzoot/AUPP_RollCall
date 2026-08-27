-- ============================================================================
-- CLASS REGISTERS
--
-- A class is a named group of students with an imported register. Lessons point
-- at a class, so a subject taught three times a week shares one register rather
-- than needing the list imported per timetable row.
--
-- The register is what makes the attendance record trustworthy: at first tap a
-- student types only their ID, and the name on the record comes from here
-- instead of whatever they felt like typing.
-- ============================================================================

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint classes_name_per_teacher unique (teacher_id, name)
);
create index if not exists classes_teacher on classes (teacher_id);

-- student_id is the school's own ID, matched against students.student_id when a
-- student registers a device. full_name is the official spelling that lands on
-- the attendance record.
create table if not exists class_students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id text not null,
  full_name text not null,
  created_at timestamptz not null default now(),
  constraint one_entry_per_student_per_class unique (class_id, student_id)
);
create index if not exists class_students_class on class_students (class_id);
create index if not exists class_students_student_id on class_students (student_id);

-- Nullable: lessons that predate registers, or one-offs with no class, keep
-- working exactly as before.
alter table lessons
  add column if not exists class_id uuid references classes(id) on delete set null;
create index if not exists lessons_class on lessons (class_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Same shape as the rest of the schema: a teacher reaches only their own rows.
-- class_students has no teacher_id of its own, so ownership is proven through
-- the parent class.
-- ============================================================================
alter table classes        enable row level security;
alter table class_students enable row level security;

-- Dropped first so the whole file is safe to re-run against an existing project.
drop policy if exists classes_own on classes;
create policy classes_own on classes
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists class_students_own on class_students;
create policy class_students_own on class_students
  for all
  using (
    exists (
      select 1 from classes c
      where c.id = class_students.class_id and c.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from classes c
      where c.id = class_students.class_id and c.teacher_id = auth.uid()
    )
  );
