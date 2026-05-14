// ============================================================
// Backtest Memory — Summarizes backtest results for the brain
// ============================================================

export function summarizeBacktestMemory(rows = []) {
  if (!rows.length) return { total: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0 };
  const wins = rows.filter(r => r.pnl > 0).length;
  const losses = rows.filter(r => r.pnl <= 0).length;
  const totalPnl = rows.reduce((s, r) => s + (r.pnl || 0), 0);
  return {
    total: rows.length,
    wins,
    losses,
    winRate: rows.length ? wins / rows.length : 0,
    totalPnl
  };
}
