-- Migration 001: Add plans table for multi-plan support
-- Run this in Supabase SQL Editor

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  source text not null default 'manual' check (source in ('manual', 'generated')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index plans_one_active_per_user 
  on public.plans (user_id) 
  where is_active = true;

alter table public.routines 
  add column plan_id uuid references public.plans(id) on delete cascade;

insert into public.plans (user_id, name, source, is_active)
select distinct user_id, 'My Routine', 'manual', true
from public.routines;

update public.routines r
set plan_id = p.id
from public.plans p
where r.user_id = p.user_id
  and p.is_active = true;

alter table public.routines 
  alter column plan_id set not null;

alter table public.plans enable row level security;

create policy "Users manage own plans"
  on public.plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);