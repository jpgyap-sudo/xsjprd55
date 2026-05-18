export const WORKER_GROUPS = {
  core: [
    'trading-signal-bot',
    'signal-generator-worker',
    'execution-worker',
    'perpetual-trader-worker',
    'mock-trading-worker',
    'aggressive-mock-worker',
    'notification-worker',
  ],
  market_data: [
    'social-news-worker',
    'news-ingest-worker',
    'news-signal-worker',
    'liquidation-intel-worker',
    'liquidation-heatmap-worker',
    'open-interest-worker',
    'social-crawler-worker',
    'wallet-tracker-worker',
    'data-health-worker',
  ],
  research_learning: [
    'research-agent-worker',
    'continuous-backtester',
    'learning-loop-worker',
    'trading-brain-worker',
    'trading-learning-worker',
    'simulation-learning-worker',
    'trading-learning-layer-worker',
    'tll-notification-worker',
    'backtest-sync-worker',
  ],
  ops_monitoring: [
    'diagnostic-agent',
    'diagnostic-worker',
    'api-debugger',
    'debug-crawler',
    'continuous-test-monitor',
    'strategy-monitor-worker',
  ],
  automation_devtools: [
    'bug-hunter-worker',
    'bug-fix-pipeline',
    'capability-consolidator',
    'app-improvement-worker',
    'coder-changelog-worker',
    'secretary',
    'deploy-checker',
    'vps-deployer-agent',
    'openclaw-analysis-worker',
  ],
};

const GROUP_LOOKUP = new Map(
  Object.entries(WORKER_GROUPS).flatMap(([group, names]) => names.map((name) => [name, group]))
);

export function getWorkerGroup(name) {
  return GROUP_LOOKUP.get(name) || 'unclassified';
}

export function groupWorkerNames(names = []) {
  return names.reduce((groups, name) => {
    const group = getWorkerGroup(name);
    groups[group] ||= [];
    groups[group].push(name);
    return groups;
  }, {});
}
