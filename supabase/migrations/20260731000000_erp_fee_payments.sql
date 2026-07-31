create table if not exists fee_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  student_name text not null,
  class_grade text,
  amount_due numeric not null default 0,
  amount_paid numeric not null default 0,
  due_date date,
  status text not null default 'pending',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table fee_payments enable row level security;

create policy "fee_payments_select" on fee_payments
  for select
  using (
    school_id in (
      select school_id from profiles
      where id = auth.uid() and erp_access = true
    )
  );

create policy "fee_payments_insert" on fee_payments
  for insert
  with check (
    school_id in (
      select school_id from profiles
      where id = auth.uid() and erp_access = true
    )
  );

create policy "fee_payments_update" on fee_payments
  for update
  using (
    school_id in (
      select school_id from profiles
      where id = auth.uid() and erp_access = true
    )
  );

create policy "fee_payments_delete" on fee_payments
  for delete
  using (
    school_id in (
      select school_id from profiles
      where id = auth.uid() and erp_access = true
    )
  );