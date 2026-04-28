// ============================================================
// Bug Submitter — Routes findings to Supabase or API
// ============================================================

import { bulkCreateBugReports } from '../bug-store.js';

export async function submitFindingsToLocalDb(findings) {
  return await bulkCreateBugReports(findings);
}

export async function submitFindingsToApi(findings) {
  const baseUrl = process.env.DEBUG_CRAWLER_API_BASE_URL || 'http://localhost:3000';
  const secret = process.env.CRON_SECRET;

  if (!secret) throw new Error('CRON_SECRET is required for API submission');

  const response = await fetch(
    `${baseUrl}/api/bugs?type=bulk-create&secret=${encodeURIComponent(secret)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findings })
    }
  );

  if (!response.ok) {
    throw new Error(`Bug API submit failed HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}
