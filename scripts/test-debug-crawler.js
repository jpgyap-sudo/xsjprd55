import { runStaticAnalysis } from '../lib/debug/static-analyzer.js';
import { classifyHttpError, safeKeyStatus } from '../lib/api-debugger/api-error-classifier.js';

console.log('=== API Error Classifier ===');
console.log('safeKeyStatus:', safeKeyStatus('sk-1234567890abcdef'));
console.log('401:', classifyHttpError({ provider: 'kimi', httpCode: 401 }));
console.log('429:', classifyHttpError({ provider: 'kimi', httpCode: 429 }));

console.log('\n=== Static Analyzer ===');
const files = [
  { path: 'api/test.js', content: 'eval(userInput); // dangerous\nfetch(url)' },
  { path: 'lib/db.js', content: 'db.query("SELECT * FROM users WHERE id = \'" + id + "\'")' },
  { path: 'server.js', content: 'console.log(process.env.SECRET_KEY);\nasync function x() { return 1; }' }
];
const f = runStaticAnalysis(files);
console.log('Findings:', f.length);
f.forEach(x => console.log('-', x.severity, x.title));
