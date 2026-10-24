-- Stix accounts & picks — step 1 (database only; the app does not use this yet).
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: it only creates things that don't exist yet and replaces its own functions/policies.
--
-- What it creates:
--   games    — kickoff time per game (filled later by the pipeline). Anyone can read; only the server key can write.
--   profiles — one row per user: unit size and when they confirmed 21+. Created automatically at sign-up.
--   picks    — each user's picks. A user can only see and change their own.
--   Lock     — the database refuses adding, changing or deleting a pick once its game has kicked off.
--              The phone's clock is never used. Admin access (SQL Editor / server key) is not locked,
--              so old picks can be imported and mistakes fixed.

-- ---------- games ----------
create table if not exists public.games (
  game_id    text primary key,                       -- nflverse id, e.g. 2026_08_KC_SEA (same as data/schedule.csv)
  week       int  not null,
  kickoff    timestamptz not null,                   -- from schedule.csv kickoff_utc
  updated_at timestamptz not null default now()
);
alter table public.games enable row level security;
drop policy if exists "games readable by everyone" on public.games;
create policy "games readable by everyone" on public.games for select to anon, authenticated using (true);
-- No insert/update/delete policies: only the server (service role) can write games.

-- ---------- profiles ----------
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  unit_size        numeric(10,2) not null default 10 check (unit_size > 0 and unit_size <= 100000),
  age_confirmed_at timestamptz,                      -- set when the user ticks "I am 21 or older"
  created_at       timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "read own profile"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Create the profile automatically when someone signs up (no extra step in the app).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- picks ----------
create table if not exists public.picks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pick_key    text not null,                         -- "<week>|<player id>|<market>", same as today's app (one pick per player/market/week)
  game_id     text not null references public.games (game_id),
  week        int  not null,
  player_id   text not null,                         -- nflverse gsis id
  player_name text not null,
  pos         text,
  market      text not null,
  side        text not null check (side in ('o','u')),
  line        numeric(6,1) not null,
  odds        int,                                   -- American odds saved with the pick; null if none
  book        text,
  source      text not null default 'manual' check (source in ('manual','Bet on DK','import')),
  line_captured_at timestamptz,                      -- when that line was captured
  units       numeric(4,2) not null default 1 check (units = 1),   -- every pick is 1 unit
  picked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, pick_key)
);
create index if not exists picks_user_idx on public.picks (user_id);
create index if not exists picks_game_idx on public.picks (game_id);
alter table public.picks enable row level security;
drop policy if exists "read own picks"   on public.picks;
drop policy if exists "add own picks"    on public.picks;
drop policy if exists "change own picks" on public.picks;
drop policy if exists "delete own picks" on public.picks;
create policy "read own picks"   on public.picks for select to authenticated using (user_id = auth.uid());
create policy "add own picks"    on public.picks for insert to authenticated with check (user_id = auth.uid());
create policy "change own picks" on public.picks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own picks" on public.picks for delete to authenticated using (user_id = auth.uid());

-- ---------- lock at kickoff (enforced by the database) ----------
-- Runs as the caller (security invoker) so it can tell an app user from an admin.
create or replace function public.enforce_pick_lock() returns trigger
language plpgsql security invoker set search_path = public as $$
declare ko timestamptz;
begin
  -- Only app users are locked. Admin (SQL Editor, server key) can import or fix picks.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  -- An existing pick can't be changed or deleted after its game kicked off.
  if tg_op in ('UPDATE', 'DELETE') then
    select kickoff into ko from public.games where game_id = old.game_id;
    if ko is null or now() >= ko then
      raise exception 'This pick is locked: the game has started.' using errcode = 'P0001';
    end if;
  end if;

  -- A new or edited pick must be for a game that hasn't started.
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.picked_at <> old.picked_at) then
      raise exception 'Not allowed to change who made a pick or when.' using errcode = 'P0001';
    end if;
    select kickoff into ko from public.games where game_id = new.game_id;
    if ko is null then
      raise exception 'Unknown game.' using errcode = 'P0001';
    end if;
    if now() >= ko then
      raise exception 'Too late: the game has started.' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' then new.picked_at := now(); end if;   -- the server's time, not the phone's
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists picks_lock on public.picks;
create trigger picks_lock before insert or update or delete on public.picks
  for each row execute function public.enforce_pick_lock();
