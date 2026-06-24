-- Quickora Database Schema Updates
-- Run these statements in your Supabase SQL Editor.

-- =========================================================================
-- 1. SECURE OTP VERIFICATION RPC
-- =========================================================================
-- Verifies the entered OTP code against the database.
-- Defined with SECURITY DEFINER to bypass column-level SELECT restrictions.
CREATE OR REPLACE FUNCTION verify_ride_otp(p_ride_id uuid, p_entered_otp text)
RETURNS boolean AS $$
DECLARE
  v_otp_code text;
BEGIN
  -- Select the OTP code. This function runs with owner privileges (SECURITY DEFINER).
  SELECT otp_code::text INTO v_otp_code FROM public.rides WHERE id = p_ride_id;
  
  -- If no OTP code is set, let it pass (legacy rides support)
  IF v_otp_code IS NULL THEN
    RETURN true;
  END IF;

  RETURN v_otp_code = p_entered_otp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 2. COLUMN-LEVEL PRIVILEGES (BLOCKING DIRECT OTP READ)
-- =========================================================================
-- Revoke broad table-level SELECT on rides table from client roles (anon/authenticated)
-- to prevent clients from fetching otp_code directly.
REVOKE SELECT ON public.rides FROM public, anon, authenticated;

-- Grant select permission ONLY to specific columns (excluding otp_code)
GRANT SELECT (
  id, 
  user_id, 
  service_type, 
  pickup_location, 
  drop_location, 
  pickup_address, 
  drop_address, 
  distance_km, 
  fare, 
  status, 
  driver_id, 
  details, 
  is_reviewed, 
  created_at, 
  updated_at
) ON public.rides TO anon, authenticated;

-- =========================================================================
-- 3. ATOMIC RIDE ACCEPTANCE RPC (FOR UPDATE SKIP LOCKED)
-- =========================================================================
-- Locks a pending ride row, checks if the driver already has an active ride,
-- and assigns the driver atomically in a single database transaction.
CREATE OR REPLACE FUNCTION accept_ride(p_ride_id uuid, p_driver_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_has_active boolean;
  v_ride RECORD;
  v_user RECORD;
  v_result jsonb;
BEGIN
  -- A. Check if the driver has an active ride already
  SELECT EXISTS (
    SELECT 1 FROM public.rides
    WHERE driver_id = p_driver_id
      AND status IN ('accepted', 'picked_up', 'on_ride')
  ) INTO v_has_active;

  IF v_has_active THEN
    RAISE EXCEPTION 'You already have an active ride';
  END IF;

  -- B. Acquire lock on the target ride row.
  -- FOR UPDATE SKIP LOCKED locks the row instantly. If another driver locks it
  -- at the same microsecond, their call succeeds and this call skips it (returning no row).
  SELECT * INTO v_ride
  FROM public.rides
  WHERE id = p_ride_id
    AND status = 'pending'
    AND driver_id IS NULL
  FOR UPDATE SKIP LOCKED;

  IF v_ride IS NULL THEN
    RAISE EXCEPTION 'Ride no longer available';
  END IF;

  -- C. Update driver_id and status to accepted
  UPDATE public.rides
  SET driver_id = p_driver_id,
      status = 'accepted',
      updated_at = NOW()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  -- D. Fetch rider details to return to the driver app
  SELECT phone, name INTO v_user
  FROM public.users
  WHERE id = v_ride.user_id;

  -- E. Construct standard Ride JSON payload including the user field
  SELECT to_jsonb(v_ride) || jsonb_build_object('user', jsonb_build_object('phone', v_user.phone, 'name', v_user.name)) INTO v_result;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 4. ATOMIC RIDE COMPLETION TRANSACTION RPC
-- =========================================================================
-- Inserts the driver's earnings and increments their total_rides count atomically.
CREATE OR REPLACE FUNCTION complete_driver_ride(
  p_ride_id uuid,
  p_driver_id uuid,
  p_earnings_amount numeric
)
RETURNS void AS $$
BEGIN
  -- A. Insert the earnings record
  INSERT INTO public.driver_earnings (driver_id, ride_id, amount, created_at)
  VALUES (p_driver_id, p_ride_id, p_earnings_amount, NOW());

  -- B. Increment the total rides counter in users table
  UPDATE public.users
  SET total_rides = COALESCE(total_rides, 0) + 1,
      updated_at = NOW()
  WHERE id = p_driver_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
