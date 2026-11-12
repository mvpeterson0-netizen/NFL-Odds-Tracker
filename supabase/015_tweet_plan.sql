-- Stix admin: tweet plan (Michael, 2026-11-11). Lets an admin edit the weekly @StixNFL tweet plan on the admin page and
-- press "Submit changes"; Claude's scheduled task then reads the pending request, carries it out (X scheduler, drafts)
-- and records the result. Run once in Supabase after 001-014. Safe to re-run. Touches no existing table.
--
-- Protection: all three tables are closed to the app (no direct access). The admin page uses admin_tweet_* functions that
-- refuse anyone not in public.admins (is_admin(), supabase/006_admin.sql). Claude's task uses tweet_agent_* functions that
-- refuse unless given the agent token; only a hash of it is stored, set by you in the SQL Editor (see the end of this file).

create table if not exists public.tweet_plan (
  slot_key    text primary key,            -- '<post date>_<slot>', e.g. 2026-11-12_TH1
  sort_order  integer not null,
  day_label   text,
  slot        text not null,
  topic       text not null,               -- "Tweet about" (admin edits)
  direction   text,                        -- notes / prompt direction for Claude (admin edits)
  post_date   date,                        -- when to post, Central time (admin edits)
  post_time   time,                        -- when to post, Central time (admin edits)
  status      text not null default 'Not drafted'
              check (status in ('Not drafted','Drafted (chat only)','Scheduled on X','Posted','Failed / skipped','Manual')),
  x_time      text,                        -- what X is actually set to; written only by Claude after it acts
  last_result text,                        -- Claude's latest note on this slot
  data_ready  text,
  draft_run   text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.tweet_requests (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  changes      jsonb not null,
  status       text not null default 'pending' check (status in ('pending','done','needs_attention')),
  result       text,
  processed_at timestamptz
);

-- One row at most: the hash of the token Claude's task presents.
create table if not exists public.tweet_agent (
  only_row   boolean primary key default true check (only_row),
  token_hash text
);
insert into public.tweet_agent (only_row) values (true) on conflict do nothing;

alter table public.tweet_plan enable row level security;
alter table public.tweet_requests enable row level security;
alter table public.tweet_agent enable row level security;
revoke all on public.tweet_plan, public.tweet_requests, public.tweet_agent from anon, authenticated;

-- Fields an admin may ask to change. Claude records what is really true (x_time, last_result, status) after it acts.
create or replace function public.tweet_editable_fields() returns text[] language sql immutable as $$
  select array['topic','direction','post_date','post_time','status'] $$;

-- ---------- admin page: read the plan and recent requests ----------
create or replace function public.admin_tweet_plan()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'plan', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
                      from tweet_plan p), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from (
                            select id, created_at, changes, status, result, processed_at
                            from tweet_requests order by id desc limit 25) r), '[]'::jsonb),
    'agent_configured', (select token_hash is not null from tweet_agent)
  );
end $$;

-- ---------- admin page: Submit changes ----------
-- op is 'update' (default), 'add' (new slot_key + fields) or 'delete'.
-- p_changes = [{"slot_key": "...", "fields": {"post_time": "9:00 AM", "status": "Failed / skipped", ...}}, ...]
-- Nothing in tweet_plan changes here: the request is a to-do for Claude, which updates the plan when it has acted.
create or replace function public.admin_tweet_submit(p_changes jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  item jsonb; op text; k text; v jsonb; clean jsonb := '[]'::jsonb; fields jsonb; new_id bigint;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0
     or jsonb_array_length(p_changes) > 60 then
    raise exception 'Send 1 to 60 changes' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_changes) loop
    op := coalesce(item->>'op', 'update');
    if op not in ('update','add','delete') then raise exception 'Unknown operation' using errcode = '22023'; end if;
    if op = 'add' then
      if coalesce(item->>'slot_key','') !~ '^[a-z0-9_-]{3,40}$' then raise exception 'Bad new slot id' using errcode = '22023'; end if;
      if exists (select 1 from tweet_plan where slot_key = item->>'slot_key') then raise exception 'Slot already exists' using errcode = '22023'; end if;
    else
      if not exists (select 1 from tweet_plan where slot_key = item->>'slot_key') then
        raise exception 'Unknown slot %', coalesce(item->>'slot_key', '(none)') using errcode = '22023';
      end if;
    end if;
    if op = 'delete' then
      clean := clean || jsonb_build_array(jsonb_build_object('op','delete','slot_key', item->>'slot_key'));
      continue;
    end if;
    fields := '{}'::jsonb;
    for k, v in select * from jsonb_each(coalesce(item->'fields', '{}'::jsonb)) loop
      if not (k = any (tweet_editable_fields())) then raise exception 'Field % can''t be changed here', k using errcode = '22023'; end if;
      if jsonb_typeof(v) not in ('string','null') then raise exception 'Field % must be text', k using errcode = '22023'; end if;
      if length(coalesce(v #>> '{}', '')) > 2000 then raise exception 'Field % is too long', k using errcode = '22023'; end if;
      if k = 'post_date' and coalesce(v #>> '{}', '') !~ '^(\d{4}-\d{2}-\d{2})?$' then raise exception 'Date must look like 2026-11-15' using errcode = '22023'; end if;
      if k = 'post_time' and coalesce(v #>> '{}', '') !~ '^([01]\d|2[0-3]):[0-5]\d$|^$' then raise exception 'Time must look like 17:30' using errcode = '22023'; end if;
      if k = 'status' and (v #>> '{}') not in ('Not drafted','Drafted (chat only)','Scheduled on X','Posted','Failed / skipped','Manual') then
        raise exception 'Unknown status' using errcode = '22023';
      end if;
      fields := fields || jsonb_build_object(k, v);
    end loop;
    if op = 'add' then
      if coalesce(fields->>'topic','') = '' then raise exception 'A new tweet needs a "Tweet about"' using errcode = '22023'; end if;
      clean := clean || jsonb_build_array(jsonb_build_object('op','add','slot_key', item->>'slot_key', 'fields', fields));
    elsif fields <> '{}'::jsonb then
      clean := clean || jsonb_build_array(jsonb_build_object('op','update','slot_key', item->>'slot_key', 'fields', fields));
    end if;
  end loop;
  if jsonb_array_length(clean) = 0 then raise exception 'No changes to send' using errcode = '22023'; end if;
  insert into tweet_requests (created_by, changes) values (auth.uid(), clean) returning id into new_id;
  return new_id;
end $$;

-- ---------- Claude's task (token instead of a sign-in) ----------
create or replace function public.tweet_agent_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_token is not null and length(p_token) >= 24
     and exists (select 1 from tweet_agent where token_hash is not null
                 and token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')) $$;

create or replace function public.tweet_agent_pending(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (
                  select id, created_at, changes from tweet_requests where status = 'pending' order by id limit 20) r), '[]'::jsonb),
    'plan', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order) from tweet_plan p), '[]'::jsonb));
end $$;

-- Claude records what is true after acting: any editable field plus x_time. p_fields keys outside that list are refused.
create or replace function public.tweet_agent_update_plan(p_token text, p_slot_key text, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb;
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tweet_plan where slot_key = p_slot_key) then raise exception 'Unknown slot' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
    if not (k = any (tweet_editable_fields() || array['x_time','last_result','data_ready','draft_run'])) then
      raise exception 'Field % can''t be changed', k using errcode = '22023'; end if;
    if jsonb_typeof(v) not in ('string','null') then raise exception 'Field % must be text', k using errcode = '22023'; end if;
  end loop;
  update tweet_plan set
    topic       = case when p_fields ? 'topic'       then coalesce(p_fields->>'topic', topic) else topic end,
    direction   = case when p_fields ? 'direction'   then nullif(p_fields->>'direction', '') else direction end,
    post_date   = case when p_fields ? 'post_date'   then nullif(p_fields->>'post_date', '')::date else post_date end,
    post_time   = case when p_fields ? 'post_time'   then nullif(p_fields->>'post_time', '')::time else post_time end,
    status      = case when p_fields ? 'status'      then p_fields->>'status' else status end,
    x_time      = case when p_fields ? 'x_time'      then p_fields->>'x_time' else x_time end,
    last_result = case when p_fields ? 'last_result' then p_fields->>'last_result' else last_result end,
    data_ready  = case when p_fields ? 'data_ready'  then p_fields->>'data_ready' else data_ready end,
    draft_run   = case when p_fields ? 'draft_run'   then p_fields->>'draft_run' else draft_run end,
    updated_at  = now()
  where slot_key = p_slot_key;
end $$;

-- Claude adds a row for a slot that has no row yet (e.g. next week). An existing row is never replaced by this.
create or replace function public.tweet_agent_add_row(p_token text, p_row jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into tweet_plan (slot_key, sort_order, day_label, slot, topic, direction, post_date, post_time, status, data_ready, draft_run)
  values (p_row->>'slot_key', coalesce((p_row->>'sort_order')::int, 1000), p_row->>'day_label', p_row->>'slot', p_row->>'topic',
          nullif(p_row->>'direction',''), nullif(p_row->>'post_date','')::date, nullif(p_row->>'post_time','')::time,
          coalesce(p_row->>'status','Not drafted'), p_row->>'data_ready', p_row->>'draft_run')
  on conflict (slot_key) do nothing;
end $$;

-- Claude removes a plan row after it has cancelled any tweet scheduled for it on X.
create or replace function public.tweet_agent_delete_row(p_token text, p_slot_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  delete from tweet_plan where slot_key = p_slot_key;
end $$;

create or replace function public.tweet_agent_finish(p_token text, p_id bigint, p_status text, p_result text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_status not in ('done','needs_attention') then raise exception 'Status must be done or needs_attention' using errcode = '22023'; end if;
  update tweet_requests set status = p_status, result = left(p_result, 4000), processed_at = now()
  where id = p_id and status = 'pending';
end $$;

revoke all on function public.tweet_editable_fields() from public, anon, authenticated;
revoke all on function public.tweet_agent_ok(text) from public, anon, authenticated;
revoke all on function public.admin_tweet_plan() from public, anon;
revoke all on function public.admin_tweet_submit(jsonb) from public, anon;
revoke all on function public.tweet_agent_pending(text) from public;
revoke all on function public.tweet_agent_update_plan(text, text, jsonb) from public;
revoke all on function public.tweet_agent_finish(text, bigint, text, text) from public;
revoke all on function public.tweet_agent_add_row(text, jsonb) from public;
revoke all on function public.tweet_agent_delete_row(text, text) from public;
grant execute on function public.admin_tweet_plan() to authenticated;
grant execute on function public.admin_tweet_submit(jsonb) to authenticated;
grant execute on function public.tweet_agent_pending(text) to anon, authenticated;
grant execute on function public.tweet_agent_update_plan(text, text, jsonb) to anon, authenticated;
grant execute on function public.tweet_agent_finish(text, bigint, text, text) to anon, authenticated;
grant execute on function public.tweet_agent_add_row(text, jsonb) to anon, authenticated;
grant execute on function public.tweet_agent_delete_row(text, text) to anon, authenticated;

-- ---------- starting plan (Nov 11-17, 2026); existing rows are left alone ----------
insert into public.tweet_plan (slot_key, sort_order, day_label, slot, topic, direction, post_date, post_time, status, x_time, last_result, data_ready, draft_run) values
  ('2026-11-11_W1', 1, 'Wed 11/11', 'W1', 'Season-to-date signals (Weeks 1-9)', null, '2026-11-11', '08:00', 'Scheduled on X', 'Wed 8:00 AM', 'Scheduled earlier today; confirm in X scheduled list', 'Wk 9 final; nflverse ~4:30 AM', 'Wed 6:26 AM'),
  ('2026-11-11_T1', 2, 'Wed 11/11', 'T1', 'Top Stix leads, Week 9 (all 15 final)', null, '2026-11-11', '09:30', 'Scheduled on X', 'Wed 9:30 AM', 'Rescheduled from Tue 9:00 AM; confirm in X list', 'Wk 9 final; nflverse ~4:30 AM', 'Tue 7:04 AM'),
  ('2026-11-11_T2', 3, 'Wed 11/11', 'T2', 'Interaction model, Week 9', null, '2026-11-11', '11:00', 'Scheduled on X', 'Wed 11:00 AM', 'Rescheduled from Tue 10:30 AM; confirm in X list', 'Wk 9 final; nflverse ~4:30 AM', 'Tue 7:04 AM'),
  ('2026-11-11_W2', 4, 'Wed 11/11', 'W2', 'Feature: player card (Malik Nabers, WAS @ NYG)', null, '2026-11-11', '17:00', 'Drafted (chat only)', null, '268-char draft was over X''s limit; shorten to 260 weighted or fewer, then schedule', 'Thu game has a posted line', 'Wed 12:34 PM'),
  ('2026-11-12_TH1', 5, 'Thu 11/12', 'TH1', 'TNF multi-lead stack (WAS @ NYG, 7:15 PM)', null, '2026-11-12', '17:30', 'Not drafted', null, null, 'TNF decisions lock ~4:15-4:45 PM', 'Thu 4:52 PM'),
  ('2026-11-12_TH2', 6, 'Thu 11/12', 'TH2', 'TNF interaction model top bet', null, '2026-11-12', '18:00', 'Not drafted', null, 'Must post before 7:15 PM kickoff', 'TNF decisions lock ~4:15-4:45 PM', 'Thu 4:52 PM'),
  ('2026-11-13_F1', 7, 'Fri 11/13', 'F1', 'Results of Thursday-night picks', null, '2026-11-13', '08:00', 'Not drafted', null, null, 'TNF final (~10:30 PM Thu) + 2 h', 'Fri 6:26 AM'),
  ('2026-11-13_F2', 8, 'Fri 11/13', 'F2', 'Feature: Research tab', null, '2026-11-13', '17:00', 'Not drafted', null, null, 'None needed', 'Fri 12:36 PM'),
  ('2026-11-14_S1', 9, 'Sat 11/14', 'S1', 'Biggest line movers this week', null, '2026-11-14', '10:30', 'Not drafted', null, null, 'Sat 8 AM line check committed ~8:10-8:45 AM', 'Sat 9:17 AM'),
  ('2026-11-14_S2', 10, 'Sat 11/14', 'S2', 'Feature: send picks to FanDuel bet slip', null, '2026-11-14', '17:00', 'Not drafted', null, null, 'None needed', 'Sat 12:38 PM'),
  ('2026-11-15_SU0', 11, 'Sun 11/15', 'SU0', 'Early international game picks (NE @ DET, 8:30 AM)', null, '2026-11-15', '07:30', 'Not drafted', null, 'Must post before 8:30 AM kickoff', 'Game locks ~5:30 AM', 'Sun 6:04 AM'),
  ('2026-11-15_SU1a', 12, 'Sun 11/15', 'SU1-a', 'Top season lead #1, top 2 players', null, '2026-11-15', '09:15', 'Not drafted', null, 'Inactives not re-checked after drafting', 'Sun 8 AM line check lands ~8:15-8:45 AM', 'Sun 8:49 AM'),
  ('2026-11-15_SU1b', 13, 'Sun 11/15', 'SU1-b', 'Top season lead #2, top 2 players', null, '2026-11-15', '10:00', 'Not drafted', null, 'Inactives not re-checked after drafting', 'Sun 8 AM line check lands ~8:15-8:45 AM', 'Sun 8:49 AM'),
  ('2026-11-15_SU1c', 14, 'Sun 11/15', 'SU1-c', 'Top season lead #3, top 2 players', null, '2026-11-15', '10:45', 'Not drafted', null, 'Inactives not re-checked after drafting', 'Sun 8 AM line check lands ~8:15-8:45 AM', 'Sun 8:49 AM'),
  ('2026-11-15_SU1d', 15, 'Sun 11/15', 'SU1-d', 'Top season lead #4, top 2 players', null, '2026-11-15', '11:30', 'Not drafted', null, 'Inactives not re-checked after drafting', 'Sun 8 AM line check lands ~8:15-8:45 AM', 'Sun 8:49 AM'),
  ('2026-11-15_SU2', 16, 'Sun 11/15', 'SU2', 'Interaction-model picks, noon-window games', null, '2026-11-15', '11:45', 'Not drafted', null, 'Late-window games (3:05/3:25 PM) not covered', 'Noon games lock ~9:00-9:45 AM', 'Sun 9:52 AM'),
  ('2026-11-15_SU3', 17, 'Sun 11/15', 'SU3', 'SNF interaction-model picks', null, '2026-11-15', '17:30', 'Not drafted', null, 'Must post before kickoff', 'SNF locks ~4:20 PM (7:20 PM kick)', 'Sun 4:49 PM'),
  ('2026-11-16_M1', 18, 'Mon 11/16', 'M1', 'Sunday results + qualifying bets for MNF', null, '2026-11-16', '08:00', 'Not drafted', null, null, 'All non-Monday games final + box scores ~12:30 AM', 'Mon 6:27 AM'),
  ('2026-11-16_M2', 19, 'Mon 11/16', 'M2', 'MNF interaction-model picks', null, '2026-11-16', '18:00', 'Not drafted', null, 'Must post before kickoff', 'MNF decisions lock ~4:15-4:45 PM', 'Mon 5:03 PM'),
  ('2026-11-16_M3', 20, 'Mon 11/16', 'M3', 'Recap of the M2 picks', null, '2026-11-16', '23:10', 'Not drafted', null, null, 'MNF final + each pick graded in app', 'Mon 11:03 PM'),
  ('2026-11-17_T1', 21, 'Tue 11/17', 'T1', 'Top leads, Week 10 final', null, '2026-11-17', '09:00', 'Not drafted', null, null, 'All Wk 10 games final + nflverse ~4:30 AM', 'Tue 7:04 AM'),
  ('2026-11-17_T2', 22, 'Tue 11/17', 'T2', 'Interaction model, Week 10', null, '2026-11-17', '10:30', 'Not drafted', null, null, 'All Wk 10 games final + nflverse ~4:30 AM', 'Tue 7:04 AM'),
  ('ARB', 23, 'Any day', 'ARB', 'Stix Arb: guaranteed arbitrage of $3+ per $100', null, null, null, 'Manual', null, 'Tell Claude when the alert arrives', 'When an arb appears (ntfy alert)', 'Manual')
on conflict (slot_key) do nothing;

-- ---------- ONE-TIME SETUP BY MICHAEL (not run automatically) ----------
-- Pick a long random token (24+ characters), type it ONLY here and into the Claude scheduled task's secret setting, never
-- into chat or the repo. Then run in the SQL Editor, replacing the text between the quotes:
--   update public.tweet_agent set token_hash = encode(sha256(convert_to('PASTE-YOUR-TOKEN-HERE', 'utf8')), 'hex');
-- To turn the agent off: update public.tweet_agent set token_hash = null;
