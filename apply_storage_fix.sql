-- ==============================================================================
-- FIX FOR DRIVER DOCUMENT UPLOADS (ROW-LEVEL SECURITY)
-- ==============================================================================
-- 1. Keeps the 'driver-documents' bucket strictly PRIVATE (public = false).
-- 2. Keeps Row-Level Security (RLS) ENABLED on storage.objects.
-- 3. Does NOT depend on any specific table name (prevents 42P01 relation errors).
-- 4. Strictly scoped ONLY to bucket_id = 'driver-documents' (never affects customer/vendor buckets).
-- ==============================================================================

-- 1. Ensure the driver-documents bucket exists and remains PRIVATE
INSERT INTO storage.buckets (id, name, public)
VALUES ('driver-documents', 'driver-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Drop any previous / failing policies on driver-documents
DROP POLICY IF EXISTS "Drivers can upload their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Drivers can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Drivers can read their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow driver document uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow driver document updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow driver document reads" ON storage.objects;

-- 3. Policy: Allow uploads to driver-documents bucket
CREATE POLICY "Allow driver document uploads"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'driver-documents'
);

-- 4. Policy: Allow update/upsert to driver-documents bucket
CREATE POLICY "Allow driver document updates"
ON storage.objects FOR UPDATE
TO public
USING (
  bucket_id = 'driver-documents'
)
WITH CHECK (
  bucket_id = 'driver-documents'
);

-- 5. Policy: Allow reads for driver-documents bucket (needed for signed URLs & download)
CREATE POLICY "Allow driver document reads"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'driver-documents'
);
