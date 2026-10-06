-- Run this SQL in your Supabase SQL Editor

-- 1. Add auth_id column to link Supabase Auth with your custom users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auth_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Create the Storage Bucket if it doesn't exist, or just ensure it is configured
INSERT INTO storage.buckets (id, name, public) 
VALUES ('driver-documents', 'driver-documents', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Drop any existing restrictive or public policies on the bucket
DROP POLICY IF EXISTS "Drivers can upload their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Drivers can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Drivers can read their own documents" ON storage.objects;

-- 4. Create secure RLS policies ensuring drivers can only upload to their own folder
CREATE POLICY "Drivers can upload their own documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'driver-documents' AND
  (SELECT auth_id FROM public.users WHERE id::text = (string_to_array(name, '/'))[1]) = auth.uid()
);

CREATE POLICY "Drivers can update their own documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'driver-documents' AND
  (SELECT auth_id FROM public.users WHERE id::text = (string_to_array(name, '/'))[1]) = auth.uid()
);

CREATE POLICY "Drivers can read their own documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'driver-documents' AND
  (SELECT auth_id FROM public.users WHERE id::text = (string_to_array(name, '/'))[1]) = auth.uid()
);

-- 5. Create a secure RPC to link the Supabase Auth session with the custom driver profile
CREATE OR REPLACE FUNCTION secure_driver_login(p_phone text, p_otp text, p_auth_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_otp_data record;
  v_user record;
BEGIN
  -- Verify OTP
  SELECT * INTO v_otp_data
  FROM public.otp
  WHERE phone = p_phone AND otp = p_otp;

  IF NOT FOUND OR v_otp_data.expires_at < NOW() THEN
    RAISE EXCEPTION 'Invalid or expired OTP';
  END IF;

  -- Verify User
  SELECT * INTO v_user
  FROM public.users
  WHERE phone = p_phone AND is_driver = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  -- Securely link the Auth ID
  UPDATE public.users SET auth_id = p_auth_id WHERE id = v_user.id;

  RETURN to_jsonb(v_user);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
