const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://zoatdppograoxpgifhbl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvYXRkcHBvZ3Jhb3hwZ2lmaGJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDEwMzMsImV4cCI6MjA5MDQ3NzAzM30.2uanxlSn2zclvd5Be1yNzOymwKqvBXY0qkIigVMPCTQ'
);

async function testUpload() {
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: 'test_driver_' + Date.now() + '@qpartner.com',
    password: 'SecurePassword123!'
  });
  
  if (authErr) {
    console.error('Signup error:', authErr);
    return;
  }
  const uid = authData.user.id;
  console.log('Signup UID:', uid);

  const { error: uploadErr } = await supabase.storage
    .from('driver-documents')
    .upload(`${uid}/test.txt`, 'Hello World!', { upsert: true });

  if (uploadErr) {
    console.error('Upload error with UID folder:', uploadErr.message);
  } else {
    console.log('Upload SUCCESS with UID folder!');
  }
}

testUpload();
