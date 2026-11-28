-- Stix CFB — bet-slip links (database only; nothing in the app reads this yet).
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: it only creates things that don't exist yet and replaces its own policy.
--
-- Why this exists: the NFL side opens FanDuel / DraftKings with a bet already on the slip, using links The Odds API returns
-- with each pull. The CFB pull did not ask for them, so there was nothing to open. This table keeps the latest FanDuel and
-- DraftKings link for each player line of a CFB game. The pipeline overwrites a row when a newer pull has a newer link
-- (links only work for the line the book showed at that moment, and only before kickoff).
--
-- What it touches: ONE new table, cfb_links. cfb_lines, cfb_picks and every other table (CFB and NFL) are not changed.
-- Same privacy as the other CFB tables: only signed-in users who confirmed 21+ can read; only the server key writes.

create table if not exists public.cfb_links (
  game_id      text not null references public.cfb_games (game_id),
  book         text not null check (book in ('fanduel','draftkings')),
  market       text not null check (market in ('player_pass_yds','player_rush_yds','player_reception_yds')),
  player_name  text not null,                         -- as the book wrote it
  side         text not null check (side in ('over','under')),
  line         numeric(6,1) not null,
  price        int,
  link         text not null,                         -- the book's own slip link for this exact line and side
  captured_utc timestamptz not null,                  -- when the pull that returned this link was made
  primary key (game_id, book, market, player_name, side)
);
create index if not exists cfb_links_game_idx on public.cfb_links (game_id);

alter table public.cfb_links enable row level security;
drop policy if exists "cfb read for 21+" on public.cfb_links;
create policy "cfb read for 21+" on public.cfb_links for select to authenticated using (public.cfb_ok());
revoke all on public.cfb_links from anon;
revoke insert, update, delete, truncate on public.cfb_links from authenticated;
grant select on public.cfb_links to authenticated;
