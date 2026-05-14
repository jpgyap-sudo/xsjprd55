-- AI Consultant / Simulation Learning Schema
-- Safe by design: no live order table, no exchange execution required.

create extension if not exists "uuid-ossp";
create extension if not exists vector;

create table if not exists advisor_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id text,
  source text not null default 'telegram',
  symbol text not null,
  timeframe text not null default '1d',
  horizon text not null default 'today',
  intent text not null default 'ask', -- ask | strategy | risk | backtest | improve
  raw_prompt text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists advisor_reports (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references advisor_requests(id) on delete set null,
  symbol text not null,
  timeframe text not null,
  horizon text not null,
  bias text not null check (bias in ('long','short','neutral','avoid')),
  confidence numeric not null default 0,
  risk_score numeric not null default 0,
  invalidation_price numeric,
  entry_zone jsonb default '{}'::jsonb,
  take_profits jsonb default '[]'::jsonb,
  stop_loss numeric,
  reasons jsonb default '[]'::jsonb,
  warnings jsonb default '[]'::jsonb,
  strategy jsonb default '{}'::jsonb,
  data_snapshot jsonb default '{}'::jsonb,
  model_used text default 'local',
  disclaimer text not null default 'Advisor only. Not financial advice. Manual decision required.',
  created_at timestamptz not null default now()
);

create table if not exists strategy_hypotheses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  symbol_scope text default 'ALL',
  timeframe text not null default '1h',
  rules jsonb not null default '{}'::jsonb,
  source_agent text not null default 'research-agent',
  status text not null default 'draft', -- draft | testing | approved | rejected
  created_at timestamptz not null default now()
);

create table if not exists strategy_backtests (
  id uuid primary key default uuid_generate_v4(),
  strategy_id uuid references strategy_hypotheses(id) on delete cascade,
  symbol text not null,
  timeframe text not null,
  period_start timestamptz,
  period_end timestamptz,
  trades_count int not null default 0,
  win_rate numeric,
  profit_factor numeric,
  max_drawdown numeric,
  avg_r_multiple numeric,
  notes text,
  metrics jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists simulation_agents (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  type text not null check (type in ('mock_trader','perp_simulator','research_agent','risk_agent')),
  config jsonb default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists simulated_trades (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid references simulation_agents(id) on delete set null,
  strategy_id uuid references strategy_hypotheses(id) on delete set null,
  advisor_report_id uuid references advisor_reports(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('long','short')),
  timeframe text not null,
  entry_price numeric not null,
  stop_loss numeric,
  take_profit numeric,
  exit_price numeric,
  status text not null default 'open', -- open | closed | invalidated
  pnl_pct numeric,
  r_multiple numeric,
  reason text,
  market_context jsonb default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists signal_outcomes (
  id uuid primary key default uuid_generate_v4(),
  advisor_report_id uuid references advisor_reports(id) on delete cascade,
  symbol text not null,
  horizon text not null,
  outcome text not null check (outcome in ('win','loss','neutral','expired','unknown')),
  max_favorable_excursion numeric,
  max_adverse_excursion numeric,
  realized_r numeric,
  notes text,
  evaluated_at timestamptz not null default now()
);

create table if not exists advisor_learning_memory (
  id uuid primary key default uuid_generate_v4(),
  memory_type text not null, -- pattern | failure | success | risk_warning
  symbol text,
  timeframe text,
  content text not null,
  evidence jsonb default '{}'::jsonb,
  confidence numeric default 0.5,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists idx_advisor_reports_symbol_time on advisor_reports(symbol, created_at desc);
create index if not exists idx_simulated_trades_symbol_status on simulated_trades(symbol, status);
create index if not exists idx_strategy_backtests_strategy on strategy_backtests(strategy_id);
