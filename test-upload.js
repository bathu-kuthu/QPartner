const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://zoatdppograoxpgifhbl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvYXRkcHBvZ3Jhb3hwZ2lmaGJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDEwMzMsImV4cCI6MjA5MDQ3NzAzM30.2uanxlSn2zclvd5Be1yNzOymwKqvBXY0qkIigVMPCTQ'
);

async function testUpload() {
  const { data: authData, error: authErr } = await supabase.auth.signInAnonymously();
  if (authErr) {
    console.error('Auth error:', authErr);
    return;
  }
  const uid = authData.user.id;
  console.log('Anonymous UID:', uid);

  const { error: uploadErr } = await supabase.storage
    .from('driver-documents')
    .upload(`${uid}/test.txt`, 'Hello World!', { upsert: true });

  if (uploadErr) {
    console.error('Upload error with UID folder:', uploadErr.message);
  } else {
    console.log('Upload SUCCESS with UID folder!');
  }
  
  // also test with a random folder
  const { error: uploadErr2 } = await supabase.storage
    .from('driver-documents')
    .upload(`random-driver-123/test.txt`, 'Hello World!', { upsert: true });
    
  if (uploadErr2) {
    console.log('Upload to random folder failed (expected):', uploadErr2.message);
  } else {
    console.log('Upload to random folder SUCCESS (Wait, is the bucket public?)');
  }
}

testUpload();
