export function assertAdvisorOnly(action = 'unknown') {
  const allowLive = String(process.env.ALLOW_LIVE_TRADING || 'false').toLowerCase() === 'true';
  const appMode = process.env.APP_MODE || 'advisor';
  const tradingMode = process.env.TRADING_MODE || 'paper';

  if (allowLive || appMode !== 'advisor' || tradingMode === 'live') {
    throw new Error(
      `Blocked unsafe action "${action}". This project must run advisor-only: APP_MODE=advisor, TRADING_MODE=paper, ALLOW_LIVE_TRADING=false`
    );
  }
  return true;
}

export function sanitizeTradingRecommendation(report) {
  return {
    ...report,
    execution_allowed: false,
    advisor_only: true,
    disclaimer: 'Advisor only. Not financial advice. Manual decision required. No automatic trading.'
  };
}
