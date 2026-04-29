require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const r1 = await s.from('mock_accounts').select('id,name,starting_balance,current_balance,created_at').limit(1);
  console.log('SELECT data:', JSON.stringify(r1.data));
  console.log('SELECT error:', r1.error ? r1.error.message : 'none');
  const r2 = await s.from('mock_accounts').insert({name:'Execution Optimizer v3',starting_balance:1000000,current_balance:1000000}).select();
  console.log('INSERT data:', JSON.stringify(r2.data));
  console.log('INSERT error code:', r2.error ? r2.error.code : 'none');
  console.log('INSERT error msg:', r2.error ? r2.error.message : 'none');
  const r3 = await s.from('mock_accounts').select('id,name,starting_balance,current_balance,created_at').eq('name','Execution Optimizer v3').maybeSingle();
  console.log('FETCH data:', JSON.stringify(r3.data));
  console.log('FETCH error:', r3.error ? r3.error.message : 'none');
})();
