-- Migration: create demo_requests table
-- Run this in your Supabase project's SQL Editor (Dashboard > SQL Editor > New query)

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  institution_name text not null,
  email text not null,
  phone_number text,
  description text,
  status text not null default 'new', -- new | contacted | scheduled | closed
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.demo_requests enable row level security;

-- Allow anyone (including anonymous/unauthenticated visitors on the public site)
-- to INSERT a demo request. This is a public marketing form, so inserts are open.
create policy "Anyone can submit a demo request"
  on public.demo_requests
  for insert
  to anon, authenticated
  with check (true);

-- Restrict SELECT/UPDATE/DELETE to admins only (KNSOFT admins / school admins).
-- Adjust the role check below to match how you identify staff in `profiles`.
create policy "Admins can view demo requests"
  on public.demo_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('knsoft_admin', 'admin', 'school_admin')
    )
  );

create policy "Admins can update demo requests"
  on public.demo_requests
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('knsoft_admin', 'admin', 'school_admin')
    )
  );