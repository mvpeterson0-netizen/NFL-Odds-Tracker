-- Stix phone alerts (web push) — subscriptions.
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: it only creates things that don't exist yet and replaces its own functions.
-- (Numbered 003 because 002 is already used by the accounts work.)
--
-- What it creates:
--   push_subs        — one row per phone/browser that turned on alerts in Stix. No sign-in needed.
--                      Nobody can read this table from the app; only the server key (the pipeline) reads it.
--   push_subscribe   — the app calls this to save (or refresh) its own subscription.
--   push_unsubscribe — the app calls this to remove its own subscription. A subscription's address is
--                      long and random, so only the phone that holds it can remove it.
--   Addresses must belong to a known push service (Apple, Google, Mozilla, Microsoft).

create table if not exists public.push_subs (
  endpoint     text primary key,                    -- push service address for that phone/browser
  p256dh       text not null,                       -- that browser's public key (used to encrypt messages to it)
  auth         text not null,                       -- that browser's auth secret
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_sent_at timestamptz                          -- set by the pipeline after a successful send
);
alter table public.push_subs enable row level security;
-- No policies on purpose: anon/authenticated can't select, insert, update or delete rows directly.
revoke all on public.push_subs from anon, authenticated;

create or replace function public.push_endpoint_ok(p_endpoint text) returns boolean
language sql immutable as $$
  select p_endpoint is not null
     and length(p_endpoint) between 20 and 1000
     and p_endpoint ~ '^https://(([a-z0-9-]+\.)*push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.push_endpoint_ok(p_endpoint) then
    raise exception 'push address not accepted' using errcode = '22023';
  end if;
  if p_p256dh is null or length(p_p256dh) not between 40 and 200
     or p_auth is null or length(p_auth) not between 10 and 100 then
    raise exception 'push keys not accepted' using errcode = '22023';
  end if;
  insert into public.push_subs (endpoint, p256dh, auth)
  values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint;
$$;

revoke all on function public.push_subscribe(text, text, text) from public;
revoke all on function public.push_unsubscribe(text) from public;
grant execute on function public.push_subscribe(text, text, text) to anon, authenticated;
grant execute on function public.push_unsubscribe(text) to anon, authenticated;
