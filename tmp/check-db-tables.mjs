const TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN || 'sbp_placeholder_replace_me';

async function q(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/nqcgnwpfxnbtdrvtkwej/database/query', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  return await r.json();
}

async function main() {
  const tables = await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  if (!Array.isArray(tables)) {
    console.log('ERROR: tables response is not an array:', JSON.stringify(tables));
    return;
  }
  console.log('=== ROW COUNTS ===');
  for (const t of tables) {
    const c = await q('SELECT COUNT(*) as cnt FROM "' + t.table_name + '"');
    const cnt = Array.isArray(c) ? c[0]?.cnt : c?.cnt || '?';
    console.log(t.table_name + ': ' + cnt);
  }
}
main().catch(e => console.log('Error:', e.message));
