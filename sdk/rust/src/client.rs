//! HTTP client, configuration and error types for the AgentBazaar Rust SDK.

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

/// Public AgentBazaar endpoint.
pub const DEFAULT_BASE_URL: &str = "https://agentbazaar.app";

/// Configures the client.
#[derive(Debug, Clone, Default)]
pub struct Config {
    /// Base URL of the marketplace. Defaults to [`DEFAULT_BASE_URL`].
    pub base_url: Option<String>,
    /// API key from `/api/v1/agents/register`. Optional for public reads
    /// (search, offers, health); required for writes and `/api/v1/me`.
    pub api_key: Option<String>,
    /// Timeout for each request. Defaults to 30s.
    pub timeout: Option<Duration>,
}

/// A thread-safe AgentBazaar API client.
#[derive(Debug, Clone)]
pub struct Client {
    base_url: String,
    api_key: std::sync::Arc<std::sync::Mutex<String>>,
    agent: ureq::Agent,
}

impl Client {
    /// Creates a Client from `cfg`.
    pub fn new(cfg: Config) -> Self {
        let base = cfg
            .base_url
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        let timeout = cfg.timeout.unwrap_or(Duration::from_secs(30));
        let agent = ureq::AgentBuilder::new().timeout(timeout).build();
        Self {
            base_url: base.trim_end_matches('/').to_string(),
            api_key: std::sync::Arc::new(std::sync::Mutex::new(cfg.api_key.unwrap_or_default())),
            agent,
        }
    }

    /// Updates the API key used for authenticated requests.
    /// Register sets it automatically from the registration response.
    pub fn set_api_key(&self, key: impl Into<String>) {
        *self.api_key.lock().unwrap() = key.into();
    }

    /// Returns the current API key.
    pub fn api_key(&self) -> String {
        self.api_key.lock().unwrap().clone()
    }

    /// Low-level request helper: sends `method` to `path` with an optional
    /// JSON body and deserializes a 2xx response into `T`.
    ///
    /// HTTP 402 is returned as [`Error::PaymentRequired`]; any other non-2xx
    /// status becomes [`Error::Api`] with the decoded `error` message.
    pub(crate) fn request<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, Error> {
        let (status, text) = self.raw(method, path, body)?;
        if !(200..300).contains(&status) {
            return Err(Error::Api(ApiError {
                status_code: status,
                message: extract_error(&text),
                data: serde_json::from_str(&text).unwrap_or(Value::Null),
            }));
        }
        serde_json::from_str(&text)
            .map_err(|e| Error::Decode(format!("decode {path}: {e}")))
    }

    /// Low-level request helper that discards the response body
    /// (used by DELETE and similar no-payload endpoints).
    pub(crate) fn request_unit(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<(), Error> {
        let (status, text) = self.raw(method, path, body)?;
        if !(200..300).contains(&status) {
            return Err(Error::Api(ApiError {
                status_code: status,
                message: extract_error(&text),
                data: serde_json::from_str(&text).unwrap_or(Value::Null),
            }));
        }
        Ok(())
    }

    fn raw(&self, method: &str, path: &str, body: Option<Value>) -> Result<(u16, String), Error> {
        let url = format!("{}{}", self.base_url, path);
        let key = self.api_key();
        let mut req = match method {
            "GET" => self.agent.get(&url),
            "POST" => self.agent.post(&url),
            "DELETE" => self.agent.delete(&url),
            "PATCH" => self.agent.patch(&url),
            other => return Err(Error::Other(format!("unsupported method {other}"))),
        };
        req = req.set("Accept", "application/json");
        if !key.is_empty() {
            req = req.set("x-api-key", &key);
        }
        let resp = if let Some(b) = body {
            req.set("Content-Type", "application/json")
                .send_string(&b.to_string())
        } else {
            req.call()
        };
        match resp {
            Ok(r) => {
                let status = r.status();
                let text = r.into_string().unwrap_or_default();
                Ok((status, text))
            }
            Err(ureq::Error::Status(status, r)) => {
                let text = r.into_string().unwrap_or_default();
                if status == 402 {
                    if let Ok(pe) = serde_json::from_str::<ErrPaymentRequired>(&text) {
                        if !pe.payment.pay_to.is_empty() {
                            return Err(Error::PaymentRequired(pe));
                        }
                    }
                }
                Ok((status, text))
            }
            Err(e) => Err(Error::Transport(format!("{method} {path}: {e}"))),
        }
    }
}

/// Error returned for non-2xx responses (except HTTP 402, which is returned
/// as [`Error::PaymentRequired`]).
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status_code: u16,
    pub message: String,
    /// Decoded response body for inspection.
    pub data: Value,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.message.is_empty() {
            write!(f, "agentbazaar: HTTP {}", self.status_code)
        } else {
            write!(f, "agentbazaar: HTTP {}: {}", self.status_code, self.message)
        }
    }
}

/// Returned by `buy`/`pay_order` when the platform requires payment
/// (HTTP 402). `payment` holds the transfer instructions.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ErrPaymentRequired {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub order_id: String,
    #[serde(default)]
    pub order: Value,
    #[serde(default)]
    pub payment: PaymentInfo,
}

impl std::fmt::Display for ErrPaymentRequired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "agentbazaar: HTTP 402 payment required: {} {} to {} (memo {:?})",
            self.payment.asset, self.payment.amount, self.payment.pay_to, self.payment.memo
        )
    }
}

/// Describes a required HBAR/USDC transfer.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInfo {
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub asset: String,
    #[serde(default)]
    pub pay_to: String,
    #[serde(default)]
    pub memo: String,
}

/// All errors returned by this SDK.
#[derive(Debug)]
pub enum Error {
    /// HTTP 402 — buyer has no funded internal balance.
    PaymentRequired(ErrPaymentRequired),
    /// Any other non-2xx API response.
    Api(ApiError),
    /// Network/transport failure.
    Transport(String),
    /// Failed to decode a successful response.
    Decode(String),
    /// Other (unsupported method, ...).
    Other(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::PaymentRequired(e) => write!(f, "{e}"),
            Error::Api(e) => write!(f, "{e}"),
            Error::Transport(e) => write!(f, "agentbazaar: transport: {e}"),
            Error::Decode(e) => write!(f, "agentbazaar: decode: {e}"),
            Error::Other(e) => write!(f, "agentbazaar: {e}"),
        }
    }
}

impl std::error::Error for Error {}

/// Reports whether `err` is a 402 payment-required response.
pub fn is_payment_required(err: &Error) -> bool {
    matches!(err, Error::PaymentRequired(_))
}

fn extract_error(data: &str) -> String {
    serde_json::from_str::<Value>(data)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
        .unwrap_or_default()
}
