// ============================================================
// Coder Changelog Worker — xsjprd55
// Automatically tracks coder changes and updates CODER-CHANGELOG.md
// Run: node workers/coder-changelog-worker.js
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { isMainModule } from '../lib/entrypoint.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const CHANGELOG_PATH = path.join(__dirname, '..', 'CODER-CHANGELOG.md');
const SIGNATURE_PATH = path.join(__dirname, '..', '.coder-signature.json');

// Load coder signatures
function loadCoders() {
  try {
    const data = fs.readFileSync(SIGNATURE_PATH, 'utf8');
    return JSON.parse(data).coders;
  } catch (e) {
    console.error('[changelog-worker] Failed to load coders:', e.message);
    return [];
  }
}

// Parse commit message for coder signature
function parseSignature(message) {
  const match = message.match(/^\[(SB|SA|RS|VD|DOC|AUTO)\]/);
  return match ? match[1] : null;
}

// Get recent commits
function getRecentCommits(limit = 20) {
  try {
    const output = execSync(
      `git log --pretty=format:"%h|%s|%an|%ad" --date=iso -${limit}`,
      { encoding: 'utf8', cwd: path.join(__dirname, '..') }
    );
    return output.trim().split('\n').map(line => {
      const [hash, subject, author, date] = line.split('|');
      return { hash, subject, author, date, signature: parseSignature(subject) };
    });
  } catch (e) {
    console.error('[changelog-worker] Failed to get commits:', e.message);
    return [];
  }
}

// Get changed files for a commit
function getChangedFiles(hash) {
  try {
    const output = execSync(
      `git show --name-only --pretty=format: ${hash}`,
      { encoding: 'utf8', cwd: path.join(__dirname, '..') }
    );
    return output.trim().split('\n').filter(f => f.length > 0);
  } catch (e) {
    return [];
  }
}

// Update changelog with new entry
function updateChangelog(commits) {
  try {
    let changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const coders = loadCoders();
    
    // Find commits not yet in changelog
    const newCommits = commits.filter(c => !changelog.includes(c.hash));
    
    if (newCommits.length === 0) {
      console.log('[changelog-worker] No new commits to add');
      return;
    }
    
    // Group commits by date
    const byDate = {};
    newCommits.forEach(c => {
      const date = c.date.split('T')[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(c);
    });
    
    // Build new entries
    let newEntries = '';
    Object.entries(byDate).forEach(([date, dateCommits]) => {
      dateCommits.forEach(c => {
        const sig = c.signature || 'AUTO';
        const coder = coders.find(cdr => cdr.id === sig.toLowerCase());
        const sigFull = coder ? `[${sig}] ${coder.name}` : `[${sig}]`;
        const files = getChangedFiles(c.hash);
        
        newEntries += `\n### ${date} — ${c.subject.replace(/^\[.*?\]\s*/, '')}\n\n`;
        newEntries += `**Coder:** ${sigFull}  \n`;
        newEntries += `**Commit:** \`${c.hash}\`  \n`;
        newEntries += `**Author:** ${c.author}\n\n`;
        
        if (files.length > 0) {
          newEntries += `#### Files Changed:\n`;
          files.slice(0, 5).forEach(f => {
            newEntries += `- \`${f}\`\n`;
          });
          if (files.length > 5) {
            newEntries += `- ... and ${files.length - 5} more files\n`;
          }
          newEntries += '\n';
        }
        
        newEntries += `#### Deployment Status:\n`;
        newEntries += `- ⏸️ Pending deployment verification\n\n`;
      });
    });
    
    // Insert after "## 🔄 Update History (Newest First)"
    const insertMarker = '## 🔄 Update History (Newest First)';
    const insertPos = changelog.indexOf(insertMarker) + insertMarker.length;
    
    const updated = changelog.slice(0, insertPos) + newEntries + changelog.slice(insertPos);
    
    fs.writeFileSync(CHANGELOG_PATH, updated);
    console.log(`[changelog-worker] Updated changelog with ${newCommits.length} new commits`);
    
  } catch (e) {
    console.error('[changelog-worker] Failed to update changelog:', e.message);
  }
}

// Main function
function main() {
  console.log('[changelog-worker] Starting changelog update...');
  const commits = getRecentCommits(10);
  updateChangelog(commits);
  console.log('[changelog-worker] Done');
}

// Run if executed directly
if (isMainModule(import.meta.url)) {
  main();
}

export { getRecentCommits, updateChangelog, parseSignature };
