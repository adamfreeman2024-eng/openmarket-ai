/**
 * Smart Discovery — natural language goal → ranked marketplace steps.
 * Uses LLM when configured; falls back to keyword capability matching.
 */
import { chatComplete, llmConfigured } from "./llm";
import { db } from "./store";
import { searchOffers } from "./ranking";
import type { AgentRecord, OfferRecord } from "./types";
import { reputationForApi } from "./reputation";
import { publicOffer } from "./public-dto";

const KNOWN_CAPS = [
  "text.translate",
  "text.summarize",
  "text.sentiment",
  "text.classify",
  "text.extract",
  "code.review",
  "design.code_review",
  "legal.tos_audit",
  "security.smart_contract_audit",
  "dispute.mediate",
  "echo.demo",
  "delivery.demo",
  "demo.usdc",
] as const;

function heuristicCapabilities(goal: string): string[] {
  const g = goal.toLowerCase();
  const out: string[] = [];
  const add = (c: string) => {
    if (!out.includes(c)) out.push(c);
  };
  if (/translat|armenian|հայեր|spanish|german|french|language/.test(g)) {
    add("text.translate");
  }
  if (/summar|tl;dr|tldr|concise|shorten/.test(g)) add("text.summarize");
  if (/sentiment|emotion|tone/.test(g)) add("text.sentiment");
  if (/classif|categor/.test(g)) add("text.classify");
  if (/extract|parse|entity|entities/.test(g)) add("text.extract");
  if (/code.?review|review.?code|lint/.test(g)) add("code.review");
  if (/design.?review|ui.?ux|user.?interface|design|usability|accessibility|wcag|landing.?page/.test(g)) {
    add("design.code_review");
  }
  if (/tos|terms of service|privacy policy|legal/.test(g)) add("legal.tos_audit");
  if (/smart.?contract|solidity|reentrancy|audit/.test(g)) {
    add("security.smart_contract_audit");
  }
  if (/dispute|mediate|mediation|arbitrat|refund my order|order dispute/.test(g)) {
    add("dispute.mediate");
  }
  if (/echo|ping|demo/.test(g)) add("echo.demo");
  if (out.length === 0) {
    // broad default: summarize then translate if multi-step words
    if (/then|and then|after that|→|->/.test(g)) {
      add("text.summarize");
      add("text.translate");
    } else {
      add("text.summarize");
    }
  }
  return out;
}

async function llmCapabilities(goal: string): Promise<string[] | null> {
  if (!llmConfigured()) return null;
  const res = await chatComplete({
    messages: [
      {
        role: "system",
        content:
          "You map user goals to AgentBazaar capability ids. Reply with ONLY a JSON array of strings from this list: " +
          JSON.stringify(KNOWN_CAPS) +
          ". Order steps left-to-right. Max 5 items. No markdown.",
      },
      { role: "user", content: goal },
    ],
    temperature: 0.1,
    maxTokens: 200,
    maxSeconds: 45,
  });
  if (!res.ok) return null;
  try {
    const text = res.text.trim().replace(/^```json\s*|\s*```$/g, "");
    const arr = JSON.parse(text) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((x): x is string => typeof x === "string")
      .filter((c) => (KNOWN_CAPS as readonly string[]).includes(c))
      .slice(0, 5);
  } catch {
    return null;
  }
}

export type DiscoveryStep = {
  step: number;
  capability: string;
  offer: ReturnType<typeof publicOffer> | null;
  seller: {
    id: string;
    name: string;
    verificationStatus: string;
    reputation: ReturnType<typeof reputationForApi> | null;
  } | null;
  score: number | null;
};

export type DiscoveryResult = {
  goal: string;
  mode: "llm" | "heuristic";
  capabilities: string[];
  steps: DiscoveryStep[];
  note: string;
};

export async function discoverForGoal(goal: string): Promise<DiscoveryResult> {
  const cleaned = goal.trim().slice(0, 2000);
  let capabilities = await llmCapabilities(cleaned);
  let mode: "llm" | "heuristic" = "llm";
  if (!capabilities || capabilities.length === 0) {
    capabilities = heuristicCapabilities(cleaned);
    mode = "heuristic";
  }

  const agents = new Map(db.listAgents().map((a) => [a.id, a] as const));
  const escrows = db.listEscrows();
  const ordersByAgent = new Map<string, number>();
  for (const o of db.listOrders()) {
    if (o.sellerAgentId) {
      ordersByAgent.set(
        o.sellerAgentId,
        (ordersByAgent.get(o.sellerAgentId) ?? 0) + 1
      );
    }
  }

  const steps: DiscoveryStep[] = capabilities.map((capability, i) => {
    const results = searchOffers(db.listOffers(), agents as Map<string, AgentRecord>, {
      capability,
      limit: 3,
      escrows,
      ordersByAgent,
      sortBy: "reputation",
    });
    const best = results[0];
    if (!best) {
      return {
        step: i + 1,
        capability,
        offer: null,
        seller: null,
        score: null,
      };
    }
    // Prefer higher verification tier among top 3
    let pick = best;
    for (const r of results.slice(0, 3)) {
      const ta = tierRank(r.seller?.verificationStatus);
      const tb = tierRank(pick.seller?.verificationStatus);
      if (ta > tb || (ta === tb && r.score > pick.score)) pick = r;
    }
    return {
      step: i + 1,
      capability,
      offer: publicOffer(pick.offer as OfferRecord),
      seller: pick.seller
        ? {
            id: pick.seller.id,
            name: pick.seller.name,
            verificationStatus: pick.seller.verificationStatus || "bronze",
            reputation: reputationForApi(
              pick.seller,
              escrows,
              ordersByAgent.get(pick.seller.id) ?? 0
            ),
          }
        : null,
      score: Number(pick.score.toFixed(4)),
    };
  });

  return {
    goal: cleaned,
    mode,
    capabilities,
    steps,
    note:
      mode === "llm"
        ? "Plan from LLM + ranked marketplace offers (verification-aware)."
        : "Heuristic capability match + ranked marketplace offers (LLM unavailable or parse fail).",
  };
}

function tierRank(t?: string | null): number {
  if (t === "gold") return 3;
  if (t === "silver") return 2;
  return 1;
}
