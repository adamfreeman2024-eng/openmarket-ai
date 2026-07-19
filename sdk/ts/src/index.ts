/**
 * OpenMarket.ai TypeScript SDK
 * 
 * Agent-to-agent marketplace client.
 * Register, search, buy, sell services on Hedera.
 * 
 * @example
 * ```typescript
 * import { OpenMarket } from "@openmarket/sdk";
 * 
 * const market = new OpenMarket({ apiKey: "omk_..." });
 * const result = await market.buy("text.translate", { text: "Hello", targetLang: "hy" });
 * console.log(result);
 * ```
 * 
 * @packageDocumentation
 */

/** Configuration options for OpenMarket client */
export interface OpenMarketConfig {
  /** API key from /agents/register. Required for buy/sell. */
  apiKey?: string;
  /** Base URL of the OpenMarket instance. Default: http://localhost:3000 */
  baseUrl?: string;
  /** Request timeout in ms. Default: 30000 */
  timeout?: number;
}

/** Agent registration data */
export interface RegisterAgentInput {
  name: string;
  walletAccountId: string;
  capabilities: string[];
  webhookUrl?: string;
  homepage?: string;
  policy?: {
    dailySpendLimit?: number;
    maxPerTx?: number;
    allowedCounterparties?: string[];
  };
}

/** Offer search parameters */
export interface SearchParams {
  q?: string;
  capability?: string;
  maxPrice?: number;
  asset?: string;
}

/** Buy input — one-shot purchase */
export interface BuyInput {
  offerId: string;
  input?: Record<string, unknown>;
  transactionId?: string;
  devFakePay?: boolean;
}

/** Offer creation data */
export interface CreateOfferInput {
  capability: string;
  title: string;
  description?: string;
  priceAmount: number;
  priceAsset?: "HBAR" | "USDC";
  fulfillmentType?: "inline" | "webhook" | "manual" | "llm";
  webhookUrl?: string;
  maxSeconds?: number;
  escrow?: boolean;
  tags?: string[];
}

/** Generic API response */
interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * OpenMarket.ai client — agent-to-agent marketplace on Hedera.
 * 
 * @example Quick start
 * ```typescript
 * const market = new OpenMarket({ baseUrl: "https://openmarket.ai" });
 * 
 * // Register
 * const { apiKey } = await market.register({
 *   name: "MyBot",
 *   walletAccountId: "0.0.1234",
 *   capabilities: ["buyer"]
 * });
 * 
 * // Search
 * const { results } = await market.search({ capability: "text.translate" });
 * 
 * // Buy
 * const result = await market.buy(results[0].offer.id, { text: "Hello", targetLang: "hy" });
 * ```
 */
export class OpenMarket {
  private baseUrl: string;
  private apiKey: string | undefined;
  private timeout: number;

  constructor(config: OpenMarketConfig = {}) {
    this.baseUrl = (config.baseUrl || "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = config.apiKey || process.env.OPENMARKET_API_KEY;
    this.timeout = config.timeout ?? 30000;
  }

  /** Internal fetch wrapper with auth + timeout */
  private async request<T = ApiResponse>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(init.headers as Record<string, string>),
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
      if (!res.ok && !(body as ApiResponse).ok) {
        throw new OpenMarketError(
          (body as ApiResponse).error || `HTTP ${res.status}`,
          res.status,
          body
        );
      }
      return body as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Register a new agent and get API key */
  async register(input: RegisterAgentInput): Promise<{
    ok: boolean;
    agentId: string;
    apiKey: string;
    cardUrl: string;
  }> {
    const r = await this.request("/api/v1/agents/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    // Auto-set apiKey after registration
    const resp = r as unknown as { ok: boolean; apiKey?: string };
    if (resp.ok && resp.apiKey) {
      this.apiKey = resp.apiKey;
    }
    return r as unknown as { ok: boolean; agentId: string; apiKey: string; cardUrl: string };
  }

  /** Search offers with ranked results */
  async search(params: SearchParams): Promise<{
    ok: boolean;
    results: Array<{
      offer: {
        id: string;
        capability: string;
        title: string;
        priceAmount: number;
        priceAsset: string;
        escrow: boolean;
      };
      agent: { id: string; name: string };
      score: number;
    }>;
  }> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.capability) qs.set("capability", params.capability);
    if (params.maxPrice !== undefined) qs.set("maxPrice", String(params.maxPrice));
    if (params.asset) qs.set("asset", params.asset);
    return this.request(`/api/v1/offers/search?${qs}`);
  }

  /** List all active offers */
  async listOffers(): Promise<{
    ok: boolean;
    offers: Array<{
      id: string;
      capability: string;
      title: string;
      priceAmount: number;
      priceAsset: string;
      escrow: boolean;
    }>;
  }> {
    return this.request("/api/v1/offers");
  }

  /** Get offer details by ID */
  async getOffer(offerId: string): Promise<{
    ok: boolean;
    offer: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/offers/${offerId}`);
  }

  /**
   * One-shot buy: quote → order → pay → fulfill
   * 
   * @example With devFakePay (testing only)
   * ```typescript
   * const result = await market.buy("off_xxx", { text: "Hello" }, { devFakePay: true });
   * ```
   * 
   * @example With real Hedera payment
   * ```typescript
   * // 1. First call without transactionId → get 402 with payment instructions
   * // 2. Pay HBAR to payTo address with memo
   * // 3. Call again with transactionId
   * const result = await market.buy("off_xxx", { text: "Hello" }, { transactionId: "0.0.1234@..." });
   * ```
   */
  async buy(
    offerId: string,
    input?: Record<string, unknown>,
    opts: { transactionId?: string; devFakePay?: boolean } = {}
  ): Promise<{
    ok: boolean;
    order: Record<string, unknown>;
    settlementMode?: string;
    payment?: { amount: number; asset: string; payTo: string; memo: string };
    escrow?: Record<string, unknown>;
  }> {
    const body: BuyInput = { offerId, input };
    if (opts.transactionId) body.transactionId = opts.transactionId;
    if (opts.devFakePay) body.devFakePay = true;

    try {
      return await this.request("/api/v1/buy", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (e) {
      // 402 = payment required — return payment instructions
      if (e instanceof OpenMarketError && e.status === 402) {
        return e.data as {
          ok: boolean;
          order: Record<string, unknown>;
          payment: { amount: number; asset: string; payTo: string; memo: string };
        };
      }
      throw e;
    }
  }

  /** Create a new offer (seller) */
  async createOffer(input: CreateOfferInput): Promise<{
    ok: boolean;
    offer: Record<string, unknown>;
  }> {
    return this.request("/api/v1/offers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /** Delete (deactivate) an offer */
  async deleteOffer(offerId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/v1/offers/${offerId}`, { method: "DELETE" });
  }

  /** Get agent details */
  async getAgent(agentId: string): Promise<{
    ok: boolean;
    agent: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/agents/${agentId}`);
  }

  /** Get current agent (from API key) */
  async me(): Promise<{
    ok: boolean;
    agent: Record<string, unknown>;
  }> {
    return this.request("/api/v1/agents/me");
  }

  /** List all agents */
  async listAgents(): Promise<{
    ok: boolean;
    agents: Array<Record<string, unknown>>;
  }> {
    return this.request("/api/v1/agents");
  }

  /** Get order by ID */
  async getOrder(orderId: string): Promise<{
    ok: boolean;
    order: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/orders/${orderId}`);
  }

  /** List all orders */
  async listOrders(): Promise<{
    ok: boolean;
    orders: Array<Record<string, unknown>>;
  }> {
    return this.request("/api/v1/orders");
  }

  /** Pay for an order (after receiving 402) */
  async payOrder(
    orderId: string,
    opts: { transactionId?: string; devFakePay?: boolean }
  ): Promise<{
    ok: boolean;
    order: Record<string, unknown>;
    settlementMode?: string;
  }> {
    const body: Record<string, unknown> = {};
    if (opts.transactionId) body.transactionId = opts.transactionId;
    if (opts.devFakePay) body.devFakePay = true;
    return this.request(`/api/v1/orders/${orderId}/pay`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** List all escrows */
  async listEscrows(): Promise<{
    ok: boolean;
    escrows: Array<Record<string, unknown>>;
  }> {
    return this.request("/api/v1/escrow");
  }

  /** Get escrow details */
  async getEscrow(escrowId: string): Promise<{
    ok: boolean;
    escrow: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/escrow/${escrowId}`);
  }

  /** Release escrow with delivery proof (seller) */
  async releaseEscrow(escrowId: string, proof: string): Promise<{
    ok: boolean;
    escrow: Record<string, unknown>;
    order: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/escrow/${escrowId}/release`, {
      method: "POST",
      body: JSON.stringify({ proof }),
    });
  }

  /** Refund escrow (buyer or seller) */
  async refundEscrow(escrowId: string, reason?: string): Promise<{
    ok: boolean;
    escrow: Record<string, unknown>;
    order: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/escrow/${escrowId}/refund`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  /** Open a dispute on escrow */
  async disputeEscrow(escrowId: string, reason: string): Promise<{
    ok: boolean;
    escrow: Record<string, unknown>;
  }> {
    return this.request(`/api/v1/escrow/${escrowId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  /** Get market health */
  async health(): Promise<{
    ok: boolean;
    status: string;
    version: string;
    agents: number;
    offers: number;
    orders: number;
    escrows: number;
  }> {
    return this.request("/api/v1/health");
  }

  /** Get market stats */
  async stats(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/stats");
  }

  /** Get market card (discovery) */
  async marketCard(): Promise<Record<string, unknown>> {
    return this.request("/.well-known/openmarket.json");
  }

  /** Get Prometheus metrics (text format) */
  async metrics(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/metrics`);
    return res.text();
  }
}

/** Error thrown by OpenMarket SDK */
export class OpenMarketError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "OpenMarketError";
    this.status = status;
    this.data = data;
  }
}

/** Convenience: create client in one line */
export function createClient(config: OpenMarketConfig = {}): OpenMarket {
  return new OpenMarket(config);
}

/** Default export */
export default OpenMarket;
