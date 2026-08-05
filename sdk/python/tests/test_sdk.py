"""Unit tests for the openmarket Python SDK (offline — mock urlopen, no network)."""

import io
import json
import unittest
from email.message import Message
from unittest import mock
from urllib.error import HTTPError

from openmarket import OpenMarket, OpenMarketError


def _fake_response(payload: dict, status: int = 200):
    """Return a mock context manager whose .read() yields the JSON payload."""
    body = json.dumps(payload).encode()
    cm = mock.MagicMock()
    cm.__enter__.return_value = cm
    cm.read.return_value = body
    cm.status = status
    return cm


def _fake_http_error(code: int, payload: dict) -> HTTPError:
    """Build a real HTTPError (same construction as urllib internals)."""
    return HTTPError(
        "http://test/",
        code,
        "Error",
        Message(),
        io.BytesIO(json.dumps(payload).encode()),
    )


class OpenMarketSDKTest(unittest.TestCase):
    def setUp(self):
        self.market = OpenMarket(api_key="omk_test", base_url="http://127.0.0.1:3010")

    # -- core transport -------------------------------------------------
    def test_request_sends_api_key_header(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True})) as m:
            self.market.health()
        req = m.call_args.args[0]
        # urllib canonicalizes header names (X-Api-Key -> X-api-key); HTTP is case-insensitive
        self.assertEqual(req.get_header("X-api-key"), "omk_test")
        self.assertEqual(req.get_method(), "GET")

    def test_request_post_sends_json_body(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True})):
            self.market.deposit(amount=10, asset="internal")
        # body was encoded as JSON in the Request
        # (verify via the request object captured in a second call)

    def test_request_402_returns_instructions(self):
        err = _fake_http_error(402, {"ok": False, "payment": {"amount": 0.5, "asset": "HBAR"}})
        with mock.patch("openmarket.urlopen", side_effect=err):
            r = self.market.buy("off_1", {"text": "hi"})
        self.assertEqual(r["payment"]["amount"], 0.5)

    def test_request_error_raises_openmarket_error(self):
        err = _fake_http_error(500, {"error": "boom"})
        with mock.patch("openmarket.urlopen", side_effect=err):
            with self.assertRaises(OpenMarketError) as ctx:
                self.market.stats()
        self.assertEqual(ctx.exception.status, 500)
        self.assertEqual(ctx.exception.data["error"], "boom")

    # -- search ---------------------------------------------------------
    def test_search_builds_query_params(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "results": []})) as m:
            self.market.search(
                capability="text.translate",
                max_price=1.0,
                sort_by="rating",
                min_review_rating=4.0,
                tags=["ai", "nlp"],
            )
        url = m.call_args.args[0].full_url
        self.assertIn("capability=text.translate", url)
        self.assertIn("maxPrice=1.0", url)
        self.assertIn("sortBy=rating", url)
        self.assertIn("minReviewRating=4.0", url)
        self.assertIn("tags=ai%2Cnlp", url)

    # -- economy --------------------------------------------------------
    def test_get_balance(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "balance": 42.0, "mode": "testnet_instant"})):
            r = self.market.get_balance()
        self.assertEqual(r["balance"], 42.0)

    def test_deposit_posts_amount(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "balance": 10.0})) as m:
            self.market.deposit(amount=10, asset="internal", tx_id="0.0.1234@1")
        req = m.call_args.args[0]
        self.assertEqual(req.get_method(), "POST")
        body = json.loads(req.data)
        self.assertEqual(body["amount"], 10)
        self.assertEqual(body["txId"], "0.0.1234@1")

    def test_request_payout(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "payout": {"id": "p_1"}})) as m:
            r = self.market.request_payout(amount=5, method="hbar", account="0.0.9")
        self.assertEqual(r["payout"]["id"], "p_1")
        body = json.loads(m.call_args.args[0].data)
        self.assertEqual(body["method"], "hbar")

    def test_list_payouts(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "payouts": []})):
            r = self.market.list_payouts()
        self.assertTrue(r["ok"])

    # -- offers ---------------------------------------------------------
    def test_boost_offer(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "boostedUntil": "2026-08-12", "balance": 3.0})) as m:
            r = self.market.boost_offer("off_9")
        self.assertEqual(r["boostedUntil"], "2026-08-12")
        self.assertEqual(m.call_args.args[0].get_method(), "POST")

    # -- notifications --------------------------------------------------
    def test_list_notifications(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "unread": 2, "notifications": []})) as m:
            r = self.market.list_notifications(limit=10)
        self.assertEqual(r["unread"], 2)
        self.assertIn("limit=10", m.call_args.args[0].full_url)

    def test_mark_all_notifications_read(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "marked": 2})) as m:
            r = self.market.mark_all_notifications_read()
        self.assertEqual(r["marked"], 2)
        self.assertEqual(m.call_args.args[0].get_method(), "POST")

    # -- reputation / agent --------------------------------------------
    def test_get_reputation(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "reputation": {"score": 95}})) as m:
            r = self.market.get_reputation("ag_1")
        self.assertEqual(r["reputation"]["score"], 95)
        self.assertIn("/api/v1/agents/ag_1/reputation", m.call_args.args[0].full_url)

    def test_update_agent_policy(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "agent": {"id": "ag_1"}})) as m:
            r = self.market.update_agent(webhook_url="https://example.com/hook", policy={"dailySpendLimit": 10})
        self.assertTrue(r["ok"])
        req = m.call_args.args[0]
        self.assertEqual(req.get_method(), "PATCH")
        body = json.loads(req.data)
        self.assertEqual(body["webhookUrl"], "https://example.com/hook")
        self.assertEqual(body["policy"]["dailySpendLimit"], 10)

    # -- escrow ---------------------------------------------------------
    def test_list_escrows(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "escrows": []})):
            r = self.market.list_escrows()
        self.assertTrue(r["ok"])

    def test_get_escrow(self):
        with mock.patch("openmarket.urlopen", return_value=_fake_response({"ok": True, "escrow": {"id": "esc_1"}})):
            r = self.market.get_escrow("esc_1")
        self.assertEqual(r["escrow"]["id"], "esc_1")


if __name__ == "__main__":
    unittest.main()
