// ============================================================
// Live Site Crawler — Bug Hunter Agent
// Crawls live website routes, detects errors, captures evidence
// Uses Playwright when available, falls back to fetch
// ============================================================

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { logger } from '../logger.js';

// Routes to monitor
const ROUTES_TO_MONITOR = [
  { path: '/', name: 'Home', type: 'page' },
  { path: '/dashboard', name: 'Dashboard', type: 'page' },
  { path: '/signals', name: 'Signals', type: 'page' },
  { path: '/mock-trader', name: 'Mock Trader', type: 'page' },
  { path: '/research', name: 'Research', type: 'page' },
  { path: '/news', name: 'News', type: 'page' },
  { path: '/api/health', name: 'Health API', type: 'api' },
  { path: '/api/data-health', name: 'Data Health API', type: 'api' },
  { path: '/api/signal', name: 'Signal API', type: 'api' },
  { path: '/api/mock-trading-dashboard', name: 'Mock Trader API', type: 'api' },
  { path: '/api/news', name: 'News API', type: 'api' },
  { path: '/api/telegram', name: 'Telegram API', type: 'api' },
  { path: '/api/research-agent-dashboard', name: 'Research API', type: 'api' },
  { path: '/api/perpetual-trader', name: 'Perpetual Trader API', type: 'api' },
];

/**
 * Crawl a single route using Playwright or fetch fallback
 * @param {string} baseUrl 
 * @param {Object} route 
 * @param {Object} options
 */
export async function crawlRoute(baseUrl, route, options = {}) {
  const { usePlaywright = true, timeout = 15000, captureScreenshot = false } = options;
  const url = `${baseUrl}${route.path}`;
  
  const result = {
    route: route.path,
    name: route.name,
    type: route.type,
    url,
    timestamp: new Date().toISOString(),
    success: false,
    http_status: null,
    response_ms: null,
    console_errors: [],
    api_errors: [],
    symptoms: [],
    evidence: {}
  };
  
  const startTime = Date.now();
  
  try {
    if (usePlaywright && route.type === 'page') {
      // Use Playwright for pages to catch SSR/hydration errors
      await crawlWithPlaywright(url, result, { timeout, captureScreenshot });
    } else {
      // Use fetch for APIs (faster, no browser needed)
      await crawlWithFetch(url, result, { timeout });
    }
    
    result.response_ms = Date.now() - startTime;
    
    // Check for symptoms
    detectSymptoms(result);
    
  } catch (error) {
    result.response_ms = Date.now() - startTime;
    result.success = false;
    result.symptoms.push('crawl_failed');
    result.evidence.error_message = error.message;
    
    if (error.message.includes('timeout')) {
      result.symptoms.push('timeout');
    }
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      result.symptoms.push('server_unreachable');
    }
  }
  
  return result;
}

/**
 * Crawl using Playwright (for pages)
 */
async function crawlWithPlaywright(url, result, options) {
  let browser = null;
  
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();
    
    // Capture console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        result.console_errors.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location()
        });
      }
    });
    
    // Capture page errors
    page.on('pageerror', error => {
      result.console_errors.push({
        type: 'pageerror',
        text: error.message,
        stack: error.stack
      });
    });
    
    // Navigate to page
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: options.timeout
    });
    
    result.http_status = response.status();
    result.success = response.ok();
    
    // Check for hydration errors
    const hasHydrationError = await page.evaluate(() => {
      return document.body.innerText.includes('hydration') ||
             document.body.innerText.includes('minified react error');
    });
    
    if (hasHydrationError) {
      result.symptoms.push('hydration_error');
    }
    
    // Check for SSR errors
    const hasSSRError = await page.evaluate(() => {
      return document.body.innerText.includes('Server Error') ||
             document.body.innerText.includes('Internal Server Error');
    });
    
    if (hasSSRError) {
      result.symptoms.push('ssr_error');
    }
    
    // Capture screenshot if requested
    if (options.captureScreenshot) {
      const screenshotPath = `screenshots/${result.route.replace(/\//g, '_')}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.evidence.screenshot_path = screenshotPath;
    }
    
    // Get page title
    result.evidence.page_title = await page.title();
    
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Crawl using fetch (for APIs)
 */
async function crawlWithFetch(url, result, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BugHunterAgent/1.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    result.http_status = response.status;
    result.success = response.ok;
    
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      const body = await response.json();
      result.evidence.response_body = body;
      
      // Check for API errors in response
      if (body.error || body.ok === false) {
        result.symptoms.push('api_error_response');
        result.api_errors.push(body.error || 'API returned ok: false');
      }
      
      // Check for stale data
      if (body.ts || body.timestamp) {
        const responseTime = new Date(body.ts || body.timestamp);
        const ageMinutes = (Date.now() - responseTime.getTime()) / 60000;
        
        if (ageMinutes > 60) {
          result.symptoms.push('stale_data');
          result.evidence.data_age_minutes = Math.round(ageMinutes);
        }
      }
      
      // Check trading-specific issues
      if (url.includes('trader') || url.includes('trading')) {
        if (!body.openTrades && !body.closedTrades && !body.trades) {
          // Empty trading data might indicate inactivity
          result.evidence.trader_empty = true;
        }
      }
      
      // Check signal generation
      if (url.includes('signal')) {
        if (body.signals && body.signals.length === 0 && body.count === 0) {
          result.evidence.no_active_signals = true;
        }
      }
    } else {
      // Non-JSON response for API endpoint
      const text = await response.text();
      result.evidence.response_preview = text.slice(0, 500);
      
      if (url.includes('/api/') && !contentType.includes('json')) {
        result.symptoms.push('unexpected_content_type');
      }
    }
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Detect symptoms from crawl result
 */
function detectSymptoms(result) {
  // HTTP status checks
  if (result.http_status === 404) {
    result.symptoms.push('404_not_found');
    result.success = false;
  }
  if (result.http_status === 500) {
    result.symptoms.push('500_server_error');
    result.success = false;
  }
  if (result.http_status === 503) {
    result.symptoms.push('503_service_unavailable');
    result.success = false;
  }
  
  // Slow response
  if (result.response_ms > 10000) {
    result.symptoms.push('slow_response');
  }
  if (result.response_ms > 30000) {
    result.symptoms.push('very_slow_response');
  }
  
  // Console errors
  if (result.console_errors.length > 0) {
    result.symptoms.push('console_errors');
  }
  
  // API errors
  if (result.api_errors.length > 0) {
    result.symptoms.push('api_failure');
  }
  
  // Trading-specific
  if (result.evidence.trader_empty && result.type === 'api') {
    result.symptoms.push('trader_inactive');
  }
  if (result.evidence.no_active_signals && result.route.includes('signal')) {
    result.symptoms.push('signal_generation_failed');
  }
}

/**
 * Crawl all monitored routes
 */
export async function crawlAllRoutes(baseUrl, options = {}) {
  logger.info(`[LIVE-SITE-CRAWLER] Starting crawl of ${ROUTES_TO_MONITOR.length} routes`);
  
  const results = [];
  
  for (const route of ROUTES_TO_MONITOR) {
    try {
      const result = await crawlRoute(baseUrl, route, options);
      results.push(result);
      
      // Log issues immediately
      if (!result.success || result.symptoms.length > 0) {
        logger.warn(`[LIVE-SITE-CRAWLER] Issue detected on ${route.path}:`, {
          status: result.http_status,
          symptoms: result.symptoms,
          response_ms: result.response_ms
        });
      }
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
      
    } catch (error) {
      logger.error(`[LIVE-SITE-CRAWLER] Failed to crawl ${route.path}:`, error.message);
      results.push({
        route: route.path,
        name: route.name,
        success: false,
        symptoms: ['crawl_exception'],
        evidence: { error: error.message }
      });
    }
  }
  
  logger.info(`[LIVE-SITE-CRAWLER] Crawl complete. ${results.filter(r => r.success).length}/${results.length} routes OK`);
  
  return results;
}

/**
 * Check if Playwright is available
 */
export async function isPlaywrightAvailable() {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

export { ROUTES_TO_MONITOR };
