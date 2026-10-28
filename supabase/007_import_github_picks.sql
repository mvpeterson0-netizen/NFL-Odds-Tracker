-- Import Michael's earlier picks (GitHub picks.json in mvpeterson0-netizen/stix-picks) into his Stix account.
-- 23 active picks (8 entries removed in the old file are left out). Runs as admin in the SQL Editor, so the
-- kickoff lock doesn't block picks for games that already started. Each pick keeps its line, odds, book, label and
-- original pick time; source = 'import'. A pick already in the account with the same week|player|stat is kept as is.
-- Run once in Supabase (Michael's Yes on this exact script). Safe to re-run (re-running adds nothing).

with me as (select id from auth.users where lower(email) = 'mvpeterson0@gmail.com'),
src (pick_key, game_id, week, player_id, player_name, pos, market, side, line, odds, book, line_label, line_captured_at, picked_at, updated_at) as (values
  ('7|00-0038621|rec', '2026_07_NE_CHI', 7, '00-0038621', 'DeMario Douglas', 'WR', 'rec', 'o', 3.5, 103, 'DraftKings', 'Pre-game', '2026-10-22T20:53:16Z', '2026-10-22T21:37:51.317Z', '2026-10-22T21:37:51.317Z'),
  ('7|00-0039021|rush_att', '2026_07_NE_CHI', 7, '00-0039021', 'Roschon Johnson', 'RB', 'rush_att', 'o', 7.5, 110, 'DraftKings', 'Pre-game', '2026-10-22T20:53:16Z', '2026-10-22T21:37:21.750Z', '2026-10-22T21:37:21.750Z'),
  ('7|00-0040126|rec_yds', '2026_07_NE_CHI', 7, '00-0040126', 'Colston Loveland', 'TE', 'rec_yds', 'o', 44.5, -115, 'DraftKings', 'Pre-game', '2026-10-22T20:53:16Z', '2026-10-22T21:37:28.727Z', '2026-10-22T21:37:28.727Z'),
  ('7|00-0040734|rec', '2026_07_NE_CHI', 7, '00-0040734', 'TreVeyon Henderson', 'RB', 'rec', 'u', 0.5, 160, 'DraftKings', 'Pre-game', '2026-10-22T20:53:16Z', '2026-10-22T21:37:43.891Z', '2026-10-22T21:37:43.891Z'),
  ('7|00-0035644|rec', '2026_07_PIT_NO', 7, '00-0035644', 'Noah Fant', 'TE', 'rec', 'u', 1.5, -111, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T15:19:10.566Z', '2026-10-23T15:19:10.566Z'),
  ('7|00-0037228|rush_att', '2026_07_PIT_NO', 7, '00-0037228', 'Jaylen Warren', 'RB', 'rush_att', 'o', 13.5, -121, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-24T11:21:54.677Z', '2026-10-24T11:21:54.677Z'),
  ('7|00-0037228|rush_yds', '2026_07_PIT_NO', 7, '00-0037228', 'Jaylen Warren', 'RB', 'rush_yds', 'o', 63.5, -113, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T14:57:09.252Z', '2026-10-23T14:57:09.252Z'),
  ('7|00-0040743|pass_yds', '2026_07_PIT_NO', 7, '00-0040743', 'Tyler Shough', 'QB', 'pass_yds', 'u', 229.5, -113, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T17:07:26.625Z', '2026-10-23T17:07:26.625Z'),
  ('7|00-0036970|rec', '2026_07_SF_ATL', 7, '00-0036970', 'Kyle Pitts Sr.', 'TE', 'rec', 'o', 3.5, -103, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T15:13:20.735Z', '2026-10-23T15:13:20.735Z'),
  ('7|00-0036970|rec_yds', '2026_07_SF_ATL', 7, '00-0036970', 'Kyle Pitts Sr.', 'TE', 'rec_yds', 'o', 34.5, -113, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T15:13:25.274Z', '2026-10-23T15:13:25.274Z'),
  ('7|00-0039337|rec', '2026_07_NYG_HOU', 7, '00-0039337', 'Malik Nabers', 'WR', 'rec', 'o', 5.5, -123, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T12:12:14.935Z', '2026-10-23T12:12:14.935Z'),
  ('7|00-0039337|rec_yds', '2026_07_NYG_HOU', 7, '00-0039337', 'Malik Nabers', 'WR', 'rec_yds', 'o', 68.5, -113, 'DraftKings', 'Pre-game', '2026-10-25T13:30:15Z', '2026-10-25T16:39:59.960Z', '2026-10-25T16:39:59.960Z'),
  ('7|00-0039880|rec', '2026_07_MIA_NYJ', 7, '00-0039880', 'Malik Washington', 'WR', 'rec', 'o', 3.5, -164, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T15:10:28.414Z', '2026-10-23T15:10:28.414Z'),
  ('7|00-0039917|rush_yds', '2026_07_SF_ATL', 7, '00-0039917', 'Michael Penix Jr.', 'QB', 'rush_yds', 'u', 1.5, -112, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T15:12:44.413Z', '2026-10-23T15:12:44.413Z'),
  ('7|00-0040198|rush_yds', '2026_07_MIA_NYJ', 7, '00-0040198', 'Ollie Gordon II', 'RB', 'rush_yds', 'o', 48.5, -109, 'DraftKings', 'Thu', '2026-10-22T19:00:16Z', '2026-10-23T14:59:38.204Z', '2026-10-23T14:59:38.204Z'),
  ('7|00-0026498|pass_yds', '2026_07_LA_LV', 7, '00-0026498', 'Matthew Stafford', 'QB', 'pass_yds', 'o', 264.5, -113, 'DraftKings', 'Sun AM', '2026-10-25T13:00:19Z', '2026-10-25T16:42:23.189Z', '2026-10-25T16:42:23.189Z'),
  ('7|00-0037840|rec', '2026_07_LA_LV', 7, '00-0037840', 'Kyren Williams', 'RB', 'rec', 'o', 3.5, -128, 'DraftKings', 'Thu', '2026-10-22T19:00:17Z', '2026-10-23T14:58:29.146Z', '2026-10-23T14:58:29.146Z'),
  ('7|00-0034844|rush_att', '2026_07_DAL_PHI', 7, '00-0034844', 'Saquon Barkley', 'RB', 'rush_att', 'u', 15.5, -123, 'DraftKings', 'Pre-game', '2026-10-26T21:00:22Z', '2026-10-26T23:10:58.959Z', '2026-10-26T23:10:58.959Z'),
  ('8|00-0036555|rush_att', '2026_08_CAR_GB', 8, '00-0036555', 'Chuba Hubbard', 'RB', 'rush_att', 'o', 15.5, -113, 'DraftKings', 'Mon', '2026-10-26T13:00:19Z', '2026-10-27T00:41:20.839Z', '2026-10-27T00:41:20.839Z'),
  ('8|00-0039150|pass_yds', '2026_08_CAR_GB', 8, '00-0039150', 'Bryce Young', 'QB', 'pass_yds', 'o', 250.5, -114, 'FanDuel', 'Bet on FD', '2026-10-26T13:00:19Z', '2026-10-27T23:22:57.749Z', '2026-10-27T23:22:57.749Z'),
  ('8|00-0040009|rec_yds', '2026_08_CAR_GB', 8, '00-0040009', 'Savion Williams', 'WR', 'rec_yds', 'o', 20.5, -112, 'DraftKings', 'Mon', '2026-10-26T13:00:19Z', '2026-10-26T20:29:33.294Z', '2026-10-26T20:29:33.294Z'),
  ('8|00-0040124|rec', '2026_08_CAR_GB', 8, '00-0040124', 'Tetairoa McMillan', 'WR', 'rec', 'o', 5.5, 116, 'DraftKings', 'Mon', '2026-10-26T13:00:19Z', '2026-10-27T21:05:09.519Z', '2026-10-27T21:05:09.519Z'),
  ('8|00-0040667|rec_yds', '2026_08_CAR_GB', 8, '00-0040667', 'Matthew Golden', 'WR', 'rec_yds', 'o', 64.5, -112, 'DraftKings', 'Mon', '2026-10-26T13:00:19Z', '2026-10-27T00:33:39.457Z', '2026-10-27T00:33:39.457Z')
),
ins as (
  insert into public.picks (user_id, pick_key, game_id, week, player_id, player_name, pos, market, side, line, odds, book,
                            source, line_label, line_captured_at, picked_at, updated_at)
  select me.id, s.pick_key, s.game_id, s.week, s.player_id, s.player_name, s.pos, s.market, s.side, s.line, s.odds, s.book,
         'import', s.line_label, s.line_captured_at::timestamptz, s.picked_at::timestamptz, s.updated_at::timestamptz
  from src s cross join me
  on conflict (user_id, pick_key) do nothing
  returning 1
)
select (select count(*) from ins) as imported_now,
       (select count(*) from public.picks where user_id = (select id from me)) + (select count(*) from ins) as picks_in_account_now;
