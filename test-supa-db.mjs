import { getResearchAgentCounts } from './lib/ml/supabase-db.js';
try {
  const c = await getResearchAgentCounts();
  console.log('RESULT:', JSON.stringify(c, null, 2));
} catch (e) {
  console.error('ERROR:', e.message);
}
