// ============================================================
// Weekly Trading Performance Report
// Cron: Sunday 04:00 UTC (or manual GET/POST)
// Aggregates PnL, win rate, and strategy breakdown from trades.
// ============================================================

import { supabase } from '../lib/supabase.js';
import { sendTelegram } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isManual = req.method === 'POST';

  // Cron protection: GET requests require x-cron-secret header
  if (!isManual) {
    const cronSecret = process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'];
    if (cronSecret && provided !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoISO = weekAgo.toISOString();

  try {
    // ── Weekly trades ─────────────────────────────────────────
    const { data: trades, error: tradesErr } = await supabase
      .from('trades')
      .select('*')
      .gte('opened_at', weekAgoISO)
      .order('opened_at', { ascending: false });

    if (tradesErr) throw tradesErr;

    const closed = (trades || []).filter(t => t.status === 'closed');
    const open = (trades || []).filter(t => t.status === 'open');

    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalPnlPct = closed.length
      ? closed.reduce((s, t) => s + (t.pnl_percent || 0), 0) / closed.length
      : 0;
    const wins = closed.filter(t => (t.pnl || 0) > 0).length;
    const losses = closed.filter(t => (t.pnl || 0) < 0).length;
    const breakeven = closed.filter(t => (t.pnl || 0) === 0).length;
    const winRate = closed.length ? ((wins / closed.length) * 100).toFixed(1) : 0;

    // ── Strategy performance ──────────────────────────────────
    const signalIds = closed.filter(t => t.signal_id).map(t => t.signal_id);
    let strategyStats = {};

    if (signalIds.length) {
      const { data: sigs } = await supabase
        .from('signals')
        .select('id, strategy')
        .in('id', signalIds);

      const stratMap = new Map((sigs || []).map(s => [s.id, s.strategy]));

      for (const t of closed) {
        const strat = stratMap.get(t.signal_id) || 'Unknown';
        if (!strategyStats[strat]) strategyStats[strat] = { pnl: 0, count: 0, wins: 0 };
        strategyStats[strat].pnl += (t.pnl || 0);
        strategyStats[strat].count += 1;
        if ((t.pnl || 0) > 0) strategyStats[strat].wins += 1;
      }
    }

    // ── Build report ──────────────────────────────────────────
    let msg = `📊 *Weekly Trading Report*\n`;
    msg += `_${weekAgo.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}_\n\n`;

    msg += `*Trades:* ${trades?.length || 0} total | ${closed.length} closed | ${open.length} open\n`;
    msg += `*PnL:* $${totalPnl.toFixed(2)} | Avg: ${totalPnlPct.toFixed(2)}%\n`;
    msg += `*Win Rate:* ${winRate}% (${wins}W / ${losses}L`;
    if (breakeven) msg += ` / ${breakeven}BE`;
    msg += `)\n\n`;

    if (Object.keys(strategyStats).length) {
      msg += `*By Strategy:*\n`;
      for (const [st, stat] of Object.entries(strategyStats)) {
        const emoji = stat.pnl >= 0 ? '🟢' : '🔴';
        const sWinRate = stat.count ? ((stat.wins / stat.count) * 100).toFixed(0) : 0;
        msg += `${emoji} ${st}: $${stat.pnl.toFixed(2)} (${stat.count} trades, ${sWinRate}% WR)\n`;
      }
      msg += `\n`;
    }

    if (open.length) {
      msg += `*Still Open:*\n`;
      for (const t of open.slice(0, 5)) {
        msg += `• ${t.side} ${t.symbol} @ ${t.entry_price} [${t.mode}]\n`;
      }
    }

    await sendTelegram(null, msg);

    return res.status(200).json({
      success: true,
      period: `${weekAgo.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`,
      trades: { total: trades?.length || 0, closed: closed.length, open: open.length },
      pnl: totalPnl,
      winRate: `${winRate}%`,
      byStrategy: strategyStats
    });
  } catch (e) {
    console.error('Weekly analysis error:', e);
    return res.status(500).json({ error: e.message });
  }
}
