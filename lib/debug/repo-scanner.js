// ============================================================
// Repo Scanner — Deep Crawler for xsjprd55
// Recursively scans codebase, extracts content, builds summaries.
// ============================================================

import fs from 'fs/promises';
import path from 'path';

const DEFAULT_INCLUDE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.sql', '.md', '.yml', '.yaml',
  '.env.example', '.dockerfile', '.sh'
]);

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.vercel', '.cache', 'tmp', 'logs',
  '.roo', '.temp'
]);

const DEFAULT_IGNORE_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'LICENSE',
  'CHANGELOG.md'
]);

/**
 * Scan repository files recursively.
 * @param {Object} options
 * @param {string} options.root — scan root directory
 * @param {number} options.maxFiles — max files to scan
 * @param {number} options.maxFileChars — max characters per file
 */
export async function scanRepoFiles({
  root = process.env.DEBUG_CRAWLER_ROOT || '.',
  maxFiles = Number(process.env.DEBUG_CRAWLER_MAX_FILES || 150),
  maxFileChars = Number(process.env.DEBUG_CRAWLER_MAX_FILE_CHARS || 15000)
} = {}) {
  const files = [];
  const absRoot = path.resolve(root);

  async function walk(dir) {
    if (files.length >= maxFiles) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const full = path.join(dir, entry.name);
      const rel = path.relative(absRoot, full).replaceAll('\\', '/');

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }

      if (!entry.isFile()) continue;
      if (DEFAULT_IGNORE_FILES.has(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const isEnvExample = entry.name.endsWith('.env.example') || entry.name === '.env.example';
      const isDockerfile = entry.name.toLowerCase().includes('dockerfile');

      if (!DEFAULT_INCLUDE_EXTENSIONS.has(ext) && !isEnvExample && !isDockerfile) continue;

      let content = '';
      try {
        content = await fs.readFile(full, 'utf8');
      } catch {
        continue;
      }

      files.push({
        path: rel,
        extension: ext || entry.name,
        size_chars: content.length,
        truncated: content.length > maxFileChars,
        content: content.slice(0, maxFileChars)
      });
    }
  }

  await walk(absRoot);
  return files;
}

/**
 * Build a repository summary from scanned files.
 * Used by neural reviewers for context.
 */
export function summarizeRepo(files) {
  const byFolder = {};
  const byExt = {};
  const imports = new Set();
  const exports = new Set();

  for (const file of files) {
    const folder = file.path.split('/')[0] || '.';
    byFolder[folder] = (byFolder[folder] || 0) + 1;
    byExt[file.extension] = (byExt[file.extension] || 0) + 1;

    // Extract import patterns for dependency graph hints
    const importMatches = file.content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
    importMatches.forEach(m => {
      const match = m.match(/from\s+['"]([^'"]+)['"]/);
      if (match && !match[1].startsWith('.')) imports.add(match[1]);
    });

    // Extract export patterns
    const exportMatches = file.content.match(/export\s+(default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g) || [];
    exportMatches.forEach(m => {
      const nameMatch = m.match(/\s+(\w+)$/);
      if (nameMatch) exports.add(nameMatch[1]);
    });
  }

  return {
    files_scanned: files.length,
    folders: byFolder,
    extensions: byExt,
    external_dependencies: Array.from(imports).slice(0, 50),
    exported_symbols: Array.from(exports).slice(0, 50),
    important_files: files
      .filter(f =>
        /^(api|lib|workers|supabase|public|scripts)\//.test(f.path) ||
        ['server.js','package.json','Dockerfile','docker-compose.yml','ecosystem.config.cjs'].includes(f.path)
      )
      .map(f => f.path)
  };
}
