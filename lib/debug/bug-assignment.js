// ============================================================
// Bug Assignment — Route bugs to appropriate agents
// Determines which agent should handle each bug type
// ============================================================

export const AGENTS = {
  DEBUGGER: 'DebuggerAgent',
  SWE: 'SWE-agent',
  TESTER: 'TesterAgent',
  DEVOPS: 'DevOpsAgent',
  SECURITY: 'SecurityAgent'
};

/**
 * Assign bug to appropriate agent based on bug characteristics
 * @param {Object} bug
 * @returns {Object} Assignment details
 */
export function assignBug(bug) {
  const owner = determineOwner(bug);
  const nextAction = determineNextAction(bug, owner);
  
  return {
    recommended_owner: owner,
    recommended_next_action: nextAction,
    auto_assign_eligible: shouldAutoAssign(bug, owner),
    reasoning: generateReasoning(bug, owner)
  };
}

/**
 * Determine which agent should own this bug
 */
function determineOwner(bug) {
  const { route = '', symptoms = [], title = '' } = bug;
  const lowerRoute = route.toLowerCase();
  const lowerTitle = title.toLowerCase();
  
  // Security issues → SecurityAgent
  if (symptoms.includes('security_breach') ||
      symptoms.includes('unauthorized_access') ||
      symptoms.includes('vulnerability') ||
      lowerTitle.includes('security') ||
      lowerTitle.includes('secret') ||
      lowerTitle.includes('auth')) {
    return AGENTS.SECURITY;
  }
  
  // Infrastructure/Deployment issues → DevOpsAgent
  if (symptoms.includes('deployment_failed') ||
      symptoms.includes('server_down') ||
      symptoms.includes('ssl_error') ||
      lowerRoute.includes('health') ||
      lowerTitle.includes('deploy') ||
      lowerTitle.includes('server') ||
      lowerTitle.includes('infrastructure')) {
    return AGENTS.DEVOPS;
  }
  
  // Frontend/UI issues → SWE-agent (frontend)
  if (symptoms.includes('hydration_error') ||
      symptoms.includes('ssr_error') ||
      symptoms.includes('console_error') ||
      lowerRoute === '/' ||
      lowerRoute.includes('dashboard') ||
      lowerTitle.includes('ui') ||
      lowerTitle.includes('css') ||
      lowerTitle.includes('render')) {
    return AGENTS.SWE;
  }
  
  // API/Backend logic issues → SWE-agent (backend)
  if (lowerRoute.startsWith('/api/') && 
      !lowerRoute.includes('health') &&
      !lowerRoute.includes('telegram')) {
    return AGENTS.SWE;
  }
  
  // Trading logic issues → DebuggerAgent (domain expert)
  if (lowerRoute.includes('trader') ||
      lowerRoute.includes('signal') ||
      lowerRoute.includes('backtest') ||
      lowerTitle.includes('trading') ||
      lowerTitle.includes('signal') ||
      lowerTitle.includes('strategy')) {
    return AGENTS.DEBUGGER;
  }
  
  // Test-related issues → TesterAgent
  if (lowerRoute.includes('test') ||
      symptoms.includes('test_failure') ||
      lowerTitle.includes('test')) {
    return AGENTS.TESTER;
  }
  
  // Telegram/Webhook issues → DebuggerAgent
  if (lowerRoute.includes('telegram') ||
      symptoms.includes('webhook_failed')) {
    return AGENTS.DEBUGGER;
  }
  
  // Default: SWE-agent for general bugs
  return AGENTS.SWE;
}

/**
 * Determine the next action for this bug
 */
function determineNextAction(bug, owner) {
  const { severity, symptoms = [] } = bug;
  
  // Critical bugs need immediate attention
  if (severity === 'critical') {
    return 'Immediate investigation required. Check production logs and roll back if needed.';
  }
  
  // Security issues
  if (owner === AGENTS.SECURITY) {
    return 'Assess vulnerability scope, implement fix, and rotate any exposed credentials.';
  }
  
  // Hydration/SSR errors
  if (symptoms.includes('hydration_error')) {
    return 'Check for mismatched server/client rendering. Review recent React/Next.js changes.';
  }
  
  // API failures
  if (symptoms.includes('api_failure')) {
    return 'Check API endpoint logic, database connections, and external service dependencies.';
  }
  
  // Console errors
  if (symptoms.includes('console_error')) {
    return 'Reproduce in browser dev tools, trace error to source component.';
  }
  
  // Stale data
  if (symptoms.includes('stale_data')) {
    return 'Check worker/cron job status, verify database writes, check Supabase connection.';
  }
  
  // Trader issues
  if (symptoms.includes('trader_inactive')) {
    return 'Check execution-worker status, verify Supabase tables, review trading config.';
  }
  
  // Default action
  return 'Investigate root cause, reproduce locally, implement fix with tests.';
}

/**
 * Should this bug be auto-assigned?
 */
function shouldAutoAssign(bug, owner) {
  // Only auto-assign critical/high severity
  if (bug.severity !== 'critical' && bug.severity !== 'high') {
    return false;
  }
  
  // Don't auto-assign security issues (need manual review)
  if (owner === AGENTS.SECURITY) {
    return false;
  }
  
  // Don't auto-assign if it's a duplicate
  if (bug.is_duplicate) {
    return false;
  }
  
  return true;
}

/**
 * Generate reasoning for assignment
 */
function generateReasoning(bug, owner) {
  const reasons = {
    [AGENTS.SECURITY]: 'Security-related issue requiring security expertise.',
    [AGENTS.DEVOPS]: 'Infrastructure/deployment issue affecting system availability.',
    [AGENTS.SWE]: 'Code implementation issue requiring software engineering skills.',
    [AGENTS.DEBUGGER]: 'Trading system logic issue requiring domain expertise.',
    [AGENTS.TESTER]: 'Test-related issue or quality assurance concern.'
  };
  
  return reasons[owner] || 'General bug fix required.';
}

/**
 * Get affected files guess based on bug characteristics
 */
export function guessAffectedFiles(bug) {
  const { route = '', symptoms = [] } = bug;
  const guesses = [];
  
  // Route-based guesses
  if (route.startsWith('/api/')) {
    const apiPath = route.replace('/api/', '');
    guesses.push(`api/${apiPath}.js`);
    guesses.push(`api/${apiPath}/index.js`);
  }
  
  if (route.includes('trader')) {
    guesses.push('workers/execution-worker.js');
    guesses.push('lib/mock-trading/execution-engine.js');
    guesses.push('lib/mock-trading/aggressive-engine.js');
  }
  
  if (route.includes('signal')) {
    guesses.push('workers/continuous-backtester.js');
    guesses.push('lib/signal-engine.js');
    guesses.push('api/signals.js');
  }
  
  if (route.includes('telegram')) {
    guesses.push('lib/telegram.js');
    guesses.push('api/telegram.js');
  }
  
  // Symptom-based guesses
  if (symptoms.includes('hydration_error')) {
    guesses.push('public/index.html');
    guesses.push('pages/**/*.js');
  }
  
  if (symptoms.includes('ssr_error')) {
    guesses.push('pages/api/*.js');
    guesses.push('lib/ssr-helpers.js');
  }
  
  return [...new Set(guesses)];
}

/**
 * Create task for bug fix pipeline
 */
export function createFixTask(bug) {
  const assignment = assignBug(bug);
  
  return {
    task_type: 'bug_fix',
    bug_id: bug.bug_id,
    title: `Fix: ${bug.title}`,
    description: bug.description || bug.title,
    severity: bug.severity,
    assigned_to: assignment.recommended_owner,
    status: assignment.auto_assign_eligible ? 'assigned' : 'pending_review',
    affected_files: guessAffectedFiles(bug),
    route: bug.route,
    symptoms: bug.symptoms,
    evidence: bug.evidence,
    created_at: new Date().toISOString(),
    metadata: {
      assignment_reasoning: assignment.reasoning,
      next_action: assignment.recommended_next_action,
      auto_assigned: assignment.auto_assign_eligible
    }
  };
}
