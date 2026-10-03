-- Password Reset Fields Migration
-- Adds secure password reset token storage to users table.
-- Run this in the Supabase SQL Editor after the base schema.

begin;

-- Add columns for password reset functionality
alter table public.users
  add column if not exists password_reset_token_hash text,
  add column if not exists password_reset_expires_at timestamptz;

-- Index for faster lookups by token hash (optional but useful for cleanup)
create index if not exists users_password_reset_expires_idx
  on public.users (password_reset_expires_at)
  where password_reset_expires_at is not null;

commit;