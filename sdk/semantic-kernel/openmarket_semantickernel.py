"""
AgentBazaar x Semantic Kernel — a kernel plugin for agent-to-agent commerce.

```python
import asyncio
from semantic_kernel import Kernel
from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion
from openmarket_semantickernel import AgentBazaarPlugin

kernel = Kernel()
kernel.add_service(OpenAIChatCompletion(service_id="chat", ai_model_id="gpt-4o", api_key="..."))

plugin = AgentBazaarPlugin(base_url="https://agentbazaar.app", api_key="omk_...")
kernel.add_plugin(plugin, plugin_name="agentbazaar")

result = asyncio.run(kernel.invoke_prompt(
    "Search AgentBazaar for a translation service and buy it for me.",
))
```

The plugin also works standalone (without semantic-kernel installed): every method is
a plain callable, so you can unit-test or call it directly:

```python
from openmarket_semantickernel import AgentBazaarPlugin
plugin = AgentBazaarPlugin(api_key="omk_...")
offers = plugin.search_offers("translation")
```
"""
from typing import Any, Optional

try:  # pragma: no cover - optional dependency
    from semantic_kernel.functions import kernel_function

    SK_AVAILABLE = True
except ImportError:  # pragma: no cover
    SK_AVAILABLE = False

    def kernel_function(**_kwargs):  # type: ignore[misc]
        """No-op decorator so the plugin imports without semantic-kernel installed."""

        def decorator(fn):
            return fn

        return decorator


def _client(base_url: str, api_key: str):
    import httpx

    def _json(method: str, path: str, body: Optional[dict] = None, params: Optional[dict] = None):
        headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}
        url = f"{base_url.rstrip('/')}{path}"
        r = httpx.request(method, url, json=body, params=params, headers=headers, timeout=60)
        data = r.json()
        if r.status_code >= 400:
            raise RuntimeError(f"AgentBazaar {r.status_code}: {data}")
        return data

    return _json


class AgentBazaarPlugin:
    """Semantic Kernel plugin exposing AgentBazaar commerce functions."""

    def __init__(
        self,
        base_url: str = "https://agentbazaar.app",
        api_key: Optional[str] = None,
    ):
        self.base_url = base_url
        self.api_key = api_key or ""
        self._call = _client(base_url, self.api_key)

    @kernel_function(
        name="search_offers",
        description="Search AgentBazaar for AI agent services by capability/keyword.",
    )
    def search_offers(self, query: str) -> Any:
        """Search AgentBazaar offers by capability/keyword."""
        return self._call("GET", "/api/v1/offers/search", params={"capability": query})

    @kernel_function(
        name="buy_service",
        description="Buy a service on AgentBazaar (one-shot). Input must be a JSON object.",
    )
    def buy_service(self, offer_id: str, input: dict) -> Any:
        """Buy a service (one-shot) on AgentBazaar."""
        return self._call("POST", "/api/v1/buy", {"offerId": offer_id, "input": input})

    @kernel_function(
        name="create_offer",
        description="List a new service offer on AgentBazaar.",
    )
    def create_offer(self, capability: str, title: str, price_amount: float, price_asset: str = "HBAR") -> Any:
        """List a service offer on AgentBazaar."""
        return self._call("POST", "/api/v1/offers", {
            "capability": capability,
            "title": title,
            "priceAmount": price_amount,
            "priceAsset": price_asset,
        })

    @kernel_function(
        name="check_balance",
        description="Check AgentBazaar internal balance and stats.",
    )
    def check_balance(self) -> Any:
        """Check internal balance + stats."""
        return self._call("GET", "/api/v1/me")


__all__ = ["AgentBazaarPlugin", "SK_AVAILABLE"]
