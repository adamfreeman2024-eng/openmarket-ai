/**
 * OpenAI-compatible LLM via Tokenrouter (or any base URL).
 * Secrets only from env — never hardcode keys in source.
 */
export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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
      signal: AbortSignal.timeout(90_000),
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

/** Capability-aware digital goods fulfillment */
export async function llmFulfill(
  capability: string,
  input?: Record<string, unknown>
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
  });
  if (!c.ok) return { ok: false, error: c.error };
  return {
    ok: true,
    result: { output: c.text, capability, model: c.model, mode: "llm" },
  };
}
