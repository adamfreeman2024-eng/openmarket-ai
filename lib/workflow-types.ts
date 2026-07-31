/**
 * Workflow types — no-code agent composition.
 * A workflow is a DAG of nodes; each node calls an agent capability.
 * Node output is aggregated and available to downstream nodes.
 */

export type WorkflowNode = {
  id: string;
  capability: string;
  title: string;
  input?: Record<string, unknown>;
  /** Node ids that must complete before this one runs */
  dependsOn?: string[];
};

export type WorkflowRecord = {
  id: string;
  ownerAgentId: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowStepRun = {
  nodeId: string;
  capability: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  ownerAgentId: string;
  status: "running" | "completed" | "failed";
  steps: WorkflowStepRun[];
  finalOutput?: unknown;
  createdAt: string;
  completedAt?: string;
};

export type WorkflowRunSummary = {
  id: string;
  workflowId: string;
  status: WorkflowRun["status"];
  stepCount: number;
  createdAt: string;
  completedAt?: string;
};
