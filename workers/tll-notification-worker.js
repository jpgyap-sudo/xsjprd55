// ============================================================
// TLL Notification Worker — Sends Telegram alerts for TLL events
//
// Watches for:
//   - New trading skills generated (confidence >= 0.7)
//   - Strategies quarantined by healing
//   - Market regime shifts
//   - TLL cycle errors
//   - Daily TLL summary report (every 24h)
//
// Uses dedupSendIdea to avoid duplicate notifications within 24h.
// ============================================================

import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { sendTelegram } from '../lib/telegram.js';
import { dedupSendIdea } from '../lib/agent-improvement-bus.js';
import { logger } from '../lib/logger.js';

const WORKER_NAME = 'tll-notification-worker';
const CHECK_INTERVAL_MS = parseInt(process.env.TLL_NOTIFY_INTERVAL_MS || '300000', 10); // 5 min
const DAILY_SUMMARY_INTERVAL_MS = parseInt(process.env.TLL_DAILY_SUMMARY_INTERVAL_MS || '86400000', 10); // 24h
const ENABLED = process.env.TLL_NOTIFY_ENABLED !== 'false';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

// ── State tracking ─────────────────────────────────────────
let lastKnownRegime = null;
let lastCheckTime = new Date(0).toISOString();
let lastDailySummaryDate = ''; // YYYY-MM-DD to avoid duplicate daily summaries

// ── Format helpers ──────────────────────────────────────────
function fmtPct(v) {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}

function regimeIcon(regime) {
  const icons = { trending: '📈', choppy: '🌊', ranging: '↔️', quiet: '💤', mixed: '🔀' };
  return icons[regime] || '🧠';
}

// ── Check 1: New high-confidence skills ─────────────────────
async function checkNewSkills() {
  try {
    const { data, error } = await supabase
      .from('tll_skills')
      .select('*')
      .eq('active', true)
      .gte('confidence', 0.7)
      .order('generated_at', { ascending: false })
      .limit(5);

    if (error) throw error;
    if (!data?.length) return [];

    const newSkills = data.filter(s => {
      const createdAt = s.generated_at;
      return createdAt && createdAt >= lastCheckTime;
    });

    return newSkills;
  } catch (e) {
    logger.error(`[${WORKER_NAME}] checkNewSkills error:`, e.message);
    return [];
  }
}

// ── Check 2: New quarantine events ─────────────────────────
async function checkNewQuarantines() {
  try {
    const { data, error } = await supabase
      .from('tll_healing_log')
      .select('*')
      .order('healed_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    if (!data?.length) return [];

    return data.filter(h => {
      const meta = h.metadata || {};
      const action = h.action || meta.action || '';
      return (action === 'quarantine' || h.win_rate < 0.25) &&
             h.healed_at >= lastCheckTime;
    });
  } catch (e) {
    logger.error(`[${WORKER_NAME}] checkNewQuarantines error:`, e.message);
    return [];
  }
}

// ── Check 3: Regime shifts ─────────────────────────────────
async function checkRegimeShift() {
  try {
    const { data, error } = await supabase
      .from('tll_regime_log')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data?.length) return null;

    const latest = data[0];

    if (lastKnownRegime && latest.regime !== lastKnownRegime) {
      lastKnownRegime = latest.regime;
      return latest;
    }

    if (!lastKnownRegime) {
      lastKnownRegime = latest.regime;
    }

    return null;
  } catch (e) {
    logger.error(`[${WORKER_NAME}] checkRegimeShift error:`, e.message);
    return null;
  }
}

// ── Check 4: TLL cycle errors ──────────────────────────────
async function checkCycleErrors() {
  try {
    const { data, error } = await supabase
      .from('brain_events')
      .select('*')
      .eq('event', 'tll_cycle')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw error;
    if (!data?.length) return [];

    return data.filter(e => {
      const payload = e.payload || {};
      return (payload.errors || 0) > 0 && e.created_at >= lastCheckTime;
    });
  } catch (e) {
    logger.error(`[${WORKER_NAME}] checkCycleErrors error:`, e.message);
    return [];
  }
}

// ── Send notifications ─────────────────────────────────────
async function sendSkillNotification(skills) {
  if (!skills.length || !TELEGRAM_CHAT_ID) return;

  const lines = skills.map((s, i) => {
    const meta = s.metadata || {};
    return `${i + 1}. *${s.name || s.feature || 'Skill'}*\n   ${s.description || s.value || '—'}\n   Confidence: ${fmtPct(s.confidence)} | WR: ${fmtPct(s.win_rate)}\n   Strategy: ${meta.strategy || 'all'}`;
  });

  const text = `🎯 *New Trading Skills Discovered*\n\n${lines.join('\n\n')}\n\n_View all skills: /api/learning-layer?view=skills_`;

  try {
    await sendTelegram(TELEGRAM_CHAT_ID, text);
    logger.info(`[${WORKER_NAME}] Sent skill notification (${skills.length} skills)`);
  } catch (e) {
    logger.error(`[${WORKER_NAME}] sendSkillNotification error:`, e.message);
  }
}

async function sendQuarantineNotification(quarantines) {
  if (!quarantines.length || !TELEGRAM_CHAT_ID) return;

  const lines = quarantines.map((q, i) => {
    const meta = q.metadata || {};
    return `${i + 1}. *${q.strategy || meta.strategy || 'Unknown'}*\n   WR: ${fmtPct(q.win_rate)} | Reason: ${q.reason || meta.reason || 'Underperforming'}`;
  });

  const text = `🔒 *Strategies Quarantined*\n\n${lines.join('\n\n')}\n\n_Review healing log: /api/learning-layer?view=healing_`;

  try {
    await sendTelegram(TELEGRAM_CHAT_ID, text);
    logger.info(`[${WORKER_NAME}] Sent quarantine notification (${quarantines.length} strategies)`);
  } catch (e) {
    logger.error(`[${WORKER_NAME}] sendQuarantineNotification error:`, e.message);
  }
}

async function sendRegimeNotification(regime) {
  if (!regime || !TELEGRAM_CHAT_ID) return;

  const icon = regimeIcon(regime.regime);
  const text = `${icon} *Market Regime Shift Detected*\n\nNew regime: *${regime.regime}*\nADX: ${(regime.adx || 0).toFixed(1)} | ATR: ${(regime.atr_pct || 0).toFixed(2)}%\nVolatility: ${regime.volatility_label || '—'}\n\n_Strategy weights have been adjusted accordingly._`;

  try {
    await sendTelegram(TELEGRAM_CHAT_ID, text);
    logger.info(`[${WORKER_NAME}] Sent regime notification: ${regime.regime}`);
  } catch (e) {
    logger.error(`[${WORKER_NAME}] sendRegimeNotification error:`, e.message);
  }
}

async function sendErrorNotification(errors) {
  if (!errors.length || !TELEGRAM_CHAT_ID) return;

  const lines = errors.map((e, i) => {
    const payload = e.payload || {};
    return `${i + 1}. Cycle had ${payload.errors} error(s) — ${payload.patterns || 0} patterns, ${payload.skills || 0} skills`;
  });

  const text = `⚠️ *TLL Cycle Errors*\n\n${lines.join('\n\n')}\n\n_Check logs for details._`;

  try {
    await sendTelegram(TELEGRAM_CHAT_ID, text);
    logger.info(`[${WORKER_NAME}] Sent error notification (${errors.length} cycles)`);
  } catch (e) {
    logger.error(`[${WORKER_NAME}] sendErrorNotification error:`, e.message);
  }
}

// ── Daily summary ──────────────────────────────────────────
async function sendDailySummary() {
  if (!TELEGRAM_CHAT_ID) return;

  const today = new Date().toISOString().slice(0, 10);
  if (lastDailySummaryDate === today) {
    logger.info(`[${WORKER_NAME}] Daily summary already sent today (${today})`);
    return;
  }

  try {
    // 1. brain_signal_memory — total resolved signals
    const { data: memoryStats } = await supabase
      .from('brain_signal_memory')
      .select('id, resolved_outcome, resolved_pnl, strategy, source')
      .not('resolved_outcome', 'is', null);

    const totalResolved = memoryStats?.length || 0;
    const wins = memoryStats?.filter(s => s.resolved_outcome === 'win').length || 0;
    const losses = memoryStats?.filter(s => s.resolved_outcome === 'loss').length || 0;
    const winRate = totalResolved > 0 ? wins / totalResolved : 0;
    const totalPnl = memoryStats?.reduce((sum, s) => sum + (parseFloat(s.resolved_pnl) || 0), 0) || 0;

    // Source breakdown
    const sourceCounts = {};
    memoryStats?.forEach(s => {
      const src = s.source || 'unknown';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });

    // 2. tll_patterns — total patterns
    const { data: patterns } = await supabase
      .from('tll_patterns')
      .select('id, feature, win_rate, confidence, sample_count')
      .order('win_rate', { ascending: false })
      .limit(5);

    const totalPatterns = patterns?.length || 0;

    // 3. tll_skills — active skills
    const { data: skills } = await supabase
      .from('tll_skills')
      .select('id, name, confidence, win_rate, active')
      .eq('active', true)
      .order('confidence', { ascending: false })
      .limit(5);

    const totalSkills = skills?.length || 0;

    // 4. tll_healing_log — recent healing
    const { data: healing } = await supabase
      .from('tll_healing_log')
      .select('*')
      .order('healed_at', { ascending: false })
      .limit(10);

    const totalHealing = healing?.length || 0;
    const quarantined = healing?.filter(h => {
      const meta = h.metadata || {};
      const action = h.action || meta.action || '';
      return action === 'quarantine' || h.win_rate < 0.25;
    }).length || 0;

    // 5. tll_regime_log — current regime
    const { data: regime } = await supabase
      .from('tll_regime_log')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(1);

    const currentRegime = regime?.[0] || null;

    // 6. brain_events — bridge ingestion stats (last 24h)
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const { data: events } = await supabase
      .from('brain_events')
      .select('payload, created_at')
      .eq('event', 'tll_cycle')
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false })
      .limit(5);

    const latestEvent = events?.[0]?.payload || {};
    const bridges = latestEvent.bridges || {};

    // ── Format the message ─────────────────────────────────
    const lines = [];

    // Header
    const regimeName = currentRegime?.regime || 'unknown';
    const regimeIcon_ = regimeIcon(regimeName);
    lines.push(`🧠 *TLL Daily Summary — ${today}*\n`);

    // Overview
    lines.push(`*📊 Overview*`);
    lines.push(`Resolved Signals: ${totalResolved}`);
    lines.push(`Win Rate: ${fmtPct(winRate)} (${wins}W / ${losses}L)`);
    lines.push(`Total PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
    lines.push(`Current Regime: ${regimeIcon_} ${regimeName}`);
    lines.push(`Active Skills: ${totalSkills}`);
    lines.push(`Total Patterns: ${totalPatterns}`);
    lines.push(`Healing Events: ${totalHealing} (${quarantined} quarantined)`);
    lines.push('');

    // Bridge Ecosystem
    lines.push(`*🌉 Bridge Ecosystem*`);
    const bridgeNames = {
      mock_trading: 'Mock Trading',
      perpetual_trader: 'Perpetual Trader',
      research_agent: 'Research Agent',
      signal_agent: 'Signal Agent',
    };
    for (const [key, label] of Object.entries(bridgeNames)) {
      const count = bridges[key] || 0;
      lines.push(`• ${label}: ${count} signals ingested`);
    }
    lines.push('');

    // Source Breakdown
    if (Object.keys(sourceCounts).length > 0) {
      lines.push(`*📡 Data Sources*`);
      for (const [src, count] of Object.entries(sourceCounts)) {
        lines.push(`• ${src}: ${count} resolved signals`);
      }
      lines.push('');
    }

    // Top Patterns
    if (patterns?.length) {
      lines.push(`*🔍 Top Patterns*`);
      patterns.forEach((p, i) => {
        lines.push(`${i + 1}. ${p.feature || 'Pattern'} — WR: ${fmtPct(p.win_rate)} (${p.sample_count || 0} samples)`);
      });
      lines.push('');
    }

    // Top Skills
    if (skills?.length) {
      lines.push(`*🎯 Top Skills*`);
      skills.forEach((s, i) => {
        lines.push(`${i + 1}. ${s.name || 'Skill'} — Confidence: ${fmtPct(s.confidence)}, WR: ${fmtPct(s.win_rate)}`);
      });
      lines.push('');
    }

    // Healing Summary
    if (healing?.length) {
      const activeQuarantines = healing.filter(h => {
        const meta = h.metadata || {};
        const action = h.action || meta.action || '';
        return action === 'quarantine' || h.win_rate < 0.25;
      });
      if (activeQuarantines.length) {
        lines.push(`*🔒 Quarantined Strategies*`);
        activeQuarantines.forEach((q, i) => {
          const meta = q.metadata || {};
          lines.push(`${i + 1}. ${q.strategy || meta.strategy || 'Unknown'} — WR: ${fmtPct(q.win_rate)}`);
        });
        lines.push('');
      }
    }

    // Footer
    lines.push(`_Dashboard: https://bot.abcx124.xyz/tll-dashboard.html_`);
    lines.push(`_Next summary: ${new Date(Date.now() + DAILY_SUMMARY_INTERVAL_MS).toISOString().slice(0, 10)}_`);

    const text = lines.join('\n');

    await sendTelegram(TELEGRAM_CHAT_ID, text);
    lastDailySummaryDate = today;
    logger.info(`[${WORKER_NAME}] Daily summary sent for ${today}`);
  } catch (e) {
    logger.error(`[${WORKER_NAME}] sendDailySummary error:`, e.message);
  }
}

// ── Main check loop ────────────────────────────────────────
async function tick() {
  logger.info(`[${WORKER_NAME}] Checking for TLL events...`);

  const [newSkills, newQuarantines, regimeShift, cycleErrors] = await Promise.all([
    checkNewSkills(),
    checkNewQuarantines(),
    checkRegimeShift(),
    checkCycleErrors(),
  ]);

  // Send notifications (non-blocking, parallel)
  const promises = [];

  if (newSkills.length) {
    promises.push(sendSkillNotification(newSkills));
    // Also log as agent improvement idea
    promises.push(dedupSendIdea({
      title: `New TLL Skills: ${newSkills.map(s => s.name || s.feature).join(', ')}`,
      description: `${newSkills.length} new trading skills discovered with confidence >= 0.7`,
      type: 'improvement',
      sourceBot: WORKER_NAME,
      metadata: { skillCount: newSkills.length, skills: newSkills.map(s => s.name || s.feature) },
    }, 24).catch(() => {}));
  }

  if (newQuarantines.length) {
    promises.push(sendQuarantineNotification(newQuarantines));
    promises.push(dedupSendIdea({
      title: `Strategies Quarantined: ${newQuarantines.map(q => q.strategy || 'unknown').join(', ')}`,
      description: `${newQuarantines.length} strategies quarantined by TLL healing`,
      type: 'bug',
      sourceBot: WORKER_NAME,
      metadata: { quarantineCount: newQuarantines.length, strategies: newQuarantines.map(q => q.strategy) },
    }, 24).catch(() => {}));
  }

  if (regimeShift) {
    promises.push(sendRegimeNotification(regimeShift));
  }

  if (cycleErrors.length) {
    promises.push(sendErrorNotification(cycleErrors));
  }

  await Promise.all(promises);

  lastCheckTime = new Date().toISOString();
  logger.info(`[${WORKER_NAME}] Check complete — ${newSkills.length} skills, ${newQuarantines.length} quarantines, ${regimeShift ? 'regime shift' : 'no shift'}, ${cycleErrors.length} errors`);
}

// ── Startup ────────────────────────────────────────────────
if (!ENABLED) {
  logger.info(`[${WORKER_NAME}] Disabled via TLL_NOTIFY_ENABLED=false`);
  process.exit(0);
}

if (!TELEGRAM_CHAT_ID) {
  logger.warn(`[${WORKER_NAME}] No TELEGRAM_CHAT_ID set — notifications disabled`);
}

// Initial run after 60s delay (let TLL worker boot first)
setTimeout(tick, 60_000);

// Then on interval
setInterval(tick, CHECK_INTERVAL_MS);

// Daily summary — first run after 120s (let TLL worker boot + first tick complete)
setTimeout(() => {
  sendDailySummary();
  // Then every 24h
  setInterval(sendDailySummary, DAILY_SUMMARY_INTERVAL_MS);
}, 120_000);

logger.info(`[${WORKER_NAME}] Started — checks every ${CHECK_INTERVAL_MS / 60000}min, daily summary every ${DAILY_SUMMARY_INTERVAL_MS / 3600000}h`);
