import '../lib/env.js';
import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Last 10 signals
const { data: signals } = await supabase
  .from('signals')
  .select('id,symbol,side,status,confidence,generated_at,valid_until,mode,source,metadata')
  .order('generated_at', { ascending: false })
  .limit(10);

console.log('=== Last 10 signals ===');
for (const s of signals || []) {
  const now = Date.now();
  const validUntil = s.valid_until ? new Date(s.valid_until).getTime() : null;
  const isValid = validUntil ? validUntil >= now : true;
  const processed = s.metadata?.processed === true;
  console.log(`${s.id.slice(0,8)} ${s.symbol} ${s.side} status=${s.status} conf=${s.confidence} gen=${s.generated_at} valid=${validUntil ? new Date(validUntil).toISOString() : 'null'} expired=${!isValid} processed=${processed} source=${s.source}`);
}

// Count active non-expired signals
const now = new Date().toISOString();
const { count: activeCount } = await supabase
  .from('signals')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'active')
  .or(`valid_until.is.null,valid_until.gte.${now}`);
console.log(`\nActive non-expired signals: ${activeCount}`);

// Check what signal generators are running
const { data: workers } = await supabase
  .from('signals')
  .select('source')
  .order('generated_at', { ascending: false })
  .limit(50);
const sources = {};
for (const w of workers || []) {
  sources[w.source] = (sources[w.source] || 0) + 1;
}
console.log('\nSignal sources (last 50):');
for (const [k, v] of Object.entries(sources)) {
  console.log(`  ${k}: ${v}`);
}
