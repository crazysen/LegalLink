-- Run in Supabase SQL Editor (or via supabase db push) if booking fails with:
-- "Could not find the function public.claim_availability_slot_by_id..."
-- RLS allows only attorneys to UPDATE availability_slots; clients must claim via SECURITY DEFINER.

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
