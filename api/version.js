// ============================================================
// Version API — xsjprd55
// GET /api/version → app version, git commit, deploy timestamp
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {
    return process.env.GIT_COMMIT || 'unknown';
  }
}

function getGitCommitDate() {
  try {
    return execSync('git log -1 --format=%cI', { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export default async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    ok: true,
    app: 'xsjprd55',
    version: getPackageVersion(),
    commit: getGitCommit(),
    commitDate: getGitCommitDate(),
    branch: getGitBranch(),
    deployedAt: process.env.DEPLOYED_AT || null,
    nodeEnv: process.env.NODE_ENV || 'development',
    status: 'ok',
    uptime: process.uptime()
  }, null, 2));
}
