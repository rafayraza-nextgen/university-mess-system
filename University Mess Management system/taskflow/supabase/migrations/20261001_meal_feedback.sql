-- Meal Feedback Table Migration
-- Creates the meal_feedback table for student meal reviews/ratings
-- Run this in Supabase SQL Editor

BEGIN;

-- Create the meal_feedback table
CREATE TABLE public.meal_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  menu_id UUID NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common query patterns
CREATE INDEX meal_feedback_student_id_idx ON public.meal_feedback(student_id);
CREATE INDEX meal_feedback_menu_id_idx ON public.meal_feedback(menu_id);
CREATE INDEX meal_feedback_created_at_idx ON public.meal_feedback(created_at DESC);

-- Ensure one feedback per student per menu
CREATE UNIQUE INDEX meal_feedback_student_menu_unique ON public.meal_feedback(student_id, menu_id);

-- Enable Row Level Security
ALTER TABLE public.meal_feedback ENABLE ROW LEVEL SECURITY;

-- Policy: Students can insert their own feedback
CREATE POLICY "meal_feedback_insert_own" ON public.meal_feedback
  FOR INSERT
  WITH CHECK (auth.uid() = student_id);

-- Policy: Students can view their own feedback
CREATE POLICY "meal_feedback_select_own" ON public.meal_feedback
  FOR SELECT
  USING (auth.uid() = student_id);

-- Policy: Students can update their own feedback (within a reasonable time window, e.g., 24 hours)
CREATE POLICY "meal_feedback_update_own" ON public.meal_feedback
  FOR UPDATE
  USING (auth.uid() = student_id)
  WITH CHECK (auth.uid() = student_id);

-- Policy: Admin/Staff can read ALL feedback (for dashboard)
-- Uses the existing current_user_role() helper from your schema
CREATE POLICY "meal_feedback_admin_select_all" ON public.meal_feedback
  FOR SELECT
  USING (
    public.current_user_role() IN ('admin', 'staff')
  );

-- Policy: Admin can manage all feedback (delete if needed)
CREATE POLICY "meal_feedback_admin_manage_all" ON public.meal_feedback
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

COMMIT;