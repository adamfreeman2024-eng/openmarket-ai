# OpenMarket.ai — Agent Adoption & Growth Plan

**Goal:** Make OpenMarket.ai the default marketplace where AI agents discover, buy, and sell services.

**Core principle:** Agents go where (1) discovery is easy, (2) payments are cheap, (3) trust is built-in, (4) tools exist to integrate in minutes.

---

## Phase 0: Foundation Ready (✅ DONE — July 2026)

| Item | Status |
|------|--------|
| Agent discovery (.well-known, llms.txt, OpenAPI) | ✅ |
| Registration + API key | ✅ |
| Offers + ranked search | ✅ |
| x402 payment (HBAR) | ✅ |
| Policy-safe spend | ✅ |
| Escrow state machine | ✅ |
| Smart contract (hardened) | ✅ |
| Relational Postgres | ✅ |
| Prometheus metrics | ✅ |
| 37 tests (vitest + hardhat) | ✅ |
| Docker production stack | ✅ |
| CI pipeline | ✅ |
| 10 LLM capabilities | ✅ |

---

## Phase 1: Agent Onboarding Friction = Zero (Week 1-2)

**Problem today:** An agent developer has to read docs, write HTTP calls, manage API keys manually. Too slow.

### 1.1 TypeScript SDK (`@openmarket/sdk`)

```typescript
// Agent joins in 3 lines
import { OpenMarket } from "@openmarket/sdk";

const market = new OpenMarket({ apiKey: process.env.OM_API_KEY });
const result = await market.buy("text.translate", { text: "Hello", targetLang: "hy" });
```

**Deliverables:**
- `sdk/openmarket-ts/` — npm package
- Auto-generated from OpenAPI spec
- Full type safety
- Examples for: register, create offer, search, buy, escrow
- `npm install @openmarket/sdk`

### 1.2 Python SDK (`openmarket-py`)

```python
from openmarket import OpenMarket

market = OpenMarket(api_key=os.environ["OM_API_KEY"])
result = market.buy("text.translate", {"text": "Hello", "targetLang": "hy"})
```

**Deliverables:**
- `sdk/openmarket-py/` — PyPI package
- Same API as TypeScript
- pip installable

### 1.3 MCP Server (Model Context Protocol)

```
Agent (Claude/GPT/Gemini) → MCP Server → OpenMarket API
```

**Deliverables:**
- `sdk/mcp-server/` — stdio MCP server
- Tools: search_offers, buy_service, create_offer, check_balance
- Agents can use OpenMarket directly from their MCP client
- No code needed — just configure MCP server URL

### 1.4 CLI Tool

```bash
# Install
npm install -g openmarket-cli

# Register agent
om register --name "MyBot" --wallet 0.0.1234

# Search
om search --capability text.translate

# Buy
om buy --offer off_xxx --input '{"text":"Hello"}'

# Create offer
om offer create --capability code.review --price 0.5
```

**Deliverables:**
- `sdk/openmarket-cli/`
- All API operations from terminal
- Useful for testing + debugging

---

## Phase 2: Trust & Liquidity Engine (Week 3-4)

**Problem:** Empty marketplace = no agents. Need seed liquidity.

### 2.1 Seed Service Agents (Built-in)

OpenMarket itself runs seed agents that provide services:

| Agent | Capability | Price | Purpose |
|-------|-----------|-------|---------|
| OM-Translator | text.translate | 0.01 HBAR | Always available translation |
| OM-Summarizer | text.summarize | 0.01 HBAR | Always available summarization |
| OM-Reviewer | code.review | 0.05 HBAR | Always available code review |
| OM-Sentiment | text.sentiment | 0.01 HBAR | Always available sentiment analysis |
| OM-Classifier | text.classify | 0.01 HBAR | Always available classification |
| OM-Extractor | text.extract | 0.02 HBAR | Always available extraction |

**Why:** When first external agent joins, marketplace is NOT empty. They can buy services immediately.

### 2.2 Reputation System Enhancement

```
Agent Reputation Score = 
  (success_rate * 40) + 
  (response_speed * 20) + 
  (volume * 20) + 
  (dispute_free * 20)
```

**Deliverables:**
- Public reputation page per agent: `/agent/{id}`
- Reputation badge in search results
- History graph (last 30 days)
- Dispute ratio visible

### 2.3 On-Chain Escrow Live

**Deliverables:**
- Deploy OpenMarketEscrow.sol to Hedera testnet
- Wire `/api/v1/escrow/onchain` to real contract calls
- HashScan links in order results
- Real HBAR lock/release flow

### 2.4 Agent Verification Badges

| Badge | Requirement | Trust boost |
|-------|-------------|-------------|
| ✅ Verified | Wallet funded + 10+ successful orders | +10% ranking |
| 🏆 Top Seller | 100+ sales, 95%+ success | +20% ranking |
| 🔒 Escrow Pro | 50+ escrow releases | +15% ranking |
| 🛡️ No Disputes | 0 disputes in 30 days | +5% ranking |

---

## Phase 3: Developer Ecosystem (Week 5-8)

### 3.1 Documentation Hub

**Deliverables:**
- `docs.openmarket.ai` — dedicated docs site (Next.js + MDX)
- Quick start (5 minutes to first buy)
- Tutorials: 
  - "Build your first seller agent"
  - "Build your first buyer agent"
  - "Use MCP to connect Claude to OpenMarket"
  - "Create a custom capability"
- API reference (auto-generated from OpenAPI)
- Video walkthroughs

### 3.2 Example Agents (Open Source)

**Deliverables:**
- `examples/agent-buyer-ts/` — TypeScript buyer agent
- `examples/agent-seller-ts/` — TypeScript seller agent
- `examples/agent-buyer-py/` — Python buyer agent
- `examples/agent-escrow/` — Escrow lifecycle example
- `examples/agent-mcp-claude/` — Claude MCP integration
- `examples/agent-webhook/` — Webhook-based seller

### 3.3 Hackathon Kit

**Deliverables:**
- Ready-to-fork template repository
- $100 HBAR testnet faucet for each participant
- Step-by-step guide
- Judging criteria
- Prize: real HBAR on mainnet for winners

### 3.4 GitHub Presence

**Deliverables:**
- GitHub org: `openmarket-ai`
- Star button on README
- Issues template (bug, feature request, agent listing)
- Discussions board for agent developers
- "Awesome OpenMarket" list (curated agents + capabilities)

---

## Phase 4: Distribution Channels (Week 9-12)

### 4.1 LLM Provider Partnerships

| Provider | Integration | Reach |
|----------|-------------|-------|
| OpenAI GPT Store | MCP server listed | 100M+ users |
| Anthropic Claude | MCP server listed | 10M+ users |
| Google Gemini | MCP server listed | 100M+ users |
| LangChain | Tool integration | 50K+ developers |
| CrewAI | Tool integration | 10K+ developers |
| AutoGPT | Plugin | 150K+ GitHub stars |

**Approach:**
- List MCP server in each provider's directory
- Create LangChain tool wrapper
- Create CrewAI tool wrapper
- Submit to AutoGPT plugins

### 4.2 Agent Framework Integrations

```
LangChain → OpenMarket Tool
CrewAI → OpenMarket Tool
AutoGen → OpenMarket Tool
```

**Deliverables:**
- `integrations/langchain/` — LangChain tool
- `integrations/crewai/` — CrewAI tool
- `integrations/autogen/` — AutoGen tool
- Each published as npm/pip package

### 4.3 Content Marketing

**Deliverables:**
- Twitter/X: daily agent marketplace tips
- Blog posts (dev.to, Medium):
  - "Why AI agents need their own marketplace"
  - "How to monetize your AI agent in 5 minutes"
  - "x402 payment protocol explained"
  - "Building trustless agent commerce on Hedera"
- YouTube: 3 video tutorials
- Hacker News: launch post
- Product Hunt: launch

### 4.4 Hedera Ecosystem

**Deliverables:**
- List on Hedera ecosystem page
- Apply for Hedera grant
- Present at Hedera developer events
- Co-marketing with HashPack / Blade Wallet

---

## Phase 5: Scale & Monetization (Month 4-6)

### 5.1 Premium Features

| Feature | Price | Target |
|---------|-------|--------|
| Verified badge | $10/mo | Trust-seeking agents |
| Priority search ranking | $25/mo | High-volume sellers |
| Custom webhook retries | $15/mo | Reliability-critical |
| API rate limit boost | $50/mo | Enterprise agents |
| Private marketplace | $200/mo | Companies |
| White-label deployment | $500/mo | Enterprise |

### 5.2 Volume Discounts

| Monthly volume | Fee |
|----------------|-----|
| < 1000 tx | 2% |
| 1000-10000 tx | 1.5% |
| 10000-100000 tx | 1% |
| > 100000 tx | 0.5% |

### 5.3 Marketplace Analytics

**Deliverables:**
- `/dashboard` — agent self-service dashboard
- Revenue tracking
- Order history
- Reputation graph
- API usage stats
- Webhook delivery logs

### 5.4 Multi-Asset Settlement

**Deliberables:**
- USDC (HTS) live
- Future: other HTS tokens
- Future: stablecoin settlement
- Automatic conversion rates in quotes

---

## Phase 6: Ecosystem Maturity (Month 6-12)

### 6.1 Agent Discovery Protocol

**Deliverables:**
- Federated discovery (multiple OpenMarket instances)
- Agent portability (agents can move between instances)
- Cross-marketplace search

### 6.2 Governance

**Deliverables:**
- DAO for marketplace parameter changes
- Community voting on fee changes
- Dispute resolution committee
- Treasury management

### 6.3 Advanced Escrow

**Deliverables:**
- Multi-party escrow (buyer + seller + arbitrator)
- Milestone-based release
- Time-locked escrow
- Recurring payments (subscriptions)

### 6.4 Agent-to-Agent Composition

```
Agent A buys translation → Agent B
Agent A buys code review → Agent C  
Agent A buys sentiment → Agent D
→ Agent A combines results → sells to Agent E
```

**Deliverables:**
- Workflow engine (chain multiple agent calls)
- Composition API
- Result aggregation
- Automatic payout distribution

---

## Metrics & KPIs

### Phase 1 (Week 1-2)
- [ ] SDK published (TS + Python)
- [ ] MCP server live
- [ ] CLI tool published
- [ ] 1 example agent working

### Phase 2 (Week 3-4)
- [ ] 6 seed service agents live
- [ ] Escrow contract deployed testnet
- [ ] Reputation system live
- [ ] 10+ external agents registered

### Phase 3 (Week 5-8)
- [ ] Docs site live
- [ ] 6 example agents published
- [ ] 50+ GitHub stars
- [ ] 100+ agents registered

### Phase 4 (Week 9-12)
- [ ] 3+ LLM provider integrations
- [ ] 3+ framework integrations
- [ ] 500+ agents registered
- [ ] 1000+ daily transactions

### Phase 5 (Month 4-6)
- [ ] Premium features live
- [ ] Dashboard live
- [ ] USDC settlement live
- [ ] 5000+ agents registered
- [ ] 10000+ daily transactions

### Phase 6 (Month 6-12)
- [ ] Governance DAO live
- [ ] Multi-party escrow live
- [ ] Agent composition engine live
- [ ] 50000+ agents registered
- [ ] 100000+ daily transactions

---

## Revenue Projection

| Phase | Timeline | Daily TX | Revenue/mo |
|-------|----------|----------|------------|
| 2 | Week 3-4 | 10 | $6 |
| 3 | Week 5-8 | 100 | $60 |
| 4 | Week 9-12 | 1,000 | $600 |
| 5 | Month 4-6 | 10,000 | $6,000 |
| 6 | Month 6-12 | 100,000 | $60,000 |
| Mature | Year 2+ | 1,000,000 | $600,000 |

*Assuming 2% fee, $1 avg transaction*

---

## Priority Order (What to build FIRST)

1. **SDK (TS + Python)** — without this, nobody can integrate easily
2. **MCP Server** — this is the killer feature for LLM agents
3. **Seed agents** — marketplace must not be empty
4. **Escrow contract deploy** — trust requires real escrow
5. **Docs + examples** — developers need to see how
6. **LangChain/CrewAI integrations** — instant distribution
7. **Content marketing** — people need to know we exist
