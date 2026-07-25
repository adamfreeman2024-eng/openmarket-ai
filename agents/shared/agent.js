/**
 * AgentBazaar Standalone Agent Framework
 * 
 * Each agent is an independent HTTP server that:
 * 1. Registers itself on AgentBazaar via API
 * 2. Listens for webhook calls (fulfillment requests)
 * 3. Processes requests using its own LLM connection
 * 4. Returns results to AgentBazaar
 * 
 * Usage: node agent.js --name "LegalAuditBot" --capability legal.tos_audit
 */

const http = require("http");
const crypto = require("crypto");

// ─── Config ───
const AGENT_NAME = process.env.AGENT_NAME || "UnnamedBot";
const AGENT_CAPABILITY = process.env.AGENT_CAPABILITY || "text.reply";
const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION || "AI service agent";
const AGENT_PRICE = parseFloat(process.env.AGENT_PRICE || "0.5");
const AGENT_ASSET = process.env.AGENT_ASSET || "HBAR";
const AGENT_WALLET = process.env.AGENT_WALLET || "0.0.9587214"; // operator for testnet
const AGENT_PORT = parseInt(process.env.AGENT_PORT || "3011");
const AGENT_HOST = process.env.AGENT_HOST || "127.0.0.1";

const MARKETPLACE_URL = process.env.MARKETPLACE_URL || "https://agentbazaar.app";
const LLM_BASE_URL = process.env.LLM_BASE_URL || process.env.TOKENROUTER_BASE_URL || "https://api.tokenrouter.com/v1";
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.TOKENROUTER_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || process.env.TOKENROUTER_MODEL || "z-ai/glm-5.2-free";

// Webhook secret for HMAC verification
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(16).toString("hex");

// ─── State ───
let apiKey = null;
let agentId = null;
let offerId = null;
let server = null;
let stats = { fulfilled: 0, errors: 0, uptime: Date.now() };

// ─── LLM ───
async function callLLM(messages, maxTokens = 2000) {
  const url = `${LLM_BASE_URL}/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + LLM_API_KEY,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = await resp.json();
  if (!resp.ok) {
    throw new Error(`LLM error ${resp.status}: ${j.error?.message || JSON.stringify(j)}`);
  }
  const msg = j.choices?.[0]?.message;
  let text = (msg?.content || "").trim();
  if (!text && msg?.reasoning_content) {
    text = msg.reasoning_content.trim();
  }
  return { text, model: j.model || LLM_MODEL };
}

// ─── Capability Handlers ───
const HANDLERS = {
  "legal.tos_audit": async (input) => {
    const documentUrl = String(input?.document_url || input?.url || "");
    const context = String(input?.context || "");
    if (!documentUrl) throw new Error("MISSING_DOCUMENT_URL");
    
    const { text, model } = await callLLM([
      {
        role: "system",
        content: "You are an AI legal auditor specializing in Terms of Service analysis. Review the provided document/URL for: 1) Legal risks and liabilities 2) Missing clauses (indemnification, limitation of liability, arbitration) 3) Compliance with GDPR, CCPA, AI Act 4) Payment terms clarity 5) Data privacy issues. Provide a structured audit report with severity ratings (CRITICAL/HIGH/MEDIUM/LOW). Be concise but thorough.",
      },
      {
        role: "user",
        content: `Document URL: ${documentUrl}\nContext: ${context.slice(0, 5000)}\n\nProvide a comprehensive legal audit report.`,
      },
    ], 3000);
    
    return { auditReport: text, documentUrl, model, auditedBy: AGENT_NAME };
  },

  "security.smart_contract_audit": async (input) => {
    const contractCode = String(input?.contract_code || input?.code || "");
    if (!contractCode) throw new Error("MISSING_CONTRACT_CODE");
    
    const { text, model } = await callLLM([
      {
        role: "system",
        content: "You are an AI smart contract security auditor. Analyze Solidity code for: 1) Reentrancy attacks 2) Access control issues 3) Integer overflow/underflow 4) Gas optimization 5) Front-running 6) Timestamp dependence 7) DoS attacks. Provide a structured security report with severity ratings (CRITICAL/HIGH/MEDIUM/LOW) and recommended fixes.",
      },
      {
        role: "user",
        content: `Analyze this Solidity smart contract:\n\n${contractCode.slice(0, 12000)}`,
      },
    ], 3000);
    
    return { securityReport: text, contractCodeChars: contractCode.length, model, auditedBy: AGENT_NAME };
  },

  "code.review": async (input) => {
    const code = String(input?.code || input?.text || "");
    if (!code) throw new Error("MISSING_CODE");
    
    const { text, model } = await callLLM([
      {
        role: "system",
        content: "You are a senior code reviewer. Review code for bugs, security issues, performance, and best practices. Format: list issues with severity (CRITICAL/HIGH/MEDIUM/LOW) and suggested fixes.",
      },
      {
        role: "user",
        content: code.slice(0, 12000),
      },
    ], 2000);
    
    return { review: text, codeChars: code.length, model, reviewedBy: AGENT_NAME };
  },

  "text.translate": async (input) => {
    const targetLang = String(input?.targetLang || input?.language || "en");
    const sourceText = String(input?.text || input?.sourceText || input?.content || "");
    if (!sourceText) throw new Error("MISSING_TEXT");
    
    const { text, model } = await callLLM([
      { role: "system", content: `Translate to ${targetLang}. Return ONLY the translation.` },
      { role: "user", content: sourceText.slice(0, 12000) },
    ], 2000);
    
    return { translation: text, targetLang, model, translatedBy: AGENT_NAME };
  },

  "text.summarize": async (input) => {
    const text = String(input?.text || input?.content || "");
    if (!text) throw new Error("MISSING_TEXT");
    
    const { text: summary, model } = await callLLM([
      { role: "system", content: "Summarize concisely. No preamble." },
      { role: "user", content: text.slice(0, 12000) },
    ], 1500);
    
    return { summary, chars: text.length, model, summarizedBy: AGENT_NAME };
  },
};

// ─── Registration ───
async function registerOnMarketplace() {
  console.log(`[${AGENT_NAME}] Registering on AgentBazaar...`);
  
  const PUBLIC_IP = process.env.PUBLIC_IP || "187.55.228.127";
const webhookUrl = `http://${PUBLIC_IP}:${AGENT_PORT}/webhook`;
  
  const resp = await fetch(`${MARKETPLACE_URL}/api/v1/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: AGENT_NAME,
      description: AGENT_DESCRIPTION,
      walletAccountId: AGENT_WALLET,
      capabilities: [AGENT_CAPABILITY],
      fulfillmentType: "webhook",
      webhookUrl: webhookUrl,
      webhookSecret: WEBHOOK_SECRET,
      // Create an offer as part of registration
      offers: [{
        capability: AGENT_CAPABILITY,
        description: AGENT_DESCRIPTION,
        price: AGENT_PRICE,
        priceAsset: AGENT_ASSET,
        fulfillmentType: "webhook",
        maxSeconds: 120,
      }],
    }),
  });
  
  const j = await resp.json();
  
  if (!resp.ok) {
    throw new Error(`Registration failed: ${j.error || resp.status}`);
  }
  
  apiKey = j.apiKey;
  agentId = j.agentId;
  offerId = j.offerId;
  
  console.log(`[${AGENT_NAME}] ✅ Registered! Agent ID: ${agentId}, API Key: ${apiKey?.slice(0, 12)}...`);
  
  // Now create an offer
  const offerResp = await fetch(`${MARKETPLACE_URL}/api/v1/offers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      capability: AGENT_CAPABILITY,
      title: AGENT_NAME + " — " + AGENT_CAPABILITY,
      description: AGENT_DESCRIPTION,
      priceAmount: AGENT_PRICE,
      priceAsset: AGENT_ASSET,
      fulfillmentType: "webhook",
      maxSeconds: 120,
    }),
  });
  const offerJ = await offerResp.json();
  if (offerResp.ok) {
    offerId = offerJ.offer?.id || offerJ.id;
    console.log(`[${AGENT_NAME}] ✅ Offer created: ${offerId}`);
  } else {
    console.warn(`[${AGENT_NAME}] Offer creation failed: ${offerJ.error}`);
  }
  
  return { agentId, offerId, apiKey };
}

// ─── Webhook Server ───
function startWebhookServer() {
  server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Webhook-Signature");
    
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // Health check
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        agent: AGENT_NAME,
        agentId,
        offerId,
        apiKey: apiKey ? apiKey.slice(0, 12) + "..." : null,
        uptime: Math.floor((Date.now() - stats.uptime) / 1000),
        stats,
      }));
      return;
    }
    
    // Webhook endpoint
    if (req.url === "/webhook" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      
      try {
        const payload = JSON.parse(body);
        console.log(`[${AGENT_NAME}] Webhook called: capability=${payload.capability}, orderId=${payload.orderId}`);
        
        // Verify HMAC if signature provided
        const signature = req.headers["x-webhook-signature"];
        if (signature && WEBHOOK_SECRET) {
          const expected = crypto
            .createHmac("sha256", WEBHOOK_SECRET)
            .update(body)
            .digest("hex");
          if (signature !== expected) {
            console.warn(`[${AGENT_NAME}] Invalid webhook signature!`);
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "INVALID_SIGNATURE" }));
            return;
          }
        }
        
        // Process request
        const handler = HANDLERS[AGENT_CAPABILITY] || HANDLERS["text.reply"];
        const result = await handler(payload.input || {});
        
        stats.fulfilled++;
        console.log(`[${AGENT_NAME}] ✅ Fulfilled order ${payload.orderId}`);
        
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        stats.errors++;
        console.error(`[${AGENT_NAME}] ❌ Fulfillment error:`, e.message);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }
    
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  });
  
  server.listen(AGENT_PORT, AGENT_HOST, () => {
    console.log(`[${AGENT_NAME}] 🚀 Webhook server listening on ${AGENT_HOST}:${AGENT_PORT}`);
  });
}

// ─── Main ───
async function main() {
  console.log(`[${AGENT_NAME}] Starting agent...`);
  console.log(`[${AGENT_NAME}] Capability: ${AGENT_CAPABILITY}`);
  console.log(`[${AGENT_NAME}] Model: ${LLM_MODEL}`);
  console.log(`[${AGENT_NAME}] Marketplace: ${MARKETPLACE_URL}`);
  
  if (!LLM_API_KEY) {
    console.error(`[${AGENT_NAME}] No LLM_API_KEY set! Exiting.`);
    process.exit(1);
  }
  
  // Start webhook server first
  startWebhookServer();
  
  // Wait a moment for server to be ready
  await new Promise(r => setTimeout(r, 1000));
  
  // Register on marketplace
  try {
    await registerOnMarketplace();
  } catch (e) {
    console.error(`[${AGENT_NAME}] Registration failed: ${e.message}`);
    console.log(`[${AGENT_NAME}] Will retry in 10s...`);
    await new Promise(r => setTimeout(r, 10000));
    try {
      await registerOnMarketplace();
    } catch (e2) {
      console.error(`[${AGENT_NAME}] Registration failed again: ${e2.message}`);
      console.log(`[${AGENT_NAME}] Continuing as webhook server only...`);
    }
  }
  
  console.log(`[${AGENT_NAME}] Agent is live! Waiting for orders...`);
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log(`[${AGENT_NAME}] Shutting down...`);
  if (server) server.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log(`[${AGENT_NAME}] Interrupted, shutting down...`);
  if (server) server.close();
  process.exit(0);
});

main().catch(e => {
  console.error(`[${AGENT_NAME}] Fatal:`, e);
  process.exit(1);
});
