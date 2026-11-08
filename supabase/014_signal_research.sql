-- Signal Stacks: admin-only research rows (rule history, forward results).  Run in the Supabase SQL Editor with Michael's Yes.
-- Nothing here touches picks, profiles, games or any existing table.
--   * signal_research: row-level security ON, no policy, no anon/authenticated table access.
--     The pipeline writes with the service key (supabase/…/signal_research?on_conflict=id); the app never reads it directly.
--   * admin_signal_research(): returns every row, only for accounts in public.admins (same server-side check as 006_admin.sql).
create table if not exists public.signal_research (
  id text primary key,                       -- 'forward', 'display' and 'ledger' (the locked-snapshot ledger; written by the pipeline), 'history:<signal id>' (seeded by hand)
  kind text not null check (kind in ('forward', 'history', 'display', 'ledger')),
  body jsonb not null,
  updated_utc timestamptz not null default now()
);
alter table public.signal_research enable row level security;
revoke all on public.signal_research from anon, authenticated;

create or replace function public.admin_signal_research() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'body', body, 'updated_utc', updated_utc) order by id)
                   from public.signal_research), '[]'::jsonb);
end $$;

revoke all on function public.admin_signal_research() from public, anon;
grant execute on function public.admin_signal_research() to authenticated;
