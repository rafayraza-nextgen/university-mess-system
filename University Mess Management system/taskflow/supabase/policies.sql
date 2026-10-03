-- University Mess Management System
-- Row Level Security policies
-- Run after supabase/schema.sql in the Supabase SQL Editor.

begin;

-- =========================================================
-- Role helper
--
-- SECURITY DEFINER prevents recursive RLS evaluation when the
-- users table policy checks the current user's role.
-- =========================================================
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.users
  where id = auth.uid()
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- Mirrors current_user_role() for account_status. Used to pin a user's own
-- status during self-service updates so a pending staff applicant cannot flip
-- their own account_status to 'active' and approve themselves.
create or replace function public.current_user_account_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select account_status
  from public.users
  where id = auth.uid()
$$;

revoke all on function public.current_user_account_status() from public;
grant execute on function public.current_user_account_status() to authenticated;

-- =========================================================
-- users policies
-- =========================================================

-- A signed-in user can read only their own profile.
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
  on public.users
  for select
  to authenticated
  using (id = auth.uid());

-- A newly authenticated user can create only their own profile.
-- A student is always created active. A staff applicant is created with
-- account_status = 'pending', which grants nothing: the staff dashboard stays
-- blocked until an admin promotes them. Neither 'admin' nor an already
-- approved 'staff' account can be self-assigned.
drop policy if exists "users_insert_own_student_profile" on public.users;
create policy "users_insert_own_student_profile"
  on public.users
  for insert
  to authenticated
  with check (
    id = auth.uid()
    and (
      (role = 'student' and account_status = 'active')
      or (role = 'staff' and account_status = 'pending')
    )
  );

-- A signed-in user can update their own profile, but cannot escalate. The
-- WITH CHECK clause requires the updated role AND account_status to match what
-- is already stored, so neither a pending applicant nor a suspended student can
-- clear their own status. Only the admin policies can change them.
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
  on public.users
  for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select public.current_user_role())
    and account_status = (select public.current_user_account_status())
  );

-- Cafeteria staff need to resolve the scanned student's name, so the
-- "Recent Scans" join on public.users is only readable for them.
-- NOTE: this also exposes the email column to staff, because RLS controls
-- rows, not columns. If that matters, move the lookup into a view or an RPC
-- that projects only full_name and student_id.
drop policy if exists "staff_select_all_users" on public.users;
create policy "staff_select_all_users"
  on public.users
  for select
  to authenticated
  using ((select public.current_user_role()) = 'staff');

-- Admins can read all profiles.
drop policy if exists "admins_select_all_users" on public.users;
create policy "admins_select_all_users"
  on public.users
  for select
  to authenticated
  using ((select public.current_user_role()) = 'admin');

-- Admins can create profiles.
drop policy if exists "admins_insert_all_users" on public.users;
create policy "admins_insert_all_users"
  on public.users
  for insert
  to authenticated
  with check ((select public.current_user_role()) = 'admin');

-- Admins can update all profiles.
drop policy if exists "admins_update_all_users" on public.users;
create policy "admins_update_all_users"
  on public.users
  for update
  to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

-- Admins can delete all profiles.
drop policy if exists "admins_delete_all_users" on public.users;
create policy "admins_delete_all_users"
  on public.users
  for delete
  to authenticated
  using ((select public.current_user_role()) = 'admin');

-- =========================================================
-- menus policies
-- =========================================================

-- Any authenticated user can read the published menu data.
drop policy if exists "authenticated_select_menus" on public.menus;
create policy "authenticated_select_menus"
  on public.menus
  for select
  to authenticated
  using (true);

-- Only admins can create menus.
drop policy if exists "admins_insert_menus" on public.menus;
create policy "admins_insert_menus"
  on public.menus
  for insert
  to authenticated
  with check ((select public.current_user_role()) = 'admin');

-- Only admins can update menus.
drop policy if exists "admins_update_menus" on public.menus;
create policy "admins_update_menus"
  on public.menus
  for update
  to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

-- Only admins can delete menus.
drop policy if exists "admins_delete_menus" on public.menus;
create policy "admins_delete_menus"
  on public.menus
  for delete
  to authenticated
  using ((select public.current_user_role()) = 'admin');

-- =========================================================
-- attendance policies
-- =========================================================

-- Students can read only their own attendance records.
drop policy if exists "students_select_own_attendance" on public.attendance;
create policy "students_select_own_attendance"
  on public.attendance
  for select
  to authenticated
  using (student_id = auth.uid());

-- Students can create attendance records only for themselves.
drop policy if exists "students_insert_own_attendance" on public.attendance;
create policy "students_insert_own_attendance"
  on public.attendance
  for insert
  to authenticated
  with check (student_id = auth.uid());

-- Students can update only their own attendance records and
-- cannot transfer a record to another student.
drop policy if exists "students_update_own_attendance" on public.attendance;
create policy "students_update_own_attendance"
  on public.attendance
  for update
  to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- Students can cancel their own opt-outs. A student is never allowed to
-- delete another student's attendance record.
drop policy if exists "students_delete_own_attendance" on public.attendance;
create policy "students_delete_own_attendance"
  on public.attendance
  for delete
  to authenticated
  using (student_id = auth.uid());

-- Staff can read all attendance records for QR verification.
drop policy if exists "staff_select_all_attendance" on public.attendance;
create policy "staff_select_all_attendance"
  on public.attendance
  for select
  to authenticated
  using ((select public.current_user_role()) = 'staff');

-- Staff can create attendance records for any student.
drop policy if exists "staff_insert_all_attendance" on public.attendance;
create policy "staff_insert_all_attendance"
  on public.attendance
  for insert
  to authenticated
  with check ((select public.current_user_role()) = 'staff');

-- Staff can update all attendance records.
drop policy if exists "staff_update_all_attendance" on public.attendance;
create policy "staff_update_all_attendance"
  on public.attendance
  for update
  to authenticated
  using ((select public.current_user_role()) = 'staff')
  with check ((select public.current_user_role()) = 'staff');

-- Admins can read all attendance records.
drop policy if exists "admins_select_all_attendance" on public.attendance;
create policy "admins_select_all_attendance"
  on public.attendance
  for select
  to authenticated
  using ((select public.current_user_role()) = 'admin');

-- Admins can create attendance records for any student.
drop policy if exists "admins_insert_all_attendance" on public.attendance;
create policy "admins_insert_all_attendance"
  on public.attendance
  for insert
  to authenticated
  with check ((select public.current_user_role()) = 'admin');

-- Admins can update all attendance records.
drop policy if exists "admins_update_all_attendance" on public.attendance;
create policy "admins_update_all_attendance"
  on public.attendance
  for update
  to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

-- Admins can delete attendance records.
drop policy if exists "admins_delete_all_attendance" on public.attendance;
create policy "admins_delete_all_attendance"
  on public.attendance
  for delete
  to authenticated
  using ((select public.current_user_role()) = 'admin');

-- =========================================================
-- invoices policies
-- =========================================================

-- Students can read only their own invoices.
drop policy if exists "students_select_own_invoices" on public.invoices;
create policy "students_select_own_invoices"
  on public.invoices
  for select
  to authenticated
  using (student_id = auth.uid());

-- Staff need to read outstanding balances before serving a meal, so the
-- $50 auto-blocker can evaluate affordability at the counter.
drop policy if exists "staff_select_all_invoices" on public.invoices;
create policy "staff_select_all_invoices"
  on public.invoices
  for select
  to authenticated
  using ((select public.current_user_role()) = 'staff');

-- Staff may flag a student account as suspended, but ONLY on student rows and
-- ONLY while the row stays a student: the WITH CHECK pins role = 'student', so
-- this policy cannot promote anyone to staff or admin, and the USING clause
-- means a staff member cannot touch a staff or admin account at all.
--
-- KNOWN LIMITATION: RLS filters rows, not columns, so this also permits editing
-- a student's other profile fields. If that is unacceptable, drop this policy
-- and expose a security definer RPC that updates account_status alone.
drop policy if exists "staff_update_student_account_status" on public.users;
create policy "staff_update_student_account_status"
  on public.users
  for update
  to authenticated
  using (
    (select public.current_user_role()) = 'staff'
    and role = 'student'
  )
  with check (
    (select public.current_user_role()) = 'staff'
    and role = 'student'
  );

-- Admins can read all invoices.
drop policy if exists "admins_select_all_invoices" on public.invoices;
create policy "admins_select_all_invoices"
  on public.invoices
  for select
  to authenticated
  using ((select public.current_user_role()) = 'admin');

-- Admins can create invoices.
drop policy if exists "admins_insert_all_invoices" on public.invoices;
create policy "admins_insert_all_invoices"
  on public.invoices
  for insert
  to authenticated
  with check ((select public.current_user_role()) = 'admin');

-- Admins can update all invoices.
drop policy if exists "admins_update_all_invoices" on public.invoices;
create policy "admins_update_all_invoices"
  on public.invoices
  for update
  to authenticated
  using ((select public.current_user_role()) = 'admin')
  with check ((select public.current_user_role()) = 'admin');

-- Admins can delete invoices.
drop policy if exists "admins_delete_all_invoices" on public.invoices;
create policy "admins_delete_all_invoices"
  on public.invoices
  for delete
  to authenticated
  using ((select public.current_user_role()) = 'admin');

commit;
