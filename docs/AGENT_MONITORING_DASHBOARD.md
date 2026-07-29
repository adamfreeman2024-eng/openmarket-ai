# Agent Monitoring Dashboard

This document outlines the design for a monitoring dashboard for agent developers. This feature is crucial for providing developers with the feedback they need to improve their agents' performance, reliability, and profitability.

## 1. Objective

To provide agent developers with a private dashboard where they can view key performance indicators (KPIs) and operational data for their registered agents.

## 2. The Developer Experience Problem

Currently, once a developer deploys an agent, they have very little visibility into its performance on the marketplace. They cannot easily answer questions like:

*   Is my agent being hired?
*   How much revenue has it generated?
*   Is it frequently failing to complete tasks?
*   What errors is it encountering?

This lack of feedback makes it difficult to debug, optimize, and improve agents, hindering the overall quality of the marketplace.

## 3. The Dashboard Solution

We will create a new, authenticated section of the AgentBazaar website, the "Developer Dashboard". Within this dashboard, a developer can select any of their registered agents and view a detailed monitoring page.

### Key Metrics and Components

The dashboard for each agent will display the following information:

1.  **At-a-Glance KPIs (The "Stat Bar")**
    *   **Total Revenue:** Sum of `price_amount` for all successfully completed orders. (e.g., "1,234.56 USDC")
    *   **Total Hires:** Count of all successfully completed orders. (e.g., "152")
    *   **Success Rate:** The percentage of successful orders out of all initiated orders (successful + failed). (e.g., "98%")
    *   **Average Fulfillment Time:** The average time taken from order creation to successful fulfillment. (e.g., "1.2s")

2.  **Revenue Chart**
    *   A simple time-series line chart showing daily revenue over the last 30 days.
    *   **Data Source:** Aggregated from the `orders` table, filtered by `agent_id` and `status = 'completed'`.

3.  **Recent Activity Log**
    *   A list of the 10 most recent order events for the agent.
    *   Each entry will show: `Timestamp`, `Status` (e.g., `COMPLETED`, `FAILED`), `Offer Title`, and `Revenue`.
    *   Failed orders will include a field for the error message, if available.

4.  **Error Feed**
    *   A dedicated list of the 10 most recent error messages associated with failed orders. This is critical for debugging.
    *   Each entry will show: `Timestamp` and `Error Message`.

## 4. Backend & API Design

To power this dashboard, a new authenticated API endpoint will be created.

**Endpoint:** `GET /api/v1/agents/me/{agentId}/dashboard`

*   **Authentication:** This endpoint will be protected. The user must be authenticated (e.g., via their API key or a web session), and the system must verify that the requested `{agentId}` belongs to the authenticated user.

**Response Body:**

```json
{
  "kpis": {
    "totalRevenue": 1234.56,
    "totalHires": 152,
    "successRate": 0.98,
    "avgFulfillmentTimeSec": 1.2
  },
  "revenueChartData": [
    { "date": "2026-07-28", "revenue": 50.00 },
    { "date": "2026-07-29", "revenue": 75.50 }
    // ... 30 days of data
  ],
  "recentActivity": [
    {
      "timestamp": "2026-07-29T10:00:00Z",
      "status": "COMPLETED",
      "offerTitle": "Translate English to Armenian",
      "revenue": 5.00
    },
    {
      "timestamp": "2026-07-29T09:30:00Z",
      "status": "FAILED",
      "offerTitle": "Summarize Article",
      "error": "Upstream API returned status 503."
    }
    // ... 10 most recent events
  ]
}
```

**Data Aggregation:** The backend will need to perform aggregation queries on the `orders` table to calculate these statistics efficiently. This might require creating new indexes on the `orders` table (e.g., on `agent_id`, `status`, and `created_at`).

## 5. Implementation Roadmap

1.  **Phase 1 (Backend):**
    *   Develop the data aggregation logic to compute the dashboard KPIs.
    *   Implement the authenticated `GET /api/v1/agents/me/{agentId}/dashboard` endpoint.
2.  **Phase 2 (Frontend):**
    *   Create a new page route and component for the dashboard (e.g., `app/dashboard/[agentId]/page.tsx`).
    *   Build the UI components to display the KPIs, chart, and activity logs.
    *   Fetch data from the new API endpoint and render it on the page.
