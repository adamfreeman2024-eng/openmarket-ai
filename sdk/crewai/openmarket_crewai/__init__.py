"""
OpenMarket.ai CrewAI Integration
===============================

Tools for CrewAI agents to use OpenMarket marketplace.

Install:
    pip install openmarket-crewai

Usage:
    from openmarket_crewai import OpenMarketTools

    tools = OpenMarketTools(api_key="omk_...")
    
    # Use in CrewAI
    from crewai import Agent, Task, Crew
    
    agent = Agent(
        role="Buyer Agent",
        goal="Find and buy translation services",
        tools=[tools.search_tool, tools.buy_tool],
    )
"""

from typing import Optional
from crewai.tools import BaseTool
from openmarket import OpenMarket


class OpenMarketSearchTool(BaseTool):
    name: str = "openmarket_search"
    description: str = (
        "Search the OpenMarket.ai marketplace for agent services. "
        "Input: capability (e.g. 'text.translate', 'code.review'), "
        "optional max_price in HBAR."
    )

    def __init__(self, market: OpenMarket):
        super().__init__()
        self._market = market

    def _run(self, capability: str = "", max_price: Optional[float] = None) -> str:
        import json
        result = self._market.search(capability=capability or None, max_price=max_price)
        return json.dumps(result, indent=2)


class OpenMarketBuyTool(BaseTool):
    name: str = "openmarket_buy"
    description: str = (
        "Buy a service from OpenMarket.ai. "
        "Input: offer_id, input_data (dict), "
        "optional dev_fake_pay (bool) for testing."
    )

    def __init__(self, market: OpenMarket):
        super().__init__()
        self._market = market

    def _run(self, offer_id: str, input_data: dict = None, dev_fake_pay: bool = False) -> str:
        import json
        result = self._market.buy(offer_id, input_data or {}, dev_fake_pay=dev_fake_pay)
        return json.dumps(result, indent=2)


class OpenMarketCreateOfferTool(BaseTool):
    name: str = "openmarket_create_offer"
    description: str = (
        "Create a service offer on OpenMarket.ai. "
        "Input: capability, title, price_amount (in HBAR)."
    )

    def __init__(self, market: OpenMarket):
        super().__init__()
        self._market = market

    def _run(self, capability: str, title: str, price_amount: float) -> str:
        import json
        result = self._market.create_offer(
            capability=capability,
            title=title,
            price_amount=price_amount,
            fulfillment_type="llm",
        )
        return json.dumps(result, indent=2)


class OpenMarketHealthTool(BaseTool):
    name: str = "openmarket_health"
    description: str = "Check OpenMarket.ai marketplace health and stats."

    def __init__(self, market: OpenMarket):
        super().__init__()
        self._market = market

    def _run(self) -> str:
        import json
        result = self._market.health()
        return json.dumps(result, indent=2)


class OpenMarketTools:
    """
    Collection of CrewAI tools for OpenMarket marketplace.

    Args:
        api_key: OpenMarket API key
        base_url: OpenMarket instance URL
        timeout: Request timeout in seconds

    Example:
        >>> tools = OpenMarketTools(api_key="omk_...")
        >>> # Use in CrewAI:
        >>> agent = Agent(tools=[tools.search_tool, tools.buy_tool])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3000",
        timeout: int = 30,
    ):
        market = OpenMarket(api_key=api_key, base_url=base_url, timeout=timeout)
        self.search_tool = OpenMarketSearchTool(market)
        self.buy_tool = OpenMarketBuyTool(market)
        self.create_offer_tool = OpenMarketCreateOfferTool(market)
        self.health_tool = OpenMarketHealthTool(market)

    @property
    def all_tools(self) -> list:
        return [
            self.search_tool,
            self.buy_tool,
            self.create_offer_tool,
            self.health_tool,
        ]
