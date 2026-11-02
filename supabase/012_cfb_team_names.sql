-- Stix CFB — step 2: short school names and abbreviations on cfb_games (so the app can show "Baylor" / "BAY"
-- instead of "Baylor Bears"). Adds four empty columns; nothing is deleted or changed. Safe to re-run.
alter table public.cfb_games add column if not exists home_short text;   -- school name without the mascot, e.g. 'Baylor'
alter table public.cfb_games add column if not exists away_short text;
alter table public.cfb_games add column if not exists home_abbr  text;   -- ESPN abbreviation, e.g. 'BAY'
alter table public.cfb_games add column if not exists away_abbr  text;
