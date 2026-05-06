const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://nqcgnwpfxnbtdrvtkwej.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xY2dud3BmeG5idGRydnRrd2VqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIxMDI3NCwiZXhwIjoyMDkyNzg2Mjc0fQ.X3N2peEGhK2_WEwiuVC3gLX930dTce4Y_OonbfZ9HhY';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const tables = [
    'research_sources',
    'strategy_proposals',
    'backtest_results',
    'strategy_lifecycle',
    'mock_strategy_feedback',
    'perp_trade_history',
    'perp_research_insights',
    'perp_daily_summary'
  ];
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true });
      if (error) {
        console.log(table + ': MISSING - ' + error.message);
      } else {
        console.log(table + ': OK (count=' + (data || 0) + ')');
      }
    } catch (e) {
      console.log(table + ': ERROR - ' + e.message);
    }
  }
}
main().catch(e => console.error('FATAL:', e));
