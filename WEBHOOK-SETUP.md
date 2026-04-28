# TradingView Webhook Alerts — Setup Guide

This guide configures TradingView to send real-time alert signals directly into your bot via webhook.

---

## 1. Prerequisites

- A **TradingView Pro/Pro+/Premium** account (webhooks require paid plan)
- Your bot deployed with a public HTTPS URL
- The `TRADINGVIEW_WEBHOOK_SECRET` env var set in your bot

---

## 2. Bot Endpoint

**URL:** `https://YOUR_DOMAIN/api/webhook/tradingview`

**Method:** `POST`

**Headers:**
```
Content-Type: application/json
x-webhook-secret: YOUR_TRADINGVIEW_WEBHOOK_SECRET
```

**Body Example:**
```json
{
  "symbol": "BTCUSDT",
  "side": "LONG",
  "entry_price": 65000,
  "stop_loss": 64000,
  "take_profit": [67000, 69000],
  "timeframe": "15m",
  "strategy": "EMA_Cross",
  "confidence": 0.82
}
```

---

## 3. TradingView Alert Configuration

1. Open any chart on TradingView
2. Click **Alerts** → **Create Alert**
3. Set **Condition** (e.g., EMA Cross, RSI, etc.)
4. Under **Actions**, check **Webhook URL**
5. Paste: `https://YOUR_DOMAIN/api/webhook/tradingview`
6. In **Message**, paste this JSON template:

```json
{
  "symbol": "{{ticker}}",
  "side": "LONG",
  "entry_price": {{close}},
  "stop_loss": {{plot_0}},
  "take_profit": [{{high}}, {{high}} * 1.02],
  "timeframe": "{{interval}}",
  "strategy": "TV_Alert",
  "confidence": 0.75
}
```

> Adjust `side`, `stop_loss`, and `take_profit` logic based on your indicator.

7. Save alert

---

## 4. Pine Script Auto-Alert (Optional)

Add this to your Pine Script strategy to auto-trigger webhooks:

```pinescript
if (ta.crossover(ema9, ema21))
    alert('{"symbol":"' + syminfo.ticker + '","side":"LONG","entry_price":' + str.tostring(close) + ',"stop_loss":' + str.tostring(close * 0.99) + ',"take_profit":[' + str.tostring(close * 1.02) + '],"timeframe":"' + timeframe.period + '","strategy":"EMA_Cross","confidence":0.8}', alert.freq_once_per_bar_close)
```

---

## 5. Verification

After setting up, check your bot logs:
```bash
tail -f logs/app.log | grep "WEBHOOK"
```

You should see:
```
[WEBHOOK] Received BTCUSDT LONG @ 65000
```

---

## 6. Security Notes

- Never share your `TRADINGVIEW_WEBHOOK_SECRET`
- The endpoint rejects requests without the correct `x-webhook-secret` header
- Use HTTPS only — the webhook will not work over HTTP in production

---

*Last updated: 2026-04-28*
