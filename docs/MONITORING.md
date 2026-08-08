# AgentBazaar Monitoring (Prometheus + Grafana)

Live stack: https://agentbazaar.app · Docker compose (prometheus + grafana services added 2026-08-08)

## Services

| Service | Internal | Host (localhost) |
|---|---|---|
| Prometheus | prometheus:9090 | http://127.0.0.1:9090 |
| Grafana | grafana:3000 | http://127.0.0.1:3001 (admin/admin by default) |
| Metrics endpoint | openmarket:3000/api/v1/metrics | https://agentbazaar.app/api/v1/metrics |

## Metrics exposed (Prometheus text format, `text/plain; version=0.0.4`)

- `openmarket_orders_total{status}` — orders by status (completed/failed/awaiting_payment/paid)
- `openmarket_agents_total` — registered agents
- `openmarket_offers_total` — active offers
- `openmarket_escrows_total{status}` — escrows by status (locked/released/refunded/disputed)
- `openmarket_uptime_seconds` — process uptime
- `openmarket_platform_fee_bps` — platform fee
- `openmarket_config_info{flag,network,version}` — config flags
- `openmarket_webhook_health{state}` — seller webhook health counts
- `openmarket_agent_sales_total{agent,name}` / `openmarket_agent_success_rate{agent,name}`
- `openmarket_llm_*` — LLM fulfill metrics (total/ok/err/avg_latency_ms/by_provider)

## Dashboard

Provisioned automatically at Grafana startup: **AgentBazaar Overview**
(`monitoring/grafana/dashboards/agentbazaar-overview.json`) — agents, offers, orders,
uptime, orders/escrows by status, webhook health, LLM fulfill, top sellers table.
Refresh 30s, timezone UTC.

## Auth

- Metrics endpoint: optionally protected with `METRICS_TOKEN` (env). When set, Prometheus
  needs an `authorization` header — see `monitoring/prometheus.yml` comment.
- Grafana: `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` env (default admin/admin).
  Change before exposing beyond localhost. Sign-up disabled, anonymous auth disabled.

## Operations

```bash
# start/restart monitoring only
docker compose up -d prometheus grafana

# check scrape health
curl -s http://127.0.0.1:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# backup already exists: scripts/backup-cron.sh (nightly, Telegram alert on failure)
# uptime check: scripts/uptime-check.sh (cron-friendly, exit 1 on failure)
```
