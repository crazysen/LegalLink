-- Escalating login lockout: 3 failed attempts → 10 min, then 20 min, 30 min, …
-- Run in Supabase SQL Editor. Applies to all roles (client, admin, attorney).

CREATE TABLE IF NOT EXISTS public.login_lockout_meta (
  email TEXT PRIMARY KEY,
  lockout_until TIMESTAMPTZ,
  lockout_tier INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.login_lockout_meta ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.log_failed_login(user_email TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(user_email));
  recent_fails INT;
  v_tier INT;
  lock_seconds INT;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  INSERT INTO audit_logs (email) VALUES (v_email);

  SELECT COUNT(*)::INT INTO recent_fails
  FROM audit_logs
  WHERE lower(email) = v_email
    AND attempt_time >= NOW() - INTERVAL '15 minutes';

  IF recent_fails < 3 THEN
    RETURN;
  END IF;

  SELECT COALESCE(lockout_tier, 0) INTO v_tier
  FROM login_lockout_meta
  WHERE email = v_email;

  IF NOT FOUND THEN
    v_tier := 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM login_lockout_meta
    WHERE email = v_email AND lockout_until IS NOT NULL AND lockout_until > NOW()
  ) THEN
    RETURN;
  END IF;

  v_tier := LEAST(v_tier + 1, 6);
  lock_seconds := 600 * v_tier;

  INSERT INTO login_lockout_meta (email, lockout_until, lockout_tier, updated_at)
  VALUES (v_email, NOW() + make_interval(secs => lock_seconds), v_tier, NOW())
  ON CONFLICT (email) DO UPDATE
  SET lockout_until = EXCLUDED.lockout_until,
      lockout_tier = EXCLUDED.lockout_tier,
      updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.check_login_lockout(user_email TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(user_email));
  v_until TIMESTAMPTZ;
  seconds_remaining INT;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN 0;
  END IF;

  SELECT lockout_until INTO v_until
  FROM login_lockout_meta
  WHERE email = v_email;

  IF v_until IS NOT NULL AND v_until > NOW() THEN
    seconds_remaining := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_until - NOW()))))::INT;
    RETURN seconds_remaining;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_failed_logins(user_email TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(user_email));
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  DELETE FROM audit_logs WHERE lower(email) = v_email;
END;
$$;
