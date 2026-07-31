-- Parent self-service fee lookup by Student ID (roll_number, e.g. STU0001 —
-- the same identifier used for student login) + Registered Mobile
--
-- NOTE: reconciled against your real students table export. It already has
-- admission_number, branch_id, parent_phone, contact_email, parent_email —
-- so this migration only adds what's genuinely missing (father_name,
-- mother_name) and does NOT add a redundant "email" column. It uses
-- contact_email for the "Email Address" field shown on the fee page.

-- 1. branches table — your data shows branch_id already populated on many
--    students, so this table almost certainly already exists; kept as
--    IF NOT EXISTS purely as a safety net so the join below never errors.
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.branches enable row level security;
drop policy if exists "branches_read_same_school" on public.branches;
create policy "branches_read_same_school" on public.branches
  for select using (
    school_id in (select school_id from public.profiles where id = auth.uid())
  );

-- 2. Only genuinely missing identity fields (admission_number and branch_id
--    already exist on your students table, confirmed from your data export)
alter table public.students add column if not exists father_name text;
alter table public.students add column if not exists mother_name text;

create index if not exists idx_students_roll_number_lower on public.students (lower(roll_number));

-- 3. Fee category breakdown on fee_payments (course/transport/etc. amounts,
--    shown in the Fee Particulars panel)
alter table fee_payments add column if not exists course_amount numeric not null default 0;
alter table fee_payments add column if not exists transport_amount numeric not null default 0;
alter table fee_payments add column if not exists other_amount numeric not null default 0;
alter table fee_payments add column if not exists uniform_amount numeric not null default 0;
alter table fee_payments add column if not exists material_amount numeric not null default 0;
alter table fee_payments add column if not exists exam_amount numeric not null default 0;

-- 4. Secure lookup: a parent enters Student ID (roll_number — same identifier
--    used for student login, e.g. STU0001) + mobile. They are NOT necessarily
--    linked via parent_students yet, so this can't go through normal students
--    RLS. Instead of opening students up for broad reads, expose one narrow
--    SECURITY DEFINER function that only returns a match when both the
--    Student ID AND mobile are correct.
drop function if exists public.lookup_student_fee_details(text, text);

create or replace function public.lookup_student_fee_details(p_student_id text, p_mobile text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_student_id uuid;
  v_full_name text;
  v_class text;
  v_section text;
  v_father_name text;
  v_mother_name text;
  v_contact_email text;
  v_mobile text;
  v_branch_id uuid;
  v_school_id uuid;
  v_branch_name text;
  v_due numeric;
  v_paid numeric;
  v_course numeric;
  v_transport numeric;
  v_other numeric;
  v_uniform numeric;
  v_material numeric;
begin
  v_role := public.get_user_role(auth.uid());
  if v_role is null or v_role not in ('parent', 'admin', 'school_admin', 'principal') then
    raise exception 'not authorized';
  end if;

  select id, full_name, class, section, father_name, mother_name,
         coalesce(contact_email, parent_email), parent_phone, branch_id, school_id
    into v_student_id, v_full_name, v_class, v_section, v_father_name, v_mother_name,
         v_contact_email, v_mobile, v_branch_id, v_school_id
  from public.students
  where lower(roll_number) = lower(trim(p_student_id))
    and parent_phone = trim(p_mobile)
  limit 1;

  if v_student_id is null then
    return null;
  end if;

  select b.name into v_branch_name from public.branches b where b.id = v_branch_id;
  if v_branch_name is null then
    select sc.name into v_branch_name from public.schools sc where sc.id = v_school_id;
  end if;

  select coalesce(sum(amount_due), 0), coalesce(sum(amount_paid), 0),
         coalesce(sum(course_amount), 0), coalesce(sum(transport_amount), 0),
         coalesce(sum(other_amount), 0), coalesce(sum(uniform_amount), 0),
         coalesce(sum(material_amount), 0)
    into v_due, v_paid, v_course, v_transport, v_other, v_uniform, v_material
  from public.fee_payments
  where student_id = v_student_id;

  return jsonb_build_object(
    'student_id', v_student_id,
    'school_id', v_school_id,
    'full_name', v_full_name,
    'class', v_class,
    'section', v_section,
    'father_name', v_father_name,
    'mother_name', v_mother_name,
    'contact_email', v_contact_email,
    'mobile', v_mobile,
    'branch_name', v_branch_name,
    'due_amount', greatest(v_due - v_paid, 0),
    'course_amount', v_course,
    'transport_amount', v_transport,
    'other_amount', v_other,
    'uniform_amount', v_uniform,
    'material_amount', v_material
  );
end;
$$;

grant execute on function public.lookup_student_fee_details(text, text) to authenticated;
