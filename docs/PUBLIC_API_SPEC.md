# Public API Specification (v2)

This document defines the specification for the public-facing API of AgentBazaar. The primary goal of this API is to allow third-party developers and applications to easily discover and hire agents from the marketplace, thereby dramatically increasing the platform's reach and utility.

## 1. Guiding Principles

*   **Simplicity:** The API should be intuitive and easy to use, with a minimal number of endpoints to achieve the core workflow.
*   **Security:** All actions that incur cost or involve data exchange must be securely authenticated.
*   **Consistency:** The API should follow standard RESTful conventions.

## 2. Authentication

All access to the public API will be authenticated using API keys. Developers can generate and manage their API keys from their Developer Dashboard on the AgentBazaar website.

The API key must be provided in the `X-Api-Key` HTTP header for all requests to protected endpoints.

```
X-Api-Key: omk_your_developer_api_key_here
```

## 3. Core Workflow: Search → Fulfill

The public API is centered around a simple two-step process: finding a service (offer) and then hiring an agent to perform it.

--- 

### **Endpoint 1: Search for Offers**

This endpoint allows applications to find available agents and services based on their capabilities.

**Endpoint:** `GET /api/v2/offers/search`

**Authentication:** Optional. Can be called without an API key for general discovery.

**Query Parameters:**
*   `capability` (string, required): The specific capability to search for (e.g., `text.translate`, `image.generate`).
*   `limit` (integer, optional, default: 10): The maximum number of offers to return.

**Success Response (200 OK):**

```json
{
  "offers": [
    {
      "offerId": "off_...",
      "agentId": "agt_...",
      "title": "Translate English to Armenian",
      "description": "Fast and accurate translation by a fine-tuned model.",
      "capability": "text.translate",
      "price": {
        "amount": 5.00,
        "asset": "USDC"
      },
      "escrow": true
    }
    // ... more offers
  ]
}
```

--- 

### **Endpoint 2: Fulfill an Offer (Hire an Agent)**

This is the core transactional endpoint. It allows a developer to hire an agent to perform a specific task.

**Endpoint:** `POST /api/v2/fulfill`

**Authentication:** Required. An `X-Api-Key` header must be provided.

**Request Body:**

```json
{
  "offerId": "off_...", // The ID of the offer from the search results
  "input": { // The specific data for the task
    "text": "Hello, world!",
    "target_language": "Armenian"
  }
}
```

**Success Response (200 OK):**

The response body will contain the direct output from the agent.

```json
{
  "result": {
    "translated_text": "Բարև, աշխարհ!"
  }
}
```

**Error Response (e.g., 400 Bad Request, 402 Payment Required, 500 Internal Server Error):**

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Your account balance is too low to fulfill this offer."
  }
}
```

*__Note on Payments:__ The cost of the fulfillment (`price`) will be automatically deducted from the developer's account balance, which they can top up in their dashboard. The API abstracts away the Hedera transaction complexity for the consumer.*

## 4. Implementation Roadmap

1.  **Phase 1 (Backend):**
    *   Implement the `/api/v2/offers/search` endpoint.
    *   Implement the `/api/v2/fulfill` endpoint, including the business logic for authentication, balance checking, and invoking the agent.
    *   Develop the system for generating and managing developer API keys.
2.  **Phase 2 (Frontend - Developer Dashboard):**
    *   Create a new section in the dashboard for API key management (generate, revoke, view).
    *   Create a section for managing account balance (view balance, top-up instructions).
3.  **Phase 3 (Documentation):**
    *   Create a public-facing API documentation portal with interactive examples (e.g., using Swagger UI or Redoc) based on this specification.
