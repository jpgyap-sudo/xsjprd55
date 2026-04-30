// ============================================================
// Bug Severity — Classification and scoring system
// Determines severity based on impact, scope, and context
// ============================================================

/**
 * Severity levels
 */
export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

/**
 * Severity score mapping for sorting
 */
const SEVERITY_SCORES = {
  [SEVERITY.CRITICAL]: 4,
  [SEVERITY.HIGH]: 3,
  [SEVERITY.MEDIUM]: 2,
  [SEVERITY.LOW]: 1
};

/**
 * Classify bug severity based on multiple factors
 * @param {Object} bug
 * @returns {string} Severity level
 */
export function classifySeverity(bug) {
  // Critical: Complete system failure, security breach, data loss
  if (isCritical(bug)) {
    return SEVERITY.CRITICAL;
  }
  
  // High: Major feature broken, performance severely degraded
  if (isHigh(bug)) {
    return SEVERITY.HIGH;
  }
  
  // Medium: Partial feature issues, minor security concerns
  if (isMedium(bug)) {
    return SEVERITY.MEDIUM;
  }
  
  // Low: Cosmetic issues, minor improvements
  return SEVERITY.LOW;
}

/**
 * Check if bug is CRITICAL
 */
function isCritical(bug) {
  const { symptoms = [], evidence = {}, route = '' } = bug;
  
  // Security breaches
  if (symptoms.includes('security_breach') || 
      symptoms.includes('unauthorized_access') ||
      evidence.vulnerability_exploited) {
    return true;
  }
  
  // Complete system failure
  if (evidence.http_status === 503 && route === '/api/health') {
    return true; // Health check failing = system down
  }
  
  // Data corruption or loss
  if (symptoms.includes('data_corruption') || symptoms.includes('data_loss')) {
    return true;
  }
  
  // Trading system failure (for this trading bot)
  if (route.includes('trader') && symptoms.includes('trading_disabled')) {
    return true;
  }
  
  // Signal generation completely broken
  if (route.includes('signal') && symptoms.includes('signal_generation_failed')) {
    return true;
  }
  
  // Telegram bot down (critical notification channel)
  if (route.includes('telegram') && symptoms.includes('webhook_failed')) {
    return true;
  }
  
  return false;
}

/**
 * Check if bug is HIGH
 */
function isHigh(bug) {
  const { symptoms = [], evidence = {}, route = '' } = bug;
  
  // 500 errors on core pages
  if (evidence.http_status === 500 && isCoreRoute(route)) {
    return true;
  }
  
  // SSR errors on main pages
  if (symptoms.includes('ssr_error') && isMainPage(route)) {
    return true;
  }
  
  // Hydration failures
  if (symptoms.includes('hydration_error')) {
    return true;
  }
  
  // Slow response times (>10s)
  if (evidence.response_ms > 10000) {
    return true;
  }
  
  // Console errors on critical paths
  if (symptoms.includes('console_error') && isCoreRoute(route)) {
    return true;
  }
  
  // API failures
  if (symptoms.includes('api_failure') && route.startsWith('/api/')) {
    return true;
  }
  
  // Stale data > 1 hour for real-time features
  if (symptoms.includes('stale_data') && route.includes('signal')) {
    return true;
  }
  
  // Mock trader inactivity
  if (symptoms.includes('trader_inactive')) {
    return true;
  }
  
  return false;
}

/**
 * Check if bug is MEDIUM
 */
function isMedium(bug) {
  const { symptoms = [], evidence = {}, route = '' } = bug;
  
  // 404 errors
  if (evidence.http_status === 404) {
    return true;
  }
  
  // Minor console errors
  if (symptoms.includes('console_warning') || symptoms.includes('console_error')) {
    return true;
  }
  
  // Slow but acceptable response
  if (evidence.response_ms > 5000) {
    return true;
  }
  
  // Non-critical API failures
  if (symptoms.includes('api_failure')) {
    return true;
  }
  
  // Deprecation warnings
  if (symptoms.includes('deprecation_warning')) {
    return true;
  }
  
  return false;
}

/**
 * Check if route is a core/essential route
 */
function isCoreRoute(route) {
  const coreRoutes = [
    '/api/health',
    '/api/signal',
    '/api/mock-trader',
    '/api/telegram',
    '/dashboard',
    '/signals',
    '/mock-trader'
  ];
  return coreRoutes.some(r => route === r || route.startsWith(r + '/'));
}

/**
 * Check if route is a main page
 */
function isMainPage(route) {
  const mainPages = ['/', '/dashboard', '/signals', '/mock-trader', '/research', '/news'];
  return mainPages.includes(route);
}

/**
 * Calculate severity score for sorting
 * @param {string} severity 
 * @param {Object} bug 
 * @returns {number} Higher = more severe
 */
export function calculateSeverityScore(severity, bug = {}) {
  let score = SEVERITY_SCORES[severity] || 0;
  
  // Boost score for certain conditions
  const { evidence = {}, symptoms = [] } = bug;
  
  // Production routes get higher priority
  if (isCoreRoute(bug.route || '')) {
    score += 0.5;
  }
  
  // Errors affecting users directly
  if (symptoms.includes('user_impact')) {
    score += 0.3;
  }
  
  // Repeated errors get higher priority
  if (bug.recurrence_count > 3) {
    score += 0.2;
  }
  
  // Very slow responses
  if (evidence.response_ms > 30000) {
    score += 0.2;
  }
  
  return score;
}

/**
 * Get severity color for UI
 */
export function getSeverityColor(severity) {
  const colors = {
    [SEVERITY.CRITICAL]: '#dc2626', // red-600
    [SEVERITY.HIGH]: '#ea580c',     // orange-600
    [SEVERITY.MEDIUM]: '#ca8a04',   // yellow-600
    [SEVERITY.LOW]: '#16a34a'       // green-600
  };
  return colors[severity] || colors[SEVERITY.LOW];
}

/**
 * Get severity emoji
 */
export function getSeverityEmoji(severity) {
  const emojis = {
    [SEVERITY.CRITICAL]: '🔴',
    [SEVERITY.HIGH]: '🟠',
    [SEVERITY.MEDIUM]: '🟡',
    [SEVERITY.LOW]: '🟢'
  };
  return emojis[severity] || '⚪';
}

/**
 * Should this severity trigger immediate notification?
 */
export function shouldNotifyImmediately(severity) {
  return severity === SEVERITY.CRITICAL || severity === SEVERITY.HIGH;
}

/**
 * Should this severity trigger auto-assignment?
 */
export function shouldAutoAssign(severity) {
  return severity === SEVERITY.CRITICAL || severity === SEVERITY.HIGH;
}
