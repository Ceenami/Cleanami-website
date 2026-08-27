-- 0035 — cleaner sign-up requires an invitation, at the database level
--
-- BACKGROUND
-- `handle_new_cleaner_user` fires on every `auth.users` insert carrying
-- `raw_user_meta_data->>'user_type' = 'cleaner'`, which is what the native app
-- sent when it called `supabase.auth.signUp()` directly. The function created
-- the `users` and `cleaners` rows unconditionally: no allowlist check, no
-- `invitation_id`, and no transition of the invitation to `signed_up`. Only the
-- website's sign-up action (`lib/services/auth/auth.service.ts`) ever did those.
--
-- Two consequences:
--   1. The invitation allowlist was enforced on the website and nowhere else.
--      Anyone holding the public anon key could mint a cleaner account.
--   2. `getCleanerAuth()` refuses a cleaner with neither `invitation_id` nor
--      `onboarding_completed`, so every account created this way was 401'd out
--      of all of `/api/cleaner/*` — signed up successfully, unable to act.
--
-- The app now posts to `/api/auth/cleaner-signup`, which runs the website's own
-- `AuthService.signUpUser`. This migration is the second half: it closes the
-- same hole in the database, so a stale app build, a script, or anyone with the
-- anon key gets the same answer the website gives.
--
-- WHY `RAISE EXCEPTION` RATHER THAN SKIPPING THE INSERTS
-- Skipping would leave an `auth.users` row with no application profile — a
-- login that resolves to nothing. Raising aborts the whole sign-up, which is
-- what "not invited" should mean. GoTrue surfaces it to the caller as an error.
--
-- KNOWN LIMIT: the rejection cannot be recorded in `cleaner_signup_attempts`.
-- Raising rolls the transaction back, taking any audit insert with it, and
-- plpgsql has no autonomous transaction. Rejections through the API route are
-- still logged there by `assertCleanerEmailApproved`; only direct-to-Supabase
-- attempts go unlogged, and those should not be happening at all.
--
-- ROLLBACK: re-run the previous definition from
-- `db/schemas/functions_for_app.sql` — but note that file was already stale
-- (it lacked the `user_type` guard and the `user_preferences` insert this
-- function has carried in production for some time). This migration is now the
-- authoritative definition.

CREATE OR REPLACE FUNCTION public.handle_new_cleaner_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_user_id UUID;
  new_cleaner_id UUID;
  user_full_name TEXT;
  user_type TEXT;
  v_invitation_id UUID;
  v_invitation_status TEXT;
BEGIN
  user_type := NEW.raw_user_meta_data ->> 'user_type';

  -- Only the app's direct-signup shape reaches this branch. The website's
  -- sign-up action does not set `user_type`, so it creates its own rows and is
  -- deliberately untouched here.
  IF user_type = 'cleaner' THEN

    -- Invitations are stored lower-cased (see findApprovedCleanerInvitation).
    SELECT id, status::text
      INTO v_invitation_id, v_invitation_status
      FROM public.cleaner_invitations
     WHERE lower(email) = lower(NEW.email);

    IF v_invitation_id IS NULL OR v_invitation_status = 'disabled' THEN
      -- Wording matches CLEANER_SIGNUP_REJECTED_MESSAGE so the app shows the
      -- same sentence whichever path refused it.
      RAISE EXCEPTION
        'Your email has not been approved for cleaner onboarding. Please contact CleanNami.'
        USING ERRCODE = 'check_violation';
    END IF;

    user_full_name := COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    );

    INSERT INTO public.users (supabase_user_id, email, name, role)
    VALUES (NEW.id, NEW.email, user_full_name, 'cleaner')
    ON CONFLICT (supabase_user_id) DO NOTHING
    RETURNING id INTO new_user_id;

    IF new_user_id IS NULL THEN
      SELECT id INTO new_user_id
      FROM public.users
      WHERE supabase_user_id = NEW.id;
    END IF;

    -- invitation_id, onboarding_started and account_status mirror what
    -- auth.service.ts writes, so the two sign-up paths produce the same row.
    INSERT INTO public.cleaners (
      user_id,
      full_name,
      email,
      invitation_id,
      onboarding_started,
      onboarding_started_at,
      account_status,
      has_hot_tub_cert,
      stripe_onboarding_complete,
      on_call_status,
      legal_docs_signed,
      onboarding_completed,
      onboarding_step
    )
    VALUES (
      new_user_id,
      user_full_name,
      NEW.email,
      v_invitation_id,
      true,
      now(),
      'onboarding_in_progress',
      false,
      false,
      'unavailable',
      '{"w9Url": null, "liabilityWaiverUrl": null, "gpsConsentUrl": null}'::jsonb,
      false,
      1
    )
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO new_cleaner_id;

    IF new_cleaner_id IS NULL THEN
      SELECT id INTO new_cleaner_id
      FROM public.cleaners
      WHERE user_id = new_user_id;

      -- A pre-existing row from before this migration has no invitation link.
      UPDATE public.cleaners
         SET invitation_id = v_invitation_id, updated_at = now()
       WHERE id = new_cleaner_id AND invitation_id IS NULL;
    END IF;

    -- markInvitationSignedUp(), in SQL.
    UPDATE public.cleaner_invitations
       SET status = 'signed_up',
           signed_up_at = COALESCE(signed_up_at, now()),
           updated_at = now()
     WHERE id = v_invitation_id AND status <> 'signed_up';

    INSERT INTO public.cleaner_audit_logs (cleaner_id, invitation_id, action, metadata)
    VALUES
      (new_cleaner_id, v_invitation_id, 'signup_succeeded',
       jsonb_build_object('source', 'handle_new_cleaner_user')),
      (new_cleaner_id, v_invitation_id, 'onboarding_started',
       jsonb_build_object('source', 'handle_new_cleaner_user'));

    -- Kept from the previous definition. Nothing in either repo reads
    -- `user_preferences` today, but removing it is a separate decision.
    INSERT INTO public.user_preferences (
      cleaner_id,
      push_notifications_enabled,
      on_call_alerts_enabled,
      email_notifications_enabled,
      sms_notifications_enabled,
      location_tracking_enabled,
      auto_photo_upload_enabled,
      share_location_with_team,
      preferred_language,
      preferred_region,
      theme
    )
    VALUES (
      new_cleaner_id, true, false, true, false, true, false, false, 'en', 'US', 'system'
    )
    ON CONFLICT (cleaner_id) DO NOTHING;

  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_cleaner_user() IS
  'Cleaner profile creation for direct supabase.auth.signUp callers. Requires an active cleaner_invitations row and raises if there is none. Kept in step with lib/services/auth/auth.service.ts, which handles the website path.';
