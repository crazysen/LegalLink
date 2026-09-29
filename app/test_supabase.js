const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sjmmyqeqiigmclcgcadr.supabase.co', 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);
async function test() {
  const { data, error } = await supabase.from('notarial_requests').insert({
    client_id: 'd9b75487-7359-4673-8991-628b0dc23971', 
    attorney_id: 'd9b75487-7359-4673-8991-628b0dc23971',
    service_type: 'Affidavit of Loss',
    status: 'pending',
  }).select();
  console.log('Data:', data);
  console.log('Error:', error);
}
test();
