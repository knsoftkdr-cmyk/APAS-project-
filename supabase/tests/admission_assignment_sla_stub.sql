-- TEST-ONLY additions for admission_assignment_sla.test.sql: the pieces of the real project the assignment / SLA engine reads.
-- profiles.full_name and academic_calendar_events (the school calendar the SLA clocks take holidays from) exist in the real schema.
alter table public.profiles add column if not exists full_name text;
create table if not exists public.academic_calendar_events (id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id), title text, event_type text, start_date date, end_date date);
grant all on public.academic_calendar_events to authenticated, anon, service_role;
