-- Stix CFB — step 1 (database only; nothing in the app uses this yet).
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: it only creates things that don't exist yet and replaces its own functions/policies/triggers.
--
-- Why this exists: the Stix repo is public, so college-football lines and results are NOT stored in it. They live
-- here, and only signed-in users who confirmed 21+ can read them (row-level security). The pipeline writes with the
-- server key (admin; it bypasses these policies). The NFL tables (games, picks, profiles, reviews, ...) are not touched.
--
-- What it creates:
--   cfb_games       — Power 4 games (ESPN event id), kickoff, teams, status, score.
--   cfb_lines       — every captured line (append-only): book, market, player, line, prices. Readable by signed-in 21+ users.
--   cfb_pulls       — log of pulls that returned data or failed (credits used, minutes before kickoff).
--   cfb_pull_state  — per game: how many empty checks so far, when lines first posted, when the pre-game pull happened.
--   cfb_players     — ESPN roster: athlete id, name, team, position.
--   cfb_results     — final passing / rushing / receiving yards per player per game (ESPN box score).
--   cfb_picks       — each user's CFB picks (separate from NFL picks). A user can only see and change their own.
--   Lock            — the database refuses adding, changing or deleting a CFB pick once its game has kicked off.
--                     The phone's clock is never used. Admin access (SQL Editor / server key) is not locked.
--   Gate            — cfb_ok() is true only for a signed-in user with profiles.age_confirmed_at set.

-- ---------- gate ----------
create or replace function public.cfb_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.age_confirmed_at is not null);
$$;
revoke all on function public.cfb_ok() from public, anon;
grant execute on function public.cfb_ok() to authenticated;

-- ---------- cfb_games ----------
create table if not exists public.cfb_games (
  game_id        text primary key,                   -- ESPN event id, e.g. '401858274'
  week           int,
  kickoff        timestamptz not null,
  home_team      text not null,                      -- ESPN display name, e.g. 'Miami Hurricanes'
  away_team      text not null,
  home_id        text,
  away_id        text,
  conference     text,                               -- ACC, Big 12, Big Ten, SEC or Notre Dame (the P4 side we found it under)
  status         text not null default 'scheduled',  -- scheduled | in | final
  home_score     int,
  away_score     int,
  odds_event_id  text,                               -- The Odds API event id once matched
  updated_at     timestamptz not null default now()
);
create index if not exists cfb_games_kickoff_idx on public.cfb_games (kickoff);

-- ---------- cfb_lines (append-only) ----------
create table if not exists public.cfb_lines (
  id               bigint generated always as identity primary key,
  game_id          text not null references public.cfb_games (game_id),
  pull_type        text not null check (pull_type in ('first','pregame')),  -- first = when lines first posted; pregame = ~1 h before kickoff (the graded line)
  captured_utc     timestamptz not null,
  minutes_before_kickoff int,
  book             text not null,
  market           text not null check (market in ('player_pass_yds','player_rush_yds','player_reception_yds')),
  player_name      text not null,                    -- as the book wrote it
  athlete_id       text,                             -- ESPN athlete id once matched
  line             numeric(6,1) not null,
  over_price       int,
  under_price      int,
  book_last_update timestamptz,
  source           text not null default 'The Odds API',
  unique (game_id, pull_type, captured_utc, book, market, player_name, line)
);
create index if not exists cfb_lines_game_idx on public.cfb_lines (game_id, pull_type);

-- ---------- cfb_pulls / cfb_pull_state ----------
create table if not exists public.cfb_pulls (
  id               bigint generated always as identity primary key,
  game_id          text not null references public.cfb_games (game_id),
  pull_type        text not null,
  status           text not null check (status in ('ok','error')),
  attempted_utc    timestamptz not null,
  minutes_before_kickoff int,
  outcomes         int,
  credits_last     int,
  credits_remaining int,
  note             text
);
create index if not exists cfb_pulls_game_idx on public.cfb_pulls (game_id);

create table if not exists public.cfb_pull_state (
  game_id          text primary key references public.cfb_games (game_id),
  empty_checks     int not null default 0,           -- checks that came back with no player props (cost 0 credits)
  last_check_utc   timestamptz,
  first_ok_utc     timestamptz,
  pregame_ok_utc   timestamptz,
  updated_at       timestamptz not null default now()
);

-- ---------- cfb_players / cfb_results ----------
create table if not exists public.cfb_players (
  athlete_id  text primary key,                      -- ESPN athlete id
  name        text not null,
  team_id     text,
  team_name   text,
  pos         text,                                  -- ESPN roster position (may be missing or wrong for some players)
  updated_at  timestamptz not null default now()
);

create table if not exists public.cfb_results (
  game_id        text not null references public.cfb_games (game_id),
  athlete_id     text not null,
  player_name    text not null,
  team_name      text not null,
  pass_cmp       numeric, pass_att numeric, pass_yds numeric,
  rush_att       numeric, rush_yds numeric,
  rec            numeric, rec_yds numeric,
  fetched_utc    timestamptz not null default now(),
  primary key (game_id, athlete_id)
);

-- Read access: signed-in users who confirmed 21+. Writes: only the server key (no write policies).
do $$
declare t text;
begin
  foreach t in array array['cfb_games','cfb_lines','cfb_pulls','cfb_pull_state','cfb_players','cfb_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "cfb read for 21+" on public.%I', t);
    execute format('create policy "cfb read for 21+" on public.%I for select to authenticated using (public.cfb_ok())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Lines are history: nobody (not even the server key) can change or delete a captured line by accident.
-- To fix a real mistake, an admin disables this trigger in the SQL Editor on purpose.
create or replace function public.cfb_lines_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'cfb_lines is append-only.' using errcode = 'P0001';
end $$;
drop trigger if exists cfb_lines_no_change on public.cfb_lines;
create trigger cfb_lines_no_change before update or delete on public.cfb_lines
  for each row execute function public.cfb_lines_append_only();

-- ---------- cfb_picks ----------
create table if not exists public.cfb_picks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pick_key    text not null,                         -- "<game id>|<player key>|<market>" (one pick per player/market/game)
  game_id     text not null references public.cfb_games (game_id),
  week        int,
  athlete_id  text,
  player_name text not null,
  team_name   text,
  pos         text,
  market      text not null check (market in ('player_pass_yds','player_rush_yds','player_reception_yds')),
  side        text not null check (side in ('o','u')),
  line        numeric(6,1) not null,
  odds        int,
  book        text,
  source      text not null default 'manual' check (source in ('manual','import')),
  line_captured_at timestamptz,
  units       numeric(4,2) not null default 1 check (units = 1),
  picked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, pick_key)
);
create index if not exists cfb_picks_user_idx on public.cfb_picks (user_id);
create index if not exists cfb_picks_game_idx on public.cfb_picks (game_id);
alter table public.cfb_picks enable row level security;
drop policy if exists "read own cfb picks"   on public.cfb_picks;
drop policy if exists "add own cfb picks"    on public.cfb_picks;
drop policy if exists "change own cfb picks" on public.cfb_picks;
drop policy if exists "delete own cfb picks" on public.cfb_picks;
create policy "read own cfb picks"   on public.cfb_picks for select to authenticated using (user_id = auth.uid() and public.cfb_ok());
create policy "add own cfb picks"    on public.cfb_picks for insert to authenticated with check (user_id = auth.uid() and public.cfb_ok());
create policy "change own cfb picks" on public.cfb_picks for update to authenticated using (user_id = auth.uid() and public.cfb_ok()) with check (user_id = auth.uid() and public.cfb_ok());
create policy "delete own cfb picks" on public.cfb_picks for delete to authenticated using (user_id = auth.uid() and public.cfb_ok());
revoke all on public.cfb_picks from anon;
grant select, insert, update, delete on public.cfb_picks to authenticated;

-- ---------- lock at kickoff (enforced by the database) ----------
create or replace function public.enforce_cfb_pick_lock() returns trigger
language plpgsql security invoker set search_path = public as $$
declare ko timestamptz;
begin
  if current_user not in ('authenticated', 'anon') then   -- admin / server key: not locked
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select kickoff into ko from public.cfb_games where game_id = old.game_id;
    if ko is null or now() >= ko then
      raise exception 'This pick is locked: the game has started.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.picked_at <> old.picked_at) then
      raise exception 'Not allowed to change who made a pick or when.' using errcode = 'P0001';
    end if;
    select kickoff into ko from public.cfb_games where game_id = new.game_id;
    if ko is null then
      raise exception 'Unknown game.' using errcode = 'P0001';
    end if;
    if now() >= ko then
      raise exception 'Too late: the game has started.' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' then new.picked_at := now(); end if;
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists cfb_picks_lock on public.cfb_picks;
create trigger cfb_picks_lock before insert or update or delete on public.cfb_picks
  for each row execute function public.enforce_cfb_pick_lock();
