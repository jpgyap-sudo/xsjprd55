-- Fix: Add binance and bybit to the provider check constraint
-- Run this in Supabase SQL Editor

-- First, drop the existing constraint
ALTER TABLE api_debugger_results
DROP CONSTRAINT IF EXISTS api_debugger_results_provider_check;

-- Re-add the constraint with binance and bybit included
ALTER TABLE api_debugger_results
ADD CONSTRAINT api_debugger_results_provider_check
CHECK (provider IN ('kimi', 'claude', 'binance', 'bybit', 'internal'));

-- Also update the docs_cache provider if there is a similar constraint (usually there isn't)
-- No constraint on docs_cache provider based on current schema
