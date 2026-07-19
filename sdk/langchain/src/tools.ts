/**
 * LangChain tools wrapping OpenMarket SDK.
 * Each tool is a StructuredTool that LangChain agents can use directly.
 */
import { Tool } from "@langchain/core/tools";
import { OpenMarket } from "@openmarket/sdk";

/** Configuration for OpenMarket LangChain tools */
export interface OpenMarketToolConfig {
  baseUrl?: string;
  apiKey?: string;
}

/** Collection of LangChain tools for OpenMarket marketplace */
export class OpenMarketLangChainTools {
  private market: OpenMarket;

  constructor(config: OpenMarketToolConfig = {}) {
    this.market = new OpenMarket(config);
  }

  /** Search marketplace for services */
  get searchTool(): Tool {
    return new OpenMarketSearchTool(this.market);
  }

  /** Buy a service from marketplace */
  get buyTool(): Tool {
    return new OpenMarketBuyTool(this.market);
  }

  /** Create an offer (sell a service) */
  get createOfferTool(): Tool {
    return new OpenMarketCreateOfferTool(this.market);
  }

  /** List all active offers */
  get listOffersTool(): Tool {
    return new OpenMarketListOffersTool(this.market);
  }

  /** Check marketplace health */
  get healthTool(): Tool {
    return new OpenMarketHealthTool(this.market);
  }

  /** Get all tools as array */
  get allTools(): Tool[] {
    return [
      this.searchTool,
      this.buyTool,
      this.createOfferTool,
      this.listOffersTool,
      this.healthTool,
    ];
  }
}

// --- Individual Tools ---

class OpenMarketSearchTool extends Tool {
  name = "openmarket_search";
  description = `Search the OpenMarket.ai marketplace for agent services.
Input: JSON object with optional fields:
  - capability (string): Service type like "text.translate", "code.review", "text.summarize"
  - q (string): Full-text search query
  - maxPrice (number): Maximum price in HBAR
Returns: JSON array of ranked offers with seller reputation.`;

  constructor(private market: OpenMarket) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input || "{}");
      const result = await this.market.search({
        capability: params.capability,
        q: params.q,
        maxPrice: params.maxPrice,
      });
      return JSON.stringify(result, null, 2);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

class OpenMarketBuyTool extends Tool {
  name = "openmarket_buy";
  description = `Buy a service from OpenMarket.ai marketplace.
Input: JSON object with:
  - offerId (string, required): Offer ID from search results
  - input (object): Service input (e.g. {text: "Hello", targetLang: "hy"})
  - devFakePay (boolean): Use fake payment for testing (optional)
Returns: Order result with fulfillment output.`;

  constructor(private market: OpenMarket) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input || "{}");
      const result = await this.market.buy(
        params.offerId,
        params.input,
        { devFakePay: params.devFakePay }
      );
      return JSON.stringify(result, null, 2);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

class OpenMarketCreateOfferTool extends Tool {
  name = "openmarket_create_offer";
  description = `Create a service offer on OpenMarket.ai.
Input: JSON object with:
  - capability (string, required): Service type
  - title (string, required): Offer title
  - priceAmount (number, required): Price in HBAR
  - description (string): Optional description
Returns: Created offer details.`;

  constructor(private market: OpenMarket) {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      const params = JSON.parse(input || "{}");
      const result = await this.market.createOffer({
        capability: params.capability,
        title: params.title,
        priceAmount: params.priceAmount,
        description: params.description,
        fulfillmentType: "llm",
      });
      return JSON.stringify(result, null, 2);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

class OpenMarketListOffersTool extends Tool {
  name = "openmarket_list_offers";
  description = "List all active offers on OpenMarket.ai marketplace.";
  constructor(private market: OpenMarket) {
    super();
  }

  async _call(): Promise<string> {
    try {
      const result = await this.market.listOffers();
      return JSON.stringify(result, null, 2);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

class OpenMarketHealthTool extends Tool {
  name = "openmarket_health";
  description = "Check OpenMarket.ai marketplace health and stats.";
  constructor(private market: OpenMarket) {
    super();
  }

  async _call(): Promise<string> {
    try {
      const result = await this.market.health();
      return JSON.stringify(result, null, 2);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}
