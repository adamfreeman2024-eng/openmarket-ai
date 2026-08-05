//! Data types for the AgentBazaar Rust SDK.
//!
//! Field names mirror the JSON API (camelCase); Rust identifiers are
//! snake_case via `#[serde(rename_all = "camelCase")]`. All structs are
//! tolerant of missing optional fields (`#[serde(default)]`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Payload for `POST /api/v1/agents/register`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAgentInput {
    pub name: String,
    pub wallet_account_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<AgentPolicy>,
}

/// Constrains an agent's spending (Spend Guardian).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_spend_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_per_tx: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_counterparties: Option<Vec<String>>,
}

/// Returned by `register`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub card_url: String,
}

/// Filters for `GET /api/v1/offers/search`.
#[derive(Debug, Clone, Default)]
pub struct SearchParams {
    pub query: Option<String>,
    pub capability: Option<String>,
    pub max_price: Option<f64>,
    pub asset: Option<String>,
}

/// A marketplace listing.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub capability: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub price_amount: f64,
    #[serde(default)]
    pub price_asset: String,
    #[serde(default)]
    pub fulfillment_type: String,
    #[serde(default)]
    pub webhook_configured: bool,
    #[serde(default)]
    pub max_seconds: i64,
    #[serde(default)]
    pub escrow: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: String,
}

/// One ranked hit from `search_offers`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    #[serde(default)]
    pub offer: Offer,
    #[serde(default)]
    pub agent: SearchResultAgent,
    #[serde(default)]
    pub score: f64,
}

/// Seller summary inside a search result.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultAgent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
}

/// Wraps `search_offers` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub results: Vec<SearchResult>,
}

/// Wraps `list_offers` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOffersResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub offers: Vec<Offer>,
}

/// Wraps `get_offer` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetOfferResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub offer: Value,
}

/// Payload for `POST /api/v1/offers` (seller).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOfferInput {
    pub capability: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub price_amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_asset: Option<String>, // "HBAR" | "USDC"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fulfillment_type: Option<String>, // inline|webhook|manual|llm
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escrow: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

/// Wraps `create_offer` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOfferResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub offer: Value,
}

/// Wraps `boost_offer` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub boosted_until: String,
    #[serde(default)]
    pub balance: f64,
}

/// Options controlling a `buy` call.
#[derive(Debug, Clone, Default)]
pub struct BuyOptions {
    /// Hedera transfer ID after the buyer paid the 402.
    pub transaction_id: Option<String>,
    /// Bypasses real settlement (testnet/demo only).
    pub dev_fake_pay: bool,
}

/// Payment instructions returned when real settlement is required (402 flow).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInfo {
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub amount: String,
    #[serde(default)]
    pub asset: String,
    #[serde(default)]
    pub memo: String,
}

/// Wraps `buy`/`pay_order` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuyResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub order: Value,
    #[serde(default)]
    pub settlement_mode: String,
    #[serde(default)]
    pub payment: Option<PaymentInfo>,
    #[serde(default)]
    pub escrow: Value,
}

/// A registered marketplace participant.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub wallet_account_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub webhook_url: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub created_at: String,
}

/// A marketplace order.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub offer_id: String,
    #[serde(default)]
    pub buyer_id: String,
    #[serde(default)]
    pub seller_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub asset: String,
    #[serde(default)]
    pub created_at: String,
}

/// An escrowed order (locked funds released on delivery).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Escrow {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub order_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub asset: String,
    #[serde(default)]
    pub created_at: String,
}

/// Wraps escrow release/refund/dispute results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EscrowActionResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub escrow: Value,
    #[serde(default)]
    pub order: Value,
}

/// An inbox record for the current agent.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub event: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub created_at: String,
}

/// Wraps `list_notifications` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub unread: i64,
    #[serde(default)]
    pub notifications: Vec<Notification>,
}

/// Wraps `mark_all_notifications_read` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkNotificationsResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub marked: i64,
}

/// Returned by `get_balance` and `deposit`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub balance: f64,
    #[serde(default)]
    pub mode: String,
}

/// Tops up the internal ledger balance.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositInput {
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>, // hbar|usdc|internal
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_id: Option<String>,
}

/// A seller withdrawal request.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payout {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub created_at: String,
}

/// Wraps `list_payouts` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPayoutsResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub balance: f64,
    #[serde(default)]
    pub payouts: Vec<Payout>,
}

/// Requests a seller withdrawal.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutInput {
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>, // hbar|usdc|manual
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

/// Wraps `request_payout` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPayoutResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub payout: Value,
    #[serde(default)]
    pub balance: f64,
}

/// Public V2 reputation view of an agent.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReputationProfile {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub agent: Option<ReputationAgent>,
    #[serde(default)]
    pub reputation: Option<Reputation>,
    #[serde(default)]
    pub orders: Option<Value>,
    #[serde(default)]
    pub escrows: Option<Value>,
}

/// Agent summary inside a reputation profile.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReputationAgent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub wallet_account_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub stats: ReputationStats,
}

/// Trade statistics inside a reputation profile.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReputationStats {
    #[serde(default)]
    pub sales: i64,
    #[serde(default)]
    pub purchases: i64,
    #[serde(default)]
    pub success: i64,
    #[serde(default)]
    pub fail: i64,
    #[serde(default)]
    pub total_latency_ms: f64,
}

/// Reputation scoring block.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reputation {
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub trust_level: f64,
    #[serde(default)]
    pub trust_label: String,
    #[serde(default)]
    pub success_rate: Option<f64>,
    #[serde(default)]
    pub order_count: Option<i64>,
}

/// Market health payload.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub agents: i64,
    #[serde(default)]
    pub offers: i64,
    #[serde(default)]
    pub orders: i64,
    #[serde(default)]
    pub escrows: i64,
}

/// Generic `{ ok, items: [...] }` envelope used by
/// `list_agents` / `list_orders` / `list_escrows`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub agents: Vec<Agent>,
    #[serde(default)]
    pub orders: Vec<Order>,
    #[serde(default)]
    pub escrows: Vec<Escrow>,
    /// Raw decoded payload for fields not covered above.
    #[serde(skip)]
    pub raw: Value,
}

/// Wraps `get_agent` / `me` results.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub agent: Value,
}
