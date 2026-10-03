-- University Mess Management System
-- Supabase PostgreSQL schema
-- Run this file in the Supabase SQL Editor.

begin;

-- Required for gen_random_uuid().
create extension if not exists pgcrypto;

-- =========================================================
-- users
-- Application profile linked to a Supabase Auth account.
-- =========================================================
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student'
    check (role in ('student', 'admin', 'staff')),
  full_name text not null,
  student_id text,
  email text not null unique
);

create index users_role_idx on public.users (role);
create index users_student_id_idx on public.users (student_id);

-- =========================================================
-- menus
-- =========================================================
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  meal_type text not null
    check (meal_type in ('Breakfast', 'Lunch', 'Dinner')),
  main_dish text not null,
  status text not null default 'Published'
    check (status in ('Published', 'Draft')),
  constraint menus_date_meal_type_key unique (date, meal_type)
);

create index menus_date_idx on public.menus (date);
create index menus_meal_type_idx on public.menus (meal_type);

-- =========================================================
-- attendance
-- A student's participation in a specific menu session.
-- =========================================================
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  menu_id uuid not null references public.menus (id) on delete cascade,
  status text not null
    check (status in ('consumed', 'opted-out', 'absent')),
  constraint attendance_student_menu_key unique (student_id, menu_id)
);

create index attendance_student_id_idx on public.attendance (student_id);
create index attendance_menu_id_idx on public.attendance (menu_id);
create index attendance_status_idx on public.attendance (status);

-- =========================================================
-- invoices
-- =========================================================
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  billing_month text not null,
  total_amount numeric(10, 2) not null default 0
    check (total_amount >= 0),
  payment_status text not null default 'Pending'
    check (payment_status in ('Paid', 'Pending')),
  constraint invoices_student_month_key unique (student_id, billing_month)
);

create index invoices_student_id_idx on public.invoices (student_id);
create index invoices_billing_month_idx on public.invoices (billing_month);
create index invoices_payment_status_idx on public.invoices (payment_status);

-- =========================================================
-- Row Level Security
-- RLS is enabled now. Add role-specific SELECT/INSERT/UPDATE/
-- DELETE policies before connecting application users.
-- =========================================================
alter table public.users enable row level security;
alter table public.menus enable row level security;
alter table public.attendance enable row level security;
alter table public.invoices enable row level security;

commit;
