"""Tests for the AgentBazaar Semantic Kernel plugin (stdlib unittest — no deps required)."""
import sys
import unittest
from unittest import mock

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from openmarket_semantickernel import AgentBazaarPlugin, SK_AVAILABLE  # noqa: E402


def _fake_json(method, path, body=None, params=None):
    return {"ok": True, "method": method, "path": path, "body": body, "params": params}


class AgentBazaarPluginTest(unittest.TestCase):
    def setUp(self):
        self.plugin = AgentBazaarPlugin(base_url="https://agentbazaar.app", api_key="omk_test")

    def test_imports_without_semantic_kernel(self):
        """Module must import cleanly even when semantic-kernel is not installed."""
        self.assertIsInstance(self.plugin, AgentBazaarPlugin)

    def test_search_offers(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("GET", "/api/v1/offers/search"))):
            out = self.plugin.search_offers("translation")
        self.assertEqual(out["method"], "GET")
        self.assertIn("offers/search", out["path"])

    def test_buy_service(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("POST", "/api/v1/buy", {"offerId": "offer_123"}))):
            out = self.plugin.buy_service("offer_123", {"text": "hello"})
        self.assertEqual(out["method"], "POST")
        self.assertEqual(out["body"]["offerId"], "offer_123")

    def test_create_offer(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("POST", "/api/v1/offers", {"priceAsset": "HBAR"}))):
            out = self.plugin.create_offer("translation", "Translate to Armenian", 0.1)
        self.assertEqual(out["body"]["priceAsset"], "HBAR")

    def test_check_balance(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("GET", "/api/v1/me"))):
            out = self.plugin.check_balance()
        self.assertEqual(out["method"], "GET")

    def test_http_error_raises(self):
        err = mock.Mock(status_code=402, json=lambda: {"error": "payment required"})
        with mock.patch("httpx.request", return_value=err):
            with self.assertRaisesRegex(RuntimeError, "402"):
                self.plugin.buy_service("offer_x", {})

    def test_kernel_function_metadata_available(self):
        """When semantic-kernel IS installed, methods carry SK metadata; standalone still works."""
        if SK_AVAILABLE:
            self.assertTrue(hasattr(self.plugin.search_offers, "__kernel_function__"))


if __name__ == "__main__":
    unittest.main()
