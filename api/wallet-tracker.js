// ============================================================
// Wallet Tracker Dashboard API
// GET /api/wallet-tracker — list tracked wallets + signals
// POST /api/wallet-tracker — add a new wallet to track
// ============================================================

import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { runWalletTracker, calculateWalletMetrics } from '../lib/wallet-tracker.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Get tracked wallets
      const { data: wallets } = await supabase
        .from('tracked_wallets')
        .select('*')
        .order('quality_score', { ascending: false });

      // Get recent wallet signals
      const { data: signals } = await supabase
        .from('signals')
        .select('*')
        .eq('source', 'wallet_tracker')
        .gte('generated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('generated_at', { ascending: false })
        .limit(50);

      // Get recent snapshots
      const { data: snapshots } = await supabase
        .from('wallet_snapshots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      return res.status(200).json({
        wallets: wallets || [],
        signals: signals || [],
        snapshots: snapshots || [],
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(`[WALLET-TRACKER-API] GET error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { address, label } = req.body || {};
      if (!address) {
        return res.status(400).json({ error: 'address is required' });
      }

      // Quick validation via Hyperliquid
      const { getClearinghouseState } = await import('../lib/wallet-tracker.js');
      const state = await getClearinghouseState(address);

      const accountValue = Number(state?.marginSummary?.accountValue) || 0;

      // Save to Supabase
      await supabase.from('tracked_wallets').upsert({
        address,
        label: label || `Wallet ${address.slice(0, 8)}`,
        account_value: accountValue,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address' });

      logger.info(`[WALLET-TRACKER-API] Added wallet ${address}`);
      return res.status(200).json({ ok: true, address, accountValue });
    } catch (err) {
      logger.error(`[WALLET-TRACKER-API] POST error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { address } = req.body || {};
      if (!address) {
        return res.status(400).json({ error: 'address is required' });
      }

      await supabase.from('tracked_wallets').update({ is_active: false }).eq('address', address);
      logger.info(`[WALLET-TRACKER-API] Deactivated wallet ${address}`);
      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(`[WALLET-TRACKER-API] DELETE error: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
