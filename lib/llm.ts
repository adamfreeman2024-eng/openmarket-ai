/**
 * OpenAI-compatible LLM via Tokenrouter (or any base URL).
 * Secrets only from env — never hardcode keys in source.
 */
export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** 60s in-memory cache for deterministic mirror-query results (hedera.mirror_query) */
const MIRROR_CACHE = new Map<string, { ts: number; data: unknown }>();

export function llmConfigured(): boolean {
  return Boolean(
    process.env.TOKENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LLM_API_KEY
  );
}

export function llmMeta() {
  return {
    configured: llmConfigured(),
    enabled: process.env.LLM_FULFILL_ENABLED !== "false",
    baseUrl: (
      process.env.TOKENROUTER_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.tokenrouter.com/v1"
    ).replace(/\/$/, ""),
    model:
      process.env.TOKENROUTER_MODEL ||
      process.env.LLM_MODEL ||
      "z-ai/glm-5.2-free",
  };
}

function baseUrl() {
  return (
    process.env.TOKENROUTER_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.LLM_BASE_URL ||
    "https://api.tokenrouter.com/v1"
  ).replace(/\/$/, "");
}

function apiKey() {
  return (
    process.env.TOKENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY ||
    ""
  );
}

function model() {
  return (
    process.env.TOKENROUTER_MODEL ||
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    "z-ai/glm-5.2-free"
  );
}

type ChatOk = { ok: true; text: string; model: string };
type ChatErr = { ok: false; error: string };

export async function chatComplete(opts: {
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
  maxSeconds?: number;
}): Promise<ChatOk | ChatErr> {
  if (!llmConfigured()) {
    return { ok: false, error: "LLM_NOT_CONFIGURED" };
  }
  const url = `${baseUrl()}/chat/completions`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + apiKey(),
      },
      body: JSON.stringify({
        model: model(),
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        // GLM reasoning models spend tokens on reasoning_content first
        max_tokens: opts.maxTokens ?? 1200,
      }),
      signal: AbortSignal.timeout((opts.maxSeconds ?? 90) * 1000),
    });
    const j = (await r.json().catch(() => ({}))) as {
      error?: { message?: string } | string;
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
        };
        finish_reason?: string;
      }>;
      model?: string;
    };
    if (!r.ok) {
      const msg =
        typeof j.error === "string"
          ? j.error
          : j.error?.message || `HTTP_${r.status}`;
      return { ok: false, error: msg };
    }
    const msg = j.choices?.[0]?.message;
    let text = (msg?.content || "").trim();
    // Some reasoning models return empty content and put draft in reasoning_content
    if (!text && msg?.reasoning_content) {
      const rc = msg.reasoning_content.trim();
      const lines = rc
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      text = lines[lines.length - 1] || rc.slice(0, 500);
    }
    if (!text) return { ok: false, error: "EMPTY_COMPLETION" };
    return { ok: true, text, model: j.model || model() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "LLM_FETCH_FAILED",
    };
  }
}

/** 30s exact-match cache for cacheable LLM capabilities (latency cut for repeat requests) */
const LLM_FULFILL_CACHE = new Map<string, { ts: number; data: unknown }>();
const CACHEABLE_CAPS = new Set([
  "text.summarize",
  "text.translate",
  "text.classify",
  "text.extract",
  "code.review",
  "design.code_review",
  "text.sentiment",
]);

/** Capability-aware digital goods fulfillment (with exact-match caching wrapper) */
export async function llmFulfill(
  capability: string,
  input?: Record<string, unknown>,
  opts?: { maxSeconds?: number }
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  if (CACHEABLE_CAPS.has(capability)) {
    const key = `llm:${capability}:${JSON.stringify(input || {})}`;
    const hit = LLM_FULFILL_CACHE.get(key);
    if (hit && Date.now() - hit.ts < 30_000) {
      return { ok: true, result: { ...(hit.data as object), cached: true } };
    }
    const res = await llmFulfillInner(capability, input, opts);
    if (res.ok) {
      LLM_FULFILL_CACHE.set(key, { ts: Date.now(), data: res.result });
      if (LLM_FULFILL_CACHE.size > 500) {
        const oldest = LLM_FULFILL_CACHE.keys().next().value;
        if (oldest) LLM_FULFILL_CACHE.delete(oldest);
      }
    }
    return res;
  }
  return llmFulfillInner(capability, input, opts);
}

/** Capability-aware digital goods fulfillment — core implementation */
async function llmFulfillInner(
  capability: string,
  input?: Record<string, unknown>,
  opts?: { maxSeconds?: number }
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  if (process.env.LLM_FULFILL_ENABLED === "false") {
    return { ok: false, error: "LLM_FULFILL_DISABLED" };
  }
  if (!llmConfigured()) return { ok: false, error: "LLM_NOT_CONFIGURED" };

  const text = String(
    input?.text || input?.content || input?.prompt || input?.query || ""
  );

  if (capability === "text.summarize") {
    if (!text) return { ok: false, error: "MISSING_TEXT" };
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            "You are a concise summarizer for a paid marketplace. Reply with a clear summary only. No preamble. No reasoning dump.",
        },
        { role: "user", content: text.slice(0, 12000) },
      ],
      maxTokens: 1500,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return {
      ok: true,
      result: {
        summary: c.text,
        chars: text.length,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (
    capability === "text.reply" ||
    capability === "agent.answer" ||
    capability === "llm.complete"
  ) {
    const prompt = text || JSON.stringify(input ?? {});
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            "You are a helpful paid AI service on OpenMarket.ai. Be accurate and concise. Answer only.",
        },
        { role: "user", content: prompt.slice(0, 12000) },
      ],
      maxTokens: 1500,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return {
      ok: true,
      result: { answer: c.text, model: c.model, mode: "llm" },
    };
  }

  if (capability === "text.translate") {
    const targetLang = String(input?.targetLang || input?.language || "en");
    const sourceText = text || String(input?.sourceText || "");
    if (!sourceText) return { ok: false, error: "MISSING_TEXT" };
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the user's text to ${targetLang}. Return ONLY the translation. No explanations. No preamble.`,
        },
        { role: "user", content: sourceText.slice(0, 12000) },
      ],
      maxTokens: 2000,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return {
      ok: true,
      result: {
        translation: c.text,
        targetLang,
        sourceChars: sourceText.length,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (capability === "code.review") {
    const code = String(input?.code || input?.text || "");
    if (!code) return { ok: false, error: "MISSING_CODE" };
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            "You are a senior code reviewer on OpenMarket.ai. Review the code for bugs, security issues, performance problems, and best practices. Be specific and actionable. Format: list issues with severity (CRITICAL/HIGH/MEDIUM/LOW) and suggested fixes.",
        },
        { role: "user", content: code.slice(0, 12000) },
      ],
      maxTokens: 2000,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return {
      ok: true,
      result: {
        review: c.text,
        codeChars: code.length,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (capability === "design.code_review") {
    const target =
      String(input?.screenshot || input?.url || input?.code || input?.text || "");
    if (!target) return { ok: false, error: "MISSING_DESIGN_INPUT" };
    const context = input?.context ? String(input.context).slice(0, 2000) : "";
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            "You are a senior UI/UX design reviewer on OpenMarket.ai. Review the provided design (HTML/CSS code, component markup, or design description) for usability, accessibility (WCAG), visual hierarchy, responsiveness, and conversion best practices. Be specific and actionable. Format: list findings with severity (CRITICAL/HIGH/MEDIUM/LOW) and concrete suggestions.",
        },
        {
          role: "user",
          content: `DESIGN TO REVIEW:\n${target.slice(0, 12000)}${
            context ? `\n\nCONTEXT:\n${context}` : ""
          }`,
        },
      ],
      maxTokens: 2000,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return {
      ok: true,
      result: {
        review: c.text,
        inputChars: target.length,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (capability === "text.sentiment") {
    const target = text || String(input?.text || input?.content || "");
    if (!target) return { ok: false, error: "MISSING_TEXT" };
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            'You are a sentiment analysis service. Analyze the sentiment of the text. Respond ONLY with JSON: {"sentiment":"positive|negative|neutral","confidence":0.0-1.0,"summary":"one sentence"}',
        },
        { role: "user", content: target.slice(0, 12000) },
      ],
      maxTokens: 300,
    });
    if (!c.ok) return { ok: false, error: c.error };
    let parsed: unknown = c.text;
    try {
      parsed = JSON.parse(c.text);
    } catch {
      // keep raw text if not valid JSON
    }
    return {
      ok: true,
      result: {
        sentiment: parsed,
        rawText: c.text,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (capability === "text.classify") {
    const target = text || String(input?.text || input?.content || "");
    const categories = String(input?.categories || input?.labels || "general");
    if (!target) return { ok: false, error: "MISSING_TEXT" };
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content: `You are a text classification service. Classify the text into one of these categories: ${categories}. Respond ONLY with JSON: {"category":"...","confidence":0.0-1.0}`,
        },
        { role: "user", content: target.slice(0, 12000) },
      ],
      maxTokens: 300,
    });
    if (!c.ok) return { ok: false, error: c.error };
    let parsed: unknown = c.text;
    try {
      parsed = JSON.parse(c.text);
    } catch {
      // keep raw text if not valid JSON
    }
    return {
      ok: true,
      result: {
        classification: parsed,
        rawText: c.text,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (capability === "text.extract") {
    const target = text || String(input?.text || input?.content || "");
    const fields = String(input?.fields || input?.schema || "key information");
    if (!target) return { ok: false, error: "MISSING_TEXT" };
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content: `You are an information extraction service. Extract the following fields from the text: ${fields}. Respond ONLY with valid JSON. If a field is not present, use null.`,
        },
        { role: "user", content: target.slice(0, 12000) },
      ],
      maxTokens: 1000,
    });
    if (!c.ok) return { ok: false, error: c.error };
    let parsed: unknown = c.text;
    try {
      parsed = JSON.parse(c.text);
    } catch {
      // keep raw text if not valid JSON
    }
    return {
      ok: true,
      result: {
        extracted: parsed,
        rawText: c.text,
        model: c.model,
        mode: "llm",
      },
    };
  }

  if (capability === "legal.tos_audit") {
    const documentUrl = String(input?.document_url || input?.url || "");
    const context = String(input?.context || "");
    if (!documentUrl) return { ok: false, error: "MISSING_DOCUMENT_URL" };
    const c = await chatComplete({
      messages: [
        { role: "system", content: "You are an AI legal auditor. Review the Terms of Service document for legal risks, clarity, compliance, and liabilities. Provide a concise audit report." },
        { role: "user", content: `Document URL: ${documentUrl}\nContext: ${context.slice(0, 5000)}` },
      ],
      maxTokens: 3000,
      maxSeconds: opts?.maxSeconds,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return { ok: true, result: { auditReport: c.text, documentUrl, model: c.model, mode: "llm" } };
  }

  if (capability === "dispute.mediate") {
    const reason = String(input?.reason || "");
    const description = String(input?.description || "");
    if (!reason) return { ok: false, error: "MISSING_REASON" };
    const sellerResponse = String(input?.seller_response || "");
    const buyer = String(input?.buyer || "");
    const seller = String(input?.seller || "");
    const c = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            "You are an impartial AI mediator for a marketplace dispute between an AI buyer agent and an AI seller agent. Decide a fair outcome. Respond with ONLY valid JSON: {\"resolution\": \"refund\"|\"keep\"|\"partial\", \"note\": \"<1-2 sentence justification>\"}. A partial resolution is currently implemented as a full refund, so use it only when the seller is partly at fault. Never invent facts — base the decision only on the provided details.",
        },
        {
          role: "user",
          content: `DISPUTE REASON: ${reason}\nDETAILS: ${description.slice(0, 6000)}\nSELLER RESPONSE: ${sellerResponse.slice(0, 3000)}\nBUYER AGENT: ${buyer}\nSELLER AGENT: ${seller}\n\nReturn JSON only.`,
        },
      ],
      maxTokens: 400,
      maxSeconds: opts?.maxSeconds,
    });
    if (!c.ok) return { ok: false, error: c.error };

    const raw = c.text.trim();
    let resolution = "keep";
    let note = raw.slice(0, 2000);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          resolution?: string;
          note?: string;
        };
        if (
          parsed.resolution === "refund" ||
          parsed.resolution === "keep" ||
          parsed.resolution === "partial"
        ) {
          resolution = parsed.resolution;
        }
        if (parsed.note) note = String(parsed.note).slice(0, 2000);
      } catch {
        // malformed JSON — fall through to keyword scan
      }
    } else if (/refund/i.test(raw)) {
      resolution = "refund";
    } else if (/partial/i.test(raw)) {
      resolution = "partial";
    }

    return {
      ok: true,
      result: { resolution, note, model: c.model, mode: "llm" },
    };
  }

  if (capability === "data.analyze") {
    const data = String(input?.data || input?.csv || input?.json || input?.text || "");
    const question = String(input?.question || input?.query || "Summarize the key insights from this data.");
    if (!data) return { ok: false, error: "MISSING_DATA" };
    const c = await chatComplete({
      messages: [
        { role: "system", content: "You are a data analyst. Analyze the provided tabular data, compute summaries and trends, and answer the question with concrete numbers. Respond with JSON: {summary, insights[], answer}." },
        { role: "user", content: `Question: ${question}\n\nData:\n${data.slice(0, 12000)}` },
      ],
      maxTokens: 2000,
      maxSeconds: opts?.maxSeconds,
    });
    if (!c.ok) return { ok: false, error: c.error };
    let parsed: unknown = c.text;
    try {
      parsed = JSON.parse(c.text);
    } catch {
      // keep raw text if not valid JSON
    }
    return { ok: true, result: { analysis: parsed, model: c.model, mode: "llm" } };
  }

  if (capability === "research.web") {
    const query = String(input?.query || input?.topic || "");
    const depth = String(input?.depth || "concise");
    if (!query) return { ok: false, error: "MISSING_QUERY" };
    const c = await chatComplete({
      messages: [
        { role: "system", content: "You are a research assistant. Produce a structured briefing on the topic: key facts, current state, notable sources. Respond with JSON: {briefing, keyFacts[], sources[]}." },
        { role: "user", content: `Topic: ${query}\nDepth: ${depth}` },
      ],
      maxTokens: 2000,
      maxSeconds: opts?.maxSeconds,
    });
    if (!c.ok) return { ok: false, error: c.error };
    let parsed: unknown = c.text;
    try {
      parsed = JSON.parse(c.text);
    } catch {
      // keep raw text if not valid JSON
    }
    return { ok: true, result: { briefing: parsed, model: c.model, mode: "llm" } };
  }

  if (capability === "hedera.mirror_query") {
    // Real on-chain data queries — deterministic, no LLM needed.
    // Mirrors public mirror node REST API for account/transaction/contract/topic/token info.
    const network = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
    const mirror = `https://${network}.mirrornode.hedera.com/api/v1`;
    const accountId = String(input?.accountId || input?.account || "");
    const txId = String(input?.transactionId || input?.txId || "");
    const contractId = String(input?.contractId || "");
    const topicId = String(input?.topicId || input?.topic || "");
    const tokenId = String(input?.tokenId || input?.token || "");
    const type = String(input?.type || "account");

    // Cache TTL by type: topic 10s (live), account/token 30s, transaction immutable 300s
    const ttlMs =
      type === "topic" ? 10_000 :
      type === "transaction" ? 300_000 :
      30_000;
    const cacheKey = `mirror:${network}:${type}:${accountId || txId || contractId || topicId || tokenId}`;
    const now = Date.now();
    const cached = MIRROR_CACHE.get(cacheKey);
    if (cached && now - cached.ts < ttlMs) {
      return { ok: true, result: { ...(cached.data as object), cached: true } };
    }

    const setCache = (data: unknown) => {
      MIRROR_CACHE.set(cacheKey, { ts: now, data });
      if (MIRROR_CACHE.size > 500) {
        const oldest = MIRROR_CACHE.keys().next().value;
        if (oldest) MIRROR_CACHE.delete(oldest);
      }
    };

    try {
      if (type === "account" && accountId) {
        const r = await fetch(`${mirror}/accounts/${encodeURIComponent(accountId)}`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { ok: false, error: `MIRROR_HTTP_${r.status}` };
        const a = await r.json();
        const data = {
          accountId: a.account,
          hbar: a.balance ? (Number(a.balance.balance) / 1e8).toFixed(6) : null,
          tokens: (a.balance?.tokens || []).map((t: any) => ({ tokenId: t.token_id, balance: t.balance })),
          memo: a.memo || null,
          created: a.created_timestamp || null,
          mode: "hedera.mirror_query",
        };
        setCache(data);
        return { ok: true, result: data };
      }
      if (type === "transaction" && txId) {
        const r = await fetch(`${mirror}/transactions/${encodeURIComponent(txId)}`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { ok: false, error: `MIRROR_HTTP_${r.status}` };
        const t = await r.json();
        const tx = t.transactions?.[0];
        const data = {
          transactionId: tx?.transaction_id,
          status: tx?.result,
          validStart: tx?.valid_start_timestamp,
          chargedFees: tx?.charged_tx_fee,
          transfers: (tx?.transfers || []).slice(0, 10).map((x: any) => ({ account: x.account, amount: Number(x.amount) / 1e8 })),
          mode: "hedera.mirror_query",
        };
        setCache(data);
        return { ok: true, result: data };
      }
      if (type === "contract" && contractId) {
        const r = await fetch(`${mirror}/contracts/${encodeURIComponent(contractId)}`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { ok: false, error: `MIRROR_HTTP_${r.status}` };
        const c = await r.json();
        const data = {
          contractId: c.contract_id,
          evmAddress: c.evm_address,
          balance: c.balance ? Number(c.balance) / 1e8 : null,
          created: c.created_timestamp,
          mode: "hedera.mirror_query",
        };
        setCache(data);
        return { ok: true, result: data };
      }
      if (type === "topic" && topicId) {
        // HCS topic messages (latest 10) — consensus service data
        const r = await fetch(`${mirror}/topics/${encodeURIComponent(topicId)}/messages?limit=10&order=desc`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { ok: false, error: `MIRROR_HTTP_${r.status}` };
        const t = await r.json();
        const data = {
          topicId,
          messageCount: t.messages?.length ?? 0,
          latestMessages: (t.messages || []).map((m: any) => ({
            sequenceNumber: m.sequence_number,
            consensusTimestamp: m.consensus_timestamp,
            message: (m.message || "").toString().slice(0, 500),
          })),
          mode: "hedera.mirror_query",
        };
        setCache(data);
        return { ok: true, result: data };
      }
      if (type === "token" && tokenId) {
        // Token info (HTS) — supply, decimals, symbol
        const r = await fetch(`${mirror}/tokens/${encodeURIComponent(tokenId)}`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { ok: false, error: `MIRROR_HTTP_${r.status}` };
        const tk = await r.json();
        const data = {
          tokenId: tk.token_id,
          symbol: tk.symbol,
          name: tk.name,
          decimals: tk.decimals,
          totalSupply: tk.total_supply,
          treasury: tk.treasury_account_id,
          type: tk.type,
          mode: "hedera.mirror_query",
        };
        setCache(data);
        return { ok: true, result: data };
      }
      if (type === "nft" && tokenId) {
        // NFT collection — latest NFTs (serial, metadata)
        const r = await fetch(`${mirror}/tokens/${encodeURIComponent(tokenId)}/nfts?limit=10&order=desc`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return { ok: false, error: `MIRROR_HTTP_${r.status}` };
        const n = await r.json();
        const data = {
          tokenId,
          nftCount: n.nfts?.length ?? 0,
          nfts: (n.nfts || []).map((x: any) => ({
            serial: x.serial_number,
            accountId: x.account_id,
            metadata: x.metadata || null,
            created: x.created_timestamp,
          })),
          mode: "hedera.mirror_query",
        };
        setCache(data);
        return { ok: true, result: data };
      }
      return { ok: false, error: "MISSING_INPUT" };
    } catch (e) {
      return { ok: false, error: "MIRROR_FETCH_FAILED" };
    }
  }

  if (capability === "security.smart_contract_audit") {
    const contractCode = String(input?.contract_code || input?.code || "");
    if (!contractCode) return { ok: false, error: "MISSING_CONTRACT_CODE" };
    const c = await chatComplete({
      messages: [
        { role: "system", content: "You are an AI smart contract security auditor. Analyze the Solidity code for vulnerabilities (reentrancy, access control, gas, overflow). Provide a security report." },
        { role: "user", content: contractCode.slice(0, 12000) },
      ],
      maxTokens: 3000,
      maxSeconds: opts?.maxSeconds,
    });
    if (!c.ok) return { ok: false, error: c.error };
    return { ok: true, result: { securityReport: c.text, contractCodeChars: contractCode.length, model: c.model, mode: "llm" } };
  }

  const c = await chatComplete({
    messages: [
      {
        role: "system",
        content: `You fulfill marketplace capability "${capability}". Return useful plain text only.`,
      },
      {
        role: "user",
        content: JSON.stringify(input ?? {}).slice(0, 12000),
      },
    ],
    maxTokens: 1200,
    maxSeconds: opts?.maxSeconds,
  });
  if (!c.ok) return { ok: false, error: c.error };
  return {
    ok: true,
    result: { output: c.text, capability, model: c.model, mode: "llm" },
  };
}
