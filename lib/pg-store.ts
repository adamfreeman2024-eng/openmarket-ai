/**
 * Relational Postgres store — proper CRUD on individual tables.
 * Used when DATABASE_URL is set. Falls back to file/memory otherwise.
 *
 * Tables: agents, offers, quotes, orders, escrows, used_tx, audit_events
 * See docs/schema.sql for DDL.
 */
import type {
  AgentRecord,
  OfferRecord,
  QuoteRecord,
  OrderRecord,
  AuditEvent,
} from "./types";
import type { EscrowRecord } from "./store-types";

type Pool = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

let pool: Pool | null = null;
let schemaReady = false;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("pg") as {
    Pool: new (c: { connectionString: string }) => Pool;
  };
  pool = new mod.Pool({ connectionString: process.env.DATABASE_URL!.trim() });
  if (!schemaReady) {
    await pool.query(SCHEMA_SQL);
    schemaReady = true;
  }
  return pool;
}

const SCHEMA_SQL = `
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
CREATE INDEX IF NOT EXISTS escrows_order_idx ON escrows(order_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
`;

// --- Agent CRUD ---

export async function pgPutAgent(a: AgentRecord): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO agents (id, api_key, name, wallet_account_id, webhook_url, homepage, capabilities, policy, stats, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
     ON CONFLICT (id) DO UPDATE SET
       api_key = EXCLUDED.api_key,
       name = EXCLUDED.name,
       wallet_account_id = EXCLUDED.wallet_account_id,
       webhook_url = EXCLUDED.webhook_url,
       homepage = EXCLUDED.homepage,
       capabilities = EXCLUDED.capabilities,
       policy = EXCLUDED.policy,
       stats = EXCLUDED.stats`,
    [
      a.id,
      a.apiKey,
      a.name,
      a.walletAccountId,
      a.webhookUrl || null,
      a.homepage || null,
      JSON.stringify(a.capabilities),
      JSON.stringify(a.policy),
      JSON.stringify(a.stats),
      a.createdAt,
    ]
  );
}

export async function pgGetAgent(id: string): Promise<AgentRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT * FROM agents WHERE id = $1`, [id]);
  return r.rows[0] ? rowToAgent(r.rows[0]) : null;
}

export async function pgGetAgentByKey(key: string): Promise<AgentRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT * FROM agents WHERE api_key = $1`, [key]);
  return r.rows[0] ? rowToAgent(r.rows[0]) : null;
}

export async function pgListAgents(): Promise<AgentRecord[]> {
  const p = await getPool();
  const r = await p.query(`SELECT * FROM agents ORDER BY created_at DESC`);
  return r.rows.map(rowToAgent);
}

// --- Offer CRUD ---

export async function pgPutOffer(o: OfferRecord): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO offers (id, agent_id, capability, title, description, price_amount, price_asset, fulfillment_type, webhook_url, max_seconds, escrow, tags, active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       capability = EXCLUDED.capability,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       price_amount = EXCLUDED.price_amount,
       price_asset = EXCLUDED.price_asset,
       fulfillment_type = EXCLUDED.fulfillment_type,
       webhook_url = EXCLUDED.webhook_url,
       max_seconds = EXCLUDED.max_seconds,
       escrow = EXCLUDED.escrow,
       tags = EXCLUDED.tags,
       active = EXCLUDED.active`,
    [
      o.id,
      o.agentId,
      o.capability,
      o.title,
      o.description || null,
      o.priceAmount,
      o.priceAsset,
      o.fulfillmentType,
      o.webhookUrl || null,
      o.maxSeconds,
      o.escrow,
      JSON.stringify(o.tags || []),
      o.active,
      o.createdAt,
    ]
  );
}

export async function pgGetOffer(id: string): Promise<OfferRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT * FROM offers WHERE id = $1`, [id]);
  return r.rows[0] ? rowToOffer(r.rows[0]) : null;
}

export async function pgListOffers(): Promise<OfferRecord[]> {
  const p = await getPool();
  const r = await p.query(`SELECT * FROM offers WHERE active = true ORDER BY created_at DESC`);
  return r.rows.map(rowToOffer);
}

// --- Quote CRUD ---

export async function pgPutQuote(q: QuoteRecord): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO quotes (id, payload, expires_at, created_at)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
    [q.id, JSON.stringify(q), q.expiresAt, q.createdAt]
  );
}

export async function pgGetQuote(id: string): Promise<QuoteRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT payload FROM quotes WHERE id = $1`, [id]);
  return r.rows[0] ? (r.rows[0].payload as QuoteRecord) : null;
}

// --- Order CRUD ---

export async function pgPutOrder(o: OrderRecord): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO orders (id, payload, status, created_at)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`,
    [o.id, JSON.stringify(o), o.status, o.createdAt]
  );
}

export async function pgGetOrder(id: string): Promise<OrderRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT payload FROM orders WHERE id = $1`, [id]);
  return r.rows[0] ? (r.rows[0].payload as OrderRecord) : null;
}

export async function pgListOrders(): Promise<OrderRecord[]> {
  const p = await getPool();
  const r = await p.query(`SELECT payload FROM orders ORDER BY created_at DESC LIMIT 500`);
  return r.rows.map((row) => row.payload as OrderRecord);
}

// --- Escrow CRUD ---

export async function pgPutEscrow(e: EscrowRecord): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO escrows (id, order_id, payload, status, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status`,
    [e.id, e.orderId, JSON.stringify(e), e.status, e.createdAt]
  );
}

export async function pgGetEscrow(id: string): Promise<EscrowRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT payload FROM escrows WHERE id = $1`, [id]);
  return r.rows[0] ? (r.rows[0].payload as EscrowRecord) : null;
}

export async function pgGetEscrowByOrder(orderId: string): Promise<EscrowRecord | null> {
  const p = await getPool();
  const r = await p.query(`SELECT payload FROM escrows WHERE order_id = $1 LIMIT 1`, [orderId]);
  return r.rows[0] ? (r.rows[0].payload as EscrowRecord) : null;
}

export async function pgListEscrows(): Promise<EscrowRecord[]> {
  const p = await getPool();
  const r = await p.query(`SELECT payload FROM escrows ORDER BY created_at DESC LIMIT 500`);
  return r.rows.map((row) => row.payload as EscrowRecord);
}

// --- Used TX ---

export async function pgIsTxUsed(tx: string): Promise<boolean> {
  const p = await getPool();
  const r = await p.query(`SELECT 1 FROM used_tx WHERE transaction_id = $1`, [tx]);
  return r.rows.length > 0;
}

export async function pgMarkTxUsed(tx: string): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO used_tx (transaction_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [tx]
  );
}

// --- Audit ---

export async function pgAudit(ev: AuditEvent): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO audit_events (id, type, payload, at) VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (id) DO NOTHING`,
    [ev.id, ev.type, JSON.stringify(ev.payload), ev.at]
  );
}

export async function pgListAudit(limit = 50): Promise<AuditEvent[]> {
  const p = await getPool();
  const r = await p.query(`SELECT id, type, payload, at FROM audit_events ORDER BY at DESC LIMIT $1`, [limit]);
  return r.rows.map((row) => ({
    id: row.id as string,
    type: row.type as string,
    payload: row.payload as Record<string, unknown>,
    at: new Date(row.at as string).toISOString(),
  }));
}

// --- Mappers ---

function rowToAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: row.id as string,
    apiKey: row.api_key as string,
    name: row.name as string,
    walletAccountId: row.wallet_account_id as string,
    webhookUrl: (row.webhook_url as string) || undefined,
    homepage: (row.homepage as string) || undefined,
    capabilities: row.capabilities as string[],
    policy: row.policy as AgentRecord["policy"],
    stats: row.stats as AgentRecord["stats"],
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function rowToOffer(row: Record<string, unknown>): OfferRecord {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    capability: row.capability as string,
    title: row.title as string,
    description: (row.description as string) || undefined,
    priceAmount: Number(row.price_amount),
    priceAsset: row.price_asset as OfferRecord["priceAsset"],
    fulfillmentType: row.fulfillment_type as OfferRecord["fulfillmentType"],
    webhookUrl: (row.webhook_url as string) || undefined,
    maxSeconds: Number(row.max_seconds),
    escrow: Boolean(row.escrow),
    tags: row.tags as string[],
    active: Boolean(row.active),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export async function pgClose(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await (p as unknown as { end: () => Promise<void> }).end();
  }
}
