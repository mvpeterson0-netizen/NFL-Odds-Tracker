-- Stix usage tracking (Michael, 2026-10-27): which screens people open, for how long, and which buttons they tap,
-- recorded for everyone with a random per-browser device id and linked to the account once that browser signs in.
-- Raw events are kept 6 months. Nothing here is readable from the app: no one can select from these tables with the
-- public or signed-in keys; writes go only through the two functions below, which check and cap what they accept.
-- Run once in Supabase after 001–004. Safe to re-run.

-- ---------- tables ----------
create table if not exists public.devices (
  device_id   uuid primary key,                                          -- random id made by the browser (localStorage)
  user_id     uuid references auth.users (id) on delete set null,        -- set when this browser signs in
  platform    text check (platform is null or platform ~ '^[a-z_]{1,20}$'),  -- iphone / android / desktop / other
  standalone  boolean,                                                   -- opened as a home-screen app
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  linked_at   timestamptz
);
create index if not exists devices_user_idx on public.devices (user_id);

create table if not exists public.events (
  id         bigserial primary key,
  device_id  uuid not null references public.devices (device_id) on delete cascade,
  user_id    uuid references auth.users (id) on delete cascade,          -- deleting an account deletes its usage
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('view', 'tap')),
  name       text not null check (name ~ '^[a-z_]{2,24}$'),                -- screen (board, player, ...) or tap (pick, bet_fd, ...)
  detail     text check (detail is null or detail ~ '^[A-Za-z0-9 ._:|/=+-]{0,60}$'),  -- e.g. player id; never typed text
  secs       integer check (secs is null or (secs >= 0 and secs <= 86400))  -- seconds on screen (views)
);
create index if not exists events_at_idx on public.events (at);
create index if not exists events_user_idx on public.events (user_id, at);
create index if not exists events_device_idx on public.events (device_id, at);

alter table public.devices enable row level security;
alter table public.events  enable row level security;
-- No policies: the app's keys can't read or write these tables directly.
revoke all on public.devices from anon, authenticated;
revoke all on public.events  from anon, authenticated;
revoke all on sequence public.events_id_seq from anon, authenticated;

-- ---------- log_events: the only way the app records usage ----------
-- p_events: JSON array (max 50) of {k: 'view'|'tap', n: name, d: detail, s: seconds, ago: seconds since it happened}.
-- Signed-in callers' events go to their account; otherwise to the account this device is linked to, if any.
-- Caps: 50 events per call, 3000 per device per day. Bad items are skipped, not errors.
create or replace function public.log_events(p_device uuid, p_events jsonb, p_platform text default null, p_standalone boolean default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  linked uuid;
  today_count integer;
  e jsonb;
  n integer := 0;
begin
  if p_device is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then return 0; end if;
  if jsonb_array_length(p_events) > 50 then raise exception 'Too many events' using errcode = 'P0001'; end if;

  insert into devices (device_id, platform, standalone)
  values (p_device, case when p_platform ~ '^[a-z_]{1,20}$' then p_platform end, p_standalone)
  on conflict (device_id) do update set last_seen = now(),
    platform = coalesce(excluded.platform, devices.platform), standalone = coalesce(excluded.standalone, devices.standalone);
  select user_id into linked from devices where device_id = p_device;

  select count(*) into today_count from events where device_id = p_device and at > now() - interval '1 day';
  if today_count >= 3000 then return 0; end if;

  for e in select * from jsonb_array_elements(p_events) loop
    begin
      if (e->>'k') in ('view', 'tap') and coalesce(e->>'n', '') ~ '^[a-z_]{2,24}$'
         and (e->>'d' is null or (e->>'d') ~ '^[A-Za-z0-9 ._:|/=+-]{0,60}$') then
        insert into events (device_id, user_id, at, kind, name, detail, secs)
        values (p_device, coalesce(uid, linked),
                now() - make_interval(secs => least(greatest(coalesce((e->>'ago')::numeric, 0), 0), 86400)),
                e->>'k', e->>'n', nullif(e->>'d', ''),
                case when e ? 's' then least(greatest(round((e->>'s')::numeric)::int, 0), 86400) end);
        n := n + 1;
      end if;
    exception when others then null;  -- skip a malformed item
    end;
    exit when today_count + n >= 3000;
  end loop;

  -- 6-month retention (cheap: uses the index on "at"; usually deletes nothing)
  delete from events where at < now() - interval '6 months';
  delete from devices d where d.user_id is null and d.last_seen < now() - interval '6 months'
    and not exists (select 1 from events x where x.device_id = d.device_id);
  return n;
end $$;

-- ---------- link_device: called by the app right after a browser signs in ----------
-- Ties this device to the signed-in account; its earlier anonymous events become that account's.
create or replace function public.link_device(p_device uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in.' using errcode = 'P0001'; end if;
  if p_device is null then return; end if;
  insert into devices (device_id, user_id, linked_at) values (p_device, uid, now())
  on conflict (device_id) do update set user_id = uid, linked_at = now(), last_seen = now();
  update events set user_id = uid where device_id = p_device and user_id is null;
end $$;

revoke all on function public.log_events(uuid, jsonb, text, boolean) from public;
grant execute on function public.log_events(uuid, jsonb, text, boolean) to anon, authenticated;
revoke all on function public.link_device(uuid) from public, anon;
grant execute on function public.link_device(uuid) to authenticated;
