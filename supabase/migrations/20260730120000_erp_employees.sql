-- People / Employees module for the ERP portal

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.erp_organizations(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  designation text,
  department text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  date_joined date not null default current_date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_employees_org on public.employees(organization_id);
create index if not exists idx_employees_org_status on public.employees(organization_id, status);

alter table public.employees enable row level security;

-- Members can see employees that belong to their own organization
create policy "employees_select_own_org" on public.employees
  for select using (
    organization_id in (select organization_id from public.erp_users where id = auth.uid())
  );

-- Members can add employees to their own organization
create policy "employees_insert_own_org" on public.employees
  for insert with check (
    organization_id in (select organization_id from public.erp_users where id = auth.uid())
  );

-- Members can update employees in their own organization
create policy "employees_update_own_org" on public.employees
  for update using (
    organization_id in (select organization_id from public.erp_users where id = auth.uid())
  ) with check (
    organization_id in (select organization_id from public.erp_users where id = auth.uid())
  );

-- Members can remove employees from their own organization
create policy "employees_delete_own_org" on public.employees
  for delete using (
    organization_id in (select organization_id from public.erp_users where id = auth.uid())
  );
