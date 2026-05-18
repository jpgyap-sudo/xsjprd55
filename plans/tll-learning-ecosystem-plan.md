# TLL Learning Ecosystem — Integration Plan

## Current State Analysis

### What Already Works (Mock Trade → TLL)

The TLL already has a complete bridge for **mock trading data**:

| Component | File | Status |
|-----------|------|--------|
| Mock trade → brain_signal_memory | `lib/learning-layer/mock-trading-bridge.js` | ✅ Complete (9 functions) |
| Outcome ingestion during TLL cycle | `lib/learning-layer/outcome-recorder.js` (line 120) | ✅ Calls `ingestRecentMockTradeOutcomes()` |
| Mock strategy healing | `lib/learning-layer/strategy-healer.js` (line 226) | ✅ `healMockStrategies()` checks `mock_trades` table |
| TLL → Mock trading data flow | `lib/learning-layer/mock-trading-bridge.js` | ✅ Regime, skills, weights, healing all flow back |

### What's Missing

| Data Source | Bridge to TLL? | Data in brain_signal_memory? | TLL Pattern Discovery? |
|-------------|----------------|------------------------------|----------------------|
| Mock Trading | ✅ Yes | ✅ Yes | ✅ Yes |
| Perpetual Trader | ❌ No | ❌ No | ❌ No |
| Research Agent | ❌ No | ❌ No | ❌ No |
| Signal Agent | ❌ No | ❌ No | ❌ No |

---

## Data Source Analysis

### 1. Perpetual Trader Data

**Tables:**
- `perpetual_mock_accounts` — Account state (balance, equity, PnL)
- `perpetual_mock_trades` — Open/closed trades with PnL, strategy, entry/exit
- `perpetual_trader_logs` — Event logs
- `signal_memory` — Signal memory (already shared with signal agent)

**Key Fields (perpetual_mock_trades):**
```json
{
  "id": "uuid",
  "symbol": "BTCUSDT",
  "side": "LONG",
  "entry_price": 65000,
  "exit_price": 67000,
  "pnl_usd": 200,
  "pnl_pct": 3.07,
  "strategy": "EMA_Cross",
  "timeframe": "15m",
  "confidence": 0.72,
  "market_regime_at_entry": "trending",
  "exit_reason": "take_profit",
  "r_multiple_at_close": 2.5,
  "entry_features": { "regime": "trending", "atr_pct": 1.2, ... }
}
```

**Current Flow:**
- `lib/perpetual-trader/engine.js` `closePerpetualTrade()` → calls `recordPerpetualTradeOutcome()` → calls `recordTradeOutcome()` (strategy-scorecard)
- `lib/perpetual-trader/learning.js` `recordPerpetualTradeOutcome()` → records to strategy-scorecard, updates `r_multiple_at_close`
- Also calls `updateSignalOutcome()` on `signal_memory` table

**Gap:** Perpetual trade outcomes are NOT recorded in `brain_signal_memory`. The TLL never sees perpetual trader data.

### 2. Research Agent Data

**Tables (Supabase + SQLite fallback):**
- `research_sources` — Raw research items with extracted hints
- `strategy_proposals` — Auto-generated strategy proposals from research
- `backtest_results` — Backtest results for proposed strategies
- `mock_strategy_feedback` — Feedback scores for strategies
- `strategy_lifecycle` — Lifecycle tracking (researched → tested → promoted → rejected)
- `strategy_failure_memory` — Failure memory
- `quarantine_trades` — Quarantined trades
- `strategy_regime_performance` — Per-regime performance

**Key Fields (strategy_proposals):**
```json
{
  "name": "research_funding_liquidation_a1b2c3",
  "description": "Auto-generated from research hints: funding, liquidation",
  "rules": [{ "feature": "funding_rate", "operator": "lt", "value": -0.005, "weight": 0.8 }],
  "confidence": 0.58,
  "tested": false,
  "promoted": false
}
```

**Current Flow:**
- Research items → `storeResearchItem()` → `research_sources` table
- `proposeStrategiesFromRecentResearch()` → generates proposals → `strategy_proposals`
- `recordMockFeedback()` → scores strategies → `mock_strategy_feedback`
- `promoteStrategy()` → promotes to `strategy_lifecycle`

**Gap:** Research agent data is completely isolated from TLL. No strategy proposals, backtest results, or feedback scores flow into TLL pattern discovery or skill generation.

### 3. Signal Agent Data

**Tables:**
- `signals` — Generated signals with brain enrichment
- `signal_memory` — Signal memory with market context and outcomes
- `signal_patterns` — Pattern learner outcomes
- `market_data` — Cached market data
- `strategy_performance` — Rolled-up strategy performance

**Key Fields (signal_memory):**
```json
{
  "signal_id": "uuid",
  "symbol": "BTCUSDT",
  "side": "LONG",
  "entry_price": 65000,
  "confidence": 0.72,
  "strategy": "EMA_Cross",
  "timeframe": "15m",
  "description": "LONG BTCUSDT — EMA_Cross on 15m...",
  "market_ctx": { "rsi": 45.2, "change24h": 2.3, "volSpike": 1.8 },
  "outcome": "win",
  "outcome_pnl": 200,
  "risk_reward": 2.5
}
```

**Current Flow:**
- `api/signals.js` generates signals → saves to `signals` table
- `lib/signal-memory.js` `storeSignalMemory()` → saves to `signal_memory` table
- `lib/learning-loop.js` `resolveOutcomes()` → resolves `signal_patterns` outcomes
- `lib/learning-loop.js` `rollupStrategyPerformance()` → saves to `strategy_performance`

**Gap:** Signal memory data is NOT fed into `brain_signal_memory`. The TLL never sees signal agent outcomes or market context.

---

## Proposed Architecture

### Unified Learning Ecosystem Data Flow

```
                    ┌─────────────────────────────────────────────┐
                    │              TLL PIPELINE                    │
                    │  (lib/learning-layer/index.js)               │
                    │                                              │
                    │  1. recordSignalOutcome()                    │
                    │     ├─ From brain_signal_memory (existing)   │
                    │     ├─ From perpetual_trader_bridge (NEW)    │
                    │     ├─ From research_agent_bridge (NEW)      │
                    │     └─ From signal_agent_bridge (NEW)        │
                    │                                              │
                    │  2. discoverPatterns() ← ALL 4 sources       │
                    │  3. detectMarketRegime() ← ALL 4 sources     │
                    │  4. tuneAdaptiveWeights() ← ALL 4 sources    │
                    │  5. generateTradingSkills() ← ALL 4 sources  │
                    │  6. healStrategies() ← ALL 4 sources         │
                    └──────────┬──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Mock Trading    │  │ Perpetual       │  │ Research Agent  │
│ Bridge          │  │ Trader Bridge   │  │ Bridge          │
│ (EXISTS)        │  │ (NEW)           │  │ (NEW)           │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ mock_trades     │  │ perpetual_mock_ │  │ research_sources│
│ brain_signal_   │  │ trades          │  │ strategy_       │
│ memory          │  │ signal_memory   │  │ proposals       │
└─────────────────┘  └─────────────────┘  │ backtest_results│
                                           │ mock_strategy_  │
                                           │ feedback        │
                    ┌─────────────────┐    └─────────────────┘
                    │ Signal Agent    │
                    │ Bridge          │
                    │ (NEW)           │
                    ├─────────────────┤
                    │ signals         │
                    │ signal_memory   │
                    │ signal_patterns │
                    │ strategy_       │
                    │ performance     │
                    └─────────────────┘
```

### New Bridge Files

#### 1. `lib/learning-layer/perpetual-trader-bridge.js`

**Purpose:** Bridge perpetual trader data into TLL's `brain_signal_memory` table.

**Functions:**
| Function | Purpose |
|----------|---------|
| `ingestPerpetualTradeOutcomes(hours)` | Batch-ingest closed perpetual trades into brain_signal_memory |
| `getPerpetualTllSnapshot()` | Unified snapshot for dashboard (regime + skills + weights + perpetual stats) |
| `getPerpetualStrategyPerformance()` | Get perpetual strategy performance for TLL healing |
| `checkPerpetualSignalAgainstTllSkills(signal, skills)` | Check perpetual signal against TLL skills |

**Data Mapping (perpetual_mock_trades → brain_signal_memory):**
```
perpetual_mock_trades.id              → signal_id
perpetual_mock_trades.symbol          → symbol
perpetual_mock_trades.side            → side
perpetual_mock_trades.entry_price     → entry_price
perpetual_mock_trades.pnl_usd         → resolved_pnl
perpetual_mock_trades.strategy        → strategy
perpetual_mock_trades.timeframe       → timeframe
perpetual_mock_trades.confidence      → confidence
perpetual_mock_trades.exit_reason     → exit_reason
perpetual_mock_trades.market_regime   → market_regime
  at_entry
perpetual_mock_trades.r_multiple      → r_multiple
  at_close
'perpetual_trader'                    → source
```

#### 2. `lib/learning-layer/research-agent-bridge.js`

**Purpose:** Bridge research agent data into TLL for pattern discovery and skill generation.

**Functions:**
| Function | Purpose |
|----------|---------|
| `ingestResearchProposals()` | Feed strategy proposals into TLL as potential patterns |
| `ingestBacktestResults()` | Feed backtest results into TLL for strategy weight tuning |
| `ingestMockFeedback()` | Feed mock strategy feedback into TLL healing |
| `getResearchTllSnapshot()` | Unified snapshot for dashboard |

**Data Mapping (strategy_proposals → tll_patterns):**
```
strategy_proposals.name              → pattern.name
strategy_proposals.description       → pattern.description
strategy_proposals.confidence        → pattern.confidence
strategy_proposals.rules_json        → pattern.features
'research_agent'                     → pattern.source
```

#### 3. `lib/learning-layer/signal-agent-bridge.js`

**Purpose:** Bridge signal agent data into TLL's `brain_signal_memory` table.

**Functions:**
| Function | Purpose |
|----------|---------|
| `ingestSignalMemoryOutcomes(hours)` | Batch-ingest signal_memory outcomes into brain_signal_memory |
| `ingestStrategyPerformance()` | Feed strategy performance rollups into TLL weight tuning |
| `getSignalTllSnapshot()` | Unified snapshot for dashboard |

**Data Mapping (signal_memory → brain_signal_memory):**
```
signal_memory.signal_id              → signal_id
signal_memory.symbol                 → symbol
signal_memory.side                   → side
signal_memory.entry_price            → entry_price
signal_memory.outcome_pnl            → resolved_pnl
signal_memory.strategy               → strategy
signal_memory.timeframe              → timeframe
signal_memory.confidence             → confidence
signal_memory.outcome                → outcome (win/loss/pending)
signal_memory.market_ctx             → market_ctx (JSON)
signal_memory.risk_reward            → risk_reward
'signal_agent'                       → source
```

### Updated TLL Pipeline

**`lib/learning-layer/index.js`** — Add 3 new bridge calls before pattern discovery:

```javascript
// Step 0: Ingest data from all sources
const perpetualOutcomes = await ingestPerpetualTradeOutcomes(24);
const researchPatterns = await ingestResearchProposals();
const signalOutcomes = await ingestSignalMemoryOutcomes(48);

// Step 1: Record outcomes (existing — now includes all sources)
const outcomesRecorded = await recordSignalOutcome();

// Step 2-6: Existing pipeline (now analyzes ALL sources)
```

### Updated Learning Loop

**`lib/learning-loop.js`** — Add bridge calls in step 6 (TLL):

```javascript
// Step 6a: Ingest perpetual trader data
await ingestPerpetualTradeOutcomes(24);

// Step 6b: Ingest research agent data
await ingestResearchProposals();
await ingestBacktestResults();

// Step 6c: Ingest signal agent data
await ingestSignalMemoryOutcomes(48);

// Step 6d: Run TLL (existing)
const tllResult = await runIntegratedTLL(results);
```

### Updated API Endpoint

**`api/learning-layer.js`** — Add new endpoints for unified ecosystem data:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/learning-layer?view=ecosystem` | Unified learning ecosystem snapshot |
| `GET /api/learning-layer?view=perpetual` | Perpetual trader → TLL bridge status |
| `GET /api/learning-layer?view=research` | Research agent → TLL bridge status |
| `GET /api/learning-layer?view=signals` | Signal agent → TLL bridge status |

### Updated Dashboard UI

**`public/index.html`** — Add "Learning Ecosystem" section to the existing Learning Layer tab:

- **Data Sources Card:** Shows all 4 data sources with ingestion counts
- **Bridge Status Card:** Shows last sync time for each bridge
- **Unified Patterns Card:** Shows patterns discovered from ALL sources
- **Cross-Source Insights Card:** Shows correlations across data sources

---

## Implementation Order

1. **Create `lib/learning-layer/perpetual-trader-bridge.js`** — Bridge perpetual trader data
2. **Create `lib/learning-layer/research-agent-bridge.js`** — Bridge research agent data
3. **Create `lib/learning-layer/signal-agent-bridge.js`** — Bridge signal agent data
4. **Update `lib/learning-layer/index.js`** — Integrate all bridges into TLL pipeline
5. **Update `lib/learning-loop.js`** — Trigger all bridges during learning loop
6. **Update `api/learning-layer.js`** — Expose unified ecosystem data
7. **Update `public/index.html`** — Show unified learning ecosystem in dashboard
8. **Commit, push, deploy**

---

## Safety Gates

- All bridges are non-blocking — failures don't affect trade lifecycle
- All bridges have dedup (check for existing signal_id before insert)
- All bridges respect `TLL_ENABLED=false` config
- Perpetual bridge capped at `TLL_MAX_RESOLVE` (200) per cycle
- Research bridge only ingests proposals with confidence ≥ 0.5
- Signal bridge only ingests resolved outcomes (not pending)
- All bridges log telemetry to `brain_events` for audit
