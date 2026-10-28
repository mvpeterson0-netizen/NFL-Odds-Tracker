-- Stix accounts — step 3/4 additions. Run once in Supabase after 001_accounts.sql. Safe to re-run.
--
-- 1. picks.line_label: where the saved line came from ("Pre-game", "Mon AM" snapshot, ...), shown next to each pick.
-- 2. delete_my_account(): lets a signed-in user delete their own account. Their profile and picks go with it.

alter table public.picks add column if not exists line_label text;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = auth.uid();   -- profile and picks are removed with it (on delete cascade)
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
