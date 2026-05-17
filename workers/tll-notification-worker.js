// ============================================================
// TLL Notification Worker — Sends Telegram alerts for TLL events
//
// Watches for:
//   - New trading skills generated (confidence >= 0.7)
//   - Strategies quarantined by healing
//   - Market regime shifts
//   - TLL cycle errors
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
const ENABLED = process.env.TLL_NOTIFY_ENABLED !== 'false';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

// ── State tracking ─────────────────────────────────────────
let lastKnownRegime = null;
let lastCheckTime = new Date(0).toISOString();

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

logger.info(`[${WORKER_NAME}] Started — checks every ${CHECK_INTERVAL_MS / 60000}min`);
