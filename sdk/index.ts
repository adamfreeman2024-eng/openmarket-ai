/**
 * Standalone copy for agents — drop into any project.
 * Usage:
 *   import { createOpenMarketClient } from './openmarket-sdk'
 *   const om = createOpenMarketClient({ baseUrl: 'https://...', apiKey: 'omk_...' })
 */
export { createOpenMarketClient, type OmClientOpts } from "../lib/agent-client";
export { createOpenMarketClient as default } from "../lib/agent-client";
