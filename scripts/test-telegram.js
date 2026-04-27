// Local Telegram diagnostics — run with: node scripts/test-telegram.js
// Requires TELEGRAM_BOT_TOKEN and optionally TELEGRAM_GROUP_CHAT_ID in env.
import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID  = process.env.TELEGRAM_GROUP_CHAT_ID;

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function main() {
  console.log('=== Telegram Bot Diagnostics ===\n');

  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is missing. Set it in .env or environment.');
    process.exit(1);
  }

  // 1. getMe
  console.log('1. getMe (bot identity)');
  const me = await tg('getMe', {});
  if (me.ok) {
    console.log(`   ✅ @${me.result.username} (id: ${me.result.id})`);
  } else {
    console.log(`   ❌ Error: ${me.description}`);
  }

  // 2. getWebhookInfo
  console.log('\n2. getWebhookInfo (webhook status)');
  const wh = await tg('getWebhookInfo', {});
  if (wh.ok) {
    const r = wh.result;
    console.log(`   URL: ${r.url || '(not set)'}`);
    console.log(`   Pending updates: ${r.pending_update_count}`);
    if (r.last_error_message) {
      console.log(`   ⚠️ Last error: ${r.last_error_message}`);
    }
  } else {
    console.log(`   ❌ Error: ${wh.description}`);
  }

  // 3. Send test message
  if (GROUP_ID) {
    console.log(`\n3. sendMessage to GROUP_ID=${GROUP_ID}`);
    const msg = await tg('sendMessage', {
      chat_id: GROUP_ID,
      text: '🔧 Diagnostic test message from local script.',
      parse_mode: 'Markdown'
    });
    if (msg.ok) {
      console.log(`   ✅ Message sent (msg_id: ${msg.result.message_id})`);
    } else {
      console.log(`   ❌ Error: ${msg.description}`);
      if (msg.description?.includes('chat not found')) {
        console.log('   💡 Tip: Make sure the bot is a member of the group/chat and the GROUP_ID is correct.');
      }
      if (msg.description?.includes('blocked')) {
        console.log('   💡 Tip: The bot was blocked by the user. Unblock it in Telegram settings.');
      }
    }
  } else {
    console.log('\n3. sendMessage skipped (TELEGRAM_GROUP_CHAT_ID not set)');
  }

  console.log('\n=== Done ===');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
