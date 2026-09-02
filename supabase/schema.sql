-- TalentLens — Supabase schema
-- Run this in Supabase → SQL Editor. Safe to re-run.

-- 1. Profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  company text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile read"  on public.profiles;
drop policy if exists "own profile write" on public.profiles;
create policy "own profile read"  on public.profiles for select using  (auth.uid() = id);
create policy "own profile write" on public.profiles for all    using  (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Screening runs ---------------------------------------------------------
create table if not exists public.screening_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled role',
  source text not null default 'upload',
  total_resumes int not null default 0,
  shortlisted int not null default 0,
  avg_score numeric not null default 0,
  top_name text,
  top_score numeric,
  results jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists screening_runs_user_created_idx
  on public.screening_runs (user_id, created_at desc);

alter table public.screening_runs enable row level security;

drop policy if exists "own runs" on public.screening_runs;
create policy "own runs" on public.screening_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2b. Saved job postings ----------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text not null,
  top_n int not null default 10,
  weights jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;
drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- link runs to a saved job (optional)
alter table public.screening_runs add column if not exists job_id uuid references public.jobs (id) on delete set null;

-- 3. Candidate reviews (status + notes per candidate per run) ----------------
create table if not exists public.candidate_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.screening_runs (id) on delete cascade,
  candidate_key text not null,          -- email if present, else filename
  candidate_name text,
  candidate_email text,
  status text not null default 'new',   -- new | shortlisted | interview | rejected | hired
  notes text,
  updated_at timestamptz not null default now(),
  unique (run_id, candidate_key)
);

create index if not exists candidate_reviews_user_idx
  on public.candidate_reviews (user_id, candidate_email);

alter table public.candidate_reviews enable row level security;

drop policy if exists "own reviews" on public.candidate_reviews;
create policy "own reviews" on public.candidate_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
