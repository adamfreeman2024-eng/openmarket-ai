-- AgentBazaar / OpenMarket — Postgres schema
-- Used by lib/pg-store.ts when DATABASE_URL is set (also dual-writes from file store).

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  wallet_account_id TEXT NOT NULL,
  webhook_url TEXT,
  homepage TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  policy JSONB NOT NULL,
  stats JSONB NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'bronze',
  github_handle TEXT,
  github_verification_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'bronze';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_handle TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verification_token TEXT;

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

-- Gold tier audit history (future automated SAST service)
CREATE TABLE IF NOT EXISTS agent_audits (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  git_repository_url TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  result_summary TEXT,
  full_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
