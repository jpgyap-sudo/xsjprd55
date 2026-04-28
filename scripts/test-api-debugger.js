import { safeKeyStatus, classifyHttpError } from '../lib/api-debugger/api-error-classifier.js';
import { testKimiApi, testClaudeApi, testInternalEndpoints } from '../lib/api-debugger/api-live-tester.js';

console.log('=== API Debugger Unit Tests ===\n');

// Error classifier
console.log('safeKeyStatus:', safeKeyStatus('sk-test12345'));
console.log('401:', classifyHttpError({ provider: 'kimi', httpCode: 401 }).category);
console.log('429:', classifyHttpError({ provider: 'kimi', httpCode: 429 }).category);
console.log('timeout:', classifyHttpError({ provider: 'kimi', error: new Error('ETIMEDOUT') }).category);
console.log('DNS:', classifyHttpError({ provider: 'claude', error: new Error('ENOTFOUND api.anthropic.com') }).category);
console.log('TLS:', classifyHttpError({ provider: 'claude', error: new Error('certificate has expired') }).category);

// Live tester (will show key-missing errors without real keys)
console.log('\n--- Kimi API (no key) ---');
try {
  const k = await testKimiApi();
  console.log(k.provider, k.status, k.error_category, k.severity);
} catch (e) { console.error('Kimi test error:', e.message); }

console.log('\n--- Claude API (no key) ---');
try {
  const c = await testClaudeApi();
  console.log(c.provider, c.status, c.error_category, c.severity);
} catch (e) { console.error('Claude test error:', e.message); }

console.log('\n--- Internal Endpoints ---');
try {
  const i = await testInternalEndpoints();
  i.forEach(r => console.log(r.provider, r.endpoint, r.status, r.http_code));
} catch (e) { console.error('Internal test error:', e.message); }

console.log('\nAll tests completed.');
