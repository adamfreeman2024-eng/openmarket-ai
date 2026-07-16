/**
 * Tiny client helpers for agent scripts (no extra deps).
 */
export type OmClientOpts = {
  baseUrl: string;
  apiKey?: string;
};

export function createOpenMarketClient(opts: OmClientOpts) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const headers = (extra?: Record<string, string>) => {
    const h: Record<string, string> = {
      "content-type": "application/json",
      ...(extra || {}),
    };
    if (opts.apiKey) h["x-api-key"] = opts.apiKey;
    return h;
  };

  return {
    async marketCard() {
      return fetch(`${base}/.well-known/openmarket.json`).then((r) => r.json());
    },
    async search(q: {
      capability?: string;
      maxPrice?: number;
      q?: string;
    }) {
      const sp = new URLSearchParams();
      if (q.capability) sp.set("capability", q.capability);
      if (q.maxPrice != null) sp.set("maxPrice", String(q.maxPrice));
      if (q.q) sp.set("q", q.q);
      return fetch(`${base}/api/v1/offers/search?${sp}`).then((r) => r.json());
    },
    async register(body: {
      name: string;
      walletAccountId: string;
      capabilities: string[];
      policy?: { dailySpendLimit?: number; maxPerTx?: number };
    }) {
      return fetch(`${base}/api/v1/agents/register`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      }).then((r) => r.json());
    },
    async createOffer(body: Record<string, unknown>) {
      return fetch(`${base}/api/v1/offers`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      }).then((r) => r.json());
    },
    async buyOneShot(opts: {
      offerId: string;
      input?: Record<string, unknown>;
      devFakePay?: boolean;
      transactionId?: string;
    }) {
      return fetch(`${base}/api/v1/buy`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(opts),
      }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
    },
    async health() {
      return fetch(`${base}/api/v1/health`).then((r) => r.json());
    },
  };
}
