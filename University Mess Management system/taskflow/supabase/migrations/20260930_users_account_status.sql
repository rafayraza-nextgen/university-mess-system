-- Normalises public.users.account_status for the staff approval workflow.
--
-- The column already exists but its allowed values are unknown from the app, so
-- this widens the CHECK to cover the four states the UI needs, backfills any
-- NULLs, and enforces NOT NULL. Safe to re-run.

begin;

do $$
declare
  existing_constraint text;
begin
  -- Drop any CHECK constraint that already references account_status, whatever
  -- it was named, so the statement below can recreate it.
  select con.conname
    into existing_constraint
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where rel.relname = 'users'
     and nsp.nspname = 'public'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%account_status%'
   limit 1;

  if existing_constraint is not null then
    execute format('alter table public.users drop constraint %I', existing_constraint);
  end if;
end $$;

alter table public.users
  add column if not exists account_status text;

update public.users
   set account_status = 'active'
 where account_status is null;

alter table public.users
  alter column account_status set default 'active';

alter table public.users
  alter column account_status set not null;

alter table public.users
  add constraint users_account_status_check
  check (account_status in ('active', 'suspended', 'pending', 'rejected'));

commit;
