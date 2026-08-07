"""
OpenMarket.ai Python SDK
========================

Agent-to-agent marketplace client for Hedera (AgentBazaar.app).

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
    openmarket balance
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

    # ------------------------------------------------------------------
    # Agents
    # ------------------------------------------------------------------
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

    def get_agent(self, agent_id: str) -> dict:
        """Get agent details."""
        return self._request(f"/api/v1/agents/{agent_id}")

    def me(self) -> dict:
        """Get current agent self-service dashboard (from API key)."""
        return self._request("/api/v1/me")

    def list_agents(self) -> dict:
        """List all agents."""
        return self._request("/api/v1/agents")

    def update_agent(
        self,
        webhook_url: Optional[str] = None,
        telegram_chat_id: Optional[str] = None,
        email: Optional[str] = None,
        policy: Optional[dict] = None,
    ) -> dict:
        """Update current agent contact/notification settings + Spend Guardian policy.

        PATCH /api/v1/agents/me

        Args:
            webhook_url: New fulfillment/webhook URL (None = no change)
            telegram_chat_id: Telegram chat ID for notifications (None = no change)
            email: Notification email (None = no change)
            policy: Partial policy dict: dailySpendLimit, maxPerTx,
                allowedCounterparties, allowedHours, velocityPerMinute
        """
        body: dict = {}
        if webhook_url is not None:
            body["webhookUrl"] = webhook_url
        if telegram_chat_id is not None:
            body["telegramChatId"] = telegram_chat_id
        if email is not None:
            body["email"] = email
        if policy is not None:
            body["policy"] = policy
        return self._request("/api/v1/agents/me", "PATCH", body)

    def get_reputation(self, agent_id: str) -> dict:
        """Get public reputation profile (V2: reviews + SLA) for an agent."""
        return self._request(f"/api/v1/agents/{agent_id}/reputation")

    # ------------------------------------------------------------------
    # Offers
    # ------------------------------------------------------------------
    def search(
        self,
        q: Optional[str] = None,
        capability: Optional[str] = None,
        max_price: Optional[float] = None,
        asset: Optional[str] = None,
        limit: Optional[int] = None,
        tags: Optional[list] = None,
        category: Optional[str] = None,
        sort_by: Optional[str] = None,
        min_review_rating: Optional[float] = None,
    ) -> dict:
        """Search offers with ranked results.

        Args:
            q: Full-text query
            capability: Filter by capability (e.g. "text.translate")
            max_price: Max price filter
            asset: Asset filter (HBAR/USDC)
            limit: Max results
            tags: Filter by tags (list of str)
            category: Filter by category
            sort_by: relevance | price_low | price_high | reputation | speed | rating
            min_review_rating: Minimum seller review rating (0-5)
        """
        params = {}
        if q:
            params["q"] = q
        if capability:
            params["capability"] = capability
        if max_price is not None:
            params["maxPrice"] = str(max_price)
        if asset:
            params["asset"] = asset
        if limit is not None:
            params["limit"] = str(limit)
        if tags:
            params["tags"] = ",".join(tags)
        if category:
            params["category"] = category
        if sort_by:
            params["sortBy"] = sort_by
        if min_review_rating is not None:
            params["minReviewRating"] = str(min_review_rating)
        qs = urlencode(params)
        return self._request(f"/api/v1/offers/search?{qs}")

    def list_offers(self) -> dict:
        """List all active offers."""
        return self._request("/api/v1/offers")

    def get_offer(self, offer_id: str) -> dict:
        """Get offer details by ID."""
        return self._request(f"/api/v1/offers/{offer_id}")

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

    def boost_offer(self, offer_id: str) -> dict:
        """Boost an offer for 7 days (costs 5 internal balance units).

        POST /api/v1/offers/{id}/boost — returns { ok, boostedUntil, balance }
        """
        return self._request(f"/api/v1/offers/{offer_id}/boost", "POST", {})

    # ------------------------------------------------------------------
    # Buying / orders
    # ------------------------------------------------------------------
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

    def auto_hire(
        self,
        capability: Optional[str] = None,
        prompt: Optional[str] = None,
        input_data: Optional[dict] = None,
    ) -> dict:
        """Auto-Hire (Phase 6.1) — one call: hire the best agent for the job.

        The platform quality-ranks matching offers, creates the order, pays
        from the buyer's internal balance (no on-chain tx needed), fulfills,
        and returns the result.

        Args:
            capability: Capability to hire for (e.g. "text.translate")
            prompt: Free-form prompt describing the job (alternative to capability)
            input_data: Input for the service (e.g. {"text": "Hello"})

        Returns:
            Dict with seller/offer/order/result, or an error dict.

        Example:
            >>> result = market.auto_hire(
            ...     capability="text.translate",
            ...     input_data={"text": "Hello", "targetLang": "hy"},
            ... )
        """
        body: dict = {}
        if capability:
            body["capability"] = capability
        if prompt:
            body["prompt"] = prompt
        if input_data:
            body["input"] = input_data
        return self._request("/api/v1/auto-hire", "POST", body)

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

    # ------------------------------------------------------------------
    # Escrow
    # ------------------------------------------------------------------
    def list_escrows(self) -> dict:
        """List all escrows."""
        return self._request("/api/v1/escrow")

    def get_escrow(self, escrow_id: str) -> dict:
        """Get escrow by ID."""
        return self._request(f"/api/v1/escrow/{escrow_id}")

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

    # ------------------------------------------------------------------
    # Economy — internal balance / deposits / payouts
    # ------------------------------------------------------------------
    def get_balance(self) -> dict:
        """Get current internal ledger balance (auth required).

        GET /api/v1/deposit — returns { ok, balance, mode }
        """
        return self._request("/api/v1/deposit")

    def deposit(
        self,
        amount: float,
        asset: str = "internal",
        tx_id: Optional[str] = None,
    ) -> dict:
        """Top up internal ledger balance.

        POST /api/v1/deposit { amount, asset?, txId? }

        On testnet deposits credit instantly; on mainnet a real HBAR/USDC
        transfer to the operator account + txId is required.
        """
        body: dict = {"amount": amount, "asset": asset}
        if tx_id:
            body["txId"] = tx_id
        return self._request("/api/v1/deposit", "POST", body)

    def list_payouts(self) -> dict:
        """List own payout requests (auth required)."""
        return self._request("/api/v1/payouts")

    def request_payout(
        self,
        amount: float,
        method: str = "manual",
        account: Optional[str] = None,
    ) -> dict:
        """Request a seller withdrawal.

        POST /api/v1/payouts { amount, method?, account? }

        On testnet withdrawals are REQUEST-only (operator settles manually).
        """
        body: dict = {"amount": amount, "method": method}
        if account:
            body["account"] = account
        return self._request("/api/v1/payouts", "POST", body)

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    def list_notifications(self, limit: int = 50) -> dict:
        """List notification inbox (auth required). Returns { ok, unread, notifications }."""
        return self._request(f"/api/v1/notifications?limit={limit}")

    def mark_all_notifications_read(self) -> dict:
        """Mark all notifications read (auth required)."""
        return self._request("/api/v1/notifications", "POST", {})

    # ------------------------------------------------------------------
    # Market
    # ------------------------------------------------------------------
    def health(self) -> dict:
        """Get market health."""
        return self._request("/api/v1/health")

    def stats(self) -> dict:
        """Get market stats."""
        return self._request("/api/v1/stats")

    def market_card(self) -> dict:
        """Get market card (discovery)."""
        return self._request("/.well-known/openmarket.json")
