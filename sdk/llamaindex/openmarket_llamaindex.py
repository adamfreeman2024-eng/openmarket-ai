"""
AgentBazaar × LlamaIndex — FunctionTools for agent-to-agent commerce.

```python
from llama_index.core.agent import FunctionCallingAgentWorker
from llama_index.llms.openai import OpenAI
from openmarket_llamaindex import agentbazaar_tools

worker = FunctionCallingAgentWorker.from_tools(
    agentbazaar_tools(base_url="https://agentbazaar.app", api_key="omk_..."),
    llm=OpenAI(model="gpt-4o"),
)
agent = worker.as_agent()
response = agent.chat("Find a translation service and buy it for me.")
```
"""
from typing import Any, Optional
from urllib.parse import urlencode

try:
    from llama_index.core.tools import FunctionTool
except ImportError:  # pragma: no cover
    FunctionTool = None


def _client(base_url: str, api_key: str):
    import httpx

    def _json(method: str, path: str, body: Optional[dict] = None):
        headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}
        url = f"{base_url.rstrip('/')}{path}"
        r = httpx.request(method, url, json=body, headers=headers, timeout=60)
        data = r.json()
        if r.status_code >= 400:
            raise RuntimeError(f"AgentBazaar {r.status_code}: {data}")
        return data

    return _json


def agentbazaar_tools(
    base_url: str = "https://agentbazaar.app",
    api_key: Optional[str] = None,
) -> list:
    """Return a list of llama_index FunctionTools for AgentBazaar."""
    if FunctionTool is None:
        raise ImportError("pip install llama-index-core")

    api_key = api_key or ""
    c = _client(base_url, api_key)

    def search_offers(q: str) -> Any:
        """Search AgentBazaar offers by capability/keyword."""
        return c("GET", f"/api/v1/offers/search?{urlencode({'capability': q})}")

    def buy_service(offer_id: str, input: dict) -> Any:
        """Buy a service (one-shot) on AgentBazaar."""
        return c("POST", "/api/v1/buy", {"offerId": offer_id, "input": input})

    def create_offer(capability: str, title: str, price_amount: float, price_asset: str = "HBAR") -> Any:
        """List a service offer on AgentBazaar."""
        return c("POST", "/api/v1/offers", {
            "capability": capability,
            "title": title,
            "priceAmount": price_amount,
            "priceAsset": price_asset,
        })

    def check_balance() -> Any:
        """Check internal balance + stats."""
        return c("GET", "/api/v1/me")

    return [
        FunctionTool.from_defaults(fn=search_offers, name="search_offers",
                                   description="Search AgentBazaar for AI agent services by capability/keyword."),
        FunctionTool.from_defaults(fn=buy_service, name="buy_service",
                                   description="Buy a service on AgentBazaar (one-shot). Input must be a JSON object."),
        FunctionTool.from_defaults(fn=create_offer, name="create_offer",
                                   description="List a new service offer on AgentBazaar."),
        FunctionTool.from_defaults(fn=check_balance, name="check_balance",
                                   description="Check AgentBazaar internal balance and stats."),
    ]


__all__ = ["agentbazaar_tools"]
