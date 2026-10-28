-- Stix admin page (Michael, 2026-10-27): site traffic and site users, visible only to admins.
-- The page itself is public code; the data is protected here: every function below refuses anyone who isn't in
-- public.admins, and the admins table can't be read or changed from the app. Admins are added only here (SQL Editor).
-- Run once in Supabase after 001–005. Safe to re-run.

create table if not exists public.admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- Michael's account (only if it exists; re-run after his first sign-in if this adds 0 rows).
insert into public.admins (user_id)
select id from auth.users where lower(email) = 'mvpeterson0@gmail.com'
on conflict (user_id) do nothing;

-- One test device Claude created on 2026-10-27 to confirm tracking worked live; left out of every report.
create or replace function public.admin_excluded_device() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000c1a0'::uuid $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from admins where user_id = auth.uid()) $$;

-- ---------- traffic summary for the last p_days days (1–180) ----------
create or replace function public.admin_traffic(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 180);
  since timestamptz := now() - make_interval(days => d);
  out jsonb;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  with ev as (
    select e.* from events e where e.at >= since and e.device_id <> admin_excluded_device()
  )
  select jsonb_build_object(
    'days', d,
    'devices', (select count(distinct device_id) from ev),
    'signed_in_devices', (select count(distinct device_id) from ev where user_id is not null),
    'active_users', (select count(distinct user_id) from ev where user_id is not null),
    'views', (select count(*) from ev where kind = 'view'),
    'view_secs', (select coalesce(sum(secs), 0) from ev where kind = 'view'),
    'taps', (select count(*) from ev where kind = 'tap'),
    'per_day', coalesce((select jsonb_agg(x order by x->>'day') from (
        select jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'),
                                  'devices', count(distinct device_id), 'views', count(*) filter (where kind = 'view'),
                                  'secs', coalesce(sum(secs) filter (where kind = 'view'), 0)) x
        from (select (at at time zone 'America/Chicago')::date as day, device_id, kind, secs from ev) dd group by day) s), '[]'::jsonb),
    'screens', coalesce((select jsonb_agg(x order by (x->>'views')::int desc) from (
        select jsonb_build_object('name', name, 'views', count(*), 'secs', coalesce(sum(secs), 0),
                                  'devices', count(distinct device_id)) x
        from ev where kind = 'view' group by name) s), '[]'::jsonb),
    'taps_by_name', coalesce((select jsonb_agg(x order by (x->>'count')::int desc) from (
        select jsonb_build_object('name', name, 'count', count(*), 'devices', count(distinct device_id)) x
        from ev where kind = 'tap' group by name) s), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(x order by (x->>'views')::int desc) from (
        select jsonb_build_object('id', detail, 'views', count(*), 'secs', coalesce(sum(secs), 0)) x
        from ev where kind = 'view' and name = 'player' and detail is not null group by detail
        order by count(*) desc limit 15) s), '[]'::jsonb),
    'platforms', coalesce((select jsonb_agg(x order by (x->>'devices')::int desc) from (
        select jsonb_build_object('platform', coalesce(v.platform, 'unknown'), 'home_screen', coalesce(v.standalone, false),
                                  'devices', count(*)) x
        from devices v where v.device_id in (select device_id from ev)
        group by coalesce(v.platform, 'unknown'), coalesce(v.standalone, false)) s), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- ---------- users ----------
create or replace function public.admin_users()
returns table (user_id uuid, email text, provider text, created_at timestamptz, last_sign_in_at timestamptz,
               age_confirmed boolean, unit_size numeric, picks bigint, devices bigint, views bigint, view_secs bigint,
               taps bigint, last_active timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, coalesce(u.raw_app_meta_data->>'provider', 'email')::text, u.created_at, u.last_sign_in_at,
         (p.age_confirmed_at is not null), p.unit_size,
         (select count(*) from picks k where k.user_id = u.id),
         (select count(*) from devices v where v.user_id = u.id),
         (select count(*) from events e where e.user_id = u.id and e.kind = 'view'),
         (select coalesce(sum(e.secs), 0)::bigint from events e where e.user_id = u.id and e.kind = 'view'),
         (select count(*) from events e where e.user_id = u.id and e.kind = 'tap'),
         (select max(e.at) from events e where e.user_id = u.id)
  from auth.users u left join profiles p on p.id = u.id
  order by coalesce((select max(e.at) from events e where e.user_id = u.id), u.last_sign_in_at, u.created_at) desc;
end $$;

-- ---------- one user's recent activity (latest 200 events) ----------
create or replace function public.admin_user_activity(p_user uuid)
returns table (at timestamptz, kind text, name text, detail text, secs integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select e.at, e.kind, e.name, e.detail, e.secs from events e
    where e.user_id = p_user order by e.at desc limit 200;
end $$;

revoke all on function public.is_admin() from public;
revoke all on function public.admin_traffic(integer) from public, anon;
revoke all on function public.admin_users() from public, anon;
revoke all on function public.admin_user_activity(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_traffic(integer) to authenticated;
grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_user_activity(uuid) to authenticated;

select count(*) as admins_now from public.admins;
