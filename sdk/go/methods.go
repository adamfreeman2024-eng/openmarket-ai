package agentbazaar

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// Register creates a new agent and returns its API key. The key is also
// stored on the client for subsequent authenticated calls.
func (c *Client) Register(ctx context.Context, input RegisterAgentInput) (*RegisterResponse, error) {
	var out RegisterResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/agents/register", input, &out); err != nil {
		return nil, err
	}
	if out.APIKey != "" {
		c.apiKey = out.APIKey
	}
	return &out, nil
}

// SearchOffers runs the ranked discovery search.
func (c *Client) SearchOffers(ctx context.Context, params SearchParams) (*SearchResponse, error) {
	q := url.Values{}
	if params.Query != "" {
		q.Set("q", params.Query)
	}
	if params.Capability != "" {
		q.Set("capability", params.Capability)
	}
	if params.MaxPrice != nil {
		q.Set("maxPrice", strconv.FormatFloat(*params.MaxPrice, 'f', -1, 64))
	}
	if params.Asset != "" {
		q.Set("asset", params.Asset)
	}
	var out SearchResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/offers/search?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListOffers lists all active offers.
func (c *Client) ListOffers(ctx context.Context) (*ListOffersResponse, error) {
	var out ListOffersResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/offers", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetOffer returns offer details by ID.
func (c *Client) GetOffer(ctx context.Context, offerID string) (*GetOfferResponse, error) {
	var out GetOfferResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/offers/"+url.PathEscape(offerID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateOffer lists a new sellable capability (seller side).
func (c *Client) CreateOffer(ctx context.Context, input CreateOfferInput) (*CreateOfferResponse, error) {
	var out CreateOfferResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/offers", input, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteOffer deactivates an offer (seller side).
func (c *Client) DeleteOffer(ctx context.Context, offerID string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/offers/"+url.PathEscape(offerID), nil, nil)
}

// BoostOffer buys a 7-day paid visibility boost from the internal balance.
func (c *Client) BoostOffer(ctx context.Context, offerID string) (*BoostResponse, error) {
	var out BoostResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/offers/"+url.PathEscape(offerID)+"/boost", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Buy performs a one-shot purchase (quote → order → pay → fulfill).
//
// If the platform answers HTTP 402 (no funded balance), Buy returns a
// *ErrPaymentRequired — inspect Payment for the transfer details, pay,
// then retry with BuyOptions{TransactionID: txID}.
func (c *Client) Buy(ctx context.Context, offerID string, input map[string]any, opts BuyOptions) (*BuyResponse, error) {
	body := map[string]any{"offerId": offerID, "input": input}
	if opts.TransactionID != "" {
		body["transactionId"] = opts.TransactionID
	}
	if opts.DevFakePay {
		body["devFakePay"] = true
	}
	var out BuyResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/buy", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetAgent returns public agent details.
func (c *Client) GetAgent(ctx context.Context, agentID string) (*GetAgentResponse, error) {
	var out GetAgentResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/agents/"+url.PathEscape(agentID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Me returns the current agent (from the API key).
func (c *Client) Me(ctx context.Context) (*GetAgentResponse, error) {
	var out GetAgentResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/me", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListAgents lists all registered agents.
func (c *Client) ListAgents(ctx context.Context) (*ListResponse, error) {
	var out ListResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/agents", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetReputation returns the public V2 reputation profile of an agent.
func (c *Client) GetReputation(ctx context.Context, agentID string) (*ReputationProfile, error) {
	var out ReputationProfile
	if err := c.do(ctx, http.MethodGet, "/api/v1/agents/"+url.PathEscape(agentID)+"/reputation", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetOrder returns an order by ID.
func (c *Client) GetOrder(ctx context.Context, orderID string) (*GetOrderResponse, error) {
	var out GetOrderResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/orders/"+url.PathEscape(orderID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetOrderResponse wraps GetOrder results.
type GetOrderResponse struct {
	OK    bool           `json:"ok"`
	Order map[string]any `json:"order"`
}

// ListOrders lists the current agent's orders.
func (c *Client) ListOrders(ctx context.Context) (*ListResponse, error) {
	var out ListResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/orders", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PayOrderOptions control a PayOrder call.
type PayOrderOptions struct {
	TransactionID string
	DevFakePay    bool
}

// PayOrder pays an order after receiving a 402 (or settles a pending order).
func (c *Client) PayOrder(ctx context.Context, orderID string, opts PayOrderOptions) (*BuyResponse, error) {
	body := map[string]any{}
	if opts.TransactionID != "" {
		body["transactionId"] = opts.TransactionID
	}
	if opts.DevFakePay {
		body["devFakePay"] = true
	}
	var out BuyResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/orders/"+url.PathEscape(orderID)+"/pay", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListEscrows lists the current agent's escrows.
func (c *Client) ListEscrows(ctx context.Context) (*ListResponse, error) {
	var out ListResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/escrow", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetEscrow returns escrow details by ID.
func (c *Client) GetEscrow(ctx context.Context, escrowID string) (*GetEscrowResponse, error) {
	var out GetEscrowResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/escrow/"+url.PathEscape(escrowID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetEscrowResponse wraps GetEscrow results.
type GetEscrowResponse struct {
	OK     bool           `json:"ok"`
	Escrow map[string]any `json:"escrow"`
}

// ReleaseEscrow releases an escrow with delivery proof (seller).
func (c *Client) ReleaseEscrow(ctx context.Context, escrowID, proof string) (*EscrowActionResponse, error) {
	var out EscrowActionResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/escrow/"+url.PathEscape(escrowID)+"/release",
		map[string]any{"proof": proof}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RefundEscrow refunds an escrow (buyer or seller).
func (c *Client) RefundEscrow(ctx context.Context, escrowID, reason string) (*EscrowActionResponse, error) {
	body := map[string]any{}
	if reason != "" {
		body["reason"] = reason
	}
	var out EscrowActionResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/escrow/"+url.PathEscape(escrowID)+"/refund", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DisputeEscrow opens a dispute on an escrow.
func (c *Client) DisputeEscrow(ctx context.Context, escrowID, reason string) (*EscrowActionResponse, error) {
	var out EscrowActionResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/escrow/"+url.PathEscape(escrowID)+"/dispute",
		map[string]any{"reason": reason}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetBalance returns the internal ledger balance (auth required).
func (c *Client) GetBalance(ctx context.Context) (*BalanceResponse, error) {
	var out BalanceResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/deposit", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Deposit tops up the internal ledger balance. On testnet deposits credit
// instantly; on mainnet a real HBAR/USDC transfer + txId is required.
func (c *Client) Deposit(ctx context.Context, input DepositInput) (*BalanceResponse, error) {
	var out BalanceResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/deposit", input, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListNotifications returns the agent's notification inbox (auth required).
func (c *Client) ListNotifications(ctx context.Context, limit int) (*NotificationsResponse, error) {
	if limit <= 0 {
		limit = 50
	}
	var out NotificationsResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/notifications?limit="+strconv.Itoa(limit), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// MarkAllNotificationsRead marks all notifications as read (auth required).
func (c *Client) MarkAllNotificationsRead(ctx context.Context) (*MarkNotificationsResponse, error) {
	var out MarkNotificationsResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/notifications", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListPayouts returns the agent's payout requests + balance (auth required).
func (c *Client) ListPayouts(ctx context.Context) (*ListPayoutsResponse, error) {
	var out ListPayoutsResponse
	if err := c.do(ctx, http.MethodGet, "/api/v1/payouts", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RequestPayout requests a seller withdrawal (operator settles manually on
// testnet; auth required).
func (c *Client) RequestPayout(ctx context.Context, input PayoutInput) (*RequestPayoutResponse, error) {
	var out RequestPayoutResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/payouts", input, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Health returns market health.
func (c *Client) Health(ctx context.Context) (*Health, error) {
	var out Health
	if err := c.do(ctx, http.MethodGet, "/api/v1/health", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Stats returns aggregate market stats.
func (c *Client) Stats(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	if err := c.do(ctx, http.MethodGet, "/api/v1/stats", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// MarketCard returns the well-known discovery card.
func (c *Client) MarketCard(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	if err := c.do(ctx, http.MethodGet, "/.well-known/openmarket.json", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}
