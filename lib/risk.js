// ============================================================
// Risk & Safety Gates — xsjprd55
// Blocks unsafe signals before they are saved or broadcast.
// ============================================================

export const REQUIRED_SIGNAL_FIELDS = ['symbol', 'side', 'entry_price', 'generated_at'];

export function validateSignal(raw) {
  const errors = [];
  for (const f of REQUIRED_SIGNAL_FIELDS) {
    if (raw[f] === undefined || raw[f] === null || raw[f] === '') {
      errors.push(`Missing required field: ${f}`);
    }
  }

  if (raw.side && !['LONG', 'SHORT', 'CLOSE'].includes(raw.side)) {
    errors.push(`Invalid side: ${raw.side}`);
  }

  if (raw.confidence !== undefined && (raw.confidence < 0 || raw.confidence > 1)) {
    errors.push('confidence must be between 0 and 1');
  }

  const priceFields = ['entry_price', 'stop_loss', 'take_profit'];
  for (const pf of priceFields) {
    const val = raw[pf];
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        if (val.some(v => typeof v !== 'number' || Number.isNaN(v))) {
          errors.push(`${pf} contains invalid numbers`);
        }
      } else if (typeof val !== 'number' || Number.isNaN(val)) {
        errors.push(`${pf} must be a number`);
      }
    }
  }

  // Stale data gate (>5 min for intraday signals)
  const ts = raw.generated_at || raw.timestamp;
  if (ts) {
    const ageMs = Date.now() - new Date(ts).getTime();
    if (ageMs > 5 * 60 * 1000) {
      errors.push('Signal data is stale (>5 min old)');
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function checkRiskGates(user, proposedSignal, supabase) {
  const issues = [];

  // Max position size
  const maxSize = user?.max_position_size_usd ?? Number(process.env.MAX_POSITION_SIZE_USD || 100);
  const notional = (proposedSignal.quantity || 0) * (proposedSignal.entry_price || 0);
  if (notional > maxSize) {
    issues.push(`Position size $${notional.toFixed(2)} exceeds limit $${maxSize}`);
  }

  // Daily loss limit
  const dailyLimit = user?.daily_loss_limit_usd ?? Number(process.env.DAILY_LOSS_LIMIT_USD || 50);
  const today = new Date().toISOString().slice(0, 10);
  if (supabase) {
    const { data: todaysTrades } = await supabase
      .from('trades')
      .select('pnl')
      .gte('opened_at', today)
      .eq('mode', proposedSignal.mode || 'paper');
    const dailyPnl = (todaysTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0);
    if (dailyPnl < -dailyLimit) {
      issues.push(`Daily loss limit $${dailyLimit} exceeded (current PnL: $${dailyPnl.toFixed(2)})`);
    }
  }

  // Cooldown per symbol
  const cooldownMins = user?.cooldown_minutes ?? Number(process.env.SIGNAL_COOLDOWN_MINUTES || 15);
  if (supabase) {
    const cooldownAgo = new Date(Date.now() - cooldownMins * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('signals')
      .select('generated_at')
      .eq('symbol', proposedSignal.symbol)
      .gte('generated_at', cooldownAgo)
      .order('generated_at', { ascending: false })
      .limit(1);
    if (recent?.length) {
      issues.push(`Cooldown active: last signal for ${proposedSignal.symbol} at ${recent[0].generated_at}`);
    }
  }

  // Live mode gate
  if (proposedSignal.mode === 'live' && !user?.auto_trade_enabled) {
    issues.push('Live auto-trading not enabled for this user');
  }

  return { ok: issues.length === 0, issues };
}

export async function logAudit(supabase, eventType, details = {}) {
  if (!supabase) return;
  try {
    await supabase.from('audit_log').insert({
      event_type: eventType,
      symbol: details.symbol || null,
      user_id: details.user_id || null,
      details
    });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}
