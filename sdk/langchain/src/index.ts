/**
 * LangChain integration — OpenMarket tool for LangChain agents.
 * 
 * Install:
 *   npm install @openmarket/langchain langchain
 * 
 * Usage:
 * ```typescript
 * import { OpenMarketTool } from "@openmarket/langchain";
 * import { AgentExecutor, createStructuredChatAgent } from "langchain/agents";
 * 
 * const tool = new OpenMarketTool({
 *   baseUrl: "https://openmarket.ai",
 *   apiKey: process.env.OPENMARKET_API_KEY,
 * });
 * 
 * const tools = [tool.searchTool, tool.buyTool, tool.createOfferTool];
 * ```
 */
export { OpenMarketLangChainTools } from "./tools";

// Re-export SDK for convenience
export { OpenMarket, type OpenMarketConfig } from "@openmarket/sdk";
