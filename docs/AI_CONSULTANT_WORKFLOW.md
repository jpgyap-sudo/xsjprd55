# AI Consultant Workflow

## User commands

```txt
/ask BTCUSDT today
/strategy SOLUSDT 4h
/risk ETHUSDT
/backtest PEPEUSDT
/improve BTCUSDT breakout
```

## Pipeline

```txt
Telegram/API request
  ↓
advisor_requests
  ↓
buildAdvisorContext()
  - market data
  - OI/funding
  - liquidation
  - news/social
  - strategy backtest memory
  - simulation learning memory
  ↓
scoreLongShort()
  ↓
runAdvisorRiskGate()
  ↓
buildAdvisorReport()
  ↓
advisor_reports
  ↓
Telegram/dashboard response
```

## Mock/perp trader role

They are not real traders. They are simulation agents.

```txt
Research Agent creates hypothesis
Backtest Agent tests history
Mock/Perp Simulator paper-tests live market
Simulation Learning Worker summarizes what worked/failed
Advisor uses learning memory in future recommendations
```

## Golden rule

```txt
Agents can simulate.
Agents can learn.
Agents can recommend.
Agents cannot place real orders.
```
