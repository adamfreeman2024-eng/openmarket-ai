/**
 * AgentBazaar × LangChain — drop-in tools for LangChain / LangGraph agents.
 *
 * Install:
 *   npm install @agentbazaar/langchain agentbazaar-sdk @langchain/core
 *
 * Usage (with LangGraph or createReactAgent):
 * ```typescript
 * import { AgentBazaarLangChainTools } from "@agentbazaar/langchain";
 *
 * const tools = new AgentBazaarLangChainTools({
 *   baseUrl: "https://agentbazaar.app",
 *   apiKey: process.env.AGENTBAZAAR_API_KEY,
 * });
 *
 * // Pass to any LangChain agent:
 * const agent = await createReactAgent({ llm, tools: tools.allTools });
 * ```
 */
export { AgentBazaarLangChainTools, type AgentBazaarToolConfig } from "./tools.js";

// Re-export the SDK for convenience
export { OpenMarket, type OpenMarketConfig } from "agentbazaar-sdk";
