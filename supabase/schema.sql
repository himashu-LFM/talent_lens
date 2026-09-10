-- ===========================================================================
-- TalentLens — Supabase schema v2 (team portal)
-- Run this in Supabase → SQL Editor. Idempotent: safe to re-run.
--
-- v1 → v2 migration is inline. Existing single-user rows are moved into a
-- personal organization per user, so nothing is lost and nothing breaks.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Helpers (security definer so RLS policies can query membership without
--    recursing into the policies on `memberships` itself)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(o uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = o and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(o uuid, roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = o and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

-- Can create/modify screening data (admins and recruiters).
create or replace function public.can_write_org(o uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_org_role(o, array['admin', 'recruiter']);
$$;

create or replace function public.is_org_admin(o uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_org_role(o, array['admin']);
$$;

create or replace function public.gen_token()
returns text language sql volatile as $$
  select replace(encode(gen_random_bytes(18), 'base64'), '/', '_');
$$;

-- ---------------------------------------------------------------------------
-- 1. Organizations, memberships, invites
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My team',
  -- 0 = keep candidate data forever; otherwise purge PII + resumes after N days
  retention_days int not null default 0,
  -- default reply-to shown on candidate-facing pages
  contact_email text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'recruiter'
    check (role in ('admin', 'recruiter', 'interviewer', 'viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);

create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role text not null default 'recruiter'
    check (role in ('admin', 'recruiter', 'interviewer', 'viewer')),
  token text not null unique default public.gen_token(),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.org_invites   enable row level security;

drop policy if exists "org read"    on public.organizations;
drop policy if exists "org create"  on public.organizations;
drop policy if exists "org update"  on public.organizations;
create policy "org read"   on public.organizations for select using (public.is_org_member(id));
create policy "org create" on public.organizations for insert with check (auth.uid() = created_by);
create policy "org update" on public.organizations for update using (public.is_org_admin(id));

drop policy if exists "membership read"   on public.memberships;
drop policy if exists "membership manage" on public.memberships;
drop policy if exists "membership self"   on public.memberships;
-- Members see the whole roster of their orgs.
create policy "membership read" on public.memberships for select
  using (user_id = auth.uid() or public.is_org_member(org_id));
-- Admins manage the roster; a user may always insert their own first row
-- (bootstrapping a brand-new org they just created).
create policy "membership manage" on public.memberships for all
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));
create policy "membership self" on public.memberships for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.organizations o
                where o.id = org_id and o.created_by = auth.uid())
  );

drop policy if exists "invite manage" on public.org_invites;
drop policy if exists "invite read"   on public.org_invites;
create policy "invite read"   on public.org_invites for select using (public.is_org_member(org_id));
create policy "invite manage" on public.org_invites for all
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Accepting an invite: matched on the signed-in user's email, so it cannot be
-- used to join an arbitrary org.
create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.org_invites;
  uid uuid := auth.uid();
  uemail text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select email into uemail from auth.users where id = uid;
  select * into inv from public.org_invites where token = invite_token;
  if inv.id is null then raise exception 'invite not found'; end if;
  if inv.accepted_at is not null then raise exception 'invite already used'; end if;
  if lower(inv.email) <> lower(uemail) then
    raise exception 'this invite was sent to %', inv.email;
  end if;

  insert into public.memberships (org_id, user_id, role)
  values (inv.org_id, uid, inv.role)
  on conflict (org_id, user_id) do update set role = excluded.role;

  update public.org_invites set accepted_at = now() where id = inv.id;
  update public.profiles set active_org_id = inv.org_id where id = uid;
  return inv.org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  company text,
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists active_org_id uuid
  references public.organizations (id) on delete set null;

alter table public.profiles enable row level security;

drop policy if exists "own profile read"  on public.profiles;
drop policy if exists "own profile write" on public.profiles;
drop policy if exists "team profile read" on public.profiles;
create policy "own profile write" on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);
-- Teammates can read each other's names so comments/assignments can show them.
create policy "team profile read" on public.profiles for select using (
  auth.uid() = id
  or exists (
    select 1 from public.memberships me
    join public.memberships them on them.org_id = me.org_id
    where me.user_id = auth.uid() and them.user_id = public.profiles.id
  )
);

-- On signup: create the profile, a personal org, and an admin membership; then
-- auto-accept any pending invite for that email address.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_org uuid;
  inv public.org_invites;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email)
  on conflict (id) do update set email = excluded.email;

  select * into inv from public.org_invites
  where lower(email) = lower(new.email) and accepted_at is null
  order by created_at desc limit 1;

  if inv.id is not null then
    insert into public.memberships (org_id, user_id, role)
    values (inv.org_id, new.id, inv.role)
    on conflict (org_id, user_id) do nothing;
    update public.org_invites set accepted_at = now() where id = inv.id;
    update public.profiles set active_org_id = inv.org_id where id = new.id;
  else
    insert into public.organizations (name, created_by, contact_email)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'company', ''), 'My team'),
            new.id, new.email)
    returning id into new_org;
    insert into public.memberships (org_id, user_id, role)
    values (new_org, new.id, 'admin');
    update public.profiles set active_org_id = new_org where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Jobs / requisitions (now org-scoped + publicly applyable)
-- ---------------------------------------------------------------------------
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
alter table public.jobs add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.jobs add column if not exists is_open boolean not null default true;
alter table public.jobs add column if not exists location text;
alter table public.jobs add column if not exists employment_type text;
alter table public.jobs add column if not exists headcount int not null default 1;
alter table public.jobs add column if not exists owner_id uuid references auth.users (id) on delete set null;
alter table public.jobs add column if not exists apply_enabled boolean not null default false;
alter table public.jobs add column if not exists public_token text unique;
alter table public.jobs add column if not exists auto_ack boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4. Screening runs
-- ---------------------------------------------------------------------------
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
alter table public.screening_runs add column if not exists job_id uuid references public.jobs (id) on delete set null;
alter table public.screening_runs add column if not exists org_id uuid references public.organizations (id) on delete cascade;
create index if not exists screening_runs_org_created_idx
  on public.screening_runs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Candidate reviews (status, notes, owner)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.screening_runs (id) on delete cascade,
  candidate_key text not null,
  candidate_name text,
  candidate_email text,
  status text not null default 'new',
  notes text,
  updated_at timestamptz not null default now(),
  unique (run_id, candidate_key)
);
alter table public.candidate_reviews add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.candidate_reviews add column if not exists assignee_id uuid references auth.users (id) on delete set null;
alter table public.candidate_reviews add column if not exists updated_by uuid references auth.users (id) on delete set null;
create index if not exists candidate_reviews_org_email_idx
  on public.candidate_reviews (org_id, candidate_email);
create index if not exists candidate_reviews_assignee_idx
  on public.candidate_reviews (assignee_id) where assignee_id is not null;

-- ---------------------------------------------------------------------------
-- 6. v1 → v2 backfill: give every legacy row an org
-- ---------------------------------------------------------------------------
do $$
declare
  u record;
  new_org uuid;
begin
  -- a personal org for every user who has data but no membership yet
  for u in
    select distinct p.id, p.email, p.full_name
    from public.profiles p
    where not exists (select 1 from public.memberships m where m.user_id = p.id)
  loop
    insert into public.organizations (name, created_by, contact_email)
    values (coalesce(nullif(u.full_name, '') || '''s team', 'My team'), u.id, u.email)
    returning id into new_org;
    insert into public.memberships (org_id, user_id, role) values (new_org, u.id, 'admin');
    update public.profiles set active_org_id = new_org where id = u.id;
  end loop;

  update public.jobs j set org_id = m.org_id
    from public.memberships m where m.user_id = j.user_id and j.org_id is null;
  update public.screening_runs r set org_id = m.org_id
    from public.memberships m where m.user_id = r.user_id and r.org_id is null;
  update public.candidate_reviews c set org_id = m.org_id
    from public.memberships m where m.user_id = c.user_id and c.org_id is null;
end $$;

-- Orphans (user deleted) can't be scoped; drop them rather than leave them unreachable.
delete from public.candidate_reviews where org_id is null;
delete from public.screening_runs   where org_id is null;
delete from public.jobs             where org_id is null;

alter table public.jobs              alter column org_id set not null;
alter table public.screening_runs    alter column org_id set not null;
alter table public.candidate_reviews alter column org_id set not null;

-- Give existing jobs a public token so the apply link can be switched on.
update public.jobs set public_token = public.gen_token() where public_token is null;
alter table public.jobs alter column public_token set default public.gen_token();
alter table public.jobs alter column public_token set not null;

-- ---------------------------------------------------------------------------
-- 7. Org-scoped RLS for jobs / runs / reviews
-- ---------------------------------------------------------------------------
alter table public.jobs              enable row level security;
alter table public.screening_runs    enable row level security;
alter table public.candidate_reviews enable row level security;

drop policy if exists "own jobs"  on public.jobs;
drop policy if exists "org jobs read"  on public.jobs;
drop policy if exists "org jobs write" on public.jobs;
create policy "org jobs read"  on public.jobs for select using (public.is_org_member(org_id));
create policy "org jobs write" on public.jobs for all
  using (public.can_write_org(org_id)) with check (public.can_write_org(org_id));

drop policy if exists "own runs" on public.screening_runs;
drop policy if exists "org runs read"  on public.screening_runs;
drop policy if exists "org runs write" on public.screening_runs;
create policy "org runs read"  on public.screening_runs for select using (public.is_org_member(org_id));
create policy "org runs write" on public.screening_runs for all
  using (public.can_write_org(org_id)) with check (public.can_write_org(org_id));

drop policy if exists "own reviews" on public.candidate_reviews;
drop policy if exists "org reviews read"  on public.candidate_reviews;
drop policy if exists "org reviews write" on public.candidate_reviews;
create policy "org reviews read" on public.candidate_reviews for select using (public.is_org_member(org_id));
-- Interviewers may review too (that is their job); viewers are read-only.
create policy "org reviews write" on public.candidate_reviews for all
  using (public.has_org_role(org_id, array['admin', 'recruiter', 'interviewer']))
  with check (public.has_org_role(org_id, array['admin', 'recruiter', 'interviewer']));

-- ---------------------------------------------------------------------------
-- 8. Comments (threaded discussion per candidate)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null references public.screening_runs (id) on delete cascade,
  candidate_key text not null,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists candidate_comments_thread_idx
  on public.candidate_comments (run_id, candidate_key, created_at);

alter table public.candidate_comments enable row level security;
drop policy if exists "org comments read"   on public.candidate_comments;
drop policy if exists "org comments insert" on public.candidate_comments;
drop policy if exists "own comments edit"   on public.candidate_comments;
create policy "org comments read" on public.candidate_comments for select
  using (public.is_org_member(org_id));
create policy "org comments insert" on public.candidate_comments for insert
  with check (author_id = auth.uid()
              and public.has_org_role(org_id, array['admin', 'recruiter', 'interviewer']));
-- You may edit or delete your own comment; nobody edits someone else's.
create policy "own comments edit" on public.candidate_comments for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "own comments delete" on public.candidate_comments;
create policy "own comments delete" on public.candidate_comments for delete
  using (author_id = auth.uid() or public.is_org_admin(org_id));

-- ---------------------------------------------------------------------------
-- 9. Resume files (Supabase Storage metadata) — deduped per org by sha1
-- ---------------------------------------------------------------------------
create table if not exists public.resume_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sha1 text not null,
  filename text not null,
  storage_path text not null,
  size_bytes int not null default 0,
  content_type text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, sha1)
);

create table if not exists public.run_resumes (
  run_id uuid not null references public.screening_runs (id) on delete cascade,
  candidate_key text not null,
  resume_id uuid not null references public.resume_files (id) on delete cascade,
  primary key (run_id, candidate_key)
);

alter table public.resume_files enable row level security;
alter table public.run_resumes  enable row level security;
drop policy if exists "org resume files" on public.resume_files;
create policy "org resume files" on public.resume_files for all
  using (public.is_org_member(org_id))
  with check (public.can_write_org(org_id));
drop policy if exists "org run resumes" on public.run_resumes;
create policy "org run resumes" on public.run_resumes for all
  using (exists (select 1 from public.screening_runs r
                 where r.id = run_id and public.is_org_member(r.org_id)))
  with check (exists (select 1 from public.screening_runs r
                      where r.id = run_id and public.can_write_org(r.org_id)));

-- Private bucket; objects are stored at  <org_id>/<sha1>.<ext>
insert into storage.buckets (id, name, public, file_size_limit)
values ('resumes', 'resumes', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

create or replace function public.storage_org(objname text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(objname))[1]::uuid;
exception when others then return null;
end;
$$;

drop policy if exists "resumes read"   on storage.objects;
drop policy if exists "resumes write"  on storage.objects;
drop policy if exists "resumes delete" on storage.objects;
create policy "resumes read" on storage.objects for select
  using (bucket_id = 'resumes' and public.is_org_member(public.storage_org(name)));
create policy "resumes write" on storage.objects for insert
  with check (bucket_id = 'resumes' and public.can_write_org(public.storage_org(name)));
create policy "resumes delete" on storage.objects for delete
  using (bucket_id = 'resumes' and public.is_org_admin(public.storage_org(name)));

-- ---------------------------------------------------------------------------
-- 10. Applications (public intake)
-- ---------------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  location text,
  notice_period text,
  expected_salary text,
  current_company text,
  current_title text,
  links jsonb not null default '{}'::jsonb,
  cover_note text,
  -- Voluntary, self-reported, never fed to the scoring engine. Used only for
  -- aggregate adverse-impact reporting (min group size enforced in the report).
  voluntary_demographics jsonb,
  consent boolean not null default false,
  consent_at timestamptz,
  resume_id uuid references public.resume_files (id) on delete set null,
  parsed jsonb,
  score numeric,
  breakdown jsonb,
  matched_skills jsonb,
  missing_skills jsonb,
  status text not null default 'new',
  status_token text not null unique default public.gen_token(),
  screened_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists applications_job_idx on public.applications (job_id, created_at desc);
create index if not exists applications_org_email_idx on public.applications (org_id, lower(email));

alter table public.applications enable row level security;
drop policy if exists "org applications read"  on public.applications;
drop policy if exists "org applications write" on public.applications;
create policy "org applications read" on public.applications for select
  using (public.is_org_member(org_id));
create policy "org applications write" on public.applications for all
  using (public.can_write_org(org_id)) with check (public.can_write_org(org_id));
-- Inserts from the public form go through the backend's service role, which
-- bypasses RLS — there is deliberately no anonymous insert policy here.

-- ---------------------------------------------------------------------------
-- 11. Interview scheduling
-- ---------------------------------------------------------------------------
create table if not exists public.interview_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  starts_at timestamptz not null,
  duration_min int not null default 45,
  mode text not null default 'video' check (mode in ('video', 'phone', 'onsite')),
  location text,
  meeting_link text,
  interviewer_id uuid references auth.users (id) on delete set null,
  taken_by uuid references public.applications (id) on delete set null,
  taken_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists interview_slots_job_idx on public.interview_slots (job_id, starts_at);

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  run_id uuid references public.screening_runs (id) on delete set null,
  candidate_key text,
  candidate_name text,
  candidate_email text,
  starts_at timestamptz not null,
  duration_min int not null default 45,
  mode text not null default 'video',
  location text,
  meeting_link text,
  interviewer_ids uuid[] not null default '{}',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  ics_uid text not null default (gen_random_uuid()::text),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists interviews_org_start_idx on public.interviews (org_id, starts_at);

alter table public.interview_slots enable row level security;
alter table public.interviews      enable row level security;
drop policy if exists "org slots"      on public.interview_slots;
drop policy if exists "org interviews" on public.interviews;
create policy "org slots" on public.interview_slots for all
  using (public.is_org_member(org_id)) with check (public.can_write_org(org_id));
create policy "org interviews" on public.interviews for all
  using (public.is_org_member(org_id))
  with check (public.has_org_role(org_id, array['admin', 'recruiter', 'interviewer']));

-- ---------------------------------------------------------------------------
-- 12. Email templates + outbound queue
-- ---------------------------------------------------------------------------
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  stage text not null default 'custom'
    check (stage in ('ack', 'shortlisted', 'interview', 'rejected', 'hired', 'custom')),
  subject text not null,
  body text not null,
  is_default boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_templates_org_idx on public.email_templates (org_id, stage);

create table if not exists public.email_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  send_after timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'cancelled')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  message_id text,
  run_id uuid references public.screening_runs (id) on delete set null,
  candidate_key text,
  application_id uuid references public.applications (id) on delete set null,
  interview_id uuid references public.interviews (id) on delete set null,
  ics text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists email_queue_due_idx
  on public.email_queue (status, send_after) where status = 'queued';

alter table public.email_templates enable row level security;
alter table public.email_queue     enable row level security;
drop policy if exists "org templates" on public.email_templates;
drop policy if exists "org queue"     on public.email_queue;
create policy "org templates" on public.email_templates for all
  using (public.is_org_member(org_id)) with check (public.can_write_org(org_id));
create policy "org queue" on public.email_queue for all
  using (public.is_org_member(org_id)) with check (public.can_write_org(org_id));

-- ---------------------------------------------------------------------------
-- 13. Audit log — append-only (no update/delete policy exists, so RLS denies both)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  run_id uuid,
  candidate_key text,
  candidate_name text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_log_org_at_idx on public.audit_log (org_id, at desc);
create index if not exists audit_log_candidate_idx on public.audit_log (run_id, candidate_key, at desc);

alter table public.audit_log enable row level security;
drop policy if exists "org audit read"   on public.audit_log;
drop policy if exists "org audit insert" on public.audit_log;
create policy "org audit read" on public.audit_log for select using (public.is_org_member(org_id));
create policy "org audit insert" on public.audit_log for insert
  with check (public.is_org_member(org_id) and actor_id = auth.uid());

-- Status and assignment changes are recorded by a trigger, so they are captured
-- even if a client forgets to log them.
create or replace function public.audit_review_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  act text;
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'new' then
      insert into public.audit_log (org_id, actor_id, action, entity, entity_id, run_id,
                                    candidate_key, candidate_name, before, after)
      values (new.org_id, auth.uid(), 'status.set', 'candidate_review', new.id::text, new.run_id,
              new.candidate_key, new.candidate_name, null, jsonb_build_object('status', new.status));
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, run_id,
                                  candidate_key, candidate_name, before, after)
    values (new.org_id, auth.uid(), 'status.change', 'candidate_review', new.id::text, new.run_id,
            new.candidate_key, new.candidate_name,
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, run_id,
                                  candidate_key, candidate_name, before, after)
    values (new.org_id, auth.uid(), 'assignee.change', 'candidate_review', new.id::text, new.run_id,
            new.candidate_key, new.candidate_name,
            jsonb_build_object('assignee_id', old.assignee_id),
            jsonb_build_object('assignee_id', new.assignee_id));
  end if;
  if coalesce(new.notes, '') is distinct from coalesce(old.notes, '') then
    -- record that notes changed, not their content (notes can hold sensitive text)
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id, run_id,
                                  candidate_key, candidate_name, after)
    values (new.org_id, auth.uid(), 'notes.edit', 'candidate_review', new.id::text, new.run_id,
            new.candidate_key, new.candidate_name,
            jsonb_build_object('length', length(coalesce(new.notes, ''))));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_candidate_reviews on public.candidate_reviews;
create trigger audit_candidate_reviews
  after insert or update on public.candidate_reviews
  for each row execute function public.audit_review_change();

-- ---------------------------------------------------------------------------
-- 14. Candidate data-deletion requests (DPDP / GDPR)
-- ---------------------------------------------------------------------------
create table if not exists public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  reason text,
  source text not null default 'candidate',
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users (id) on delete set null,
  note text
);
alter table public.deletion_requests enable row level security;
drop policy if exists "org deletion requests" on public.deletion_requests;
create policy "org deletion requests" on public.deletion_requests for all
  using (public.is_org_member(org_id)) with check (public.can_write_org(org_id));

-- ---------------------------------------------------------------------------
-- 15. Bias audits (per run)
-- ---------------------------------------------------------------------------
create table if not exists public.bias_audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null references public.screening_runs (id) on delete cascade,
  report jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bias_audits_run_idx on public.bias_audits (run_id, created_at desc);

alter table public.bias_audits enable row level security;
drop policy if exists "org bias audits" on public.bias_audits;
create policy "org bias audits" on public.bias_audits for all
  using (public.is_org_member(org_id)) with check (public.can_write_org(org_id));

-- ---------------------------------------------------------------------------
-- 16. Candidate merge (same person across runs)
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  primary_key text not null,          -- surviving candidate_key
  merged_key text not null,           -- key folded into the primary
  merged_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, merged_key)
);
alter table public.candidate_identities enable row level security;
drop policy if exists "org identities" on public.candidate_identities;
create policy "org identities" on public.candidate_identities for all
  using (public.is_org_member(org_id)) with check (public.can_write_org(org_id));
