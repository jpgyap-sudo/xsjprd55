#!/usr/bin/env node
// ============================================================
// Pre-Deploy Validation — Run before deploying to VPS
// Checks: credentials are real, schema.sql was run, .env complete
// ============================================================

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_ENVS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_ADMIN_USER_ID',
];

const OPTIONAL_ENVS = [
  'BINANCE_API_KEY',
  'BYBIT_API_KEY',
  'OKX_API_KEY',
];

function isPlaceholder(val) {
  return !val || val.startsWith('your-') || val === 'none' || val === '';
}

async function checkSupabase(url, key) {
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.from('signals').select('id').limit(1);
    if (error && error.code === '42P01') {
      return { ok: false, msg: 'Table "signals" does not exist — run schema.sql in Supabase SQL Editor' };
    }
    if (error) return { ok: false, msg: error.message };
    return { ok: true, msg: 'Connected, signals table exists' };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function checkTelegram(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = await res.json();
    if (!json.ok) return { ok: false, msg: json.description };
    return { ok: true, msg: `Bot: @${json.result.username}` };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

async function main() {
  console.log('========================================');
  console.log('Pre-Deploy Checklist');
  console.log('========================================\n');

  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found');
    process.exit(1);
  }

  // Parse .env manually (no dotenv needed)
  const envText = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }

  let issues = 0;

  // 1. Required envs
  console.log('1. Required Environment Variables');
  for (const key of REQUIRED_ENVS) {
    const val = env[key];
    if (isPlaceholder(val)) {
      console.log(`   ❌ ${key}: missing or placeholder`);
      issues++;
    } else {
      console.log(`   ✅ ${key}: set`);
    }
  }

  // 2. Optional envs
  console.log('\n2. Optional Environment Variables');
  for (const key of OPTIONAL_ENVS) {
    const val = env[key];
    if (isPlaceholder(val)) {
      console.log(`   ⚠️  ${key}: missing (API fallback to public/crawler will be used)`);
    } else {
      console.log(`   ✅ ${key}: set`);
    }
  }

  // 3. Supabase connection
  console.log('\n3. Supabase Connection');
  if (!isPlaceholder(env.SUPABASE_URL) && !isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY)) {
    const result = await checkSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    console.log(`   ${result.ok ? '✅' : '❌'} ${result.msg}`);
    if (!result.ok) issues++;
  } else {
    console.log('   ❌ Skipped — credentials are placeholders');
    issues++;
  }

  // 4. Telegram bot
  console.log('\n4. Telegram Bot');
  if (!isPlaceholder(env.TELEGRAM_BOT_TOKEN)) {
    const result = await checkTelegram(env.TELEGRAM_BOT_TOKEN);
    console.log(`   ${result.ok ? '✅' : '❌'} ${result.msg}`);
    if (!result.ok) issues++;
  } else {
    console.log('   ❌ Skipped — token is placeholder');
    issues++;
  }

  // 5. Webhook secret
  console.log('\n5. Webhook Secret');
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (isPlaceholder(secret)) {
    console.log('   ❌ TELEGRAM_WEBHOOK_SECRET is placeholder — generate one for production');
    issues++;
  } else if (secret.length < 16) {
    console.log('   ⚠️  TELEGRAM_WEBHOOK_SECRET is short (< 16 chars) — recommended: 32+ chars');
  } else {
    console.log('   ✅ Webhook secret is set');
  }

  // 6. Schema check
  console.log('\n6. Schema Validation');
  const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.log('   ❌ schema.sql not found');
    issues++;
  } else {
    console.log('   ✅ schema.sql found — ensure it was run in Supabase SQL Editor');
  }

  console.log('\n========================================');
  if (issues === 0) {
    console.log('✅ All checks passed — ready to deploy!');
    console.log('   Run: bash scripts/deploy-vps.sh');
  } else {
    console.log(`❌ ${issues} issue(s) found — fix before deploying`);
  }
  console.log('========================================');
  process.exit(issues > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
