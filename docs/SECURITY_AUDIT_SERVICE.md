# Gold Tier: Automated Security Audit Service

This document specifies the design for an automated security audit service. This service is the cornerstone of the "Gold Tier" in the Agent Verification & Trust System, providing the highest level of assurance for agents on the AgentBazaar marketplace.

## 1. Objective

To automatically scan an agent's source code for common security vulnerabilities and grant a "Gold / Audited" status only if the code meets a high standard of security, defined as having zero critical vulnerabilities.

## 2. System Architecture

The audit service will be a standalone microservice that communicates with the main AgentBazaar platform. This isolates the resource-intensive scanning process and enhances security.

**Workflow:**
1.  **Trigger:** A developer submits their agent's public Git repository URL for auditing via their AgentBazaar dashboard.
2.  **Queue:** The main platform validates the URL and places an audit request into a message queue (e.g., RabbitMQ, or a simple database table acting as a queue).
3.  **Process:** The Audit Service worker picks up the request from the queue.
4.  **Execute:** The service performs the audit in an isolated, containerized environment:
    a.  Clones the Git repository into a temporary, ephemeral container.
    b.  Detects the primary language (Python or TypeScript/Node.js).
    c.  Runs the appropriate Static Analysis Security Testing (SAST) tool.
    d.  Parses the JSON output from the tool.
5.  **Evaluate:** The service checks the results against a predefined policy (e.g., `CRITICAL_VULNERABILITIES > 0` -> `FAIL`).
6.  **Report:** The service stores the audit result (pass/fail), a summary of findings, and the full JSON report in the database.
7.  **Update:** The service notifies the main platform to update the agent's `verification_status` to `gold` if the audit is passed.

## 3. Tool Selection (SAST)

The service must support the most common languages for AI agents. Our initial implementation will focus on Python and Node.js/TypeScript.

*   **For Python:** **`bandit`**
    *   **Why:** It is the industry standard for SAST in Python. It is mature, actively maintained, and designed to find common security issues in Python code. It can produce JSON output for easy parsing (`-f json`).

*   **For TypeScript / JavaScript (Node.js):** **`semgrep`**
    *   **Why:** `semgrep` is a powerful, modern, and polyglot static analysis tool. It has a vast, community-driven registry of rules for many languages, including excellent coverage for Node.js security (e.g., rulesets for `express`, `r2c-node-security-audit`). It is highly configurable and provides structured JSON output.

## 4. Audit Policy

An agent will **FAIL** the audit and be denied Gold status if the scan report contains:

*   **One or more vulnerabilities of `HIGH` or `CRITICAL` severity.**

Medium and Low severity findings will be reported to the developer but will not block Gold status initially. This policy can be tightened in the future.

## 5. API and Data Models

**New Database Table: `agent_audits`**

```sql
CREATE TABLE IF NOT EXISTS agent_audits (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  git_repository_url TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  status TEXT NOT NULL, -- e.g., 'pending', 'running', 'pass', 'fail'
  result_summary TEXT,
  full_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Internal API Endpoint (for the main app to call the microservice):**

`POST /internal/v1/audits`

Request Body:
`{ "agentId": "agt_...", "repositoryUrl": "https://github.com/user/repo" }`

## 6. Implementation Roadmap

1.  **Phase 1: DB & Tooling Setup.**
    *   Add the `agent_audits` table to the `schema.sql`.
    *   Create a new private repository for the audit microservice.
    *   Set up a Dockerfile for the service that includes Python, Node.js, `bandit`, and `semgrep`.
2.  **Phase 2: Core Service Logic.**
    *   Implement the core logic to clone a repo and run a tool based on language detection.
    *   Implement the parsing and evaluation logic against the audit policy.
3.  **Phase 3: Integration.**
    *   Build the API endpoint and the queueing mechanism.
    *   Connect the service to the main application to update agent status upon successful audit.
4.  **Phase 4: UI.**
    *   Create the UI in the developer dashboard for submitting a repository for audit and viewing the results.
