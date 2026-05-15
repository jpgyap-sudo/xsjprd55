// ============================================================
// Telegram Webhook Handler — /api/telegram
// Commands: /signal, /market, /status, /scan, /close, /test, /help, /ai
// Advisor: /ask, /strategy, /risk, /backtest, /analyze
// OpenClaw: /oc, /openclaw — Smart trading Q&A with full context
// AI Chat: directed non-command text (mention/reply/DM) is routed to Claude
// Callbacks: sig_confirm, sig_dismiss, trade_close
// ============================================================

import { supabase } from '../lib/supabase.js';
import { validateSignal, checkRiskGates, logAudit } from '../lib/risk.js';
import { buildSignal } from '../lib/signal-engine.js';
import { sendTelegram, editMessage, answerCallback, formatSignalMessage, signalKeyboard, getBotInfo } from '../lib/telegram.js';
import { askAI } from '../lib/ai.js';
import { fetchAllNews } from '../lib/news-aggregator.js';
import { scoreNewsItems } from '../lib/news-sentiment.js';
import { scanNewsSignals } from '../lib/news-signal.js';
import { getPatternStats } from '../lib/pattern-learner.js';
import { runLearningLoop } from '../lib/learning-loop.js';
import { getSources } from '../lib/data-source-manager.js';
import { runAdvisor } from '../lib/advisor/runAdvisor.js';
import { runOpenClaw, checkOpenClaw } from '../lib/openclaw.js';
import { buildTradingContext, formatTradingContext } from '../lib/openclaw-trading-context.js';

const GROUP_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_USER_ID;

// In-memory chat history per user (Vercel stateless — TTL 10 min)
const userHistory = new Map();
const HISTORY_TTL_MS = 10 * 60 * 1000;

let BOT_USERNAME = null;

async function getBotUsername() {
  if (BOT_USERNAME) return BOT_USERNAME;
  try {
    const info = await getBotInfo();
    if (info?.username) {
      BOT_USERNAME = info.username.toLowerCase();
    }
  } catch (e) {
    console.error('[getBotUsername] error:', e.message);
  }
  return BOT_USERNAME;
}

function getHistory(userId) {
  const entry = userHistory.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.ts > HISTORY_TTL_MS) {
    userHistory.delete(userId);
    return [];
  }
  return entry.messages;
}

function pushHistory(userId, role, content) {
  const entry = userHistory.get(userId) || { ts: Date.now(), messages: [] };
  entry.messages.push({ role, content });
  if (entry.messages.length > 12) entry.messages = entry.messages.slice(-12);
  entry.ts = Date.now();
  userHistory.set(userId, entry);
}

async function cmdAsk(args, chatId, userId, senderName) {
  const question = args.join(' ').trim();
  if (!question) {
    return sendTelegram(chatId, '💬 *AI Advisor*\nAsk me anything about crypto markets, shorts, longs, or liquidations.\n\nExample: `/ask What is a good short today?`');
  }
  const history = getHistory(userId);
  const result = await askAI({ question, chatHistory: history });
  if (!result.ok) {
    return sendTelegram(chatId, `❌ AI error: ${result.error}`);
  }
  pushHistory(userId, 'user', question);
  pushHistory(userId, 'assistant', result.answer);
  // Telegram message limit is 4096 chars
  const chunks = result.answer.match(/[\s\S]{1,4000}/g) || [result.answer];
  for (const chunk of chunks) {
    await sendTelegram(chatId, chunk);
  }
}

async function cmdSignal(args, chatId, userId, senderName) {
  if (args.length < 3) {
    return sendTelegram(chatId,
      `⚠️ Usage:\n/signal SYMBOL SIDE ENTRY [SL:price] [TP:price1,price2]\n` +
      `Example: /signal BTCUSDT LONG 65000 SL:64000 TP:67000,69000`
    );
  }

  const symbol = args[0].toUpperCase();
  const side   = args[1].toUpperCase();
  const entry  = parseFloat(args[2]);
  const slArg  = args.find(a => a.toUpperCase().startsWith('SL:'));
  const tpArg  = args.find(a => a.toUpperCase().startsWith('TP:'));
  const sl     = slArg ? parseFloat(slArg.slice(3)) : null;
  const tp     = tpArg ? tpArg.slice(3).split(',').map(Number) : [];

  const raw = buildSignal({
    symbol, side, entry_price: entry, stop_loss: sl, take_profit: tp,
    confidence: 0.8, strategy: 'Manual', timeframe: 'manual',
    source: 'telegram_manual', mode: process.env.TRADING_MODE || 'paper'
  });

  const v = validateSignal(raw);
  if (!v.ok) {
    return sendTelegram(chatId, `❌ Invalid signal:\n${v.errors.join('\n')}`);
  }

  const rg = await checkRiskGates(null, raw, supabase);
  if (!rg.ok) {
    return sendTelegram(chatId, `🚫 Risk gate blocked:\n${rg.issues.join('\n')}`);
  }

  const { data: saved, error: saveErr } = await supabase.from('signals').insert(raw).select().single();
  if (saveErr || !saved) return sendTelegram(chatId, '❌ Failed to save signal');

  await sendTelegram(chatId, formatSignalMessage(saved), { reply_markup: signalKeyboard(saved.id) });
  await logAudit(supabase, 'signal_sent', { signal_id: saved.id, symbol, side, user_id: userId, source: 'manual' });
}

async function cmdMarket(args, chatId) {
  const symbol = (args[0] || 'BTCUSDT').toUpperCase();
  const { data: rows } = await supabase
    .from('market_data')
    .select('*')
    .eq('symbol', symbol)
    .eq('timeframe', '1h')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  if (!rows) {
    return sendTelegram(chatId, `📭 No cached data for ${symbol}. Run /scan or wait for next cron.`);
  }

  const c = rows;
  const change = ((c.close - c.open) / c.open * 100).toFixed(2);
  const emoji = change >= 0 ? '🟢' : '🔴';
  const msg =
    `${emoji} *${symbol}* — ${c.timeframe}\n` +
    `\`O:\` ${c.open}  \`H:\` ${c.high}  \`L:\` ${c.low}  \`C:\` ${c.close}\n` +
    `📊 Change: ${change}% | Vol: ${Math.round(c.volume || 0)}\n` +
    `🕐 ${new Date(c.timestamp).toISOString()}`;
  return sendTelegram(chatId, msg);
}

async function cmdStatus(chatId) {
  const { data: activeSignals } = await supabase
    .from('signals')
    .select('*')
    .eq('status', 'active')
    .order('generated_at', { ascending: false });

  const { data: openTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('status', 'open')
    .order('opened_at', { ascending: false });

  let msg = `📊 *Bot Status*\n\n`;
  msg += `*Active Signals:* ${activeSignals?.length || 0}\n`;
  msg += `*Open Trades:*   ${openTrades?.length || 0}\n\n`;

  if (activeSignals?.length) {
    msg += `*Signals:*\n`;
    for (const s of activeSignals.slice(0, 5)) {
      msg += `• ${s.side} ${s.symbol} @ ${s.entry_price} (${s.strategy})\n`;
    }
  }
  if (openTrades?.length) {
    msg += `\n*Trades:*\n`;
    for (const t of openTrades.slice(0, 5)) {
      msg += `• ${t.side} ${t.symbol} @ ${t.entry_price} [${t.mode}]\n`;
    }
  }
  return sendTelegram(chatId, msg);
}

async function cmdScan(chatId) {
  await sendTelegram(chatId, '🔍 Triggering signal scan...');
  try {
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    if (!process.env.CRON_SECRET) {
      return sendTelegram(chatId, 'Scan blocked: CRON_SECRET is not configured.');
    }
    const res = await fetch(`${base}/api/signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET
      }
    });
    const data = await res.json();
    return sendTelegram(chatId, `🔔 Scan done. Signals: ${data.signals?.length || 0} | Errors: ${data.errors?.length || 0}`);
  } catch (e) {
    return sendTelegram(chatId, `❌ Scan failed: ${e.message}`);
  }
}

async function cmdClose(args, chatId) {
  const symbol = (args[0] || '').toUpperCase();
  if (!symbol) return sendTelegram(chatId, 'Usage: /close SYMBOL');

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('symbol', symbol)
    .eq('status', 'open');

  if (!trades?.length) return sendTelegram(chatId, `No open trades for ${symbol}`);

  for (const t of trades) {
    await supabase.from('trades').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_reason: 'manual'
    }).eq('id', t.id);
  }
  return sendTelegram(chatId, `✅ Closed ${trades.length} trade(s) for ${symbol}`);
}

async function cmdTest(chatId) {
  const checks = [];
  checks.push(`SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  checks.push(`TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
  checks.push(`TRADING_MODE: ${process.env.TRADING_MODE || 'paper (default)'}`);

  let dbOk = false;
  try {
    const { data } = await supabase.from('signals').select('id').limit(1);
    dbOk = true;
  } catch (e) { /* ignore */ }
  checks.push(`Supabase connection: ${dbOk ? '✅' : '❌'}`);

  return sendTelegram(chatId, `🩺 *Health Check*\n\n${checks.join('\n')}`);
}

async function cmdNews(chatId) {
  try {
    await sendTelegram(chatId, '📰 Fetching latest crypto news...');
    const newsItems = await fetchAllNews(120);
    const scored = scoreNewsItems(newsItems);

    if (scored.items.length === 0) {
      return sendTelegram(chatId, '📭 No fresh news in the last 2 hours.');
    }

    // Top 5 headlines with sentiment
    let msg = `📰 *Latest Crypto News* (${scored.items.length} articles)\n`;
    msg += `*Market Sentiment: ${scored.overallScore > 0.2 ? '📈 Bullish' : scored.overallScore < -0.2 ? '📉 Bearish' : '➡️ Neutral'}* (${scored.overallScore.toFixed(2)})\n\n`;

    scored.items.slice(0, 5).forEach((item, i) => {
      const impact = item.impact === 'bullish' ? '📈' : item.impact === 'bearish' ? '📉' : '➡️';
      const urgency = item.hasUrgency ? ' *BREAKING*' : '';
      msg += `${i + 1}. ${impact} [${item.source}](${item.url})${urgency}\n`;
      msg += `   _${item.title}_\n`;
      msg += `   Score: ${item.sentimentScore.toFixed(2)} | ${item.detectedAssets.map(a => a.symbol.replace('USDT', '')).join(', ') || 'General'}\n\n`;
    });

    // Add asset summary
    const byAsset = {};
    for (const item of scored.items) {
      for (const asset of item.detectedAssets) {
        if (!byAsset[asset.symbol]) byAsset[asset.symbol] = { name: asset.name, count: 0, avg: 0, scores: [] };
        byAsset[asset.symbol].count++;
        byAsset[asset.symbol].scores.push(item.sentimentScore);
      }
    }
    const sortedAssets = Object.entries(byAsset)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    if (sortedAssets.length > 0) {
      msg += `*Most Mentioned:*\n`;
      sortedAssets.forEach(([sym, data]) => {
        const avg = data.scores.reduce((s, v) => s + v, 0) / data.scores.length;
        const dir = avg > 0.2 ? '📈' : avg < -0.2 ? '📉' : '➡️';
        msg += `${dir} ${sym.replace('USDT', '')}: ${avg.toFixed(2)} (${data.count}x)\n`;
      });
    }

    return sendTelegram(chatId, msg);
  } catch (e) {
    console.error('News command error:', e);
    return sendTelegram(chatId, `❌ News fetch failed: ${e.message}`);
  }
}

async function cmdNewsScan(chatId) {
  try {
    await sendTelegram(chatId, '🔍 Scanning news for trade signals...');
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const res = await fetch(`${base}/api/news-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (!data.ok) {
      return sendTelegram(chatId, `❌ News scan failed: ${data.error}`);
    }

    let msg = `🔔 *News Signal Scan Complete*\n\n`;
    msg += `Scanned: ${data.scanned} assets\n`;
    msg += `Signals generated: ${data.signals?.length || 0}\n`;
    msg += `Broadcasted: ${data.broadcasted || 0}\n`;
    if (data.skipped?.length) msg += `Skipped: ${data.skipped.length} (cooldown/duplicate)\n`;

    if (data.signals?.length > 0) {
      msg += `\n*Signals:*\n`;
      data.signals.forEach(s => {
        const emoji = s.side === 'LONG' ? '🟢' : '🔴';
        msg += `${emoji} ${s.side} ${s.symbol} — Win Prob: ${s.win_probability}% | Conf: ${Math.round(s.confidence * 100)}%\n`;
      });
    } else {
      msg += `\n_No signals met the threshold. Market is quiet._`;
    }

    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Scan failed: ${e.message}`);
  }
}

async function cmdCatalysts(chatId) {
  try {
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const res = await fetch(`${base}/api/catalyst`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    let msg = `🔴 *CATALYST WATCH*\n\n`;

    // High impact
    if (data.high?.length) {
      msg += `*High Impact:*\n`;
      data.high.forEach((c, i) => {
        const dirEmoji = c.direction === 'bearish' ? '🔴' : c.direction === 'bullish' ? '🟢' : '⚡';
        msg += `${i + 1}. ${c.emoji} *${c.title}* ${dirEmoji}\n`;
        msg += `   _${c.impact}_\n`;
        if (c.alert) msg += `   ⚠️ ${c.alert}\n`;
        msg += `\n`;
      });
    }

    // Readings
    if (data.readings?.length) {
      msg += `*Market Readings:*\n`;
      data.readings.forEach(r => {
        const sigEmoji = r.signal === 'contrarian_buy' ? '🟢' : r.signal === 'short_risk' ? '🔴' : r.signal === 'squeeze_potential' ? '🚀' : '⚡';
        msg += `   ${sigEmoji} *${r.label}:* ${r.value} — ${r.implication}\n`;
      });
      msg += `\n`;
    }

    // Key levels
    if (data.levels) {
      msg += `*Key Levels:*\n`;
      Object.entries(data.levels).forEach(([sym, lvl]) => {
        msg += `   *${sym}:* Support ${lvl.support} | Resistance ${lvl.resistance}\n`;
      });
      msg += `\n`;
    }

    // Bottom line
    if (data.bottomLine) {
      msg += `🧠 *Bottom Line:*\n_${data.bottomLine.substring(0, 400)}..._`;
    }

    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Catalyst fetch failed: ${e.message}`);
  }
}

async function cmdSuggestions(chatId) {
  const { data } = await supabase
    .from('app_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('generated_at', { ascending: false })
    .limit(5);

  if (!data?.length) {
    return sendTelegram(chatId, '🤖 *No pending suggestions*\n\nThe bot is still learning. Check back after more signals are generated.');
  }

  const icons = {
    new_api: '🔌', new_strategy: '🧠', strategy_tweak: '🔧',
    new_data_source: '📡', ui_improvement: '🎨', risk_adjustment: '🛡️',
    tool_discovery: '🔎', correction: '✏️'
  };

  let msg = '🤖 *Bot Suggestions* — Top 5 pending ideas:\n\n';
  for (const s of data) {
    const icon = icons[s.category] || '💡';
    msg += `${icon} *${s.title}*\n`;
    msg += `_${s.description.slice(0, 120)}${s.description.length > 120 ? '...' : ''}_\n`;
    msg += `Expected impact: ${s.expected_impact || 'TBD'}\n\n`;
  }
  msg += `View all in dashboard: ${process.env.APP_URL || 'https://bot.abcx124.xyz'}`;
  return sendTelegram(chatId, msg);
}

async function cmdLearn(chatId) {
  await sendTelegram(chatId, '🔄 *Running learning loop...*');
  try {
    const results = await runLearningLoop();
    const msg =
      `✅ *Learning Loop Complete*\n\n` +
      `• Outcomes resolved: ${results.outcomesResolved}\n` +
      `• Strategies rolled up: ${results.strategiesRolledUp}\n` +
      `• Suggestions generated: ${results.suggestionsGenerated}\n` +
      `• Sources checked: ${results.sourcesChecked}\n` +
      `• New sources discovered: ${results.newSourcesDiscovered}` +
      (results.errors.length ? `\n\n⚠️ Errors: ${results.errors.join(', ')}` : '');
    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Learning loop failed: ${e.message}`);
  }
}

async function cmdSources(chatId) {
  const sources = await getSources();
  if (!sources?.length) {
    return sendTelegram(chatId, '📡 *No data sources registered*');
  }

  let msg = '📡 *Data Sources*:\n\n';
  for (const s of sources) {
    const statusEmoji = s.status === 'active' ? '🟢' : s.status === 'degraded' ? '🟡' : '🔴';
    msg += `${statusEmoji} *${s.display_name}* (${s.type})\n`;
    msg += `Reliability: ${(s.reliability_score * 100).toFixed(0)}% | Signals: ${s.signals_contributed}\n`;
    if (s.last_error_message) msg += `⚠️ ${s.last_error_message.slice(0, 60)}\n`;
    msg += '\n';
  }
  return sendTelegram(chatId, msg);
}

async function cmdPatterns(args, chatId) {
  const strategy = args[0] || null;
  try {
    const stats = await getPatternStats({ strategy, limit: 200 });
    let msg = `📊 *Signal Pattern Stats` + (strategy ? ` — ${strategy}` : '') + `*\n\n`;
    msg += `Total signals: ${stats.total}\n`;
    msg += `Win rate: ${(stats.winRate * 100).toFixed(1)}%\n`;
    msg += `Total PnL: $${stats.totalPnl.toFixed(2)}\n`;
    msg += `Avg PnL: $${stats.avgPnl.toFixed(2)}\n`;
    msg += `Avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%\n\n`;

    if (Object.keys(stats.byStrategy).length > 0) {
      msg += '*By Strategy:*\n';
      for (const [k, v] of Object.entries(stats.byStrategy)) {
        msg += `• ${k}: ${v.count} signals, ${(v.winRate * 100).toFixed(0)}% win\n`;
      }
    }
    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Pattern stats error: ${e.message}`);
  }
}

// ── Advisor Commands ────────────────────────────────────────

async function cmdStrategy(args, chatId) {
  const symbol = (args[0] || '').toUpperCase();
  const timeframe = args[1] || '1h';
  if (!symbol) {
    return sendTelegram(chatId, '📊 *Strategy Analysis*\nUsage: `/strategy SYMBOL [timeframe]`\nExample: `/strategy BTCUSDT 4h`');
  }
  try {
    await sendTelegram(chatId, `🧠 Analyzing ${symbol} ${timeframe}...`);
    const result = await runAdvisor({
      symbol,
      timeframe,
      intent: 'strategy',
      source: 'telegram'
    });
    const r = result.report;
    const biasEmoji = r.bias === 'long' ? '🟢' : r.bias === 'short' ? '🔴' : r.bias === 'neutral' ? '⚪' : '🚫';
    let msg = `${biasEmoji} *Strategy: ${symbol}* (${timeframe})\n\n`;
    msg += `*Bias:* ${r.bias.toUpperCase()}\n`;
    msg += `*Confidence:* ${(r.confidence * 100).toFixed(0)}%\n`;
    msg += `*Risk Score:* ${(r.risk_score * 100).toFixed(0)}%\n\n`;
    if (r.entry_zone?.from && r.entry_zone?.to) {
      msg += `*Entry Zone:* $${r.entry_zone.from} – $${r.entry_zone.to}\n`;
    }
    if (r.stop_loss) msg += `*Stop Loss:* $${r.stop_loss}\n`;
    if (r.take_profits?.length) {
      msg += `*Take Profits:* ${r.take_profits.map(tp => `$${tp}`).join(', ')}\n`;
    }
    if (r.reasons?.length) {
      msg += `\n*Reasons:*\n${r.reasons.map(rs => `• ${rs}`).join('\n')}\n`;
    }
    if (r.warnings?.length) {
      msg += `\n⚠️ *Warnings:*\n${r.warnings.map(w => `• ${w}`).join('\n')}\n`;
    }
    msg += `\n_${r.disclaimer || 'Advisor only. Not financial advice.'}_`;
    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Strategy analysis failed: ${e.message}`);
  }
}

async function cmdRisk(args, chatId) {
  const symbol = (args[0] || '').toUpperCase();
  if (!symbol) {
    return sendTelegram(chatId, '🛡️ *Risk Assessment*\nUsage: `/risk SYMBOL`\nExample: `/risk ETHUSDT`');
  }
  try {
    await sendTelegram(chatId, `🛡️ Assessing risk for ${symbol}...`);
    const result = await runAdvisor({
      symbol,
      timeframe: '1h',
      intent: 'risk',
      source: 'telegram'
    });
    const r = result.report;
    const riskLevel = r.risk_score > 0.7 ? '🔴 HIGH' : r.risk_score > 0.4 ? '🟡 MEDIUM' : '🟢 LOW';
    let msg = `🛡️ *Risk Assessment: ${symbol}*\n\n`;
    msg += `*Risk Score:* ${(r.risk_score * 100).toFixed(0)}% — ${riskLevel}\n`;
    msg += `*Bias:* ${r.bias.toUpperCase()}\n`;
    msg += `*Confidence:* ${(r.confidence * 100).toFixed(0)}%\n\n`;
    if (r.warnings?.length) {
      msg += `*Risk Factors:*\n${r.warnings.map(w => `• ${w}`).join('\n')}\n\n`;
    }
    msg += `_${r.disclaimer || 'Advisor only. Not financial advice.'}_`;
    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Risk assessment failed: ${e.message}`);
  }
}

async function cmdBacktest(args, chatId) {
  const symbol = (args[0] || '').toUpperCase();
  if (!symbol) {
    return sendTelegram(chatId, '📜 *Backtest Summary*\nUsage: `/backtest SYMBOL`\nExample: `/backtest PEPEUSDT`');
  }
  try {
    await sendTelegram(chatId, `📜 Fetching backtest memory for ${symbol}...`);
    const { data: backtests } = await supabase
      .from('strategy_backtests')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(5);
    if (!backtests?.length) {
      return sendTelegram(chatId, `📭 No backtest data for ${symbol}. Run research agent first.`);
    }
    let msg = `📜 *Backtest Memory: ${symbol}*\n\n`;
    for (const b of backtests) {
      const wr = b.win_rate ? `${(b.win_rate * 100).toFixed(0)}%` : 'N/A';
      const pf = b.profit_factor ? b.profit_factor.toFixed(2) : 'N/A';
      msg += `*${b.timeframe}* — ${b.trades_count} trades\n`;
      msg += `Win Rate: ${wr} | Profit Factor: ${pf}\n`;
      if (b.max_drawdown) msg += `Max DD: ${(b.max_drawdown * 100).toFixed(0)}%\n`;
      msg += '\n';
    }
    return sendTelegram(chatId, msg);
  } catch (e) {
    return sendTelegram(chatId, `❌ Backtest fetch failed: ${e.message}`);
  }
}

async function cmdAnalyze(args, chatId) {
  const prompt = args.join(' ').trim();
  if (!prompt) {
    return sendTelegram(chatId, '🔎 *AI Analysis*\nUsage: `/analyze QUESTION`\nExample: `/analyze What is the market structure of BTC?`\n\nUses OpenClaw AI for deep analysis.');
  }
  try {
    // Check if OpenClaw is available
    const ocStatus = checkOpenClaw();
    if (!ocStatus.available) {
      // Fall back to askAI
      await sendTelegram(chatId, '🔎 OpenClaw not available, using AI advisor...');
      const result = await askAI({ question: prompt });
      if (!result.ok) return sendTelegram(chatId, `❌ AI error: ${result.error}`);
      const chunks = result.answer.match(/[\s\S]{1,4000}/g) || [result.answer];
      for (const chunk of chunks) await sendTelegram(chatId, chunk);
      return;
    }
    await sendTelegram(chatId, '🔎 Running OpenClaw analysis...');
    const output = runOpenClaw(prompt, { type: 'analysis', timeout: 30000 });
    const chunks = output.match(/[\s\S]{1,4000}/g) || [output];
    for (const chunk of chunks) await sendTelegram(chatId, chunk);
  } catch (e) {
    // Fallback to askAI
    try {
      const result = await askAI({ question: prompt });
      if (!result.ok) return sendTelegram(chatId, `❌ Analysis failed: ${e.message}`);
      const chunks = result.answer.match(/[\s\S]{1,4000}/g) || [result.answer];
      for (const chunk of chunks) await sendTelegram(chatId, chunk);
    } catch (e2) {
      return sendTelegram(chatId, `❌ Analysis failed: ${e.message}`);
    }
  }
}

// ── OpenClaw Smart Trading Q&A ─────────────────────────────

async function cmdOpenClaw(args, chatId, userId, senderName) {
  const question = args.join(' ').trim();
  if (!question) {
    return sendTelegram(chatId,
      `🧠 *OpenClaw Trading AI*\n` +
      `Ask me anything about crypto trading, markets, signals, or strategies.\n\n` +
      `Examples:\n` +
      `/oc What's the best short right now?\n` +
      `/oc Analyze BTCUSDT — is it a good long?\n` +
      `/oc How are our strategies performing?\n` +
      `/oc What's the market sentiment today?\n` +
      `/oc Explain the liquidation risk for ETH\n` +
      `/oc Should I take profit on my open trades?`
    );
  }

  // Send thinking message — we'll edit it in-place with the response
  const thinkingMsg = await sendTelegram(chatId, '🧠 *OpenClaw is thinking...*\n_Gathering market data, signals, and context..._');
  const thinkingMsgId = thinkingMsg?.message_id;

  try {
    // Use askAI() directly — it already fetches market context + news internally
    // No need to call buildTradingContext() separately (avoids double-fetching)
    const aiResult = await askAI({
      question: `You are OpenClaw — a highly intelligent trading analysis agent integrated into a Telegram bot.

Your role is to answer trading-related questions with deep market insight, data-driven analysis, and clear reasoning.

## YOUR CAPABILITIES
You have access to comprehensive trading context including:
- Real-time market data (prices, volumes, BTC/ETH dominance)
- Funding rates (identify crowded longs/shorts)
- Liquidation intelligence (best short/long candidates, OI data)
- Active trading signals with confidence levels
- Open trades with current PnL
- Strategy performance metrics (win rates by strategy)
- Brain signal memory and learning insights
- Recent news with sentiment analysis

## HOW TO ANALYZE
1. Ground your answer in the actual data provided
2. Provide structured analysis with emojis
3. Be honest about uncertainty
4. Never claim guaranteed profits
5. Always include risk disclaimers

## OUTPUT FORMAT
- Use Markdown (*bold*, _italic_)
- Keep under 4000 chars per message
- Use emojis for structure
- End with actionable takeaway

User Question: ${question}

Provide a thorough, data-driven analysis.`,
      maxTokens: 4096,
    });

    if (!aiResult.ok) throw new Error(aiResult.error || 'AI analysis failed');

    const answer = aiResult.answer;
    const provider = aiResult.provider;

    // Split into Telegram-friendly chunks (max 4000 chars)
    const chunks = answer.match(/[\s\S]{1,4000}/g) || [answer];

    // Edit the thinking message with the first chunk, send rest as new messages
    if (thinkingMsgId) {
      try {
        await editMessage(chatId, thinkingMsgId, chunks[0]);
      } catch (e) {
        await sendTelegram(chatId, chunks[0]);
      }
    } else {
      await sendTelegram(chatId, chunks[0]);
    }

    for (let i = 1; i < chunks.length; i++) {
      await sendTelegram(chatId, chunks[i]);
    }

    // Log the interaction
    try {
      await supabase.from('audit_log').insert({
        action: 'openclaw_telegram',
        metadata: {
          question: question.slice(0, 500),
          provider,
          chat_id: chatId,
          user_id: userId,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (e) { /* non-critical */ }

  } catch (e) {
    console.error('[telegram] OpenClaw command error:', e);
    const errorText = `❌ OpenClaw analysis failed: ${e.message}`;
    if (thinkingMsgId) {
      try { await editMessage(chatId, thinkingMsgId, errorText); } catch (e2) { await sendTelegram(chatId, errorText); }
    } else {
      await sendTelegram(chatId, errorText);
    }
  }
}

async function cmdHelp(chatId) {
  const msg =
    `*Available Commands*\n\n` +
    `🧠 *AI Consultant*\n` +
    `/ask QUESTION — Ask the AI anything (e.g. "/ask good short today?")\n` +
    `/strategy SYMBOL [TF] — Full strategy analysis (e.g. "/strategy BTCUSDT 4h")\n` +
    `/risk SYMBOL — Risk assessment for a symbol\n` +
    `/backtest SYMBOL — Backtest memory for a symbol\n` +
    `/analyze QUESTION — Deep AI analysis via OpenClaw\n` +
    `Or just type any message without a "/" — the AI will reply!\n\n` +
    `🤖 *OpenClaw Smart Trading*\n` +
    `/oc QUESTION — Smart trading Q&A with full market context\n` +
    `   (e.g. "/oc What's the best short right now?")\n` +
    `   OpenClaw analyzes signals, trades, news, and liquidation data\n\n` +
    `📰 *News Signals*\n` +
    `/news — Latest crypto headlines with sentiment\n` +
    `/newsscan — Scan news for trade signals NOW\n\n` +
    `🔴 *Catalyst Watch*\n` +
    `/catalysts — Key macro events & price levels to watch\n\n` +
    `📡 *Trading*\n` +
    `/signal SYMBOL SIDE ENTRY [SL:price] [TP:price1,price2] — Manual signal\n` +
    `/market [SYMBOL] — Cached market data\n` +
    `/status — Active signals & trades\n` +
    `/scan — Trigger technical signal scan\n` +
    `/close SYMBOL — Close open trades\n` +
    `/test — Bot health check\n\n` +
    `🧠 *Self-Improvement*\n` +
    `/suggestions — Bot-generated improvement ideas\n` +
    `/learn — Run learning loop manually\n` +
    `/sources — Connected data sources & health\n` +
    `/patterns [STRATEGY] — Signal performance stats\n\n` +
    `/help — This message`;
  return sendTelegram(chatId, msg);
}

// ── Main handler ────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');

  // ── Webhook secret validation ─────────────────────────────
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret && secret !== 'your-webhook-secret' && headerSecret !== secret) {
    console.warn('[telegram webhook] rejected — invalid secret');
    return res.status(403).json({ error: 'Invalid webhook secret' });
  }

  const body = req.body;
  console.log('[telegram webhook] received update', JSON.stringify(body));

  const callback = body?.callback_query;

  // ── Inline callbacks ──────────────────────────────────────
  if (callback) {
    const data    = callback.data || '';
    const chatId  = callback.message?.chat?.id?.toString();
    const msgId   = callback.message?.message_id;
    const cbId    = callback.id;

    if (data.startsWith('sig_confirm_')) {
      const signalId = data.replace('sig_confirm_', '');
      const { data: sig } = await supabase.from('signals').select('*').eq('id', signalId).single();
      if (!sig) {
        await answerCallback(cbId, 'Signal not found');
        return res.status(200).send('OK');
      }
      await supabase.from('signals').update({ status: 'confirmed' }).eq('id', signalId);
      await editMessage(chatId, msgId, formatSignalMessage({ ...sig, status: 'confirmed' }) + '\n\n✅ *Confirmed*');
      await answerCallback(cbId, 'Signal confirmed');
      await logAudit(supabase, 'signal_confirmed', { signal_id: signalId });
      return res.status(200).send('OK');
    }

    if (data.startsWith('sig_dismiss_')) {
      const signalId = data.replace('sig_dismiss_', '');
      const { data: sig } = await supabase.from('signals').select('*').eq('id', signalId).single();
      if (!sig) {
        await answerCallback(cbId, 'Signal not found');
        return res.status(200).send('OK');
      }
      await supabase.from('signals').update({ status: 'dismissed' }).eq('id', signalId);
      await editMessage(chatId, msgId, formatSignalMessage({ ...sig, status: 'dismissed' }) + '\n\n❌ *Dismissed*');
      await answerCallback(cbId, 'Signal dismissed');
      await logAudit(supabase, 'signal_dismissed', { signal_id: signalId });
      return res.status(200).send('OK');
    }

    await answerCallback(cbId, 'Unknown action');
    return res.status(200).send('OK');
  }

  // ── Command messages ──────────────────────────────────────
  const msg      = body.message || {};
  const text     = (msg.text || '').trim();
  const chatId   = msg.chat?.id?.toString();
  const userId   = msg.from?.id?.toString();
  const sender   = msg.from?.username || msg.from?.first_name || 'Unknown';

  console.log(`[telegram] chatId=${chatId} GROUP_ID=${GROUP_ID} text="${text}" sender=${sender}`);

  // Ignore messages from wrong group
  if (GROUP_ID && chatId !== String(GROUP_ID)) {
    console.log(`[telegram] ignored: chatId ${chatId} !== GROUP_ID ${GROUP_ID}`);
    return res.status(200).send('OK');
  }

  if (msg.from?.is_bot) return res.status(200).send('OK');

  const botUsername = await getBotUsername();
  const botUsernameClean = botUsername ? `@${botUsername}` : null;

  // Detect reply-to-bot and leading @mention
  const replyToUsername = msg.reply_to_message?.from?.username?.toLowerCase();
  const isReplyToBot    = replyToUsername === botUsername;
  const startsWithMention = botUsername ? text.toLowerCase().startsWith(`@${botUsername}`) : false;
  const isDirectedAtBot = isReplyToBot || startsWithMention;

  console.log(`[telegram] botUsername=${botUsername} isReplyToBot=${isReplyToBot} startsWithMention=${startsWithMention} isDirectedAtBot=${isDirectedAtBot}`);

  // Determine if this is a group/supergroup (vs DM)
  const chatType = msg.chat?.type;
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  // Non-command text
  if (!text.startsWith('/')) {
    // In groups, only respond if the message is directed at the bot
    if (isGroup && !isDirectedAtBot) {
      console.log('[telegram] ignored: non-command in group not directed at bot');
      return res.status(200).send('OK');
    }

    // Strip leading @botname so the AI doesn't see its own username
    let cleanText = text;
    if (startsWithMention && botUsernameClean) {
      cleanText = text.slice(botUsernameClean.length).trim();
    }

    // Detect if this is a trading-related question — route through OpenClaw for smarter answers
    const tradingKeywords = [
      'short', 'long', 'signal', 'trade', 'market', 'btc', 'eth', 'sol',
      'buy', 'sell', 'entry', 'price', 'liquidation', 'funding', 'oi',
      'position', 'pnl', 'profit', 'loss', 'strategy', 'analysis',
      'chart', 'trend', 'support', 'resistance', 'breakout', 'dump',
      'pump', 'bearish', 'bullish', 'crypto', 'coin', 'token', 'altcoin',
      'leverage', 'margin', 'future', 'perpetual', 'spot', 'swap',
      'rsi', 'macd', 'ema', 'volume', 'order', 'book', 'depth',
      'risk', 'stop', 'loss', 'take', 'profit', 'tp', 'sl',
    ];
    const words = cleanText.toLowerCase().split(/\s+/);
    const tradingWordCount = words.filter(w => tradingKeywords.includes(w)).length;
    const isTradingQuestion = tradingWordCount >= 2 || words.some(w =>
      w.endsWith('usdt') || w.endsWith('usd') || /^[a-z]{2,6}usdt$/.test(w)
    );

    if (isTradingQuestion) {
      // Route through OpenClaw for smart trading analysis
      try {
        await cmdOpenClaw(cleanText.split(/\s+/), chatId, userId, sender);
      } catch (e) {
        console.error('Telegram OpenClaw error:', e);
        // Fallback to basic AI
        try {
          await cmdAsk(cleanText.split(/\s+/), chatId, userId, sender);
        } catch (e2) {
          if (chatId) await sendTelegram(chatId, `❌ Error: ${e.message}`);
        }
      }
    } else {
      // General questions — use standard AI
      try {
        await cmdAsk(cleanText.split(/\s+/), chatId, userId, sender);
      } catch (e) {
        console.error('Telegram AI error:', e);
        if (chatId) await sendTelegram(chatId, `❌ AI error: ${e.message}`);
      }
    }
    return res.status(200).send('OK');
  }

  const parts = text.split(/\s+/);
  const cmd   = parts[0].split('@')[0].toLowerCase();
  const args  = parts.slice(1);

  console.log(`[telegram] cmd="${cmd}" args=${JSON.stringify(args)}`);

  try {
    switch (cmd) {
      case '/signal':       await cmdSignal(args, chatId, userId, sender); break;
      case '/market':       await cmdMarket(args, chatId); break;
      case '/status':       await cmdStatus(chatId); break;
      case '/scan':         await cmdScan(chatId); break;
      case '/news':         await cmdNews(chatId); break;
      case '/newsscan':     await cmdNewsScan(chatId); break;
      case '/catalysts':    await cmdCatalysts(chatId); break;
      case '/close':        await cmdClose(args, chatId); break;
      case '/test':         await cmdTest(chatId); break;
      case '/help':         await cmdHelp(chatId); break;
      case '/start':        await cmdHelp(chatId); break;
      case '/ask':          await cmdAsk(args, chatId, userId, sender); break;
      case '/strategy':     await cmdStrategy(args, chatId); break;
      case '/risk':         await cmdRisk(args, chatId); break;
      case '/backtest':     await cmdBacktest(args, chatId); break;
      case '/analyze':      await cmdAnalyze(args, chatId); break;
      case '/oc':           await cmdOpenClaw(args, chatId, userId, sender); break;
      case '/openclaw':     await cmdOpenClaw(args, chatId, userId, sender); break;
      case '/suggestions':  await cmdSuggestions(chatId); break;
      case '/learn':        await cmdLearn(chatId); break;
      case '/sources':      await cmdSources(chatId); break;
      case '/patterns':     await cmdPatterns(args, chatId); break;
      default:
        if (chatId) await sendTelegram(chatId, `Unknown command: ${cmd}\nTry /help`);
    }
  } catch (e) {
    console.error('Telegram command error:', e);
    if (chatId) await sendTelegram(chatId, `❌ Error: ${e.message}`);
  }

  return res.status(200).send('OK');
}
