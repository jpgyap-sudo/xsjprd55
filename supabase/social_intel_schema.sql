-- ============================================================
-- Neural Social Intelligence Layer Schema
-- Run this in your Supabase SQL Editor before deploying.
-- ============================================================
create extension if not exists pgcrypto;

-- ── Social Sources Registry ──────────────────────────────
create table if not exists social_sources (
  id text primary key,
  type text not null check (type in ('rss','web','playwright','x','telegram','manual')),
  name text,
  url text,
  enabled boolean default true,
  source_quality numeric default 0.50,
  config jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Raw Social Posts (deduplicated) ─────────────────────
create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),
  source_id text references social_sources(id) on delete set null,
  source text,
  source_account text,
  url text,
  raw_text text not null,
  normalized_text text,
  symbol text,
  symbols text[] default '{}',
  language text default 'en',
  external_created_at timestamptz,
  engagement jsonb default '{}'::jsonb,
  hash text unique,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_social_posts_symbol_created on social_posts(symbol, created_at desc);
create index if not exists idx_social_posts_hash on social_posts(hash);
create index if not exists idx_social_posts_symbols on social_posts using gin(symbols);

-- ── Neural News Events (AI-analyzed) ────────────────────
create table if not exists neural_news_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references social_posts(id) on delete cascade,
  symbol text,
  symbols text[] default '{}',
  event_type text,
  sentiment_score numeric,
  confidence numeric,
  impact_level text check (impact_level in ('low','medium','high','critical')),
  urgency text check (urgency in ('normal','fast','breaking')),
  source_quality numeric,
  summary text,
  suggested_bias text check (suggested_bias in ('bullish','bearish','neutral','mixed')),
  time_decay_minutes int default 180,
  event_score numeric default 0,
  model_name text,
  model_provider text,
  features jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_neural_news_symbol_created on neural_news_events(symbol, created_at desc);
create index if not exists idx_neural_news_event_type on neural_news_events(event_type);
create index if not exists idx_neural_news_symbols on neural_news_events using gin(symbols);
create index if not exists idx_neural_news_score on neural_news_events(event_score desc) where event_score >= 0.5;

-- ── Agent Message Bus ───────────────────────────────────
create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  from_agent text not null,
  to_agent text not null,
  message_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text default 'new' check (status in ('new','processing','done','failed','ignored')),
  error text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create index if not exists idx_agent_messages_to_status on agent_messages(to_agent, status, created_at desc);

-- ── Source Health Tracker ───────────────────────────────
create table if not exists social_source_health (
  source_id text primary key references social_sources(id) on delete cascade,
  status text default 'unknown' check (status in ('ok','degraded','offline','unknown')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_items_found int default 0,
  reliability_score numeric default 0.50,
  metadata jsonb default '{}'::jsonb
);

-- ── Seed default sources ────────────────────────────────
insert into social_sources (id, type, name, url, source_quality, config)
values
('cointelegraph-rss','rss','Cointelegraph RSS','https://cointelegraph.com/rss',0.72,'{}'),
('coindesk-rss','rss','CoinDesk RSS','https://www.coindesk.com/arc/outboundfeeds/rss/',0.78,'{}'),
('decrypt-rss','rss','Decrypt RSS','https://decrypt.co/feed',0.70,'{}'),
('cryptonews-rss','rss','CryptoNews RSS','https://crypto.news/feed/',0.68,'{}'),
('cryptopanic-rss','rss','CryptoPanic RSS','https://cryptopanic.com/news/rss/',0.65,'{}')
on conflict (id) do nothing;

-- ── RLS Policies (disable for server-side service key) ────
-- If you use anon key from frontend, enable these:
-- alter table social_posts enable row level security;
-- alter table neural_news_events enable row level security;
-- alter table agent_messages enable row level security;
