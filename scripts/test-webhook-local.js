// Local webhook simulator — feeds the handler the exact Telegram payload
// IMPORTANT: Load secrets from .env.local, never hardcode them in this file.
import { createServer } from 'http';
import 'dotenv/config';

// Validate required env vars
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ Set TELEGRAM_BOT_TOKEN in .env.local before running this script');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local');
  process.exit(1);
}

const module = await import('../api/telegram.js');
const handler = module.default;

function makeReq(body) {
  return {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' }
  };
}

function makeRes() {
  let code = null;
  let sent = null;
  return {
    status(c) { code = c; return this; },
    send(d) { sent = d; console.log(`[RES] status=${code} body="${d}"`); return this; },
    json(d) { sent = d; console.log(`[RES] status=${code} body=${JSON.stringify(d)}`); return this; }
  };
}

const scenarios = [
  {
    name: 'Mention + natural language',
    body: {
      message: {
        message_id: 1,
        from: { id: 123456789, first_name: 'Test', is_bot: false, username: 'testuser' },
        chat: { id: -1003775841452, type: 'supergroup' },
        date: 1777243331,
        text: '@johnsonlighthouse_bot what is the price of BTC?'
      }
    }
  },
  {
    name: 'Reply to bot message',
    body: {
      message: {
        message_id: 2,
        from: { id: 123456789, first_name: 'Test', is_bot: false, username: 'testuser' },
        chat: { id: -1003775841452, type: 'supergroup' },
        date: 1777243331,
        text: 'what is the price of BTC?',
        reply_to_message: {
          message_id: 100,
          from: { id: 8772102071, is_bot: true, first_name: 'johnson care', username: 'johnsonlighthouse_bot' },
          chat: { id: -1003775841452, type: 'supergroup' },
          date: 1777243300,
          text: 'Previous bot message'
        }
      }
    }
  },
  {
    name: 'Leading mention with slash command',
    body: {
      message: {
        message_id: 3,
        from: { id: 123456789, first_name: 'Test', is_bot: false },
        chat: { id: -1003775841452, type: 'supergroup' },
        date: 1777243331,
        text: '@johnsonlighthouse_bot /market BTC'
      }
    }
  },
  {
    name: 'Inline mention /market@bot',
    body: {
      message: {
        message_id: 4,
        from: { id: 123456789, first_name: 'Test', is_bot: false },
        chat: { id: -1003775841452, type: 'supergroup' },
        date: 1777243331,
        text: '/market@johnsonlighthouse_bot BTC'
      }
    }
  },
  {
    name: 'Plain /test command (no mention)',
    body: {
      message: {
        message_id: 5,
        from: { id: 123456789, first_name: 'Test', is_bot: false },
        chat: { id: -1003775841452, type: 'supergroup' },
        date: 1777243331,
        text: '/test'
      }
    }
  },
  {
    name: 'Empty mention (bot tagged with no text)',
    body: {
      message: {
        message_id: 6,
        from: { id: 123456789, first_name: 'Test', is_bot: false },
        chat: { id: -1003775841452, type: 'supergroup' },
        date: 1777243331,
        text: '@johnsonlighthouse_bot'
      }
    }
  },
  {
    name: 'Callback query (sig_confirm)',
    body: {
      callback_query: {
        id: 'cq_123',
        from: { id: 123456789, first_name: 'Test', is_bot: false },
        message: {
          message_id: 10,
          chat: { id: -1003775841452, type: 'supergroup' },
          date: 1777243300,
          text: 'Signal message'
        },
        data: 'sig_confirm_00000000-0000-0000-0000-000000000000'
      }
    }
  }
];

for (const s of scenarios) {
  console.log(`\n=== SCENARIO: ${s.name} ===`);
  try {
    await handler(makeReq(s.body), makeRes());
  } catch (err) {
    console.error(`[CRASH] ${err.name}: ${err.message}`);
    console.error(err.stack);
  }
}

console.log('\n=== All scenarios completed ===');
