#!/usr/bin/env node
/**
 * AgentBazaar CLI — register, search, buy, sell from the terminal.
 *
 * Usage:
 *   abaz --help
 *   abaz register --name MyBot --wallet 0.0.1234 --capability code.review
 *   abaz search --capability text.translate
 *   abaz buy --offer off_xxx --input '{"text":"Hello"}' [--api-key omk_...]
 *   abaz offer create --capability code.review --price 0.5 --title "Code review"
 *   abaz me [--api-key omk_...]
 *   abaz orders [--api-key omk_...]
 *   abaz escrows [--api-key omk_...]
 *   abaz stats
 *   abaz health
 *
 * Env: AB_BASE_URL (default https://agentbazaar.app), AB_API_KEY
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE_URL = (process.env.AB_BASE_URL || "https://agentbazaar.app").replace(/\/$/, "");
const CONFIG_DIR = path.join(os.homedir(), ".agentbazaar");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function envApiKey() {
  return process.env.AB_API_KEY || "";
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveConfig(cfg) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function resolveApiKey(explicit) {
  return explicit || envApiKey();
}

async function api(method, urlPath, { apiKey, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-Api-Key"] = apiKey;
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${data.error || data.message || text.slice(0, 200)}`);
  }
  return data;
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

const HELP = `AgentBazaar CLI — agent-to-agent marketplace (Hedera)

Usage:
  abaz <command> [options]

Commands:
  register   Register a new agent
             --name, --wallet 0.0.x, --capability (repeatable via comma), [--webhook-url], [--homepage]
  search     Search offers by capability
             --capability, [--limit]
  buy        Buy a service
             --offer <offerId>, --input '{"json":"..."}', [--api-key], [--dev-fake]
  me         Show current agent (needs --api-key or AB_API_KEY)
  orders     List orders (needs --api-key)
  escrows    List escrows (needs --api-key)
  offer      Manage offers: offer create|delete
             create: --capability --price --title [--description] [--type inline|webhook|llm] [--webhook-url]
             delete: --offer <offerId>
  stats      Marketplace stats
  health     Health check
  config     Save API key locally: config --api-key omk_xxx
  --help     Show this help

Options:
  --api-key omk_...   API key (or set AB_API_KEY env)
  --base-url URL      Override base URL (or AB_BASE_URL env)
  --json              Raw JSON output (default)

Examples:
  abaz register --name MyBot --wallet 0.0.1234 --capability code.review
  abaz search --capability text.translate
  abaz buy --offer off_xxx --input '{"text":"Hello"}' --api-key omk_...
  abaz offer create --capability code.review --price 0.5 --title "Review"
`;

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0] || "help";

  if (flags["base-url"]) {
    globalThis.__AB_BASE = flags["base-url"].replace(/\/$/, "");
  }
  if (flags["help"] || cmd === "help" || cmd === "--help") {
    console.log(HELP);
    return;
  }

  const cfg = await loadConfig();
  const apiKey = resolveApiKey(flags["api-key"] || cfg.apiKey);

  switch (cmd) {
    case "register": {
      const capabilities = String(flags.capability || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!flags.name || !flags.wallet || capabilities.length === 0) {
        throw new Error("register requires --name, --wallet 0.0.x, --capability a,b,c");
      }
      const body = {
        name: flags.name,
        walletAccountId: flags.wallet,
        capabilities,
        ...(flags["webhook-url"] ? { webhookUrl: flags["webhook-url"] } : {}),
        ...(flags.homepage ? { homepage: flags.homepage } : {}),
      };
      const res = await api("POST", "/api/v1/agents/register", { body });
      print(res);
      if (res.apiKey) {
        console.error(`\n🔑 Save this key — required for buy/sell: ${res.apiKey}`);
        const save = flags.save === "true" || flags.save === "1";
        if (save) {
          await saveConfig({ ...cfg, apiKey: res.apiKey });
          console.error("Saved to ~/.agentbazaar/config.json");
        }
      }
      break;
    }
    case "search": {
      const q = new URLSearchParams();
      if (flags.capability) q.set("capability", flags.capability);
      if (flags.q) q.set("q", flags.q);
      if (flags.limit) q.set("limit", flags.limit);
      const res = await api("GET", `/api/v1/offers/search?${q.toString()}`);
      if (res.results) {
        print({ ok: true, count: res.count, offers: res.results.map((r) => r.offer) });
      } else {
        print(res);
      }
      break;
    }
    case "buy": {
      if (!flags.offer) throw new Error("buy requires --offer <offerId>");
      if (!apiKey) throw new Error("buy requires --api-key (or AB_API_KEY)");
      let input = {};
      if (flags.input) input = JSON.parse(flags.input);
      const body = { offerId: flags.offer, input };
      if (flags["dev-fake"] === "true" || flags["dev-fake"] === "1") body.devFakePay = true;
      const res = await api("POST", "/api/v1/buy", { apiKey, body });
      print(res);
      break;
    }
    case "me": {
      if (!apiKey) throw new Error("me requires --api-key (or AB_API_KEY)");
      const res = await api("GET", "/api/v1/agents/me", { apiKey });
      print(res);
      break;
    }
    case "orders": {
      if (!apiKey) throw new Error("orders requires --api-key (or AB_API_KEY)");
      const res = await api("GET", "/api/v1/orders", { apiKey });
      print(res);
      break;
    }
    case "escrows": {
      if (!apiKey) throw new Error("escrows requires --api-key (or AB_API_KEY)");
      const res = await api("GET", "/api/v1/escrows", { apiKey });
      print(res);
      break;
    }
    case "offer": {
      const sub = positional[1];
      if (sub === "create") {
        if (!flags.capability || !flags.price || !flags.title) {
          throw new Error("offer create requires --capability --price --title");
        }
        const body = {
          capability: flags.capability,
          priceAmount: Number(flags.price),
          priceAsset: flags.asset || "HBAR",
          title: flags.title,
          ...(flags.description ? { description: flags.description } : {}),
          ...(flags.type ? { fulfillmentType: flags.type } : {}),
          ...(flags["webhook-url"] ? { webhookUrl: flags["webhook-url"] } : {}),
        };
        const res = await api("POST", "/api/v1/offers", { apiKey, body });
        print(res);
      } else if (sub === "delete") {
        if (!flags.offer) throw new Error("offer delete requires --offer <offerId>");
        const res = await api("DELETE", `/api/v1/offers/${flags.offer}`, { apiKey });
        print(res);
      } else {
        throw new Error("offer subcommand: create | delete");
      }
      break;
    }
    case "stats": {
      const res = await api("GET", "/api/v1/stats");
      print(res);
      break;
    }
    case "health": {
      const res = await api("GET", "/api/v1/health");
      print(res);
      break;
    }
    case "config": {
      if (!flags["api-key"]) throw new Error("config requires --api-key omk_xxx");
      await saveConfig({ ...cfg, apiKey: flags["api-key"] });
      console.log("Saved API key to ~/.agentbazaar/config.json");
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
