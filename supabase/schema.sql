create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('infinite', 'timed', 'daily')),
  seed bigint not null check (seed >= 0 and seed <= 4294967295),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  challenge_date date,
  completed_at timestamptz
);

create index if not exists game_sessions_user_started_idx
  on public.game_sessions (user_id, started_at desc);

create unique index if not exists game_sessions_daily_attempt_idx
  on public.game_sessions (user_id, challenge_date)
  where mode = 'daily';

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.game_sessions (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('infinite', 'timed', 'daily')),
  score bigint not null check (score >= 0),
  move_count integer not null check (move_count >= 0),
  submitted_at timestamptz not null default now()
);

create index if not exists scores_mode_score_idx
  on public.scores (mode, score desc, submitted_at);

alter table public.profiles enable row level security;
alter table public.game_sessions enable row level security;
alter table public.scores enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select using (true);

drop policy if exists "Players can create their own profile" on public.profiles;
create policy "Players can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "Players can update their own profile" on public.profiles;
create policy "Players can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Scores are publicly readable" on public.scores;
create policy "Scores are publicly readable"
  on public.scores for select using (true);

revoke all on public.game_sessions from anon, authenticated;
revoke insert, update, delete on public.scores from anon, authenticated;
grant select on public.profiles, public.scores to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant all on public.profiles, public.game_sessions, public.scores to service_role;

create or replace view public.leaderboard
with (security_invoker = true)
as
select
  best.user_id,
  best.username,
  best.mode,
  best.score,
  row_number() over (
    partition by best.mode
    order by best.score desc, best.submitted_at asc, best.user_id asc
  )::integer as rank,
  best.submitted_at
from (
  with best_scores as (
    select user_id, mode, max(score)::bigint as score
    from public.scores
    group by user_id, mode
  )
  select
    best_scores.user_id,
    profiles.username,
    best_scores.mode,
    best_scores.score,
    (
      select min(scores.submitted_at)
      from public.scores
      where scores.user_id = best_scores.user_id
        and scores.mode = best_scores.mode
        and scores.score = best_scores.score
    ) as submitted_at
  from best_scores
  join public.profiles on profiles.id = best_scores.user_id
) as best;

grant select on public.leaderboard to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'scores'
    ) then
    execute 'alter publication supabase_realtime add table public.scores';
  end if;
end
$$;

create or replace function public.save_verified_score(
  p_session_id uuid,
  p_user_id uuid,
  p_mode text,
  p_score bigint,
  p_move_count integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.game_sessions
  set completed_at = now()
  where id = p_session_id
    and user_id = p_user_id
    and mode = p_mode
    and completed_at is null;

  if not found then
    raise exception 'Game session was already completed or is invalid';
  end if;

  insert into public.scores (session_id, user_id, mode, score, move_count)
  values (p_session_id, p_user_id, p_mode, p_score, p_move_count);
end;
$$;

revoke all on function public.save_verified_score(uuid, uuid, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.save_verified_score(uuid, uuid, text, bigint, integer)
  to service_role;
