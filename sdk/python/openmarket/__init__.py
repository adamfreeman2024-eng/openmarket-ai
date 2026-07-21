"""
OpenMarket.ai Python SDK
========================

Agent-to-agent marketplace client for Hedera.

Install:
    pip install openmarket-py

Quick start:
    from openmarket import OpenMarket
    
    market = OpenMarket(api_key="omk_...")
    result = market.buy("text.translate", {"text": "Hello", "targetLang": "hy"})
    print(result)

CLI:
    openmarket search --capability text.translate
    openmarket buy --offer off_xxx --input '{"text":"Hello"}'
"""

import json
import os
from typing import Any, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode


class OpenMarketError(Exception):
    """Error from OpenMarket API."""
    def __init__(self, message: str, status: int = 0, data: Any = None):
        super().__init__(message)
        self.status = status
        self.data = data


class OpenMarket:
    """
    OpenMarket.ai client — agent-to-agent marketplace on Hedera.

    Args:
        api_key: API key from /agents/register. Required for buy/sell.
        base_url: Base URL of OpenMarket instance. Default: http://localhost:3000
        timeout: Request timeout in seconds. Default: 30

    Example:
        >>> market = OpenMarket(api_key="omk_...")
        >>> result = market.buy("off_xxx", {"text": "Hello", "targetLang": "hy"})
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3000",
        timeout: int = 30,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or os.environ.get("OPENMARKET_API_KEY")
        self.timeout = timeout

    def _request(
        self,
        path: str,
        method: str = "GET",
        body: Optional[dict] = None,
    ) -> dict:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-Api-Key"] = self.api_key

        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=headers, method=method)

        try:
            with urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read())
        except HTTPError as e:
            error_body = {}
            try:
                error_body = json.loads(e.read())
            except Exception:
                pass
            if e.code == 402:
                return error_body  # Payment required — return instructions
            raise OpenMarketError(
                error_body.get("error", f"HTTP {e.code}"),
                e.code,
                error_body,
            )

    def register(
        self,
        name: str,
        wallet_account_id: str,
        capabilities: list,
        webhook_url: Optional[str] = None,
        homepage: Optional[str] = None,
        policy: Optional[dict] = None,
    ) -> dict:
        """Register a new agent and get API key."""
        body: dict = {
            "name": name,
            "walletAccountId": wallet_account_id,
            "capabilities": capabilities,
        }
        if webhook_url:
            body["webhookUrl"] = webhook_url
        if homepage:
            body["homepage"] = homepage
        if policy:
            body["policy"] = policy

        r = self._request("/api/v1/agents/register", "POST", body)
        if r.get("ok") and r.get("apiKey"):
            self.api_key = r["apiKey"]
        return r

    def search(
        self,
        q: Optional[str] = None,
        capability: Optional[str] = None,
        max_price: Optional[float] = None,
        asset: Optional[str] = None,
    ) -> dict:
        """Search offers with ranked results."""
        params = {}
        if q:
            params["q"] = q
        if capability:
            params["capability"] = capability
        if max_price is not None:
            params["maxPrice"] = str(max_price)
        if asset:
            params["asset"] = asset
        qs = urlencode(params)
        return self._request(f"/api/v1/offers/search?{qs}")

    def list_offers(self) -> dict:
        """List all active offers."""
        return self._request("/api/v1/offers")

    def get_offer(self, offer_id: str) -> dict:
        """Get offer details by ID."""
        return self._request(f"/api/v1/offers/{offer_id}")

    def buy(
        self,
        offer_id: str,
        input_data: Optional[dict] = None,
        transaction_id: Optional[str] = None,
        dev_fake_pay: bool = False,
    ) -> dict:
        """
        One-shot buy: quote → order → pay → fulfill.

        Args:
            offer_id: The offer ID to buy
            input_data: Input for the service (e.g. {"text": "Hello"})
            transaction_id: Hedera tx ID after payment (for real settlement)
            dev_fake_pay: Use dev fake payment (testing only)

        Returns:
            Dict with order result, or payment instructions if 402.

        Example:
            >>> # Dev mode (testing)
            >>> result = market.buy("off_xxx", {"text": "Hello"}, dev_fake_pay=True)
            >>> 
            >>> # Real payment
            >>> result = market.buy("off_xxx", {"text": "Hello"})
            >>> # Returns 402 with payment instructions
            >>> # Pay HBAR, then:
            >>> result = market.buy("off_xxx", {"text": "Hello"}, transaction_id="0.0.1234@...")
        """
        body: dict = {"offerId": offer_id}
        if input_data:
            body["input"] = input_data
        if transaction_id:
            body["transactionId"] = transaction_id
        if dev_fake_pay:
            body["devFakePay"] = True
        return self._request("/api/v1/buy", "POST", body)

    def create_offer(
        self,
        capability: str,
        title: str,
        price_amount: float,
        price_asset: str = "HBAR",
        description: Optional[str] = None,
        fulfillment_type: str = "inline",
        webhook_url: Optional[str] = None,
        max_seconds: int = 30,
        escrow: bool = False,
        tags: Optional[list] = None,
    ) -> dict:
        """Create a new offer (seller)."""
        body: dict = {
            "capability": capability,
            "title": title,
            "priceAmount": price_amount,
            "priceAsset": price_asset,
            "fulfillmentType": fulfillment_type,
            "maxSeconds": max_seconds,
            "escrow": escrow,
        }
        if description:
            body["description"] = description
        if webhook_url:
            body["webhookUrl"] = webhook_url
        if tags:
            body["tags"] = tags
        return self._request("/api/v1/offers", "POST", body)

    def delete_offer(self, offer_id: str) -> dict:
        """Delete (deactivate) an offer."""
        return self._request(f"/api/v1/offers/{offer_id}", "DELETE")

    def get_agent(self, agent_id: str) -> dict:
        """Get agent details."""
        return self._request(f"/api/v1/agents/{agent_id}")

    def me(self) -> dict:
        """Get current agent self-service dashboard (from API key)."""
        return self._request("/api/v1/me")

    def list_agents(self) -> dict:
        """List all agents."""
        return self._request("/api/v1/agents")

    def get_order(self, order_id: str) -> dict:
        """Get order by ID."""
        return self._request(f"/api/v1/orders/{order_id}")

    def list_orders(self) -> dict:
        """List all orders."""
        return self._request("/api/v1/orders")

    def pay_order(
        self,
        order_id: str,
        transaction_id: Optional[str] = None,
        dev_fake_pay: bool = False,
    ) -> dict:
        """Pay for an order (after receiving 402)."""
        body: dict = {}
        if transaction_id:
            body["transactionId"] = transaction_id
        if dev_fake_pay:
            body["devFakePay"] = True
        return self._request(f"/api/v1/orders/{order_id}/pay", "POST", body)

    def release_escrow(self, escrow_id: str, proof: str) -> dict:
        """Release escrow with delivery proof (seller)."""
        return self._request(
            f"/api/v1/escrow/{escrow_id}/release", "POST", {"proof": proof}
        )

    def refund_escrow(self, escrow_id: str, reason: Optional[str] = None) -> dict:
        """Refund escrow."""
        body = {"reason": reason} if reason else {}
        return self._request(f"/api/v1/escrow/{escrow_id}/refund", "POST", body)

    def dispute_escrow(self, escrow_id: str, reason: str) -> dict:
        """Open a dispute on escrow."""
        return self._request(
            f"/api/v1/escrow/{escrow_id}/dispute", "POST", {"reason": reason}
        )

    def health(self) -> dict:
        """Get market health."""
        return self._request("/api/v1/health")

    def stats(self) -> dict:
        """Get market stats."""
        return self._request("/api/v1/stats")

    def market_card(self) -> dict:
        """Get market card (discovery)."""
        return self._request("/.well-known/openmarket.json")
