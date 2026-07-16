/**
 * Optional Postgres backend when DATABASE_URL is set.
 * Blob state in om_kv — same semantics as JSON file store.
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS om_kv (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    schemaReady = true;
  }
  return pool;
}

export type PersistShape = {
  agents: AgentRecord[];
  offers: OfferRecord[];
  quotes: QuoteRecord[];
  orders: OrderRecord[];
  usedTx: string[];
  audit: AuditEvent[];
  escrows: EscrowRecord[];
};

const STATE_KEY = "openmarket_state_v1";

export async function pgLoadState(): Promise<PersistShape | null> {
  const p = await getPool();
  const r = await p.query(`SELECT value FROM om_kv WHERE key = $1`, [STATE_KEY]);
  if (!r.rows[0]) return null;
  return r.rows[0].value as PersistShape;
}

export async function pgSaveState(state: PersistShape): Promise<void> {
  const p = await getPool();
  await p.query(
    `INSERT INTO om_kv(key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify(state)]
  );
}
