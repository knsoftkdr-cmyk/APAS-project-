-- 1) ERP customer organizations
create table if not exists public.erp_organizations (
  id uuid primary key default gen_random_uuid(),
  org_name text not null,
  phone text,
  country text,
  state text,
  solution_slug text,           -- e.g. 'finance-erp' — which product they signed up for
  status text not null default 'trial' check (status in ('trial','active','suspended','cancelled')),
  created_at timestamptz not null default now()
);

-- 2) ERP users, one row per person who can log into the ERP portal
create table if not exists public.erp_users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.erp_organizations(id) on delete cascade,
  email text not null,
  role text not null default 'owner' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now()
);

create index if not exists idx_erp_users_org on public.erp_users(organization_id);

alter table public.erp_organizations enable row level security;
alter table public.erp_users enable row level security;

-- Org visible only to its own members
create policy "erp_org_select_own" on public.erp_organizations
  for select using (
    id in (select organization_id from public.erp_users where id = auth.uid())
  );

-- Users can see/update only their own erp_users row
create policy "erp_users_select_own" on public.erp_users
  for select using (id = auth.uid());

create policy "erp_users_update_own" on public.erp_users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- 3) Auto-provision org + erp_user when someone signs up with account_type = 'erp_customer'
create or replace function public.handle_new_erp_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if (new.raw_user_meta_data->>'account_type') = 'erp_customer' then
    insert into public.erp_organizations (org_name, phone, country, state, solution_slug)
    values (
      new.raw_user_meta_data->>'org_name',
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'country',
      new.raw_user_meta_data->>'state',
      new.raw_user_meta_data->>'solution_slug'
    )
    returning id into new_org_id;

    insert into public.erp_users (id, organization_id, email, role)
    values (new.id, new_org_id, new.email, 'owner');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_erp on auth.users;
create trigger on_auth_user_created_erp
  after insert on auth.users
  for each row execute function public.handle_new_erp_user();