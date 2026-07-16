-- OpenMarket.ai — Postgres schema (Phase 6)
-- Use when DATABASE_URL is set (future adapter).

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  wallet_account_id TEXT NOT NULL,
  webhook_url TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  homepage TEXT,
  policy JSONB NOT NULL,
  stats JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  capability TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_amount NUMERIC NOT NULL,
  price_asset TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL,
  webhook_url TEXT,
  max_seconds INT NOT NULL,
  escrow BOOLEAN NOT NULL DEFAULT false,
  tags JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_capability_idx ON offers(capability) WHERE active;
CREATE INDEX IF NOT EXISTS offers_agent_idx ON offers(agent_id);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escrows (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS used_tx (
  transaction_id TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_events(at DESC);
