// ============================================================
// Notification Engine — creates alerts and sends Telegram admin alerts.
// Integrates with Supabase system_notifications table.
// ============================================================

import { supabase } from './supabase.js';
import { logger } from './logger.js';
import { config } from './config.js';

/**
 * Create a notification in the database.
 */
export async function createNotification(payload) {
  const notification = {
    level: payload.level || 'info',
    title: payload.title,
    message: payload.message,
    source_name: payload.source || null,
    data_type: payload.dataType || null,
    is_read: false,
    sent_to_telegram: false,
  };

  try {
    const { data, error } = await supabase.from('system_notifications').insert(notification).select().single();
    if (error) throw error;
    logger.info(`[NOTIFICATION] ${notification.level.toUpperCase()}: ${notification.title}`);
    return data;
  } catch (err) {
    logger.error(`[NOTIFICATION] Failed to create notification: ${err.message}`);
    return null;
  }
}

/**
 * Send a Telegram admin alert for critical/warning notifications.
 */
export async function sendTelegramAdminAlert(notification) {
  const adminId = config.TELEGRAM_ADMIN_CHAT_ID || config.TELEGRAM_GROUP_CHAT_ID;
  const botToken = config.TELEGRAM_BOT_TOKEN;
  if (!botToken || !adminId) return;

  const icon = notification.level === 'critical' ? '🚨'
             : notification.level === 'warning' ? '⚠️'
             : 'ℹ️';

  const text = `${icon} *Data Source ${notification.level.toUpperCase()}*\n\n` +
    `*Source:* ${notification.source_name || 'Unknown'}\n` +
    `*Data type:* ${notification.data_type || 'Unknown'}\n` +
    `*Message:* ${notification.message}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: adminId, text, parse_mode: 'Markdown' }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description);

    // Mark as sent
    if (notification.id) {
      await supabase.from('system_notifications').update({ sent_to_telegram: true }).eq('id', notification.id);
    }
    logger.info('[NOTIFICATION] Telegram admin alert sent');
  } catch (err) {
    logger.error(`[NOTIFICATION] Telegram alert failed: ${err.message}`);
  }
}

/**
 * Process unsent critical/warning notifications and alert admin.
 */
export async function processUnsentNotifications() {
  try {
    const { data: rows } = await supabase
      .from('system_notifications')
      .select('*')
      .eq('sent_to_telegram', false)
      .in('level', ['critical', 'warning'])
      .order('created_at', { ascending: true })
      .limit(10);

    for (const n of rows || []) {
      await sendTelegramAdminAlert(n);
    }
  } catch (err) {
    logger.error(`[NOTIFICATION] processUnsentNotifications error: ${err.message}`);
  }
}
