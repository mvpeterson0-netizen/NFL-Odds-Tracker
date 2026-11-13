-- Stix admin: tweet drafts + instant plan edits + "Mark posted" (Michael, 2026-11-13). Run once in Supabase after 015.
-- Safe to re-run. Adds one table (tweet_drafts) and replaces two functions from 015 (admin_tweet_plan, admin_tweet_submit).
-- Existing tweet_plan / tweet_requests rows are never touched by this file.
--
-- What changes:
--  1. Claude's tasks save each tweet's final text and screenshots (tweet_agent_save_draft); the admin page shows them when
--     a tweet is expanded so you can copy, download, post on X, and tap Mark posted.
--  2. "Submit changes" now saves the plan immediately. A request for Claude is still queued only when the change affects a
--     tweet that is already scheduled on X (Claude then moves X to match).
--  3. admin_tweet_mark_posted: one tap sets a tweet to Posted (or back).

create table if not exists public.tweet_drafts (
  slot_key  text primary key references public.tweet_plan (slot_key) on delete cascade,
  body      text not null,
  images    jsonb not null default '[]'::jsonb,   -- [{"name": "...png", "mime": "image/png", "data": "<base64>"}], at most 4
  saved_at  timestamptz not null default now()
);
alter table public.tweet_drafts enable row level security;
revoke all on public.tweet_drafts from anon, authenticated;

-- ---------- Claude's task: save the finished draft (text + images) for a slot ----------
create or replace function public.tweet_agent_save_draft(p_token text, p_slot_key text, p_body text, p_images jsonb default '[]'::jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare img jsonb;
begin
  if not tweet_agent_ok(p_token) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tweet_plan where slot_key = p_slot_key) then raise exception 'Unknown slot' using errcode = '22023'; end if;
  if coalesce(p_body, '') = '' or length(p_body) > 4000 then raise exception 'Draft text must be 1 to 4000 characters' using errcode = '22023'; end if;
  p_images := coalesce(p_images, '[]'::jsonb);
  if jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 4 then raise exception 'Send at most 4 images' using errcode = '22023'; end if;
  for img in select * from jsonb_array_elements(p_images) loop
    if coalesce(img->>'mime', '') not in ('image/png', 'image/jpeg') then raise exception 'Images must be png or jpeg' using errcode = '22023'; end if;
    if coalesce(img->>'data', '') !~ '^[A-Za-z0-9+/=]+$' or length(img->>'data') > 3000000 then raise exception 'Image data must be base64 under about 2 MB' using errcode = '22023'; end if;
  end loop;
  insert into tweet_drafts (slot_key, body, images, saved_at) values (p_slot_key, p_body, p_images, now())
  on conflict (slot_key) do update set body = excluded.body, images = excluded.images, saved_at = now();
end $$;

-- ---------- admin page: plan + request list + which slots have drafts (text only; images load when a tweet is opened) ----------
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
    'agent_configured', (select token_hash is not null from tweet_agent)
  );
end $$;

-- ---------- admin page: images of one draft ----------
create or replace function public.admin_tweet_draft_images(p_slot_key text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((select images from tweet_drafts where slot_key = p_slot_key), '[]'::jsonb);
end $$;

-- ---------- admin page: Mark posted / undo ----------
create or replace function public.admin_tweet_mark_posted(p_slot_key text, p_posted boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tweet_plan where slot_key = p_slot_key) then raise exception 'Unknown slot' using errcode = '22023'; end if;
  update tweet_plan set
    status = case when p_posted then 'Posted'
                  when x_time is not null and x_time <> '' then 'Scheduled on X'
                  when exists (select 1 from tweet_drafts d where d.slot_key = p_slot_key) then 'Drafted (chat only)'
                  else 'Not drafted' end,
    last_result = case when p_posted then 'Marked posted in the app' else 'Posted mark removed in the app' end,
    updated_at = now()
  where slot_key = p_slot_key;
end $$;

-- ---------- admin page: Submit changes (now saves immediately) ----------
-- Same input as 015: p_changes = [{"op": "update"|"add"|"delete", "slot_key": "...", "fields": {...}}]. Same validation.
-- update: applied to tweet_plan now. add: row inserted now. delete: row removed now unless it is Posted (refused) or has a tweet on X
-- (then it stays and Claude removes it from X first). A request for Claude is queued only for changes that touch X
-- (the row has an x_time); everything else is recorded as done.
create or replace function public.admin_tweet_submit(p_changes jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  item jsonb; op text; k text; v jsonb; clean jsonb := '[]'::jsonb; xclean jsonb := '[]'::jsonb; fields jsonb; new_id bigint;
  r tweet_plan%rowtype; touches_x boolean; maxsort integer;
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
      select * into r from tweet_plan where slot_key = item->>'slot_key';
      if not found then raise exception 'Unknown slot %', coalesce(item->>'slot_key', '(none)') using errcode = '22023'; end if;
    end if;
    if op = 'delete' then
      if r.status = 'Posted' then raise exception 'A posted tweet can''t be deleted' using errcode = '22023'; end if;
      if coalesce(r.x_time, '') <> '' or r.status = 'Scheduled on X' then
        xclean := xclean || jsonb_build_array(jsonb_build_object('op','delete','slot_key', r.slot_key));   -- Claude cancels on X, then deletes
      else
        delete from tweet_plan where slot_key = r.slot_key;
        clean := clean || jsonb_build_array(jsonb_build_object('op','delete','slot_key', r.slot_key));
      end if;
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
      select coalesce(max(sort_order), 0) + 1 into maxsort from tweet_plan;
      insert into tweet_plan (slot_key, sort_order, day_label, slot, topic, direction, post_date, post_time, status)
      values (item->>'slot_key', maxsort,
              coalesce(to_char(nullif(fields->>'post_date','')::date, 'Dy MM/DD'), 'Any day'),
              left(fields->>'topic', 12), fields->>'topic', nullif(fields->>'direction',''),
              nullif(fields->>'post_date','')::date, nullif(fields->>'post_time','')::time, 'Not drafted');
      clean := clean || jsonb_build_array(jsonb_build_object('op','add','slot_key', item->>'slot_key', 'fields', fields));
    elsif fields <> '{}'::jsonb then
      touches_x := coalesce(r.x_time, '') <> '' or r.status = 'Scheduled on X';
      update tweet_plan set
        topic     = case when fields ? 'topic'     then coalesce(fields->>'topic', topic) else topic end,
        direction = case when fields ? 'direction' then nullif(fields->>'direction', '') else direction end,
        post_date = case when fields ? 'post_date' then nullif(fields->>'post_date', '')::date else post_date end,
        post_time = case when fields ? 'post_time' then nullif(fields->>'post_time', '')::time else post_time end,
        status    = case when fields ? 'status'    then fields->>'status' else status end,
        updated_at = now()
      where slot_key = r.slot_key;
      if touches_x then
        xclean := xclean || jsonb_build_array(jsonb_build_object('op','update','slot_key', r.slot_key, 'fields', fields));
      else
        clean := clean || jsonb_build_array(jsonb_build_object('op','update','slot_key', r.slot_key, 'fields', fields));
      end if;
    end if;
  end loop;
  if jsonb_array_length(clean) + jsonb_array_length(xclean) = 0 then raise exception 'No changes to send' using errcode = '22023'; end if;
  -- Changes already saved: logged as done. Changes that need Claude to move X: logged as pending.
  if jsonb_array_length(clean) > 0 then
    insert into tweet_requests (created_by, changes, status, result, processed_at)
    values (auth.uid(), clean, 'done', 'Saved in the plan.', now()) returning id into new_id;
  end if;
  if jsonb_array_length(xclean) > 0 then
    insert into tweet_requests (created_by, changes) values (auth.uid(), xclean) returning id into new_id;
  end if;
  return new_id;
end $$;

revoke all on function public.tweet_agent_save_draft(text, text, text, jsonb) from public;
revoke all on function public.admin_tweet_draft_images(text) from public, anon;
revoke all on function public.admin_tweet_mark_posted(text, boolean) from public, anon;
revoke all on function public.admin_tweet_plan() from public, anon;
revoke all on function public.admin_tweet_submit(jsonb) from public, anon;
grant execute on function public.tweet_agent_save_draft(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.admin_tweet_draft_images(text) to authenticated;
grant execute on function public.admin_tweet_mark_posted(text, boolean) to authenticated;
grant execute on function public.admin_tweet_plan() to authenticated;
grant execute on function public.admin_tweet_submit(jsonb) to authenticated;
