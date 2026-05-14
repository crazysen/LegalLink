-- BatasMo core database schema for Supabase
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('Client', 'Attorney', 'Admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'rescheduled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
    CREATE TYPE request_status AS ENUM ('pending', 'accepted', 'rejected', 'completed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
    CREATE TYPE payout_status AS ENUM ('requested', 'processing', 'paid', 'rejected');
  END IF;
END $$;

-- Common updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Profiles linked to Supabase Auth users
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text UNIQUE,
  role user_role NOT NULL DEFAULT 'Client',
  -- Philippine local 11-digit (09XXXXXXXXX). auth.users.phone is E.164; app maps before insert.
  phone text,
  address text,
  age int,
  guardian_name text,
  guardian_contact text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE((NEW.raw_user_meta_data ->> 'role')::user_role, 'Client'),
    NEW.phone
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    role = EXCLUDED.role,
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Attorney-only extra profile data
CREATE TABLE IF NOT EXISTS public.attorney_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  firm_name text,
  years_experience int,
  specialties text[] DEFAULT '{}',
  bio text,
  consultation_fee numeric(12,2) DEFAULT 0,
  is_verified boolean NOT NULL DEFAULT false,
  prc_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_attorney_profiles_updated_at
BEFORE UPDATE ON public.attorney_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Attorney availability slots
-- NOTE: Uses date + time columns to match actual Supabase table and app code
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  time varchar NOT NULL,
  is_booked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_attorney_date
  ON public.availability_slots(attorney_id, date);

-- One row per attorney/date/time (dedupe DB before applying on existing projects)
CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_slots_attorney_date_time_unique
  ON public.availability_slots (attorney_id, date, time);

CREATE TRIGGER trg_availability_slots_updated_at
BEFORE UPDATE ON public.availability_slots
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Appointments between client and attorney
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attorney_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_id uuid REFERENCES public.availability_slots(id) ON DELETE SET NULL,
  title text,
  notes text,
  scheduled_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 60,
  status appointment_status NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  meeting_link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_duration_check CHECK (duration_minutes > 0)
);

CREATE INDEX IF NOT EXISTS idx_appointments_client ON public.appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_attorney ON public.appointments(attorney_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status_time ON public.appointments(status, scheduled_at);

CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Consultation rooms and messages
CREATE TABLE IF NOT EXISTS public.consultation_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_consultation_rooms_updated_at
BEFORE UPDATE ON public.consultation_rooms
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Auto-create consultation room when appointment is confirmed
CREATE OR REPLACE FUNCTION public.handle_new_consultation_room() 
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Create room for confirmed or rescheduled appointments (chat remains available after reschedule)
  IF (NEW.status IN ('confirmed', 'rescheduled')) THEN
    INSERT INTO public.consultation_rooms (appointment_id)
    VALUES (NEW.id)
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_room_on_confirmation ON public.appointments;
CREATE TRIGGER trg_create_room_on_confirmation
AFTER UPDATE OR INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_consultation_room();

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.consultation_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created
  ON public.messages(room_id, created_at);

-- Notarial requests
CREATE TABLE IF NOT EXISTS public.notarial_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attorney_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  service_type text NOT NULL,
  details text,
  document_url text,
  preferred_date timestamptz,
  status request_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notarial_client ON public.notarial_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_notarial_attorney ON public.notarial_requests(attorney_id);
CREATE INDEX IF NOT EXISTS idx_notarial_status ON public.notarial_requests(status);

CREATE TRIGGER trg_notarial_requests_updated_at
BEFORE UPDATE ON public.notarial_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Payments and payout tracking
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attorney_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'PHP',
  payment_method text,
  payment_status payment_status NOT NULL DEFAULT 'pending',
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_client ON public.transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_transactions_attorney ON public.transactions(attorney_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(payment_status);

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attorney_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  status payout_status NOT NULL DEFAULT 'requested',
  payout_reference text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_attorney ON public.payout_requests(attorney_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON public.payout_requests(status);

CREATE TRIGGER trg_payout_requests_updated_at
BEFORE UPDATE ON public.payout_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

CREATE TRIGGER trg_notifications_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Post-consultation feedback (one row per appointment; client submits after room is closed)
CREATE TABLE IF NOT EXISTS public.consultation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attorney_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultation_feedback_appointment_unique UNIQUE (appointment_id)
);

-- Denormalized for public profile cards (avoids joining profiles, which are RLS-restricted)
ALTER TABLE public.consultation_feedback ADD COLUMN IF NOT EXISTS client_display_name text;

CREATE INDEX IF NOT EXISTS idx_consultation_feedback_attorney
  ON public.consultation_feedback(attorney_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_consultation_feedback_client
  ON public.consultation_feedback(client_id, created_at DESC);

-- Audit logs for failed login tracking (standalone, no FK needed)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  attempt_time timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_email_time
  ON public.audit_logs(email, attempt_time DESC);

-- ============================================================
-- Enable Row Level Security
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attorney_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notarial_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Row Level Security Policies
-- ============================================================

-- Profiles policies
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Attorney profile policies
DROP POLICY IF EXISTS "attorney_profiles_select_all_auth" ON public.attorney_profiles;
CREATE POLICY "attorney_profiles_select_all_auth"
ON public.attorney_profiles FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "attorney_profiles_owner_write" ON public.attorney_profiles;
CREATE POLICY "attorney_profiles_owner_write"
ON public.attorney_profiles FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Availability policies
DROP POLICY IF EXISTS "availability_select_all_auth" ON public.availability_slots;
CREATE POLICY "availability_select_all_auth"
ON public.availability_slots FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "availability_owner_write" ON public.availability_slots;
CREATE POLICY "availability_owner_write"
ON public.availability_slots FOR ALL
USING (auth.uid() = attorney_id)
WITH CHECK (auth.uid() = attorney_id);

-- Appointment policies
DROP POLICY IF EXISTS "appointments_participant_select" ON public.appointments;
CREATE POLICY "appointments_participant_select"
ON public.appointments FOR SELECT
USING (auth.uid() = client_id OR auth.uid() = attorney_id);

DROP POLICY IF EXISTS "appointments_client_insert" ON public.appointments;
CREATE POLICY "appointments_client_insert"
ON public.appointments FOR INSERT
WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "appointments_participant_update" ON public.appointments;
CREATE POLICY "appointments_participant_update"
ON public.appointments FOR UPDATE
USING (auth.uid() = client_id OR auth.uid() = attorney_id)
WITH CHECK (auth.uid() = client_id OR auth.uid() = attorney_id);

-- Consultation room policies
DROP POLICY IF EXISTS "rooms_participant_select" ON public.consultation_rooms;
CREATE POLICY "rooms_participant_select"
ON public.consultation_rooms FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = consultation_rooms.appointment_id
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "rooms_management_update" ON public.consultation_rooms;
CREATE POLICY "rooms_management_update"
ON public.consultation_rooms FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = consultation_rooms.appointment_id
      AND a.attorney_id = auth.uid()
  )
);

-- Message policies
DROP POLICY IF EXISTS "messages_participant_select" ON public.messages;
CREATE POLICY "messages_participant_select"
ON public.messages FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.consultation_rooms r
    JOIN public.appointments a ON a.id = r.appointment_id
    WHERE r.id = messages.room_id
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "messages_participant_insert" ON public.messages;
CREATE POLICY "messages_participant_insert"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id 
  AND EXISTS (
    SELECT 1 FROM public.consultation_rooms r
    JOIN public.appointments a ON a.id = r.appointment_id
    WHERE r.id = messages.room_id
      AND r.is_closed = false
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

-- Consultation feedback policies
DROP POLICY IF EXISTS "consultation_feedback_client_select" ON public.consultation_feedback;
CREATE POLICY "consultation_feedback_client_select"
ON public.consultation_feedback FOR SELECT
USING (auth.uid() = client_id);

DROP POLICY IF EXISTS "consultation_feedback_attorney_select" ON public.consultation_feedback;
CREATE POLICY "consultation_feedback_attorney_select"
ON public.consultation_feedback FOR SELECT
USING (auth.uid() = attorney_id);

DROP POLICY IF EXISTS "consultation_feedback_client_insert" ON public.consultation_feedback;
CREATE POLICY "consultation_feedback_client_insert"
ON public.consultation_feedback FOR INSERT
WITH CHECK (
  auth.uid() = client_id
  AND EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.consultation_rooms r ON r.appointment_id = a.id
    WHERE a.id = consultation_feedback.appointment_id
      AND a.client_id = auth.uid()
      AND a.attorney_id = consultation_feedback.attorney_id
      AND r.is_closed = true
  )
);

-- Authenticated users can read feedback (attorney profile "Recent Client Feedback")
DROP POLICY IF EXISTS "consultation_feedback_select_auth_directory" ON public.consultation_feedback;
CREATE POLICY "consultation_feedback_select_auth_directory"
ON public.consultation_feedback FOR SELECT
TO authenticated
USING (true);

-- Notarial request policies
DROP POLICY IF EXISTS "notarial_owner_select" ON public.notarial_requests;
CREATE POLICY "notarial_owner_select"
ON public.notarial_requests FOR SELECT
USING (auth.uid() = client_id OR auth.uid() = attorney_id);

DROP POLICY IF EXISTS "notarial_client_insert" ON public.notarial_requests;
CREATE POLICY "notarial_client_insert"
ON public.notarial_requests FOR INSERT
WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "notarial_participant_update" ON public.notarial_requests;
CREATE POLICY "notarial_participant_update"
ON public.notarial_requests FOR UPDATE
USING (auth.uid() = client_id OR auth.uid() = attorney_id)
WITH CHECK (auth.uid() = client_id OR auth.uid() = attorney_id);

-- Transaction policies
DROP POLICY IF EXISTS "transactions_participant_select" ON public.transactions;
CREATE POLICY "transactions_participant_select"
ON public.transactions FOR SELECT
USING (auth.uid() = client_id OR auth.uid() = attorney_id);

DROP POLICY IF EXISTS "transactions_client_insert" ON public.transactions;
CREATE POLICY "transactions_client_insert"
ON public.transactions FOR INSERT
WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "transactions_participant_update" ON public.transactions;
CREATE POLICY "transactions_participant_update"
ON public.transactions FOR UPDATE
USING (auth.uid() = client_id OR auth.uid() = attorney_id)
WITH CHECK (auth.uid() = client_id OR auth.uid() = attorney_id);

-- Payout policies
DROP POLICY IF EXISTS "payout_owner_select" ON public.payout_requests;
CREATE POLICY "payout_owner_select"
ON public.payout_requests FOR SELECT
USING (auth.uid() = attorney_id);

DROP POLICY IF EXISTS "payout_owner_insert" ON public.payout_requests;
CREATE POLICY "payout_owner_insert"
ON public.payout_requests FOR INSERT
WITH CHECK (auth.uid() = attorney_id);

DROP POLICY IF EXISTS "payout_owner_update" ON public.payout_requests;
CREATE POLICY "payout_owner_update"
ON public.payout_requests FOR UPDATE
USING (auth.uid() = attorney_id)
WITH CHECK (auth.uid() = attorney_id);

-- Notification policies
DROP POLICY IF EXISTS "notifications_owner_select" ON public.notifications;
CREATE POLICY "notifications_owner_select"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Audit log policies (allow any authenticated user to insert, only service role reads)
DROP POLICY IF EXISTS "audit_logs_insert_auth" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_auth"
ON public.audit_logs FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "audit_logs_select_none" ON public.audit_logs;
CREATE POLICY "audit_logs_select_none"
ON public.audit_logs FOR SELECT
USING (false);

-- Function to mark an availability slot as booked regardless of RLS
CREATE OR REPLACE FUNCTION public.mark_slot_booked(p_attorney_id uuid, p_date date, p_time varchar)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.availability_slots
  SET is_booked = true
  WHERE attorney_id = p_attorney_id AND date = p_date AND time = p_time;
END;
$$;

-- Clear booking flag when consultation is done / cancelled (SECURITY DEFINER so clients can release via app)
CREATE OR REPLACE FUNCTION public.release_slot_booked(p_attorney_id uuid, p_date date, p_time varchar)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.availability_slots
  SET is_booked = false, updated_at = now()
  WHERE attorney_id = p_attorney_id AND date = p_date AND time = p_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_availability_slot_by_id(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.availability_slots
  SET is_booked = false, updated_at = now()
  WHERE id = p_slot_id;
END;
$$;

-- Client booking: RLS only allows attorneys to UPDATE rows directly — clients must claim via DEFINER.
CREATE OR REPLACE FUNCTION public.claim_availability_slot_by_id(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE public.availability_slots
  SET is_booked = true, updated_at = now()
  WHERE id = p_slot_id AND is_booked = false;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_availability_slot_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_availability_slot_by_id(uuid) TO authenticated;

-- Expo push token for client devices (optional; used by send-reschedule-push Edge Function)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expo_push_token text;

-- ---------------------------------------------------------------------------
-- Chat: typed messages + attachments (run in SQL Editor if DB already exists)
-- ---------------------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_bucket text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_size_bytes bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_message_type_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'file'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_room_nontext
  ON public.messages (room_id)
  WHERE message_type IS DISTINCT FROM 'text';

CREATE OR REPLACE VIEW public.conversations AS
SELECT id, appointment_id, is_closed, created_at, updated_at
FROM public.consultation_rooms;

-- Realtime: add messages + consultation_rooms to supabase_realtime publication (no-op if already member)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.consultation_rooms;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Storage: private buckets for chat uploads (path: appointment_id/user_id/filename)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('chat-images', 'chat-images', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]),
  ('chat-files', 'chat-files', false, 26214400, NULL)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "chat_images_select" ON storage.objects;
CREATE POLICY "chat_images_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-images'
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = (split_part(name, '/', 1))::uuid
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_images_insert" ON storage.objects;
CREATE POLICY "chat_images_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-images'
  AND (split_part(name, '/', 2))::uuid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = (split_part(name, '/', 1))::uuid
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_images_delete" ON storage.objects;
CREATE POLICY "chat_images_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-images'
  AND (split_part(name, '/', 2))::uuid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = (split_part(name, '/', 1))::uuid
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_files_select" ON storage.objects;
CREATE POLICY "chat_files_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-files'
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = (split_part(name, '/', 1))::uuid
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_files_insert" ON storage.objects;
CREATE POLICY "chat_files_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-files'
  AND (split_part(name, '/', 2))::uuid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = (split_part(name, '/', 1))::uuid
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "chat_files_delete" ON storage.objects;
CREATE POLICY "chat_files_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-files'
  AND (split_part(name, '/', 2))::uuid = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = (split_part(name, '/', 1))::uuid
      AND (a.client_id = auth.uid() OR a.attorney_id = auth.uid())
  )
);
