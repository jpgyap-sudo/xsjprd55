# How to Edit and Save .env in Nano (VPS Web Console)

## You're in Nano Right Now

If you see a screen like this at the bottom:
```
^G Get Help   ^O Write Out  ^W Where Is   ^K Cut Text   ^J Justify
^C Cur Pos    ^X Exit       ^R Read File  ^\ Replace    ^U Paste Text
```

You're in **nano** text editor.

---

## How to Paste Your Credentials

1. **Right-click** in the nano window
2. Select **"Paste"** (or press Ctrl+Shift+V)
3. Your credentials will appear in the editor

OR type them manually line by line.

---

## Required Values (Replace ALL "your-..." with real values)

Paste this template and replace with your real values:

```
SUPABASE_URL=https://your-real-project.supabase.co
SUPABASE_ANON_KEY=your-real-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-real-service-role-key
TELEGRAM_BOT_TOKEN=your-real-bot-token
TELEGRAM_WEBHOOK_SECRET=256a6166f3f332cfc3f668af97686a119938fec9e73d567232ccae1bc022c47c
TELEGRAM_ADMIN_USER_ID=your-real-telegram-user-id
TELEGRAM_GROUP_CHAT_ID=your-real-group-chat-id
TRADING_MODE=paper
DEFAULT_EXCHANGE=binance
DEFAULT_SYMBOL=BTCUSDT
DEFAULT_TIMEFRAME=15m
MAX_POSITION_SIZE_USD=100
DAILY_LOSS_LIMIT_USD=50
SIGNAL_COOLDOWN_MINUTES=30
SIGNAL_CONFIDENCE_THRESHOLD=0.70
EMA_SHORT_PERIOD=9
EMA_LONG_PERIOD=21
RSI_PERIOD=14
RSI_OVERBOUGHT=70
RSI_OVERSOLD=30
MARKET_SCAN_INTERVAL_MINUTES=5
HEALTH_CHECK_INTERVAL_MINUTES=30
CRON_SECRET=your-cron-secret-here
LEARNING_LOOP_ENABLED=true
SUGGESTION_AI_ENABLED=true
SUGGESTION_MIN_PATTERNS=20
ANTHROPIC_API_KEY=your-anthropic-api-key
ENABLE_CONTINUOUS_BACKTESTER=true
ENABLE_MOCK_TRADING=true
ENABLE_LEARNING_LOOP=true
ENABLE_NOTIFICATIONS=true
ENABLE_ADVISOR=true
ENABLE_WALLET_TRACKER=true
WALLET_TRACKER_INTERVAL_MS=300000
ENABLE_DIAGNOSTIC_WORKER=true
ENABLE_SOCIAL_CRAWLER_WORKER=true
```

---

## How to Save and Exit

After pasting your credentials:

1. **Press Ctrl+X** (hold Ctrl, press X)
2. Nano asks: `Save modified buffer?`
3. **Press Y** (for Yes)
4. Nano asks: `File Name to Write: .env`
5. **Press Enter** (to confirm the filename)

Done! You're back at the command prompt.

---

## Verify It Saved

Type this to check:
```
cat .env
```

This prints the file contents. Make sure your real values are there (not "your-...").

---

## Quick Nano Commands

| Action | Key |
|---|---|
| Save file | Ctrl+O then Enter |
| Exit nano | Ctrl+X |
| Save and exit | Ctrl+X then Y then Enter |
| Delete line | Ctrl+K |
| Undo | Alt+U |
| Search | Ctrl+W |

---

## Next Step After Saving

Run the health check:
```
node scripts/pre-deploy-check.js
```
