import { config } from '../lib/config.js';

export default function handler(req, res) {
  // Security: only expose non-sensitive config
  res.json({
    deployment_target: config.DEPLOYMENT_TARGET,
    trading_mode: config.TRADING_MODE,
    node_env: config.NODE_ENV,
    default_pairs: config.DEFAULT_PAIRS,
    timeframes: config.TIMEFRAMES,
    features: {
      news: config.ENABLE_NEWS,
      social: config.ENABLE_SOCIAL,
      websocket: config.ENABLE_WEBSOCKET,
    },
    timestamp: new Date().toISOString(),
  });
}
