/**
 * In-memory store for MVP. Swap for Supabase/Postgres without changing API shapes.
 * Note: resets on process restart — OK for testnet demo.
 */
import { nanoid } from "nanoid";
import type {
  AgentRecord,
  OfferRecord,
  QuoteRecord,
  OrderRecord,
  AuditEvent,
} from "./types";

const g = globalThis as unknown as {
  __omStore?: {
    agents: Map<string, AgentRecord>;
    agentsByKey: Map<string, string>;
    offers: Map<string, OfferRecord>;
    quotes: Map<string, QuoteRecord>;
    orders: Map<string, OrderRecord>;
    usedTx: Set<string>;
    audit: AuditEvent[];
  };
};

function store() {
  if (!g.__omStore) {
    g.__omStore = {
      agents: new Map(),
      agentsByKey: new Map(),
      offers: new Map(),
      quotes: new Map(),
      orders: new Map(),
      usedTx: new Set(),
      audit: [],
    };
  }
  return g.__omStore;
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
  return ev;
}

export const db = {
  putAgent(a: AgentRecord) {
    const s = store();
    s.agents.set(a.id, a);
    s.agentsByKey.set(a.apiKey, a.id);
  },
  getAgent(id: string) {
    return store().agents.get(id);
  },
  getAgentByKey(key: string) {
    const id = store().agentsByKey.get(key);
    return id ? store().agents.get(id) : undefined;
  },
  listAgents() {
    return [...store().agents.values()];
  },
  putOffer(o: OfferRecord) {
    store().offers.set(o.id, o);
  },
  getOffer(id: string) {
    return store().offers.get(id);
  },
  listOffers() {
    return [...store().offers.values()].filter((o) => o.active);
  },
  putQuote(q: QuoteRecord) {
    store().quotes.set(q.id, q);
  },
  getQuote(id: string) {
    return store().quotes.get(id);
  },
  putOrder(o: OrderRecord) {
    store().orders.set(o.id, o);
  },
  getOrder(id: string) {
    return store().orders.get(id);
  },
  listOrders() {
    return [...store().orders.values()];
  },
  isTxUsed(tx: string) {
    return store().usedTx.has(tx);
  },
  markTxUsed(tx: string) {
    store().usedTx.add(tx);
  },
  listAudit(limit = 50) {
    return store().audit.slice(0, limit);
  },
};

/** Seed a demo seller + offer for empty market (so agents always find supply) */
export function ensureSeedCatalog() {
  if (store().agents.size > 0) return;
  const apiKey = `omk_seed_${nanoid(16)}`;
  const agent: AgentRecord = {
    id: newId("agt"),
    apiKey,
    name: "OpenMarket Seed Seller",
    walletAccountId: "0.0.1001",
    capabilities: ["echo.demo", "text.summarize"],
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
  audit("seed.catalog", { agentId: agent.id });
}
