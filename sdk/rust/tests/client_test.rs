//! Integration tests for the AgentBazaar Rust SDK.
//!
//! Uses a tiny std-only mock HTTP server (no external dev-dependencies) so
//! tests run offline and fast — mirroring the Go SDK's `httptest` suite.

use agentbazaar::{
    is_payment_required, BuyOptions, Client, Config, Error, RegisterAgentInput, SearchParams,
};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;

/// Spawns a single-request mock HTTP server. Returns (base_url, rx) where rx
/// receives `(request_line, headers, body)` for the captured request.
fn mock_server(
    status: u16,
    body: &'static str,
) -> (String, mpsc::Receiver<(String, String, String)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                handle_one(&mut stream, status, body, &tx);
            }
            break; // single request per mock
        }
    });
    (format!("http://{addr}"), rx)
}

fn handle_one(
    stream: &mut TcpStream,
    status: u16,
    body: &'static str,
    tx: &mpsc::Sender<(String, String, String)>,
) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line);
    let mut headers = String::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
        headers.push_str(&line);
    }
    let mut req_body = vec![0u8; content_length];
    if content_length > 0 {
        let _ = reader.read_exact(&mut req_body);
    }
    let _ = tx.send((
        request_line.trim().to_string(),
        headers,
        String::from_utf8_lossy(&req_body).to_string(),
    ));
    let resp = format!(
        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn test_client(api_key: &str, status: u16, body: &'static str) -> (Client, mpsc::Receiver<(String, String, String)>) {
    let (base, rx) = mock_server(status, body);
    let c = Client::new(Config {
        base_url: Some(base),
        api_key: Some(api_key.to_string()),
        ..Default::default()
    });
    (c, rx)
}

#[test]
fn sends_api_key_header() {
    let (c, rx) = test_client("test-key-123", 200, r#"{"ok":true,"offers":[]}"#);
    let resp = c.list_offers().unwrap();
    assert!(resp.ok);
    let (_, headers, _) = rx.recv().unwrap();
    assert!(
        headers.to_ascii_lowercase().contains("x-api-key: test-key-123"),
        "headers = {headers}"
    );
}

#[test]
fn register_parses_api_key_and_sets_it() {
    let (c, rx) = test_client(
        "",
        200,
        r#"{"ok":true,"agentId":"agt_123","apiKey":"fresh-key","cardUrl":"https://agentbazaar.app/agents/agt_123"}"#,
    );
    let resp = c
        .register(RegisterAgentInput {
            name: "MyBot".into(),
            wallet_account_id: "0.0.1234".into(),
            capabilities: vec!["buyer".into()],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(resp.agent_id, "agt_123");
    assert_eq!(resp.api_key, "fresh-key");
    assert_eq!(c.api_key(), "fresh-key", "client key should be auto-set");
    let (request_line, _, _) = rx.recv().unwrap();
    assert!(request_line.starts_with("POST /api/v1/agents/register"));
}

#[test]
fn search_builds_query_params() {
    let (c, rx) = test_client("", 200, r#"{"ok":true,"results":[]}"#);
    let _ = c
        .search_offers(SearchParams {
            query: Some("translate".into()),
            capability: Some("text.translate".into()),
            max_price: Some(5.0),
            asset: Some("USDC".into()),
        })
        .unwrap();
    let (request_line, _, _) = rx.recv().unwrap();
    for want in [
        "q=translate",
        "capability=text.translate",
        "maxPrice=5",
        "asset=USDC",
    ] {
        assert!(
            request_line.contains(want),
            "query {request_line} missing {want}"
        );
    }
}

#[test]
fn list_offers_parses_offers() {
    let (c, _) = test_client(
        "",
        200,
        r#"{"ok":true,"offers":[{"id":"off_1","agentId":"agt_1","capability":"echo.demo","title":"Echo","priceAmount":1.5,"priceAsset":"HBAR","fulfillmentType":"inline","escrow":true}]}"#,
    );
    let resp = c.list_offers().unwrap();
    assert_eq!(resp.offers.len(), 1);
    let o = &resp.offers[0];
    assert_eq!(o.id, "off_1");
    assert_eq!(o.price_amount, 1.5);
    assert_eq!(o.price_asset, "HBAR");
    assert!(o.escrow);
}

#[test]
fn buy_returns_payment_required() {
    let (c, _) = test_client(
        "",
        402,
        r#"{"ok":true,"orderId":"o-1","order":{"id":"o-1","status":"pending_payment"},"payment":{"amount":2.0,"asset":"HBAR","payTo":"0.0.999","memo":"ab-xyz"}}"#,
    );
    let err = c
        .buy("off_1", serde_json::json!({"text": "hi"}), BuyOptions::default())
        .unwrap_err();
    match &err {
        Error::PaymentRequired(perr) => {
            assert_eq!(perr.payment.amount, 2.0);
            assert_eq!(perr.payment.pay_to, "0.0.999");
            assert_eq!(perr.payment.memo, "ab-xyz");
        }
        other => panic!("error type = {other:?}, want PaymentRequired"),
    }
    assert!(is_payment_required(&err));
}

#[test]
fn api_error_status() {
    let (c, _) = test_client("", 500, r#"{"ok":false,"error":"boom"}"#);
    let err = c.list_offers().unwrap_err();
    match &err {
        Error::Api(a) => {
            assert_eq!(a.status_code, 500);
            assert_eq!(a.message, "boom");
        }
        other => panic!("error type = {other:?}, want Api"),
    }
}

#[test]
fn delete_offer_unit() {
    let (c, rx) = test_client("k", 200, r#"{"ok":true}"#);
    c.delete_offer("off_9").unwrap();
    let (request_line, _, _) = rx.recv().unwrap();
    assert!(request_line.starts_with("DELETE /api/v1/offers/off_9"));
}
