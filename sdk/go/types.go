package agentbazaar

// RegisterAgentInput is the payload for POST /api/v1/agents/register.
type RegisterAgentInput struct {
	Name            string       `json:"name"`
	WalletAccountID string       `json:"walletAccountId"`
	Capabilities    []string     `json:"capabilities"`
	WebhookURL      string       `json:"webhookUrl,omitempty"`
	Homepage        string       `json:"homepage,omitempty"`
	Policy          *AgentPolicy `json:"policy,omitempty"`
}

// AgentPolicy constrains an agent's spending (Spend Guardian).
type AgentPolicy struct {
	DailySpendLimit       *float64 `json:"dailySpendLimit,omitempty"`
	MaxPerTx              *float64 `json:"maxPerTx,omitempty"`
	AllowedCounterparties []string `json:"allowedCounterparties,omitempty"`
}

// RegisterResponse is returned by Register.
type RegisterResponse struct {
	OK      bool   `json:"ok"`
	AgentID string `json:"agentId"`
	APIKey  string `json:"apiKey"`
	CardURL string `json:"cardUrl"`
}

// SearchParams filters GET /api/v1/offers/search.
type SearchParams struct {
	Query      string
	Capability string
	MaxPrice   *float64
	Asset      string
}

// Offer is a marketplace listing.
type Offer struct {
	ID                string   `json:"id"`
	AgentID           string   `json:"agentId"`
	Capability        string   `json:"capability"`
	Title             string   `json:"title"`
	Description       string   `json:"description"`
	PriceAmount       float64  `json:"priceAmount"`
	PriceAsset        string   `json:"priceAsset"`
	FulfillmentType   string   `json:"fulfillmentType"`
	WebhookConfigured bool     `json:"webhookConfigured"`
	MaxSeconds        int      `json:"maxSeconds"`
	Escrow            bool     `json:"escrow"`
	Tags              []string `json:"tags,omitempty"`
	CreatedAt         string   `json:"createdAt,omitempty"`
}

// SearchResult is one ranked hit from SearchOffers.
type SearchResult struct {
	Offer Offer `json:"offer"`
	Agent struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"agent"`
	Score float64 `json:"score"`
}

// SearchResponse wraps SearchOffers results.
type SearchResponse struct {
	OK      bool           `json:"ok"`
	Results []SearchResult `json:"results"`
}

// ListOffersResponse wraps ListOffers results.
type ListOffersResponse struct {
	OK     bool    `json:"ok"`
	Offers []Offer `json:"offers"`
}

// GetOfferResponse wraps GetOffer results.
type GetOfferResponse struct {
	OK    bool           `json:"ok"`
	Offer map[string]any `json:"offer"`
}

// CreateOfferInput is the payload for POST /api/v1/offers (seller).
type CreateOfferInput struct {
	Capability      string   `json:"capability"`
	Title           string   `json:"title"`
	Description     string   `json:"description,omitempty"`
	PriceAmount     float64  `json:"priceAmount"`
	PriceAsset      string   `json:"priceAsset,omitempty"`      // "HBAR" | "USDC"
	FulfillmentType string   `json:"fulfillmentType,omitempty"` // inline|webhook|manual|llm
	WebhookURL      string   `json:"webhookUrl,omitempty"`
	MaxSeconds      int      `json:"maxSeconds,omitempty"`
	Escrow          bool     `json:"escrow,omitempty"`
	Tags            []string `json:"tags,omitempty"`
}

// CreateOfferResponse wraps CreateOffer results.
type CreateOfferResponse struct {
	OK    bool           `json:"ok"`
	Offer map[string]any `json:"offer"`
}

// BoostResponse wraps BoostOffer results.
type BoostResponse struct {
	OK           bool    `json:"ok"`
	BoostedUntil string  `json:"boostedUntil"`
	Balance      float64 `json:"balance"`
}

// BuyOptions control a Buy call.
type BuyOptions struct {
	// TransactionID is the Hedera transfer ID after the buyer paid the 402.
	TransactionID string
	// DevFakePay bypasses real settlement (testnet/demo only).
	DevFakePay bool
}

// BuyResponse wraps Buy results.
type BuyResponse struct {
	OK             bool           `json:"ok"`
	Order          map[string]any `json:"order"`
	SettlementMode string         `json:"settlementMode,omitempty"`
	Payment        *PaymentInfo   `json:"payment,omitempty"`
	Escrow         map[string]any `json:"escrow,omitempty"`
}

// Agent is a registered marketplace participant.
type Agent struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	WalletAccountID string   `json:"walletAccountId"`
	Capabilities    []string `json:"capabilities"`
	WebhookURL      string   `json:"webhookUrl,omitempty"`
	Homepage        string   `json:"homepage,omitempty"`
	CreatedAt       string   `json:"createdAt,omitempty"`
}

// Order is a marketplace order.
type Order struct {
	ID        string  `json:"id"`
	OfferID   string  `json:"offerId"`
	BuyerID   string  `json:"buyerId,omitempty"`
	SellerID  string  `json:"sellerId,omitempty"`
	Status    string  `json:"status"`
	Amount    float64 `json:"amount"`
	Asset     string  `json:"asset"`
	CreatedAt string  `json:"createdAt,omitempty"`
}

// Escrow is an escrowed order (locked funds released on delivery).
type Escrow struct {
	ID        string  `json:"id"`
	OrderID   string  `json:"orderId,omitempty"`
	Status    string  `json:"status"`
	Amount    float64 `json:"amount"`
	Asset     string  `json:"asset"`
	CreatedAt string  `json:"createdAt,omitempty"`
}

// EscrowActionResponse wraps escrow release/refund/dispute results.
type EscrowActionResponse struct {
	OK     bool           `json:"ok"`
	Escrow map[string]any `json:"escrow"`
	Order  map[string]any `json:"order,omitempty"`
}

// Notification is an inbox record for the current agent.
type Notification struct {
	ID        string `json:"id"`
	AgentID   string `json:"agentId"`
	Event     string `json:"event"`
	Title     string `json:"title"`
	Message   string `json:"message"`
	Read      bool   `json:"read"`
	CreatedAt string `json:"createdAt"`
}

// NotificationsResponse wraps ListNotifications results.
type NotificationsResponse struct {
	OK            bool           `json:"ok"`
	AgentID       string         `json:"agentId"`
	Unread        int            `json:"unread"`
	Notifications []Notification `json:"notifications"`
}

// MarkNotificationsResponse wraps MarkAllNotificationsRead results.
type MarkNotificationsResponse struct {
	OK     bool `json:"ok"`
	Marked int  `json:"marked"`
}

// BalanceResponse is returned by GetBalance and Deposit.
type BalanceResponse struct {
	OK      bool    `json:"ok"`
	Balance float64 `json:"balance"`
	Mode    string  `json:"mode"`
}

// DepositInput tops up the internal ledger balance.
type DepositInput struct {
	Amount float64 `json:"amount"`
	Asset  string  `json:"asset,omitempty"` // hbar|usdc|internal
	TxID   string  `json:"txId,omitempty"`
}

// Payout is a seller withdrawal request.
type Payout struct {
	ID        string  `json:"id"`
	Amount    float64 `json:"amount"`
	Method    string  `json:"method"`
	Status    string  `json:"status"`
	CreatedAt string  `json:"createdAt,omitempty"`
}

// ListPayoutsResponse wraps ListPayouts results.
type ListPayoutsResponse struct {
	OK      bool     `json:"ok"`
	Balance float64  `json:"balance"`
	Payouts []Payout `json:"payouts"`
}

// PayoutInput requests a seller withdrawal.
type PayoutInput struct {
	Amount  float64 `json:"amount"`
	Method  string  `json:"method,omitempty"` // hbar|usdc|manual
	Account string  `json:"account,omitempty"`
}

// RequestPayoutResponse wraps RequestPayout results.
type RequestPayoutResponse struct {
	OK      bool           `json:"ok"`
	Payout  map[string]any `json:"payout"`
	Balance float64        `json:"balance"`
}

// ReputationProfile is the public V2 reputation view of an agent.
type ReputationProfile struct {
	OK    bool `json:"ok"`
	Agent *struct {
		ID              string   `json:"id"`
		Name            string   `json:"name"`
		WalletAccountID string   `json:"walletAccountId"`
		Capabilities    []string `json:"capabilities"`
		CreatedAt       string   `json:"createdAt"`
		Stats           struct {
			Sales          int     `json:"sales"`
			Purchases      int     `json:"purchases"`
			Success        int     `json:"success"`
			Fail           int     `json:"fail"`
			TotalLatencyMs float64 `json:"totalLatencyMs"`
		} `json:"stats"`
	} `json:"agent"`
	Reputation *struct {
		Score       float64  `json:"score"`
		TrustLevel  float64  `json:"trustLevel"`
		TrustLabel  string   `json:"trustLabel"`
		SuccessRate *float64 `json:"successRate"`
		OrderCount  *int     `json:"orderCount"`
	} `json:"reputation"`
	Orders  *map[string]any `json:"orders"`
	Escrows *map[string]any `json:"escrows"`
}

// Health is the market health payload.
type Health struct {
	OK      bool   `json:"ok"`
	Status  string `json:"status"`
	Version string `json:"version"`
	Agents  int    `json:"agents"`
	Offers  int    `json:"offers"`
	Orders  int    `json:"orders"`
	Escrows int    `json:"escrows"`
}

// ListResponse is a generic {ok, items:[...]} envelope used by
// ListAgents / ListOrders / ListEscrows.
type ListResponse struct {
	OK      bool           `json:"ok"`
	Agents  []Agent        `json:"agents,omitempty"`
	Orders  []Order        `json:"orders,omitempty"`
	Escrows []Escrow       `json:"escrows,omitempty"`
	Raw     map[string]any `json:"-"`
}

// GetAgentResponse wraps GetAgent / Me results.
type GetAgentResponse struct {
	OK    bool           `json:"ok"`
	Agent map[string]any `json:"agent"`
}
