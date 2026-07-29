# Smart Discovery Service Specification

This document details the design for a "Smart Discovery Service". This is the final component of Phase 3 and the capstone of the AgentBazaar strategic vision. This service elevates the platform from a passive marketplace to an active, intelligent orchestrator.

## 1. Objective

To enable users and agents to discover services not by searching for specific, known capabilities, but by describing a problem or goal in natural language. The platform's AI will then intelligently recommend the best agent or generate a complete multi-agent workflow to solve the problem.

## 2. The Current Limitation: Keyword-Based Search

Currently, finding an agent requires knowing the exact `capability` string (e.g., `text.translate`). This is rigid and assumes the user knows what they are looking for. It does not support complex, multi-step problems.

## 3. The Solution: AI-Powered Discovery & Planning

The Smart Discovery Service will be an AI-powered engine that understands a user's intent and maps it to the available agents on the marketplace.

**Core Workflow:**
1.  **Input:** A user or an agent sends a natural language prompt describing a goal (e.g., "Take this webpage, get the main points, and translate them to Spanish").
2.  **Decomposition:** The service's internal LLM (the "Planner") decomposes the prompt into a sequence of required capabilities (e.g., `web.fetch_article` -> `text.summarize` -> `text.translate`).
3.  **Semantic Search:** For each required capability, the service performs a semantic search against the marketplace to find the most relevant and highly-rated agents. This search matches the *meaning* of the required capability, not just keywords.
4.  **Workflow Generation:** The Planner constructs a complete, executable workflow JSON (using the schema from the No-Code Builder design), chaining together the best agents for each step.
5.  **Output:** The service returns the generated workflow JSON, which can then be executed by the user or the hiring agent.

## 4. Technical Architecture

This service combines vector search with LLM-based planning.

### Component 1: The Vector Index of Agents

*   **Embedding:** Whenever an agent is registered or updated, we will use a sentence-transformer model (e.g., from Hugging Face) to create a vector embedding of its key information: `title`, `description`, and `capability`.
*   **Storage:** These embeddings will be stored in a vector database or a PostgreSQL table with the `pgvector` extension, linked to the agent ID.

### Component 2: The Planner (LLM Agent)

*   This is the core "brain". It is an internal agent that is invoked by the Smart Discovery Service.
*   **Prompt Engineering:** The Planner will be given a carefully crafted prompt, such as:
    > "You are an expert system orchestrator. Your task is to convert a user's request into an executable workflow. Given the user's goal and a list of available tools (agents) retrieved via semantic search, you must generate a JSON object representing a step-by-step plan. The plan should chain the tools together, mapping the output of one step to the input of the next. The final output must be only the JSON workflow definition."

### Component 3: The API

A new primary endpoint for all intelligent discovery.

**Endpoint:** `POST /api/v2/discover`

**Authentication:** Required (`X-Api-Key`).

**Request Body:**

```json
{
  "goal": "Take the content from https://example-blog.com/some-article, create a 3-sentence summary, and translate that summary into German."
}
```

**Success Response (200 OK):**

The response will be the generated workflow JSON, ready for execution.

```json
{
  "workflow": {
    "workflowId": "wf_generated_...",
    "name": "Summarize and Translate Webpage",
    "steps": {
      "step1": {
        "agentId": "agt_fetch_article_...", // Best agent for web.fetch
        "inputs": {
          "url": "https://example-blog.com/some-article"
        }
      },
      "step2": {
        "agentId": "agt_summarize_long_text_...", // Best agent for summarization
        "inputs": {
          "text": "${steps.step1.output.content}"
        }
      },
      "step3": {
        "agentId": "agt_translate_pro_...", // Best agent for translation
        "inputs": {
          "text": "${steps.step2.output.summary}",
          "target_language": "German"
        }
      }
    }
  }
}
```

## 5. Implementation Roadmap

This is a capstone feature and depends on other components being in place.

1.  **Prerequisites:**
    *   The core marketplace (agents, offers) must be stable.
    *   The No-Code Builder's workflow definition and Execution Engine must be implemented, as this service generates JSON for that engine to consume.
2.  **Phase 1 (Vector Search):**
    *   Set up the vector database (`pgvector`).
    *   Implement the embedding process for all agents/offers.
    *   Create an internal search function that finds relevant agents based on a natural language query.
3.  **Phase 2 (Planner Integration):**
    *   Select an LLM provider for the Planner agent.
    *   Develop the prompt and the logic to call the LLM with the user's goal and the search results.
    *   Implement robust parsing and validation for the LLM's JSON output.
4.  **Phase 3 (API Endpoint):**
    *   Build and deploy the public-facing `POST /api/v2/discover` endpoint that ties everything together.
