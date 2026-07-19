/**
 * Durable store: memory + JSON file + optional Postgres dual-write (DATABASE_URL).
 */
import { nanoid } from "nanoid";
import * as fs from "fs";
import * as path from "path";
import type {
  AgentRecord,
  OfferRecord,
  QuoteRecord,
  OrderRecord,
  AuditEvent,
} from "./types";
import type { EscrowRecord } from "./store-types";
import {
  hasDatabaseUrl,
} from "./pg-store";

export type { EscrowRecord } from "./store-types";

// Re-export new relational PG functions for direct use by API routes
export {
  hasDatabaseUrl as hasPg,
  pgPutAgent,
  pgGetAgent,
  pgGetAgentByKey,
  pgListAgents,
  pgPutOffer,
  pgGetOffer,
  pgListOffers,
  pgPutQuote,
  pgGetQuote,
  pgPutOrder,
  pgGetOrder,
  pgListOrders,
  pgPutEscrow,
  pgGetEscrow,
  pgGetEscrowByOrder,
  pgListEscrows,
  pgIsTxUsed,
  pgMarkTxUsed,
  pgAudit,
  pgListAudit,
} from "./pg-store";

type StoreShape = {
  agents: Map<string, AgentRecord>;
  agentsByKey: Map<string, string>;
  offers: Map<string, OfferRecord>;
  quotes: Map<string, QuoteRecord>;
  orders: Map<string, OrderRecord>;
  usedTx: Set<string>;
  audit: AuditEvent[];
  escrows: Map<string, EscrowRecord>;
};

type PersistShape = {
  agents: AgentRecord[];
  offers: OfferRecord[];
  quotes: QuoteRecord[];
  orders: OrderRecord[];
  usedTx: string[];
  audit: AuditEvent[];
  escrows: EscrowRecord[];
};

const g = globalThis as unknown as {
  __omStore?: StoreShape;
  __omPgHydrated?: boolean;
};

const DATA_DIR =
  process.env.OM_DATA_DIR || path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "openmarket-store.json");

function emptyStore(): StoreShape {
  return {
    agents: new Map(),
    agentsByKey: new Map(),
    offers: new Map(),
    quotes: new Map(),
    orders: new Map(),
    usedTx: new Set(),
    audit: [],
    escrows: new Map(),
  };
}

function hydrate(data: PersistShape): StoreShape {
  const s = emptyStore();
  for (const a of data.agents || []) {
    s.agents.set(a.id, a);
    s.agentsByKey.set(a.apiKey, a.id);
  }
  for (const o of data.offers || []) s.offers.set(o.id, o);
  for (const q of data.quotes || []) s.quotes.set(q.id, q);
  for (const o of data.orders || []) s.orders.set(o.id, o);
  for (const t of data.usedTx || []) s.usedTx.add(t);
  s.audit = data.audit || [];
  for (const e of data.escrows || []) s.escrows.set(e.id, e);
  return s;
}

function loadFromDisk(): StoreShape {
  try {
    if (!fs.existsSync(DATA_FILE)) return emptyStore();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return hydrate(JSON.parse(raw) as PersistShape);
  } catch {
    return emptyStore();
  }
}

function snapshot(): PersistShape {
  const s = store();
  return {
    agents: Array.from(s.agents.values()),
    offers: Array.from(s.offers.values()),
    quotes: Array.from(s.quotes.values()),
    orders: Array.from(s.orders.values()),
    usedTx: Array.from(s.usedTx),
    audit: s.audit.slice(0, 500),
    escrows: Array.from(s.escrows.values()),
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      persistNow();
    } catch (e) {
      console.error("[store] persist failed", e);
    }
  }, 50);
}

export function persistNow() {
  const payload = snapshot();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  // Relational PG dual-write: save each record individually
  if (hasDatabaseUrl()) {
    void pgPersistRelational(payload).catch((e) =>
      console.error("[store] pg persist failed", e)
    );
  }
}

/** Write all state to relational PG tables (dual-write mode) */
async function pgPersistRelational(state: PersistShape): Promise<void> {
  const { getPool } = await import("./pg-store");
  await getPool(); // ensure schema
  for (const a of state.agents) {
    const { pgPutAgent } = await import("./pg-store");
    await pgPutAgent(a);
  }
  for (const o of state.offers) {
    const { pgPutOffer } = await import("./pg-store");
    await pgPutOffer(o);
  }
  for (const q of state.quotes) {
    const { pgPutQuote } = await import("./pg-store");
    await pgPutQuote(q);
  }
  for (const o of state.orders) {
    const { pgPutOrder } = await import("./pg-store");
    await pgPutOrder(o);
  }
  for (const e of state.escrows) {
    const { pgPutEscrow } = await import("./pg-store");
    await pgPutEscrow(e);
  }
  for (const t of state.usedTx) {
    const { pgMarkTxUsed } = await import("./pg-store");
    await pgMarkTxUsed(t);
  }
  for (const ev of state.audit) {
    const { pgAudit } = await import("./pg-store");
    await pgAudit(ev);
  }
}

function store(): StoreShape {
  if (!g.__omStore) {
    g.__omStore = loadFromDisk();
    // Prefer Postgres snapshot if available (async hydrate once)
    if (hasDatabaseUrl() && !g.__omPgHydrated) {
      g.__omPgHydrated = true;
      void pgLoadFromRelational()
        .then((state) => {
          if (state && (state.agents?.length || state.offers?.length)) {
            g.__omStore = hydrate(state);
            // also mirror to local file for backup
            try {
              if (!fs.existsSync(DATA_DIR))
                fs.mkdirSync(DATA_DIR, { recursive: true });
              fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
            } catch {
              /* ignore */
            }
          }
        })
        .catch((e) => console.error("[store] pg load failed", e));
    }
  }
  return g.__omStore;
}

/** Load state from relational PG tables (replaces blob load) */
async function pgLoadFromRelational(): Promise<PersistShape | null> {
  const { pgListAgents, pgListOffers, pgListOrders, pgListEscrows, pgListAudit } = await import("./pg-store");
  const agents = await pgListAgents();
  if (!agents.length) return null;
  const offers = await pgListOffers();
  const orders = await pgListOrders();
  const escrows = await pgListEscrows();
  const audit = await pgListAudit(500);
  // quotes: load from pg if available
  const quotes: QuoteRecord[] = [];
  const { getPool } = await import("./pg-store");
  const p = await getPool();
  const qr = await p.query(`SELECT payload FROM quotes ORDER BY created_at DESC LIMIT 500`);
  for (const row of qr.rows) quotes.push(row.payload as QuoteRecord);
  // usedTx
  const usedTx: string[] = [];
  const tr = await p.query(`SELECT transaction_id FROM used_tx`);
  for (const row of tr.rows) usedTx.push(row.transaction_id as string);
  return { agents, offers, quotes, orders, usedTx, audit, escrows };
}

export function newId(prefix: string) {
  return `${prefix}_${nanoid(12)}`;
}

export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function audit(type: string, payload: Record<string, unknown>) {
  const s = store();
  const ev: AuditEvent = {
    id: newId("aud"),
    type,
    payload,
    at: new Date().toISOString(),
  };
  s.audit.unshift(ev);
  if (s.audit.length > 500) s.audit.length = 500;
  schedulePersist();
  return ev;
}

export const db = {
  putAgent(a: AgentRecord) {
    const s = store();
    s.agents.set(a.id, a);
    s.agentsByKey.set(a.apiKey, a.id);
    schedulePersist();
  },
  getAgent(id: string) {
    return store().agents.get(id);
  },
  getAgentByKey(key: string) {
    const id = store().agentsByKey.get(key);
    return id ? store().agents.get(id) : undefined;
  },
  listAgents() {
    return Array.from(store().agents.values());
  },
  putOffer(o: OfferRecord) {
    store().offers.set(o.id, o);
    schedulePersist();
  },
  getOffer(id: string) {
    return store().offers.get(id);
  },
  listOffers() {
    return Array.from(store().offers.values()).filter((o) => o.active);
  },
  putQuote(q: QuoteRecord) {
    store().quotes.set(q.id, q);
    schedulePersist();
  },
  getQuote(id: string) {
    return store().quotes.get(id);
  },
  putOrder(o: OrderRecord) {
    store().orders.set(o.id, o);
    schedulePersist();
  },
  getOrder(id: string) {
    return store().orders.get(id);
  },
  listOrders() {
    return Array.from(store().orders.values());
  },
  isTxUsed(tx: string) {
    // lazy import avoided — use shared helper
    const { normalizeTxId } = require("./tx-id") as {
      normalizeTxId: (s: string) => string;
    };
    const n = normalizeTxId(tx);
    return store().usedTx.has(tx) || store().usedTx.has(n);
  },
  markTxUsed(tx: string) {
    const { normalizeTxId } = require("./tx-id") as {
      normalizeTxId: (s: string) => string;
    };
    store().usedTx.add(tx);
    store().usedTx.add(normalizeTxId(tx));
    schedulePersist();
  },
  listAudit(limit = 50) {
    return store().audit.slice(0, limit);
  },
  putEscrow(e: EscrowRecord) {
    store().escrows.set(e.id, e);
    schedulePersist();
  },
  getEscrow(id: string) {
    return store().escrows.get(id);
  },
  getEscrowByOrder(orderId: string) {
    return Array.from(store().escrows.values()).find(
      (e) => e.orderId === orderId
    );
  },
  listEscrows() {
    return Array.from(store().escrows.values());
  },
  backend() {
    return hasDatabaseUrl() ? "file+postgres-relational" : "file";
  },
};

/** Seed demo seller + offers; ensure core demo capabilities always present */
export function ensureSeedCatalog() {
  store();
  const hasEcho = db
    .listOffers()
    .some((o) => o.capability === "echo.demo" && o.active);
  if (store().agents.size > 0 && hasEcho) {
    const hasEscrow = db
      .listOffers()
      .some((o) => o.capability === "delivery.demo" && o.active);
    if (!hasEscrow) {
      const seller = store().agents.values().next().value as
        | AgentRecord
        | undefined;
      if (seller) {
        db.putOffer({
          id: newId("off"),
          agentId: seller.id,
          capability: "delivery.demo",
          title: "Escrow demo service (lock until proof)",
          description:
            "Uses escrow path: pay → locked → release with proof string.",
          priceAmount: 0.5,
          priceAsset: "HBAR",
          fulfillmentType: "manual",
          maxSeconds: 3600,
          escrow: true,
          tags: ["demo", "escrow"],
          active: true,
          createdAt: new Date().toISOString(),
        });
        audit("seed.escrow_offer", { agentId: seller.id });
      }
    }
    return;
  }
  if (store().agents.size > 0) return;

  const apiKey = `omk_seed_${nanoid(16)}`;
  const agent: AgentRecord = {
    id: newId("agt"),
    apiKey,
    name: "OpenMarket Seed Seller",
    walletAccountId: "0.0.1001",
    capabilities: ["echo.demo", "text.summarize", "delivery.demo"],
    policy: {
      dailySpendLimit: 100,
      maxPerTx: 10,
      allowedCounterparties: [],
      spentToday: 0,
      spentDay: utcDay(),
    },
    stats: {
      sales: 0,
      purchases: 0,
      success: 0,
      fail: 0,
      totalLatencyMs: 0,
    },
    createdAt: new Date().toISOString(),
  };
  db.putAgent(agent);
  db.putOffer({
    id: newId("off"),
    agentId: agent.id,
    capability: "echo.demo",
    title: "Echo demo service",
    description:
      "Instant fulfill: returns your input. For buyer-agent smoke tests.",
    priceAmount: 0.1,
    priceAsset: "HBAR",
    fulfillmentType: "inline",
    maxSeconds: 10,
    escrow: false,
    tags: ["demo", "instant"],
    active: true,
    createdAt: new Date().toISOString(),
  });
  db.putOffer({
    id: newId("off"),
    agentId: agent.id,
    capability: "text.summarize",
    title: "Tiny text summarize (demo)",
    description: "Demo summarizer — truncates text. Replace with real webhook.",
    priceAmount: 0.25,
    priceAsset: "HBAR",
    fulfillmentType: "inline",
    maxSeconds: 30,
    escrow: false,
    tags: ["demo", "nlp"],
    active: true,
    createdAt: new Date().toISOString(),
  });
  db.putOffer({
    id: newId("off"),
    agentId: agent.id,
    capability: "delivery.demo",
    title: "Escrow demo service (lock until proof)",
    description:
      "Uses escrow path: pay → locked → release with proof string.",
    priceAmount: 0.5,
    priceAsset: "HBAR",
    fulfillmentType: "manual",
    maxSeconds: 3600,
    escrow: true,
    tags: ["demo", "escrow"],
    active: true,
    createdAt: new Date().toISOString(),
  });
  audit("seed.catalog", { agentId: agent.id, durable: true });
  try {
    persistNow();
  } catch (e) {
    console.error("[store] seed persist", e);
  }
}
