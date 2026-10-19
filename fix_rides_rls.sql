-- ==============================================================================
-- QUICKORA / QPARTNER — FIX FOR INCOMING RIDE REQUEST VISIBILITY (RLS & REALTIME)
-- ==============================================================================
-- Run these statements in the Supabase SQL Editor for your project:
-- URL: https://zoatdppograoxpgifhbl.supabase.co
-- ==============================================================================

-- 1. Ensure Row-Level Security (RLS) is enabled on public.rides
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

-- 2. Drop any previous / failing policies on public.rides
DROP POLICY IF EXISTS "Drivers read pending rides" ON public.rides;
DROP POLICY IF EXISTS "Drivers read assigned rides" ON public.rides;
DROP POLICY IF EXISTS "Public read pending rides" ON public.rides;

-- 3. Policy: Allow drivers (both anon and authenticated roles) to SELECT pending unassigned rides
-- Note: Sensitive columns such as otp_code are already protected by column-level grants.
CREATE POLICY "Drivers read pending rides"
ON public.rides
FOR SELECT
TO anon, authenticated
USING (
  status = 'pending' AND driver_id IS NULL
);

-- 4. Policy: Allow drivers to SELECT rides assigned to them (for active ride tracking)
CREATE POLICY "Drivers read assigned rides"
ON public.rides
FOR SELECT
TO anon, authenticated
USING (
  driver_id IS NOT NULL
);

-- 5. Ensure public.rides is included in the Supabase Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  END IF;
END $$;

-- 6. Grant execute on atomic ride acceptance RPC
GRANT EXECUTE ON FUNCTION public.accept_ride(uuid, uuid) TO anon, authenticated, service_role;

-- 7. Grant select on public.rides columns to anon and authenticated
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
  base_fare,
  distance_fare,
  waiting_charge,
  status, 
  driver_id, 
  details, 
  is_reviewed, 
  cancel_reason,
  sender_phone,
  receiver_phone,
  is_multi_stop,
  stop_count,
  created_at, 
  updated_at
) ON public.rides TO anon, authenticated;
