// ============================================================
// Structured Logger — console + optional file output
// Timestamps in UTC by default; respects LOG_LEVEL env var.
// ============================================================

import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.LOG_LEVEL] ?? 1;

let fileStream = null;
if (config.LOG_TO_FILE && config.LOG_DIR) {
  try {
    if (!fs.existsSync(config.LOG_DIR)) {
      fs.mkdirSync(config.LOG_DIR, { recursive: true });
    }
    const logPath = path.join(config.LOG_DIR, `app-${new Date().toISOString().slice(0,10)}.log`);
    fileStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch (e) {
    console.error('[LOGGER] Failed to open log file:', e.message);
  }
}

function write(level, ...args) {
  if ((LEVELS[level] ?? 1) < currentLevel) return;
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](line);
  if (fileStream) {
    fileStream.write(line + '\n');
  }
}

export const logger = {
  debug: (...args) => write('debug', ...args),
  info: (...args) => write('info', ...args),
  warn: (...args) => write('warn', ...args),
  error: (...args) => write('error', ...args),
};
