-- Stix review queue — which player × stat lines each user has already looked at this week.
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run: it only creates things that don't exist yet and replaces its own policies/trigger.
--
-- What it creates:
--   reviews — one row per user per "<week>|<player id>|<market>" (same key as picks). Records the line on screen
--             when the card was swiped and the decision (Over / Under / skip). Lets phone and computer share
--             what's been reviewed. A user can only see and change their own rows.
-- What it does NOT change: the picks and profiles tables. Over / Under swipes still save the pick through the
-- existing picks table (with its kickoff lock); this table only remembers that the card was seen.

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_key  text not null check (length(review_key) between 5 and 80),   -- "<week>|<player id>|<market>"
  week        int  not null check (week between 1 and 30),
  line        numeric(6,1) not null,                 -- line on screen when reviewed (a big move later brings the card back)
  decision    text not null check (decision in ('o','u','skip')),
  reviewed_at timestamptz not null default now(),
  unique (user_id, review_key)
);
create index if not exists reviews_user_week_idx on public.reviews (user_id, week);
alter table public.reviews enable row level security;
drop policy if exists "read own reviews"   on public.reviews;
drop policy if exists "add own reviews"    on public.reviews;
drop policy if exists "change own reviews" on public.reviews;
drop policy if exists "delete own reviews" on public.reviews;
create policy "read own reviews"   on public.reviews for select to authenticated using (user_id = auth.uid());
create policy "add own reviews"    on public.reviews for insert to authenticated with check (user_id = auth.uid());
create policy "change own reviews" on public.reviews for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own reviews" on public.reviews for delete to authenticated using (user_id = auth.uid());
revoke all on public.reviews from anon;
grant select, insert, update, delete on public.reviews to authenticated;

-- The server's clock sets reviewed_at (not the phone's), and a row can't be moved to another user.
create or replace function public.reviews_stamp() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'Not allowed to change whose review this is.' using errcode = 'P0001';
  end if;
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists reviews_stamp on public.reviews;
create trigger reviews_stamp before insert or update on public.reviews
  for each row execute function public.reviews_stamp();
