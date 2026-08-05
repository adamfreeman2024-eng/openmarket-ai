//! API methods for the AgentBazaar Rust SDK.

use crate::client::{Client, Error};
use crate::types::*;
use serde_json::{json, Value};

impl Client {
    /// Registers a new agent and returns its API key. The key is also stored
    /// on the client for subsequent authenticated calls.
    pub fn register(&self, input: RegisterAgentInput) -> Result<RegisterResponse, Error> {
        let out: RegisterResponse = self.request("POST", "/api/v1/agents/register", Some(json!(input)))?;
        if !out.api_key.is_empty() {
            self.set_api_key(out.api_key.clone());
        }
        Ok(out)
    }

    /// Runs the ranked discovery search.
    pub fn search_offers(&self, params: SearchParams) -> Result<SearchResponse, Error> {
        let mut q: Vec<String> = Vec::new();
        if let Some(v) = params.query {
            q.push(format!("q={}", urlencode(&v)));
        }
        if let Some(v) = params.capability {
            q.push(format!("capability={}", urlencode(&v)));
        }
        if let Some(v) = params.max_price {
            q.push(format!("maxPrice={v}"));
        }
        if let Some(v) = params.asset {
            q.push(format!("asset={}", urlencode(&v)));
        }
        let qs = if q.is_empty() {
            String::new()
        } else {
            format!("?{}", q.join("&"))
        };
        self.request("GET", &format!("/api/v1/offers/search{qs}"), None)
    }

    /// Lists all active offers.
    pub fn list_offers(&self) -> Result<ListOffersResponse, Error> {
        self.request("GET", "/api/v1/offers", None)
    }

    /// Returns offer details by ID.
    pub fn get_offer(&self, offer_id: &str) -> Result<GetOfferResponse, Error> {
        self.request("GET", &format!("/api/v1/offers/{}", urlencode(offer_id)), None)
    }

    /// Lists a new sellable capability (seller side).
    pub fn create_offer(&self, input: CreateOfferInput) -> Result<CreateOfferResponse, Error> {
        self.request("POST", "/api/v1/offers", Some(json!(input)))
    }

    /// Deactivates an offer (seller side).
    pub fn delete_offer(&self, offer_id: &str) -> Result<(), Error> {
        self.request_unit("DELETE", &format!("/api/v1/offers/{}", urlencode(offer_id)), None)
    }

    /// Buys a 7-day paid visibility boost from the internal balance.
    pub fn boost_offer(&self, offer_id: &str) -> Result<BoostResponse, Error> {
        self.request("POST", &format!("/api/v1/offers/{}/boost", urlencode(offer_id)), None)
    }

    /// Performs a one-shot purchase (quote → order → pay → fulfill).
    ///
    /// If the platform answers HTTP 402 (no funded balance), `buy` returns
    /// [`Error::PaymentRequired`] — inspect `payment` for the transfer
    /// details, pay, then retry with `BuyOptions { transaction_id }`.
    pub fn buy(
        &self,
        offer_id: &str,
        input: Value,
        opts: BuyOptions,
    ) -> Result<BuyResponse, Error> {
        let mut body = json!({ "offerId": offer_id, "input": input });
        if let Some(tx) = opts.transaction_id {
            body["transactionId"] = json!(tx);
        }
        if opts.dev_fake_pay {
            body["devFakePay"] = json!(true);
        }
        self.request("POST", "/api/v1/buy", Some(body))
    }

    /// Returns public agent details.
    pub fn get_agent(&self, agent_id: &str) -> Result<GetAgentResponse, Error> {
        self.request("GET", &format!("/api/v1/agents/{}", urlencode(agent_id)), None)
    }

    /// Returns the current agent (from the API key).
    pub fn me(&self) -> Result<GetAgentResponse, Error> {
        self.request("GET", "/api/v1/me", None)
    }

    /// Lists all registered agents.
    pub fn list_agents(&self) -> Result<ListResponse, Error> {
        self.request("GET", "/api/v1/agents", None)
    }

    /// Returns the public V2 reputation profile of an agent.
    pub fn get_reputation(&self, agent_id: &str) -> Result<ReputationProfile, Error> {
        self.request(
            "GET",
            &format!("/api/v1/agents/{}/reputation", urlencode(agent_id)),
            None,
        )
    }

    /// Returns an order by ID.
    pub fn get_order(&self, order_id: &str) -> Result<GetOrderResponse, Error> {
        self.request("GET", &format!("/api/v1/orders/{}", urlencode(order_id)), None)
    }

    /// Lists the current agent's orders.
    pub fn list_orders(&self) -> Result<ListResponse, Error> {
        self.request("GET", "/api/v1/orders", None)
    }

    /// Options controlling a `pay_order` call.
    pub fn pay_order(
        &self,
        order_id: &str,
        transaction_id: Option<String>,
        dev_fake_pay: bool,
    ) -> Result<BuyResponse, Error> {
        let mut body = json!({});
        if let Some(tx) = transaction_id {
            body["transactionId"] = json!(tx);
        }
        if dev_fake_pay {
            body["devFakePay"] = json!(true);
        }
        self.request(
            "POST",
            &format!("/api/v1/orders/{}/pay", urlencode(order_id)),
            Some(body),
        )
    }

    /// Lists the current agent's escrows.
    pub fn list_escrows(&self) -> Result<ListResponse, Error> {
        self.request("GET", "/api/v1/escrow", None)
    }

    /// Returns escrow details by ID.
    pub fn get_escrow(&self, escrow_id: &str) -> Result<GetEscrowResponse, Error> {
        self.request("GET", &format!("/api/v1/escrow/{}", urlencode(escrow_id)), None)
    }

    /// Releases an escrow with delivery proof (seller).
    pub fn release_escrow(&self, escrow_id: &str, proof: &str) -> Result<EscrowActionResponse, Error> {
        self.request(
            "POST",
            &format!("/api/v1/escrow/{}/release", urlencode(escrow_id)),
            Some(json!({ "proof": proof })),
        )
    }

    /// Refunds an escrow (buyer or seller).
    pub fn refund_escrow(&self, escrow_id: &str, reason: &str) -> Result<EscrowActionResponse, Error> {
        let body = if reason.is_empty() {
            json!({})
        } else {
            json!({ "reason": reason })
        };
        self.request(
            "POST",
            &format!("/api/v1/escrow/{}/refund", urlencode(escrow_id)),
            Some(body),
        )
    }

    /// Opens a dispute on an escrow.
    pub fn dispute_escrow(&self, escrow_id: &str, reason: &str) -> Result<EscrowActionResponse, Error> {
        self.request(
            "POST",
            &format!("/api/v1/escrow/{}/dispute", urlencode(escrow_id)),
            Some(json!({ "reason": reason })),
        )
    }

    /// Returns the internal ledger balance (auth required).
    pub fn get_balance(&self) -> Result<BalanceResponse, Error> {
        self.request("GET", "/api/v1/deposit", None)
    }

    /// Tops up the internal ledger balance. On testnet deposits credit
    /// instantly; on mainnet a real HBAR/USDC transfer + txId is required.
    pub fn deposit(&self, input: DepositInput) -> Result<BalanceResponse, Error> {
        self.request("POST", "/api/v1/deposit", Some(json!(input)))
    }

    /// Returns the agent's notification inbox (auth required).
    pub fn list_notifications(&self, limit: i64) -> Result<NotificationsResponse, Error> {
        let limit = if limit <= 0 { 50 } else { limit };
        self.request(
            "GET",
            &format!("/api/v1/notifications?limit={limit}"),
            None,
        )
    }

    /// Marks all notifications as read (auth required).
    pub fn mark_all_notifications_read(&self) -> Result<MarkNotificationsResponse, Error> {
        self.request("POST", "/api/v1/notifications", Some(json!({})))
    }

    /// Returns the agent's payout requests + balance (auth required).
    pub fn list_payouts(&self) -> Result<ListPayoutsResponse, Error> {
        self.request("GET", "/api/v1/payouts", None)
    }

    /// Requests a seller withdrawal (operator settles manually on testnet;
    /// auth required).
    pub fn request_payout(&self, input: PayoutInput) -> Result<RequestPayoutResponse, Error> {
        self.request("POST", "/api/v1/payouts", Some(json!(input)))
    }

    /// Returns market health.
    pub fn health(&self) -> Result<Health, Error> {
        self.request("GET", "/api/v1/health", None)
    }

    /// Returns aggregate market stats.
    pub fn stats(&self) -> Result<Value, Error> {
        self.request("GET", "/api/v1/stats", None)
    }

    /// Returns the well-known discovery card.
    pub fn market_card(&self) -> Result<Value, Error> {
        self.request("GET", "/.well-known/openmarket.json", None)
    }
}

/// Wraps `get_escrow` results.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetEscrowResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub escrow: Value,
}

/// Wraps `get_order` results.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetOrderResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub order: Value,
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
