"""Tests for the AgentBazaar × LlamaIndex FunctionTools (stdlib unittest — no deps required).

Runs deterministically whether or not `llama-index-core` is installed:
- if installed, real llama_index FunctionTool instances are asserted;
- if not, a minimal stand-in is injected so tool-construction logic is still exercised.
HTTP is always mocked via httpx.request.
"""
import importlib
import sys
import types
import unittest
from unittest import mock

BASE = __file__.rsplit("/", 1)[0]
sys.path.insert(0, BASE)

import openmarket_llamaindex as om  # noqa: E402

HAS_REAL_LLAMA_INDEX = om.FunctionTool is not None


def _ensure_functiontool():
    """Return the FunctionTool class actually used by the module (real or injected stand-in)."""
    if om.FunctionTool is not None:
        return om.FunctionTool
    # Inject a minimal llama_index.core.tools so the import inside the module succeeds.
    fake_index = types.SimpleNamespace()
    fake_core = types.SimpleNamespace()
    fake_tools = types.SimpleNamespace()

    class _FunctionTool:
        def __init__(self, fn=None, name=None, description=None):
            self.fn = fn
            self.name = name
            self.description = description

        @classmethod
        def from_defaults(cls, fn=None, name=None, description=None):
            return cls(fn=fn, name=name, description=description)

    fake_tools.FunctionTool = _FunctionTool  # type: ignore[attr-defined]
    fake_core.tools = fake_tools  # type: ignore[attr-defined]
    fake_index.core = fake_core  # type: ignore[attr-defined]
    sys.modules["llama_index"] = fake_index  # type: ignore[assignment]
    sys.modules["llama_index.core"] = fake_core  # type: ignore[assignment]
    sys.modules["llama_index.core.tools"] = fake_tools  # type: ignore[assignment]
    return importlib.reload(om).FunctionTool


def _fake_json(method, path, body=None):
    return {"ok": True, "method": method, "path": path, "body": body}


class LlamaIndexToolsTest(unittest.TestCase):
    def setUp(self):
        self.FunctionTool = _ensure_functiontool()
        self.tools = om.agentbazaar_tools(base_url="https://agentbazaar.app", api_key="omk_test")

    def test_returns_four_tools(self):
        self.assertEqual(len(self.tools), 4)

    def test_tool_names_and_descriptions(self):
        by_name = {t.name: t for t in self.tools}
        self.assertEqual(
            set(by_name.keys()),
            {"search_offers", "buy_service", "create_offer", "check_balance"},
        )
        self.assertIn("Search AgentBazaar", by_name["search_offers"].description)
        self.assertIn("Buy a service", by_name["buy_service"].description)
        self.assertIn("List a new service offer", by_name["create_offer"].description)
        self.assertIn("balance and stats", by_name["check_balance"].description)

    def test_search_offers_http(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("GET", "/api/v1/offers/search"))):
            out = self.tools[0].fn("translation")
        self.assertEqual(out["method"], "GET")
        self.assertIn("offers/search", out["path"])

    def test_search_offers_url_encodes_query(self):
        captured = {}

        def _fake_request(method, url, **kwargs):
            captured["url"] = url
            return mock.Mock(status_code=200, json=lambda: {"ok": True})

        with mock.patch("httpx.request", side_effect=_fake_request):
            self.tools[0].fn("translate to Armenian")
        self.assertIn("capability=translate+to+Armenian", captured["url"])

    def test_buy_service_http(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("POST", "/api/v1/buy", {"offerId": "offer_123"}))):
            out = self.tools[1].fn("offer_123", {"text": "hello"})
        self.assertEqual(out["method"], "POST")
        self.assertEqual(out["body"]["offerId"], "offer_123")

    def test_create_offer_http(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("POST", "/api/v1/offers", {"priceAsset": "HBAR"}))):
            out = self.tools[2].fn("translation", "Translate to Armenian", 0.1)
        self.assertEqual(out["body"]["priceAsset"], "HBAR")

    def test_check_balance_http(self):
        with mock.patch("httpx.request", return_value=mock.Mock(status_code=200, json=lambda: _fake_json("GET", "/api/v1/me"))):
            out = self.tools[3].fn()
        self.assertEqual(out["method"], "GET")

    def test_http_error_raises(self):
        err = mock.Mock(status_code=402, json=lambda: {"error": "payment required"})
        with mock.patch("httpx.request", return_value=err):
            with self.assertRaisesRegex(RuntimeError, "402"):
                self.tools[1].fn("offer_x", {})

    def test_auth_header_sent(self):
        captured = {}

        def _fake_request(method, url, headers=None, **kwargs):
            captured["headers"] = headers
            return mock.Mock(status_code=200, json=lambda: {"ok": True})

        with mock.patch("httpx.request", side_effect=_fake_request):
            self.tools[3].fn()
        self.assertEqual(captured["headers"]["X-Api-Key"], "omk_test")


if __name__ == "__main__":
    unittest.main()
