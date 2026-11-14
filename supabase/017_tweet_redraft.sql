-- Stix admin: "Redraft with Claude" button on the Tweet plan tab (Michael, 2026-11-14). Run once in Supabase after 016.
-- Safe to re-run. Adds two tables (tweet_redraft_config, tweet_redraft_log), three functions, and replaces admin_tweet_plan
-- from 016 (same output plus one extra key, 'redraft_configured'). Existing tweet_plan / tweet_requests / tweet_drafts rows
-- are never touched by this file.
--
-- What it does: an admin taps "Redraft with Claude" on a tweet. The database (not the browser) then sends an authenticated
-- POST to Claude's "routine fire" URL, which starts a cloud Claude session that reads the tweet's row (topic, direction)
-- plus an optional note, remakes the screenshots and saves a new draft with tweet_agent_save_draft.
--
-- Secrets: the fire URL and its token live only in tweet_redraft_config, a table closed to the app (no access for anon or
-- signed-in users, RLS on). They never go to the browser, the repo or chat. You set them once in the SQL Editor (see the end).
-- Needs the pg_net extension (Supabase: Database > Extensions > pg_net; the script also tries to enable it).

create extension if not exists pg_net with schema extensions;

create table if not exists public.tweet_redraft_config (
  only_row  boolean primary key default true check (only_row),
  fire_url  text,      -- https://api.anthropic.com/v1/claude_code/routines/<id>/fire (from the routine's API trigger)
  token     text       -- the routine's bearer token (sk-ant-oat01-...); shown once when generated
);
insert into public.tweet_redraft_config (only_row) values (true) on conflict do nothing;

create table if not exists public.tweet_redraft_log (
  id            bigint generated always as identity primary key,
  slot_key      text not null,
  requested_at  timestamptz not null default now(),
  requested_by  uuid,
  note          text,
  net_request   bigint        -- pg_net request id (its answer is in net._http_response)
);
alter table public.tweet_redraft_config enable row level security;
alter table public.tweet_redraft_log enable row level security;
revoke all on public.tweet_redraft_config, public.tweet_redraft_log from anon, authenticated;

-- ---------- admin page: ask Claude to redraft one tweet ----------
-- Refuses: non-admins, unknown slots, Posted tweets, a second request for the same slot within 3 minutes, notes over 1500 chars,
-- and the case where the fire URL / token are not set yet. Returns the log id (use it with admin_tweet_redraft_status).
create or replace function public.admin_tweet_redraft(p_slot_key text, p_note text default '')
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare cfg tweet_redraft_config%rowtype; r tweet_plan%rowtype; txt text; req bigint; new_id bigint;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into cfg from tweet_redraft_config where only_row;
  if cfg.fire_url is null or cfg.token is null or cfg.fire_url !~ '^https://api\.anthropic\.com/v1/claude_code/routines/[A-Za-z0-9_]+/fire$' then
    raise exception 'Redraft is not connected yet (see the end of supabase/017_tweet_redraft.sql)' using errcode = '22023';
  end if;
  select * into r from tweet_plan where slot_key = p_slot_key;
  if not found then raise exception 'Unknown slot' using errcode = '22023'; end if;
  if r.status = 'Posted' then raise exception 'That tweet is already posted' using errcode = '22023'; end if;
  p_note := coalesce(btrim(p_note), '');
  if length(p_note) > 1500 then raise exception 'Note must be 1500 characters or fewer' using errcode = '22023'; end if;
  if exists (select 1 from tweet_redraft_log where slot_key = p_slot_key and requested_at > now() - interval '3 minutes') then
    raise exception 'Already requested a minute ago; give Claude a few minutes' using errcode = '22023';
  end if;
  txt := 'REDRAFT REQUEST from the Stix admin page (Tweet plan tab). slot_key: ' || p_slot_key
      || E'\nPlanned post: ' || coalesce(r.post_date::text, 'no date') || ' ' || coalesce(r.post_time::text, '')
      || E'\nNote from Michael for this redraft (may be empty): ' || case when p_note = '' then '(none)' else p_note end;
  select net.http_post(
           url := cfg.fire_url,
           body := jsonb_build_object('text', txt),
           headers := jsonb_build_object('Authorization', 'Bearer ' || cfg.token,
                                         'anthropic-version', '2023-06-01',
                                         'Content-Type', 'application/json'),
           timeout_milliseconds := 10000) into req;
  insert into tweet_redraft_log (slot_key, requested_by, note, net_request) values (p_slot_key, auth.uid(), nullif(p_note, ''), req)
    returning id into new_id;
  update tweet_plan set last_result = 'Redraft requested from the app; Claude is working on it', updated_at = now()
    where slot_key = p_slot_key;
  return new_id;
end $$;

-- ---------- admin page: did the request reach Claude? ----------
-- Returns {requested_at, http_status, error}; http_status is null until the answer arrives (a few seconds). 2xx = Claude started.
create or replace function public.admin_tweet_redraft_status(p_log_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare l tweet_redraft_log%rowtype; resp record;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into l from tweet_redraft_log where id = p_log_id;
  if not found then raise exception 'Unknown request' using errcode = '22023'; end if;
  select status_code, error_msg into resp from net._http_response where id = l.net_request;
  return jsonb_build_object('requested_at', l.requested_at, 'http_status', resp.status_code, 'error', resp.error_msg);
end $$;

-- ---------- Claude's task: read the current saved draft of a slot (so a redraft can edit it) ----------
create or replace function public.tweet_agent_get_draft(p_token text, p_slot_key text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_build_object('body', d.body, 'images', d.images, 'saved_at', d.saved_at)
                   from tweet_drafts d where d.slot_key = p_slot_key), 'null'::jsonb);
end $$;

-- ---------- admin page: plan + requests + drafts (same as 016, plus whether the redraft button is connected) ----------
create or replace function public.admin_tweet_plan()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'plan', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order) from tweet_plan p), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from (
                            select id, created_at, changes, status, result, processed_at
                            from tweet_requests order by id desc limit 25) r), '[]'::jsonb),
    'drafts', coalesce((select jsonb_object_agg(d.slot_key, jsonb_build_object('body', d.body, 'saved_at', d.saved_at,
                          'image_count', jsonb_array_length(d.images))) from tweet_drafts d), '{}'::jsonb),
    'agent_configured', (select token_hash is not null from tweet_agent),
    'redraft_configured', coalesce((select fire_url is not null and token is not null from tweet_redraft_config where only_row), false)
  );
end $$;

revoke all on function public.admin_tweet_redraft(text, text) from public, anon;
revoke all on function public.admin_tweet_redraft_status(bigint) from public, anon;
revoke all on function public.tweet_agent_get_draft(text, text) from public;
revoke all on function public.admin_tweet_plan() from public, anon;
grant execute on function public.admin_tweet_redraft(text, text) to authenticated;
grant execute on function public.admin_tweet_redraft_status(bigint) to authenticated;
grant execute on function public.tweet_agent_get_draft(text, text) to anon, authenticated;
grant execute on function public.admin_tweet_plan() to authenticated;

-- ---------- ONE-TIME SETUP (you, after this file has run) ----------
-- 1. On claude.ai/code/routines open the "Stix tweet redraft (on demand)" task > Edit > Add another trigger > API > Generate token.
--    Copy the URL and the token (the token is shown once).
-- 2. Run this in the SQL Editor with your real values (never paste them into chat):
--      update public.tweet_redraft_config set fire_url = 'PASTE-THE-FIRE-URL', token = 'PASTE-THE-TOKEN' where only_row;
-- 3. To switch the button off: update public.tweet_redraft_config set fire_url = null, token = null where only_row;
--    To rotate: generate a new token in the routine (the old one stops working) and run step 2 again.
