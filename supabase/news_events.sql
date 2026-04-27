-- ============================================================
-- News Events Table — Persistent news storage for AI queries
-- Ingested every 5 min via /api/news-ingest cron
-- Deduped by title_hash, queried by /ask, /news-feed, /news-signal
-- ============================================================

CREATE TABLE IF NOT EXISTS news_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Source tracking
  source TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('rss', 'telegram', 'api', 'twitter', 'manual')),
  source_url TEXT,

  -- Content
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  message_id TEXT, -- for Telegram dedupe

  -- Timestamps
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Asset tagging
  assets TEXT[] DEFAULT '{}',

  -- Scoring
  sentiment_score NUMERIC(5,3),   -- -1.0 to +1.0 from sentiment engine
  credibility_score NUMERIC(4,3) DEFAULT 0.7, -- source weight: 0.5-1.0
  freshness_score NUMERIC(4,3),   -- decays with age: 1.0 = fresh, 0.0 = old
  urgency_score NUMERIC(4,3) DEFAULT 0, -- from keyword matching

  -- Dedupe
  title_hash TEXT UNIQUE,

  -- Metadata
  matched_keywords JSONB DEFAULT '[]',
  raw_data JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_news_events_source ON news_events(source);
CREATE INDEX IF NOT EXISTS idx_news_events_published ON news_events(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_ingested ON news_events(ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_events_assets ON news_events USING GIN(assets);
CREATE INDEX IF NOT EXISTS idx_news_events_sentiment ON news_events(sentiment_score) WHERE sentiment_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_news_events_freshness ON news_events(freshness_score DESC) WHERE freshness_score > 0.3;

-- Auto-cleanup old news (keep 7 days)
-- Run manually or via pg_cron if available:
-- DELETE FROM news_events WHERE ingested_at < NOW() - INTERVAL '7 days';
