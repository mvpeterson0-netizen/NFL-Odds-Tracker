-- Stix accounts — allow picks saved from the "Bet on FanDuel" buttons. Run once in Supabase after 001–003. Safe to re-run.
--
-- picks.source was limited to 'manual', 'Bet on DK' and 'import' (001). Since PR #73 a FanDuel bet tap saves the pick
-- with source 'Bet on FD', which the old rule would refuse. This only widens the allowed values; existing rows are kept
-- and still pass the new rule.

do $$
declare c record;
begin
  -- Remove the old rule on picks.source, whatever name it was given.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.picks'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.picks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.picks add constraint picks_source_check
  check (source in ('manual', 'Bet on DK', 'Bet on FD', 'import'));
