# Research Agent Promotion Gate v2 — Architecture Plan

## Current Problems Identified

| # | Problem | Location | Severity |
|---|---------|----------|----------|
| 1 | Auto-promotes with only **5 trades and 54% win rate** | [`workers/research-agent-worker.js:162`](workers/research-agent-worker.js:162) | 🔴 Critical |
| 2 | **Random features** in backtests (funding, OI, liq, sentiment, whale, spread all use `Math.random()`) | [`lib/ml/backtestEngine.js:100-109`](lib/ml/backtestEngine.js:100-109) | 🔴 Critical |
| 3 | **Dummy candles** can trigger promotion (no synthetic flag) | [`lib/ml/backtestEngine.js:307`](lib/ml/backtestEngine.js:307) | 🔴 Critical |
| 4 | No **walk-forward validation** (train/val/test split) | Missing entirely | 🟠 High |
| 5 | Promotes by **win rate only**, not expectancy | [`lib/ml/feedbackLoop.js:63`](lib/ml/feedbackLoop.js:63) | 🟠 High |
| 6 | No **quarantine stage** between backtest and mock approval | Missing entirely | 🟠 High |
| 7 | No **source credibility scoring** | Missing entirely | 🟡 Medium |
| 8 | **Duplicate strategy detection** — names use `composite_${Date.now()}` | [`lib/ml/strategyExtractor.js:123`](lib/ml/strategyExtractor.js:123) | 🟡 Medium |
| 9 | No **failure memory** — why strategies failed is not stored | Missing entirely | 🟡 Medium |
| 10 | No **regime-aware ranking** | Missing entirely | 🟢 Low |

## Architecture: Promotion Gate v2

### New Files

```
lib/ml/
├── promotionGate.js        ← NEW: Central promotion gate with all checks
├── walkForwardValidator.js ← NEW: Train/val/test split validation
├── sourceCredibility.js    ← NEW: Source credibility scoring
├── duplicateDetector.js    ← NEW: Rule-hash based dedup
├── failureMemory.js        ← NEW: Stores why strategies failed
├── regimeRanker.js         ← NEW: Regime-aware strategy ranking
└── quarantineManager.js    ← NEW: Quarantine stage management
```

### Modified Files

```
lib/ml/
├── backtestEngine.js       ← MODIFIED: Remove Math.random(), add synthetic flag, add walk-forward
├── strategyLifecycle.js    ← MODIFIED: Add quarantine status, stricter approval gate
├── strategyExtractor.js    ← MODIFIED: Add rule-hash dedup, source credibility
├── feedbackLoop.js         ← MODIFIED: Promote by expectancy, not win rate
├── researchAgent.js        ← MODIFIED: Store source credibility metadata
└── supabase-db.js          ← MODIFIED: Add quarantine + failure memory tables

workers/
└── research-agent-worker.js ← MODIFIED: Use promotionGate instead of inline promote
```

### SQL Schema Additions

```sql
-- quarantine_testing table
CREATE TABLE IF NOT EXISTS strategy_quarantine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL UNIQUE,
  proposal_id UUID REFERENCES strategy_proposals(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mock_trades_completed INTEGER NOT NULL DEFAULT 0,
  mock_trades_required INTEGER NOT NULL DEFAULT 30,
  win_rate NUMERIC,
  profit_factor NUMERIC,
  max_drawdown_pct NUMERIC,
  passed BOOLEAN,
  exited_at TIMESTAMPTZ
);

-- failure_memory table
CREATE TABLE IF NOT EXISTS strategy_failure_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL,
  rule_hash TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}',
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_hash, failure_reason)
);

-- Add columns to strategy_proposals
ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS rule_hash TEXT;
ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS source_credibility NUMERIC DEFAULT 0.5;
ALTER TABLE strategy_proposals ADD COLUMN IF NOT EXISTS is_synthetic BOOLEAN DEFAULT FALSE;
```

## Implementation Order

### Phase 1: Foundation (Stop the Bleeding)
1. **promotionGate.js** — Central gate that checks ALL conditions before promoting
2. **backtestEngine.js** — Remove `Math.random()`, add `isSynthetic` flag, use real data only
3. **research-agent-worker.js** — Replace inline promote with promotionGate

### Phase 2: Validation & Structure
4. **walkForwardValidator.js** — Train/val/test split with OOS check
5. **strategyLifecycle.js** — Add quarantine status, update approval criteria
6. **quarantineManager.js** — Quarantine stage management

### Phase 3: Quality & Dedup
7. **duplicateDetector.js** — Rule-hash based dedup
8. **strategyExtractor.js** — Integrate dedup + source credibility
9. **sourceCredibility.js** — Source scoring

### Phase 4: Memory & Ranking
10. **failureMemory.js** — Store failure reasons
11. **regimeRanker.js** — Regime-aware ranking
12. **feedbackLoop.js** — Promote by expectancy

### Phase 5: Schema & Integration
13. SQL schema additions
14. **supabase-db.js** — Add new table operations
15. Integration wiring

## Promotion Gate v2 — Gate Conditions

A strategy must pass ALL of these to be promoted:

```
1. ✅ Real data only (isSynthetic === false)
2. ✅ Minimum 50 trades (not 5)
3. ✅ Profit factor > 1.25
4. ✅ Max drawdown < 20%
5. ✅ Positive expectancy
6. ✅ Walk-forward: OOS expectancy positive
7. ✅ Multi-symbol: works on at least 2 symbols
8. ✅ Not a duplicate (rule_hash not in failure_memory)
9. ✅ Source credibility >= 0.3
10. ✅ Passed quarantine (30+ mock trades with positive expectancy)
```

## Backtest Random Feature Removal

Current random features in [`lib/ml/backtestEngine.js:100-109`](lib/ml/backtestEngine.js:100-109):
- `fundingRate: Math.random()` → Use real funding from Binance API or skip
- `openInterestChangePct: Math.random()` → Use real OI data or skip
- `liquidationImbalance: Math.random()` → Use real liq data or skip
- `socialSentiment: Math.random()` → Use real sentiment or skip
- `newsSentiment: Math.random()` → Use real news or skip
- `whaleFlowScore: Math.random()` → Use real whale data or skip
- `spreadBps: Math.random()` → Use real spread or skip

**Solution:** Set unavailable features to `0` (neutral) and mark the backtest as `partial_features`. Partial-feature backtests can still run for informational purposes but **cannot trigger promotion**.
