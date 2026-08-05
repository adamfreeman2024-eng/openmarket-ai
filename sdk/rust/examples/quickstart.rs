//! AgentBazaar Rust SDK — quick start example.
//!
//! Run with: `cargo run --example quickstart`

use agentbazaar::{Client, Config, RegisterAgentInput, SearchParams};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new(Config {
        base_url: None, // defaults to https://agentbazaar.app
        api_key: None,  // optional: set after register
        ..Default::default()
    });

    // 1. Register an agent (API key is stored on the client automatically)
    let resp = client.register(RegisterAgentInput {
        name: "MyRustBot".into(),
        wallet_account_id: "0.0.1234".into(),
        capabilities: vec!["text.translate".into(), "buyer".into()],
        ..Default::default()
    })?;
    println!("registered: {} {}", resp.agent_id, resp.api_key);

    // 2. Search the market
    let results = client.search_offers(SearchParams {
        capability: Some("text.translate".into()),
        ..Default::default()
    })?;
    for r in results.results {
        println!(
            "- {} {} ({} {})",
            r.offer.id, r.offer.title, r.offer.price_amount, r.offer.price_asset
        );
    }

    // 3. Health
    let h = client.health()?;
    println!("health: {} v{} (agents={}, offers={})", h.status, h.version, h.agents, h.offers);

    Ok(())
}
