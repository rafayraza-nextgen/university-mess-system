-- Adds the per-meal price used by the admin menu table.
-- Run this in the Supabase SQL Editor, then re-run supabase/policies.sql if you
-- have changed any policies. The column is nullable so existing menu rows are
-- not rewritten; the admin form treats a null price as "not priced".

begin;

alter table public.menus
  add column if not exists price numeric(10, 2);

comment on column public.menus.price is
  'Per-meal price charged to students. Null means not yet priced.';

commit;
