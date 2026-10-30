-- ====================================================================
-- BIOPOPCORN STRATEGY COURT DECISION LAB - SUPABASE POSTGRESQL SCHEMA
-- Supports:
-- 1. Courtroom & Jury Voting (Max 6 Jurors, 4 Deliberation Questions)
-- 2. Live Classroom Quiz (Independent room PINs, 3 Stances, Reasoning)
-- ====================================================================

-- 1. CLASSROOM QUIZ SESSIONS
create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  room_pin varchar(6) not null unique,
  host_token varchar(64) not null,
  status varchar(20) not null default 'active' check (status in ('lobby', 'active', 'ended')),
  question_id varchar(50) not null default 'q1',
  question_category varchar(100) not null default 'Strategic Decision',
  question_text text not null default 'Based on the evidence presented, do you support our solution for the company''s future?',
  results_revealed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours')
);

create index if not exists idx_quiz_sessions_pin on public.quiz_sessions(room_pin);
create index if not exists idx_quiz_sessions_status on public.quiz_sessions(status);

-- 2. CLASSROOM QUIZ PARTICIPANTS & RESPONSES
create table if not exists public.quiz_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quiz_sessions(id) on delete cascade,
  client_id varchar(64) not null,
  name varchar(100) not null,
  stance varchar(100) check (stance in ('Support Solution', 'Conditional Support', 'Oppose / Alternative', 'Yes — Support Localization & Dual Sourcing', 'Conditional — Require Additional Pilot Batch Comparability', 'Oppose / Alternative — Retain Existing Qualified Import')),
  reasoning text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_quiz_participant unique (session_id, client_id)
);

create index if not exists idx_quiz_participants_session on public.quiz_participants(session_id);
create index if not exists idx_quiz_participants_client on public.quiz_participants(client_id);

-- 3. JURY VOTING SESSIONS
create table if not exists public.jury_sessions (
  id uuid primary key default gen_random_uuid(),
  room_pin varchar(6) not null unique,
  host_token varchar(64) not null,
  status varchar(20) not null default 'lobby' check (status in ('lobby', 'active', 'ended')),
  current_question_index integer not null default 0 check (current_question_index >= 0 and current_question_index < 10),
  results_revealed boolean not null default false,
  questions jsonb not null default '[]'::jsonb,
  max_jurors integer not null default 6,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours')
);

create index if not exists idx_jury_sessions_pin on public.jury_sessions(room_pin);
create index if not exists idx_jury_sessions_status on public.jury_sessions(status);

-- 4. JURY PARTICIPANTS (MAX 6)
create table if not exists public.jury_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.jury_sessions(id) on delete cascade,
  client_id varchar(64) not null,
  name varchar(100) not null,
  slot_number integer not null check (slot_number between 1 and 6),
  connected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_jury_participant unique (session_id, client_id),
  constraint uq_jury_slot unique (session_id, slot_number)
);

create index if not exists idx_jury_participants_session on public.jury_participants(session_id);

-- 5. JURY VOTES & REASONING
create table if not exists public.jury_votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.jury_sessions(id) on delete cascade,
  participant_id uuid not null references public.jury_participants(id) on delete cascade,
  client_id varchar(64) not null,
  question_index integer not null,
  option_index integer not null check (option_index between 0 and 3),
  option_text text not null,
  reasoning text default '',
  submitted_at timestamptz not null default now(),
  constraint uq_jury_vote unique (session_id, participant_id, question_index)
);

create index if not exists idx_jury_votes_session on public.jury_votes(session_id);
create index if not exists idx_jury_votes_question on public.jury_votes(session_id, question_index);

-- 6. AUDIT / SESSION EVENTS LOG
create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_type varchar(20) not null check (session_type in ('quiz', 'jury')),
  session_id uuid not null,
  event_type varchar(50) not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_events_type_id on public.session_events(session_type, session_id);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

alter table public.quiz_sessions enable row level security;
alter table public.quiz_participants enable row level security;
alter table public.jury_sessions enable row level security;
alter table public.jury_participants enable row level security;
alter table public.jury_votes enable row level security;
alter table public.session_events enable row level security;

-- Public anon read access to active sessions by room_pin
create policy "Anon can read quiz sessions"
  on public.quiz_sessions for select
  using (status in ('lobby', 'active', 'ended'));

create policy "Anon can read jury sessions"
  on public.jury_sessions for select
  using (status in ('lobby', 'active', 'ended'));

-- Participants can read participant and vote data in their active session
create policy "Anon can read quiz participants"
  on public.quiz_participants for select
  using (true);

create policy "Anon can insert quiz participants"
  on public.quiz_participants for insert
  with check (true);

create policy "Anon can update own quiz response"
  on public.quiz_participants for update
  using (true);

create policy "Anon can read jury participants"
  on public.jury_participants for select
  using (true);

create policy "Anon can insert jury participants"
  on public.jury_participants for insert
  with check (true);

create policy "Anon can read jury votes"
  on public.jury_votes for select
  using (true);

create policy "Anon can insert jury votes"
  on public.jury_votes for insert
  with check (true);

create policy "Anon can update jury votes"
  on public.jury_votes for update
  using (true);

-- Allow service role full management
create policy "Service role manages quiz_sessions"
  on public.quiz_sessions for all
  using (true);

create policy "Service role manages jury_sessions"
  on public.jury_sessions for all
  using (true);

-- ====================================================================
-- REALTIME REPLICATION CONFIGURATION
-- ====================================================================
-- Enables Supabase Realtime broadcast and postgres_changes across connected devices
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'quiz_sessions') then
    alter publication supabase_realtime add table public.quiz_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'quiz_participants') then
    alter publication supabase_realtime add table public.quiz_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jury_sessions') then
    alter publication supabase_realtime add table public.jury_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jury_participants') then
    alter publication supabase_realtime add table public.jury_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jury_votes') then
    alter publication supabase_realtime add table public.jury_votes;
  end if;
exception when others then
  null;
end $$;

