-- ============================================================================
-- Create the teacher profile row automatically when an auth user is created.
--
-- The client used to insert this itself immediately after signUp(). That works
-- only when sign-up returns a session — i.e. when "Confirm email" is off. With
-- confirmation on (the Supabase default) there is no session yet, so RLS blocks
-- the insert and the teacher ends up with a confirmed login and no profile row.
-- Doing it in a trigger makes sign-up work either way, and keeps the name and
-- timezone the teacher actually typed.
-- ============================================================================

create or replace function public.handle_new_teacher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.teachers (id, full_name, timezone)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'timezone'), ''),
      'Asia/Phnom_Penh'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_teacher();
