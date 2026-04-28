const fs = require('fs');
const path = 'C:\\Users\\User\\xsjprd55\\server.js';
let content = fs.readFileSync(path, 'utf8');

// Add imports
const importBlock = `import strategyLabsHandler from './api/strategy-labs.js';
import researchAgentHandler from './api/research-agent.js';
import mockFeedbackHandler from './api/mock-feedback.js';`;

if (!content.includes('strategyLabsHandler')) {
  content = content.replace(
    "import socialSentimentHandler from './api/social-sentiment.js';\n",
    "import socialSentimentHandler from './api/social-sentiment.js';\n" + importBlock + "\n"
  );
}

// Add routes
const routeBlock = `  '/api/strategy-labs': strategyLabsHandler,
  '/api/research-agent': researchAgentHandler,
  '/api/mock-feedback': mockFeedbackHandler,`;

if (!content.includes("'/api/strategy-labs'")) {
  content = content.replace(
    "  '/api/social-sentiment/trends': socialSentimentHandler,\n};",
    "  '/api/social-sentiment/trends': socialSentimentHandler,\n" + routeBlock + "\n};"
  );
}

fs.writeFileSync(path, content);
console.log('PATCHED');
