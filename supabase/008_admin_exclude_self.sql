-- Admin page: leave admins' own activity out of the traffic numbers (Michael, 2026-10-27).
-- Replaces admin_traffic(days) with admin_traffic(days, include_admins). By default (include_admins = false) every event
-- recorded for an admin account is left out, including events from a device before it signed in (those move to the
-- account when the device is linked). Activity on a device that has never signed in can't be told apart; open the site
-- once with ?me=1 on such a device to stop tracking it.
-- Run once in Supabase after 006. Safe to re-run.

drop function if exists public.admin_traffic(integer);

create or replace function public.admin_traffic(p_days integer default 30, p_include_admins boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d integer := least(greatest(coalesce(p_days, 30), 1), 180);
  since timestamptz := now() - make_interval(days => d);
  out jsonb;
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  with ev as (
    select e.* from events e
    where e.at >= since and e.device_id <> admin_excluded_device()
      and (coalesce(p_include_admins, false) or e.user_id is null or e.user_id not in (select user_id from admins))
  )
  select jsonb_build_object(
    'days', d,
    'include_admins', coalesce(p_include_admins, false),
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

revoke all on function public.admin_traffic(integer, boolean) from public, anon;
grant execute on function public.admin_traffic(integer, boolean) to authenticated;
