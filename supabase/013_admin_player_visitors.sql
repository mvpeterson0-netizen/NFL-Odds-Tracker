-- Admin page: "Most-viewed players" counted every screen view, so one person switching apps (a new view each time the
-- page is hidden and shown again, e.g. tapping through to FanDuel and back) could put a player on top by themselves.
-- Each player row now has: visitors (distinct devices), visits (looks 30+ min apart on the same device count separately)
-- and raw views; ranked by visitors, then visits. Same function name and arguments as 008, so the app call is unchanged.
-- Run once in Supabase after 012. Safe to re-run. Changes only this function's output; no tables touched.

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
    'players', coalesce((select jsonb_agg(x order by (x->>'visitors')::int desc, (x->>'visits')::int desc, (x->>'views')::int desc) from (
        select jsonb_build_object('id', id, 'visitors', count(distinct device_id), 'visits', count(*) filter (where new_visit),
                                  'views', count(*), 'secs', coalesce(sum(secs), 0)) x
        from (
          select detail as id, device_id, secs,
                 -- a new visit = first look at this player on this device, or 30+ min after the previous look
                 (lag(at) over (partition by device_id, detail order by at) is null
                  or at - lag(at) over (partition by device_id, detail order by at) > interval '30 minutes') as new_visit
          from ev where kind = 'view' and name = 'player' and detail is not null
        ) pv group by id
        order by count(distinct device_id) desc, count(*) filter (where new_visit) desc limit 15) s), '[]'::jsonb),
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
