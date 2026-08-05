package agentbazaar

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testClient(t *testing.T, handler http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	c := New(Config{BaseURL: srv.URL, APIKey: "test-key-123"})
	t.Cleanup(srv.Close)
	return c, srv
}

func writeJSON(t *testing.T, w http.ResponseWriter, status int, v any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Fatalf("encode: %v", err)
	}
}

func TestSendsAPIKeyHeader(t *testing.T) {
	var gotKey string
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		writeJSON(t, w, http.StatusOK, map[string]any{"ok": true, "offers": []any{}})
	})
	if _, err := c.ListOffers(context.Background()); err != nil {
		t.Fatalf("ListOffers: %v", err)
	}
	if gotKey != "test-key-123" {
		t.Errorf("x-api-key = %q, want %q", gotKey, "test-key-123")
	}
}

func TestRegisterParsesAPIKeyAndSetsIt(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agents/register" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("method = %q", r.Method)
		}
		writeJSON(t, w, http.StatusOK, map[string]any{
			"ok": true, "agentId": "agt_123", "apiKey": "fresh-key", "cardUrl": "https://agentbazaar.app/agents/agt_123",
		})
	})
	resp, err := c.Register(context.Background(), RegisterAgentInput{
		Name: "MyBot", WalletAccountID: "0.0.1234", Capabilities: []string{"buyer"},
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if resp.AgentID != "agt_123" || resp.APIKey != "fresh-key" {
		t.Errorf("resp = %+v", resp)
	}
	if c.apiKey != "fresh-key" {
		t.Errorf("client apiKey = %q, want fresh-key (auto-set)", c.apiKey)
	}
}

func TestSearchBuildsQueryParams(t *testing.T) {
	var qs string
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		qs = r.URL.RawQuery
		writeJSON(t, w, http.StatusOK, map[string]any{"ok": true, "results": []any{}})
	})
	max := 5.0
	_, err := c.SearchOffers(context.Background(), SearchParams{
		Query: "translate", Capability: "text.translate", MaxPrice: &max, Asset: "USDC",
	})
	if err != nil {
		t.Fatalf("SearchOffers: %v", err)
	}
	for _, want := range []string{"q=translate", "capability=text.translate", "maxPrice=5", "asset=USDC"} {
		if !strings.Contains(qs, want) {
			t.Errorf("query %q missing %q", qs, want)
		}
	}
}

func TestListOffersParsesOffers(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, map[string]any{
			"ok": true,
			"offers": []any{
				map[string]any{
					"id": "off_1", "agentId": "agt_1", "capability": "echo.demo",
					"title": "Echo", "priceAmount": 1.5, "priceAsset": "HBAR",
					"fulfillmentType": "inline", "escrow": true,
				},
			},
		})
	})
	resp, err := c.ListOffers(context.Background())
	if err != nil {
		t.Fatalf("ListOffers: %v", err)
	}
	if len(resp.Offers) != 1 {
		t.Fatalf("offers len = %d", len(resp.Offers))
	}
	o := resp.Offers[0]
	if o.ID != "off_1" || o.PriceAmount != 1.5 || o.PriceAsset != "HBAR" || !o.Escrow {
		t.Errorf("offer = %+v", o)
	}
}

func TestBuyReturnsPaymentRequired(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusPaymentRequired, map[string]any{
			"ok": true, "orderId": "o-1",
			"order":   map[string]any{"id": "o-1", "status": "pending_payment"},
			"payment": map[string]any{"amount": 2.0, "asset": "HBAR", "payTo": "0.0.999", "memo": "ab-xyz"},
		})
	})
	_, err := c.Buy(context.Background(), "off_1", map[string]any{"text": "hi"}, BuyOptions{})
	if err == nil {
		t.Fatal("expected error")
	}
	var perr *ErrPaymentRequired
	if !errors.As(err, &perr) {
		t.Fatalf("error type = %T, want *ErrPaymentRequired", err)
	}
	if perr.Payment.Amount != 2.0 || perr.Payment.PayTo != "0.0.999" || perr.Payment.Memo != "ab-xyz" {
		t.Errorf("payment = %+v", perr.Payment)
	}
	if !IsPaymentRequired(err) {
		t.Error("IsPaymentRequired = false")
	}
}

func TestAPIErrorStatus(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "boom"})
	})
	_, err := c.ListOffers(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	var aerr *APIError
	if !errors.As(err, &aerr) {
		t.Fatalf("error type = %T, want *APIError", err)
	}
	if aerr.StatusCode != http.StatusInternalServerError || aerr.Message != "boom" {
		t.Errorf("api error = %+v", aerr)
	}
}

func TestNotificationsLimit(t *testing.T) {
	var path string
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.String()
		writeJSON(t, w, http.StatusOK, map[string]any{
			"ok": true, "agentId": "agt_1", "unread": 1,
			"notifications": []any{
				map[string]any{"id": "n_1", "agentId": "agt_1", "event": "order.created",
					"title": "New order", "message": "You have a new order", "read": false},
			},
		})
	})
	resp, err := c.ListNotifications(context.Background(), 10)
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if path != "/api/v1/notifications?limit=10" {
		t.Errorf("path = %q", path)
	}
	if len(resp.Notifications) != 1 || resp.Notifications[0].Event != "order.created" || resp.Unread != 1 {
		t.Errorf("notifications = %+v", resp)
	}
}

func TestHealthParses(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusOK, map[string]any{
			"ok": true, "status": "ok", "version": "1.4.5",
			"agents": 7, "offers": 12, "orders": 34, "escrows": 5,
		})
	})
	h, err := c.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if h.Version != "1.4.5" || h.Agents != 7 || h.Offers != 12 {
		t.Errorf("health = %+v", h)
	}
}

func TestClientRespectsCustomTimeout(t *testing.T) {
	c := New(Config{BaseURL: "http://127.0.0.1:1", Timeout: 1, APIKey: "k"})
	if c.hc.Timeout != 1 {
		t.Errorf("timeout = %v", c.hc.Timeout)
	}
	if c.baseURL != "http://127.0.0.1:1" {
		t.Errorf("baseURL = %q", c.baseURL)
	}
}
