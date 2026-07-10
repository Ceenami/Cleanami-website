-- Migration: Add all PostgreSQL functions for app features
-- Adapted to match Drizzle schema naming conventions

-- ============================================================================
-- 1. TRIGGER FUNCTION: Auto-update updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create triggers for app-specific tables
CREATE TRIGGER update_cleaners_updated_at
  BEFORE UPDATE ON public.cleaners
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_swap_requests_updated_at
  BEFORE UPDATE ON public.swap_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_onboarding_documents_updated_at
  BEFORE UPDATE ON public.onboarding_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_capability_flags_updated_at
  BEFORE UPDATE ON public.capability_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reliability_checks_updated_at
  BEFORE UPDATE ON public.reliability_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2. AUTH FUNCTION: Auto-create user and cleaner on signup
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_cleaner_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id UUID;
BEGIN
  -- First, create user record
  INSERT INTO public.users (supabase_user_id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    'cleaner'
  )
  RETURNING id INTO new_user_id;

  -- Then create cleaner profile linked to user
  INSERT INTO public.cleaners (user_id, email, full_name)
  VALUES (
    new_user_id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
  );

  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created_cleaner ON auth.users;
CREATE TRIGGER on_auth_user_created_cleaner
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_cleaner_user();

-- ============================================================================
-- 3. ASSIGNMENT FUNCTION: Check if job has assignments
-- ============================================================================
CREATE OR REPLACE FUNCTION public.job_has_assignments(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.jobs_to_cleaners 
    WHERE job_id = p_job_id
  );
$$;

-- ============================================================================
-- 4. SWAP FUNCTIONS: Manage job swaps
-- ============================================================================

-- Count swaps in last 60 days
CREATE OR REPLACE FUNCTION public.get_cleaner_swap_count(cleaner_uuid UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.swap_requests
  WHERE original_cleaner_id = cleaner_uuid
    AND status = 'accepted'
    AND created_at >= NOW() - INTERVAL '60 days';
$$;

-- Check swap eligibility
CREATE OR REPLACE FUNCTION public.check_swap_eligibility(
  p_job_id UUID,
  p_cleaner_id UUID
)
RETURNS TABLE (
  cleaner_id UUID,
  full_name TEXT,
  reliability_score NUMERIC,
  swap_count INTEGER,
  is_eligible BOOLEAN,
  conflict_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH job_info AS (
    SELECT j.*, jtc.role
    FROM public.jobs j
    JOIN public.jobs_to_cleaners jtc ON j.id = jtc.job_id
    WHERE j.id = p_job_id AND jtc.cleaner_id = p_cleaner_id
  ),
  eligible_cleaners AS (
    SELECT 
      c.id as cleaner_id,
      c.full_name,
      c.reliability_score,
      public.get_cleaner_swap_count(c.id) as swap_count,
      CASE 
        WHEN public.get_cleaner_swap_count(c.id) >= 3 THEN FALSE
        WHEN EXISTS (
          SELECT 1 FROM public.jobs_to_cleaners jtc2
          JOIN public.jobs j2 ON jtc2.job_id = j2.id
          WHERE jtc2.cleaner_id = c.id 
          AND j2.check_in_time = (SELECT check_in_time FROM job_info)
        ) THEN FALSE
        ELSE TRUE
      END as is_eligible,
      CASE 
        WHEN public.get_cleaner_swap_count(c.id) >= 3 THEN 'Swap limit reached (3/60 days)'
        WHEN EXISTS (
          SELECT 1 FROM public.jobs_to_cleaners jtc2
          JOIN public.jobs j2 ON jtc2.job_id = j2.id
          WHERE jtc2.cleaner_id = c.id 
          AND j2.check_in_time = (SELECT check_in_time FROM job_info)
        ) THEN 'Schedule conflict'
        ELSE NULL
      END as conflict_reason
    FROM public.cleaners c
    WHERE c.id != p_cleaner_id
      AND c.reliability_score >= 80 -- Only reliable cleaners
  )
  SELECT * FROM eligible_cleaners
  ORDER BY is_eligible DESC, reliability_score DESC, swap_count ASC;
$$;

-- ============================================================================
-- 5. RELIABILITY SCORING FUNCTIONS
-- ============================================================================

-- Calculate reliability score based on last 90 days
CREATE OR REPLACE FUNCTION public.calculate_reliability_score(p_cleaner_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_jobs INTEGER;
  positive_events INTEGER;
  reliability_score INTEGER;
BEGIN
  -- Count total reliability events in last 90 days
  SELECT COUNT(*) INTO total_jobs
  FROM public.reliability_events
  WHERE cleaner_id = p_cleaner_id
    AND created_at >= NOW() - INTERVAL '90 days';
    
  -- Count positive events (on_time, early_arrival)
  SELECT COUNT(*) INTO positive_events
  FROM public.reliability_events
  WHERE cleaner_id = p_cleaner_id
    AND created_at >= NOW() - INTERVAL '90 days'
    AND event_type IN ('on_time', 'early_arrival');
    
  -- Calculate percentage (default to 100 if no events)
  IF total_jobs = 0 THEN
    reliability_score := 100;
  ELSE
    reliability_score := ROUND((positive_events::DECIMAL / total_jobs::DECIMAL) * 100);
  END IF;
  
  RETURN reliability_score;
END;
$$;

-- Calculate penalty points for lateness
CREATE OR REPLACE FUNCTION public.calculate_lateness_penalty(p_delay_minutes INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE 
    WHEN p_delay_minutes < 10 THEN RETURN 0;
    WHEN p_delay_minutes < 30 THEN RETURN 5;
    WHEN p_delay_minutes < 60 THEN RETURN 15;
    ELSE RETURN 25;
  END CASE;
END;
$$;

-- ============================================================================
-- 6. LEADERBOARD FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_leaderboard()
RETURNS TABLE(
  cleaner_id UUID,
  full_name TEXT,
  reliability_score INTEGER,
  total_jobs BIGINT,
  badges_count BIGINT,
  total_earnings NUMERIC,
  rank BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cleaner_stats AS (
    SELECT 
      c.id as cleaner_id,
      c.full_name,
      public.calculate_reliability_score(c.id) as reliability_score,
      COALESCE(js.job_count, 0) as total_jobs,
      COALESCE(cb.badge_count, 0) as badges_count,
      COALESCE(p.total_earnings, 0) as total_earnings
    FROM public.cleaners c
    LEFT JOIN (
      SELECT 
        cleaner_id, 
        COUNT(*) as job_count
      FROM public.job_stats 
      WHERE completed_at IS NOT NULL
      GROUP BY cleaner_id
    ) js ON c.id = js.cleaner_id
    LEFT JOIN (
      SELECT 
        cleaner_id, 
        COUNT(*) as badge_count
      FROM public.cleaner_badges
      GROUP BY cleaner_id
    ) cb ON c.id = cb.cleaner_id
    LEFT JOIN (
      SELECT 
        cleaner_id,
        SUM(amount) as total_earnings
      FROM public.payouts
      WHERE status = 'released'
      GROUP BY cleaner_id
    ) p ON c.id = p.cleaner_id
  )
  SELECT 
    cs.*,
    ROW_NUMBER() OVER (
      ORDER BY 
        cs.reliability_score DESC,
        cs.total_jobs DESC,
        cs.badges_count DESC,
        cs.total_earnings DESC
    ) as rank
  FROM cleaner_stats cs
  ORDER BY rank;
END;
$$;

-- ============================================================================
-- 7. RELIABILITY CHECK FUNCTIONS
-- ============================================================================

-- Send reliability notifications for jobs starting in 1 hour
CREATE OR REPLACE FUNCTION public.send_reliability_notifications()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert reliability check records for jobs starting in 1 hour
  INSERT INTO public.reliability_checks (job_id, cleaner_id)
  SELECT DISTINCT j.id, jtc.cleaner_id
  FROM public.jobs j
  JOIN public.jobs_to_cleaners jtc ON j.id = jtc.job_id
  WHERE j.check_in_time BETWEEN now() + INTERVAL '55 minutes' AND now() + INTERVAL '65 minutes'
    AND j.status = 'assigned'
    AND NOT EXISTS (
      SELECT 1 FROM public.reliability_checks rc 
      WHERE rc.job_id = j.id AND rc.cleaner_id = jtc.cleaner_id
    );

  -- Create notifications for the reliability checks
  INSERT INTO public.notifications (user_id, type, title, message, job_id, metadata)
  SELECT 
    u.id,
    'reliability_check',
    'Job Starting Soon - Arrival Confirmation',
    'Your cleaning job starts in 1 hour. Please confirm your expected arrival time.',
    rc.job_id,
    jsonb_build_object(
      'reliability_check_id', rc.id,
      'job_start_time', j.check_in_time,
      'property_id', j.property_id
    )
  FROM public.reliability_checks rc
  JOIN public.cleaners c ON rc.cleaner_id = c.id
  JOIN public.users u ON c.user_id = u.id
  JOIN public.jobs j ON rc.job_id = j.id
  WHERE rc.notification_sent_at >= now() - INTERVAL '5 minutes'
    AND rc.response_received_at IS NULL;
END;
$$;

-- Handle reliability check response
CREATE OR REPLACE FUNCTION public.handle_reliability_response(
  p_reliability_check_id UUID,
  p_expected_lateness TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_cleaner_id UUID;
  v_result JSONB;
BEGIN
  -- Update the reliability check
  UPDATE public.reliability_checks 
  SET 
    expected_lateness = p_expected_lateness::expected_lateness,
    response_received_at = now(),
    job_cancelled = CASE WHEN p_expected_lateness = 'hour_plus' THEN true ELSE false END,
    updated_at = now()
  WHERE id = p_reliability_check_id
  RETURNING job_id, cleaner_id INTO v_job_id, v_cleaner_id;

  -- If hour+ late, cancel the job and trigger swap notifications
  IF p_expected_lateness = 'hour_plus' THEN
    -- Update job status
    UPDATE public.jobs SET status = 'canceled' WHERE id = v_job_id;
    
    -- Remove assignment
    DELETE FROM public.jobs_to_cleaners WHERE job_id = v_job_id AND cleaner_id = v_cleaner_id;
    
    -- Create urgent swap request
    INSERT INTO public.swap_requests (
      job_id, 
      original_cleaner_id, 
      expires_at,
      status
    ) VALUES (
      v_job_id,
      v_cleaner_id,
      (SELECT check_in_time - INTERVAL '30 minutes' FROM public.jobs WHERE id = v_job_id),
      'urgent'
    );
    
    v_result = jsonb_build_object(
      'status', 'job_cancelled',
      'message', 'Job cancelled due to expected significant delay. Swap notifications sent.'
    );
  ELSE
    v_result = jsonb_build_object(
      'status', 'confirmed',
      'message', 'Arrival time confirmed. Thank you!'
    );
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 8. NOTIFICATION FUNCTIONS
-- ============================================================================

-- Auto-create job reminders 2 hours before job starts
CREATE OR REPLACE FUNCTION public.create_job_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create reminder 2 hours before job start for all assigned cleaners
  INSERT INTO public.notifications (user_id, type, title, message, job_id, scheduled_for)
  SELECT 
    u.id,
    'job_reminder',
    'Job Starting Soon',
    'Your cleaning job starts in 2 hours. Don''t forget to arrive 15 minutes early!',
    NEW.id,
    NEW.check_in_time - INTERVAL '2 hours'
  FROM jobs_to_cleaners jtc
  JOIN cleaners c ON jtc.cleaner_id = c.id
  JOIN users u ON c.user_id = u.id
  WHERE jtc.job_id = NEW.id;
  
  RETURN NEW;
END;
$$;

-- Create trigger for automatic job reminders
DROP TRIGGER IF EXISTS create_job_reminders_trigger ON public.jobs;
CREATE TRIGGER create_job_reminders_trigger
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.create_job_reminders();