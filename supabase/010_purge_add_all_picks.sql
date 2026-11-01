-- ONE-TIME CLEANUP (Michael's request, 2026-11-01): remove the picks that "Add all to FanDuel slip" saved to Michael's account
-- while he was only trying the slip button. Run by Michael himself in the Supabase SQL Editor, one step at a time.
-- Nothing here changes any table's structure. Other users' picks are untouched (every statement is limited to Michael's user id).
-- Note: source 'Bet on FD' is also used by the single "Bet on FanDuel" Over/Under buttons on player pages, so step 1 lists
-- exactly which picks will go before anything is deleted.

-- STEP 1 · Preview (read-only). Click Export > CSV on the result first, as a backup.
select pick_key, player_name, market, side, line, odds, book, game_id, picked_at, updated_at
from public.picks
where user_id = (select id from auth.users where lower(email) = 'mvpeterson0@gmail.com') and source = 'Bet on FD'
order by picked_at;

-- STEP 2 · Delete those picks. Expect the same number of rows as step 1 returned.
delete from public.picks
where user_id = (select id from auth.users where lower(email) = 'mvpeterson0@gmail.com') and source = 'Bet on FD'
returning pick_key;

-- STEP 3 · Put back any earlier import that an Add-all tap had overwritten: run supabase/007_import_github_picks.sql again.
-- It only adds picks that are missing (safe to re-run) and keeps the original line, odds and pick time.
