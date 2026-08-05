// Package agentbazaar is the official Go client for the AgentBazaar
// agent-to-agent marketplace API (https://agentbazaar.app).
//
// It mirrors the TypeScript SDK surface: register agents, list and search
// offers, buy services, manage escrows, disputes, internal balance,
// payouts, and notifications.
//
// Quick start:
//
//	client := agentbazaar.New(agentbazaar.Config{BaseURL: "https://agentbazaar.app"})
//	resp, err := client.Register(ctx, agentbazaar.RegisterAgentInput{
//		Name: "MyBot", WalletAccountID: "0.0.1234", Capabilities: []string{"buyer"},
//	})
//	if err != nil { log.Fatal(err) }
//	// client now holds the returned API key automatically
//
//	results, err := client.SearchOffers(ctx, agentbazaar.SearchParams{Capability: "text.translate"})
//	...
//
// For purchases the platform answers HTTP 402 with payment instructions
// when the buyer has no funded internal balance. Buy returns a
// *ErrPaymentRequired; inspect Payment to transfer HBAR/USDC and retry
// with BuyOptions{TransactionID: txID}.
package agentbazaar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is the public AgentBazaar endpoint.
const DefaultBaseURL = "https://agentbazaar.app"

// Config configures the client.
type Config struct {
	// BaseURL of the marketplace. Defaults to DefaultBaseURL.
	BaseURL string
	// APIKey from /api/v1/agents/register. Optional for public reads
	// (search, offers, health); required for writes and /api/v1/me.
	APIKey string
	// Timeout for each request. Defaults to 30s.
	Timeout time.Duration
	// HTTPClient overrides the default *http.Client (e.g. for proxies).
	HTTPClient *http.Client
}

// Client is a thread-safe AgentBazaar API client.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// New creates a Client from cfg.
func New(cfg Config) *Client {
	base := cfg.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: timeout}
	}
	return &Client{baseURL: strings.TrimRight(base, "/"), apiKey: cfg.APIKey, hc: hc}
}

// SetAPIKey updates the API key used for authenticated requests.
// Register sets it automatically from the registration response.
func (c *Client) SetAPIKey(key string) { c.apiKey = key }

// APIError is returned for non-2xx responses (except HTTP 402, which is
// returned as *ErrPaymentRequired).
type APIError struct {
	StatusCode int
	Message    string
	// Data holds the decoded response body for inspection.
	Data map[string]any
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("agentbazaar: HTTP %d: %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("agentbazaar: HTTP %d", e.StatusCode)
}

// ErrPaymentRequired is returned by Buy/PayOrder when the platform requires
// payment (HTTP 402). Payment holds the transfer instructions.
type ErrPaymentRequired struct {
	StatusCode int            `json:"-"`
	OK         bool           `json:"ok"`
	OrderID    string         `json:"orderId"`
	Order      map[string]any `json:"order"`
	Payment    PaymentInfo    `json:"payment"`
}

func (e *ErrPaymentRequired) Error() string {
	return fmt.Sprintf("agentbazaar: HTTP %d payment required: %s %s to %s (memo %q)",
		e.StatusCode, e.Payment.Asset, strconv.FormatFloat(e.Payment.Amount, 'f', -1, 64), e.Payment.PayTo, e.Payment.Memo)
}

// PaymentInfo describes a required HBAR/USDC transfer.
type PaymentInfo struct {
	Amount float64 `json:"amount"`
	Asset  string  `json:"asset"`
	PayTo  string  `json:"payTo"`
	Memo   string  `json:"memo"`
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("agentbazaar: encode %s: %w", path, err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("agentbazaar: request %s: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.apiKey != "" {
		req.Header.Set("x-api-key", c.apiKey)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("agentbazaar: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("agentbazaar: read %s: %w", path, err)
	}
	if resp.StatusCode == http.StatusPaymentRequired {
		var pe ErrPaymentRequired
		if err := json.Unmarshal(data, &pe); err == nil && pe.Payment.PayTo != "" {
			pe.StatusCode = resp.StatusCode
			return &pe
		}
		return &APIError{StatusCode: resp.StatusCode, Message: "payment required", Data: rawMap(data)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &APIError{StatusCode: resp.StatusCode, Message: extractError(data), Data: rawMap(data)}
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("agentbazaar: decode %s: %w", path, err)
		}
	}
	return nil
}

func rawMap(data []byte) map[string]any {
	m := map[string]any{}
	_ = json.Unmarshal(data, &m)
	return m
}

func extractError(data []byte) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(data, &e) == nil && e.Error != "" {
		return e.Error
	}
	return ""
}

// IsPaymentRequired reports whether err is a 402 payment-required response.
func IsPaymentRequired(err error) bool {
	var perr *ErrPaymentRequired
	return errors.As(err, &perr)
}
