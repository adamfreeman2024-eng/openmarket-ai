# No-Code Agent Builder Specification

This document details the design for a "No-Code Agent Builder", a visual workflow editor for AgentBazaar. This feature is the final component of Phase 2 and represents a strategic move to democratize the creation of AI-powered automations on the platform.

## 1. Objective

To empower non-technical users to create their own powerful, multi-step automations by chaining together existing agents from the marketplace. This transforms users from pure consumers into creators, dramatically expanding the platform's user base and utility.

**Core Analogy:** Zapier or IFTTT, but for the open-source AI agents on AgentBazaar.

## 2. The User Experience (UX)

The user will interact with a new page, `agentbazaar.app/builder`, which presents a visual canvas.

**The Workflow:**
1.  **Start with a Trigger:** The user defines how the workflow starts. Initially, this will be a manual trigger: a form where the user provides the initial input (e.g., text, a URL).
2.  **Add Steps (Agents):** The user browses or searches for agents from the marketplace and adds them to the canvas as "steps" or "nodes".
3.  **Connect the Steps:** The user draws connections between nodes. This defines the flow of data. For example, the `output` of a "Summarize Article" agent is connected to the `text` input of a "Translate Text" agent.
4.  **Configure Each Step:** The user clicks on each node to configure its specific inputs. Some inputs will be static (e.g., always translate to "Armenian"), while others will be mapped from the outputs of previous steps.
5.  **Save and Run:** The user saves their workflow, giving it a name. They can then run it manually from their dashboard by providing the trigger input.

**Example Workflow: "Summarize and Translate News"**
*   **Trigger:** User provides a URL to a news article.
*   **Step 1 (Agent: `web.fetch_article`):** Takes the URL, fetches the main content.
*   **Step 2 (Agent: `text.summarize`):** Takes the article content from Step 1, produces a summary.
*   **Step 3 (Agent: `text.translate`):** Takes the summary from Step 2, translates it to a user-specified language.
*   **Final Output:** The builder displays the translated summary.

## 3. Technical Architecture

The system requires two main components: a frontend for the visual editor and a backend "Execution Engine".

### Component 1: The Frontend (Visual Builder)

*   This will be a React component using a library designed for node-based editors, such as **React Flow**.
*   It will allow users to drag, drop, and connect nodes on a canvas.
*   It will have a sidebar for searching/browsing marketplace agents.
*   When the user saves, the frontend will serialize the state of the canvas into a JSON object representing the workflow.

### Component 2: The Backend (Execution Engine)

This is a new service responsible for running the saved workflows.

**Workflow JSON Definition:**

A workflow will be stored in the database as a JSON object, for example:
```json
{
  "workflowId": "wf_...",
  "name": "Summarize and Translate News",
  "steps": {
    "step1": {
      "agentId": "agt_fetch_article_...",
      "inputs": {
        "url": "${workflow.trigger.url}" // Maps from the initial trigger input
      }
    },
    "step2": {
      "agentId": "agt_summarize_...",
      "inputs": {
        "text": "${steps.step1.output.content}" // Maps from the output of step 1
      }
    },
    "step3": {
      "agentId": "agt_translate_...",
      "inputs": {
        "text": "${steps.step2.output.summary}",
        "target_language": "Armenian" // Static input
      }
    }
  }
}
```

**Execution Logic:**
1.  The Execution Engine receives a request to run a workflow (`POST /api/v1/workflows/{workflowId}/run`).
2.  It fetches the workflow's JSON definition from the database.
3.  It executes the steps sequentially, using the `market.fulfill` logic for each step.
4.  It performs the data mapping, taking the output from one step and feeding it as input to the next, based on the `${...}` mapping syntax.
5.  It handles errors gracefully. If one step fails, the entire workflow run is marked as failed, and the error is logged.

## 4. Database Schema

Two new tables will be required.

```sql
-- To store the saved workflow designs
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES developers(id),
  name TEXT NOT NULL,
  definition JSONB NOT NULL, -- The workflow JSON
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- To store the history of each run of a workflow
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  status TEXT NOT NULL, -- 'running', 'completed', 'failed'
  trigger_input JSONB,
  final_output JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
```

## 5. Implementation Roadmap

1.  **Phase 1 (Core Backend):**
    *   Implement the `workflows` and `workflow_runs` tables.
    *   Build the core Execution Engine logic capable of running a hardcoded, multi-step workflow.
2.  **Phase 2 (Frontend POC):**
    *   Set up a proof-of-concept builder using React Flow.
    *   Implement the ability to add nodes and save the resulting JSON.
3.  **Phase 3 (Integration):**
    *   Connect the frontend to the backend. Saving a workflow in the UI stores it in the database.
    *   Implement the API endpoint to trigger a workflow run.
4.  **Phase 4 (Polish):**
    *   Add robust error handling, user-friendly configuration panels for each node, and a dashboard to view workflow run history.
