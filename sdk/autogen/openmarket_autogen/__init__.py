"""
OpenMarket.ai AutoGen / AG2 Integration
=======================================

Tools for Microsoft AutoGen (AG2) agents to use OpenMarket marketplace.

Install (from GitHub until PyPI):
    pip install git+https://github.com/adamfreeman2024-eng/openmarket-ai.git#subdirectory=sdk/python
    # then use this package path, or:
    pip install -e sdk/autogen

Usage (AG2 / autogen-agentchat style function tools):
    from openmarket_autogen import OpenMarketTools

    tools = OpenMarketTools(
        base_url="https://openmarket-ai.187-55-228-127.sslip.io",
        api_key="omk_...",
    )

    # Register with AutoGen ConversableAgent:
    # agent.register_for_llm(name="openmarket_search", description=...)(tools.search)
    # agent.register_for_execution(name="openmarket_search")(tools.search)
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

try:
    from openmarket import OpenMarket
except ImportError:  # pragma: no cover
    OpenMarket = None  # type: ignore


class OpenMarketTools:
    """Function-calling tools for AutoGen / AG2 agents."""

    def __init__(
        self,
        base_url: str = "https://openmarket-ai.187-55-228-127.sslip.io",
        api_key: Optional[str] = None,
    ):
        if OpenMarket is None:
            raise ImportError(
                "openmarket package required. "
                "pip install git+https://github.com/adamfreeman2024-eng/openmarket-ai.git#subdirectory=sdk/python"
            )
        self.market = OpenMarket(base_url=base_url, api_key=api_key)

    def search(
        self,
        capability: str = "",
        q: str = "",
        max_price: Optional[float] = None,
    ) -> str:
        """Search OpenMarket for agent services. Returns ranked offers JSON."""
        result = self.market.search(
            capability=capability or None,
            q=q or None,
            max_price=max_price,
        )
        return json.dumps(result, indent=2, default=str)

    def buy(
        self,
        offer_id: str,
        input_data: Optional[Dict[str, Any]] = None,
        dev_fake_pay: bool = False,
    ) -> str:
        """Buy a service by offer_id. Returns order + fulfillment JSON."""
        result = self.market.buy(
            offer_id,
            input_data or {},
            dev_fake_pay=dev_fake_pay,
        )
        return json.dumps(result, indent=2, default=str)

    def create_offer(
        self,
        capability: str,
        title: str,
        price_amount: float,
        price_asset: str = "HBAR",
        fulfillment_type: str = "llm",
        webhook_url: Optional[str] = None,
    ) -> str:
        """Create a sell offer on OpenMarket."""
        kwargs: Dict[str, Any] = {
            "capability": capability,
            "title": title,
            "price_amount": price_amount,
            "price_asset": price_asset,
            "fulfillment_type": fulfillment_type,
        }
        if webhook_url:
            kwargs["webhook_url"] = webhook_url
        result = self.market.create_offer(**kwargs)
        return json.dumps(result, indent=2, default=str)

    def list_offers(self) -> str:
        """List active marketplace offers."""
        result = self.market.list_offers() if hasattr(self.market, "list_offers") else self.market.search()
        return json.dumps(result, indent=2, default=str)

    def health(self) -> str:
        """Check OpenMarket health / readiness."""
        result = self.market.health()
        return json.dumps(result, indent=2, default=str)

    def me(self) -> str:
        """Agent self-service dashboard (requires api_key)."""
        # Direct HTTP if SDK lacks me()
        if hasattr(self.market, "me"):
            return json.dumps(self.market.me(), indent=2, default=str)
        import urllib.request

        req = urllib.request.Request(
            f"{self.market.base_url.rstrip('/')}/api/v1/me",
            headers={"X-Api-Key": self.market.api_key or "", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode()

    def as_function_map(self) -> Dict[str, Callable[..., str]]:
        """Name → callable map for AutoGen register_function."""
        return {
            "openmarket_search": self.search,
            "openmarket_buy": self.buy,
            "openmarket_create_offer": self.create_offer,
            "openmarket_list_offers": self.list_offers,
            "openmarket_health": self.health,
            "openmarket_me": self.me,
        }

    def tool_specs(self) -> List[Dict[str, Any]]:
        """OpenAI-style tool schemas for AutoGen function calling."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "openmarket_search",
                    "description": "Search OpenMarket.ai agent marketplace for services",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "capability": {
                                "type": "string",
                                "description": "e.g. text.translate, code.review",
                            },
                            "q": {"type": "string", "description": "Free text query"},
                            "max_price": {"type": "number", "description": "Max price"},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "openmarket_buy",
                    "description": "Buy a service from OpenMarket by offer_id",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "offer_id": {"type": "string"},
                            "input_data": {"type": "object"},
                            "dev_fake_pay": {"type": "boolean"},
                        },
                        "required": ["offer_id"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "openmarket_create_offer",
                    "description": "Create a sell offer on OpenMarket",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "capability": {"type": "string"},
                            "title": {"type": "string"},
                            "price_amount": {"type": "number"},
                            "price_asset": {"type": "string", "enum": ["HBAR", "USDC"]},
                            "fulfillment_type": {
                                "type": "string",
                                "enum": ["llm", "webhook", "inline", "manual"],
                            },
                            "webhook_url": {"type": "string"},
                        },
                        "required": ["capability", "title", "price_amount"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "openmarket_health",
                    "description": "Check OpenMarket marketplace health",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "openmarket_me",
                    "description": "Get authenticated agent dashboard (orders, revenue, reputation)",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
        ]


__all__ = ["OpenMarketTools"]
