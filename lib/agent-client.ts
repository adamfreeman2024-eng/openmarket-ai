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
    async buyDev(offerId: string, input?: Record<string, unknown>) {
      const quote = await fetch(`${base}/api/v1/quotes`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ offerId, input }),
      }).then((r) => r.json());
      if (!quote.quote?.id) return { step: "quote", quote };
      const orderRes = await fetch(`${base}/api/v1/orders`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ quoteId: quote.quote.id }),
      });
      const order = await orderRes.json();
      if (!order.orderId) return { step: "order", order, http: orderRes.status };
      const pay = await fetch(`${base}/api/v1/orders/${order.orderId}/pay`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ devFakePay: true }),
      }).then((r) => r.json());
      return { step: "done", quote, order, pay };
    },
  };
}
