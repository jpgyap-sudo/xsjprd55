// ============================================================
// Bug Signature — Deduplication and fingerprinting
// Generates unique signatures for bugs to prevent duplicates
// ============================================================

import crypto from 'crypto';

/**
 * Generate a unique signature for a bug based on route + title + error
 * @param {Object} bug
 * @param {string} bug.route - API route or page URL
 * @param {string} bug.title - Bug title
 * @param {string} [bug.errorMessage] - Error message
 * @param {number} [bug.httpStatus] - HTTP status code
 * @returns {string} Unique signature hash
 */
export function generateBugSignature(bug) {
  const normalizedRoute = (bug.route || 'unknown').toLowerCase().trim();
  const normalizedTitle = (bug.title || 'untitled').toLowerCase().trim();
  
  // Extract key error patterns (remove timestamps, random IDs, etc.)
  const errorPattern = normalizeErrorPattern(bug.errorMessage || '');
  
  const signatureData = [
    normalizedRoute,
    normalizedTitle,
    errorPattern,
    bug.httpStatus || '0'
  ].join('::');
  
  return crypto
    .createHash('sha256')
    .update(signatureData)
    .digest('hex')
    .slice(0, 16); // First 16 chars is enough for uniqueness
}

/**
 * Normalize error message to extract pattern
 * Removes variable data like timestamps, IDs, hashes
 */
function normalizeErrorPattern(errorMessage) {
  if (!errorMessage) return '';
  
  return errorMessage
    .toLowerCase()
    // Remove timestamps
    .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(\.\d{3})?z?/g, '<TIMESTAMP>')
    // Remove UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    // Remove MongoDB/ObjectIDs
    .replace(/[0-9a-f]{24}/g, '<ID>')
    // Remove numbers (often variable)
    .replace(/\b\d+\b/g, '<N>')
    // Remove hex hashes
    .replace(/\b[0-9a-f]{32,64}\b/g, '<HASH>')
    // Remove quoted strings (often variable data)
    .replace(/['"`][^'"`]{10,}['"`]/g, '<STRING>')
    // Remove stack trace line numbers
    .replace(/:\d+:\d+/g, ':<LINE>:<COL>')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200); // Limit length
}

/**
 * Check if a bug is duplicate based on existing signatures
 * @param {Object} newBug - New bug to check
 * @param {Array} existingBugs - Array of existing bug objects with signatures
 * @returns {Object|null} Duplicate bug if found, null otherwise
 */
export function findDuplicateBug(newBug, existingBugs) {
  const newSignature = generateBugSignature(newBug);
  
  return existingBugs.find(existing => {
    // Check exact signature match
    if (existing.signature === newSignature) return true;
    
    // Check fuzzy match: same route + similar title
    if (existing.route === newBug.route) {
      const titleSimilarity = calculateStringSimilarity(
        existing.title.toLowerCase(),
        newBug.title.toLowerCase()
      );
      if (titleSimilarity > 0.85) return true;
    }
    
    return false;
  }) || null;
}

/**
 * Calculate string similarity (0-1) using Levenshtein distance
 */
function calculateStringSimilarity(str1, str2) {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein edit distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Generate bug ID in format BUG-YYYYMMDD-HHMMSS-XXX
 */
export function generateBugId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `BUG-${date}-${time}-${random}`;
}

/**
 * Create a complete bug signature object with all metadata
 */
export function createBugSignature(bugData) {
  return {
    id: generateBugId(),
    signature: generateBugSignature(bugData),
    created_at: new Date().toISOString(),
    // Store normalized components for debugging
    components: {
      route: (bugData.route || 'unknown').toLowerCase().trim(),
      title: (bugData.title || 'untitled').toLowerCase().trim(),
      error_pattern: normalizeErrorPattern(bugData.errorMessage || ''),
      http_status: bugData.httpStatus || 0
    }
  };
}

/**
 * Rate limiting check: has similar bug been reported recently?
 * @param {Object} bug - Bug to check
 * @param {Array} recentBugs - Recent bugs from the last N minutes
 * @param {number} windowMinutes - Time window to check (default 60)
 * @returns {boolean} True if rate limited
 */
export function isRateLimited(bug, recentBugs, windowMinutes = 60) {
  const newSignature = generateBugSignature(bug);
  const cutoffTime = new Date(Date.now() - windowMinutes * 60 * 1000);
  
  return recentBugs.some(existing => {
    // Same signature
    if (existing.signature !== newSignature) return false;
    
    // Within time window
    const existingTime = new Date(existing.created_at || existing.timestamp);
    return existingTime > cutoffTime;
  });
}
