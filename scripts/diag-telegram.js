// Quick Telegram diagnostics — no external deps
// Reads TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID from environment.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID  = process.env.TELEGRAM_GROUP_CHAT_ID;

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
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
  console.log(JSON.stringify(me, null, 2));

  // 2. getWebhookInfo
  console.log('\n2. getWebhookInfo (webhook status)');
  const wh = await tg('getWebhookInfo', {});
  console.log(JSON.stringify(wh, null, 2));

  // 3. Send test message
  if (GROUP_ID) {
    console.log(`\n3. sendMessage to GROUP_ID=${GROUP_ID}`);
    const msg = await tg('sendMessage', {
      chat_id: GROUP_ID,
      text: '🔧 Diagnostic test message.',
      parse_mode: 'Markdown'
    });
    console.log(JSON.stringify(msg, null, 2));
  } else {
    console.log('\n3. sendMessage skipped (TELEGRAM_GROUP_CHAT_ID not set)');
  }

  console.log('\n=== Done ===');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
