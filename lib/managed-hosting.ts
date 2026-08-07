/**
 * Managed Agent Hosting — platform-hosted seller agents.
 * 
 * Allows agents without their own infrastructure to run on AgentBazaar.
 * Platform spins up an agent process, registers it, and manages its lifecycle.
 * 
 * Use cases:
 * - Developer uploads agent code → platform runs it
 * - Agent runs on a schedule (cron-like)
 * - Agent listens for webhooks from platform
 */

import { db, newId } from "./store";
import { log } from "./logger";
import { spawn, type ChildProcess } from "child_process";
import path from "path";

export type ManagedAgent = {
  id: string;
  name: string;
  agentId: string; // AgentBazaar agent ID
  status: "starting" | "running" | "stopped" | "crashed";
  pid?: number;
  port?: number;
  script: string; // path to agent script
  env?: Record<string, string>;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  lastError?: string;
};

const managedAgents = new Map<string, { agent: ManagedAgent; process?: ChildProcess }>();
let nextPort = 3020;

export function createManagedAgent(opts: {
  name: string;
  script: string;
  capability: string;
  agentId?: string;
  env?: Record<string, string>;
}): ManagedAgent {
  const port = nextPort++;
  const managed: ManagedAgent = {
    id: newId("mga"),
    name: opts.name,
    agentId: opts.agentId || "", // will be set after registration
    status: "starting",
    port,
    script: opts.script,
    env: {
      AGENT_NAME: opts.name,
      AGENT_CAPABILITY: opts.capability,
      AGENT_PORT: String(port),
      AGENT_HOST: "0.0.0.0",
      AGENTBAZAAR_URL:
        process.env.SITE_URL?.trim() ||
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        "https://agentbazaar.app",
      ...opts.env,
    },
    restartCount: 0,
  };

  managedAgents.set(managed.id, { agent: managed });
  log.info({ managedId: managed.id, name: opts.name, port }, "Managed agent created");

  return managed;
}

export function startManagedAgent(id: string): ManagedAgent | null {
  const entry = managedAgents.get(id);
  if (!entry) return null;
  if (entry.agent.status === "running") return entry.agent;

  const { agent } = entry;
  const scriptPath = path.resolve(agent.script);

  try {
    const proc = spawn("node", [scriptPath], {
      env: {
        ...process.env,
        ...agent.env,
        AGENT_NAME: agent.name,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    agent.pid = proc.pid;
    agent.status = "running";
    agent.startedAt = new Date().toISOString();

    // Capture output
    proc.stdout?.on("data", (data: Buffer) => {
      log.info({ agentId: agent.id, name: agent.name, output: data.toString().trim() }, "Managed agent output");
    });

    proc.stderr?.on("data", (data: Buffer) => {
      log.warn({ agentId: agent.id, name: agent.name, output: data.toString().trim() }, "Managed agent stderr");
    });

    proc.on("exit", (code, signal) => {
      log.warn({ agentId: agent.id, code, signal }, "Managed agent exited");
      agent.status = code === 0 ? "stopped" : "crashed";
      agent.stoppedAt = new Date().toISOString();
      if (code !== 0) {
        agent.lastError = `Process exited with code ${code}`;
        agent.restartCount++;
      }
    });

    proc.on("error", (err) => {
      log.error({ agentId: agent.id, err: err.message }, "Managed agent process error");
      agent.status = "crashed";
      agent.lastError = err.message;
    });

    entry.process = proc;
    log.info({ agentId: agent.id, pid: agent.pid, port: agent.port }, "Managed agent started");

    return agent;
  } catch (e) {
    log.error({ agentId: agent.id, err: e instanceof Error ? e.message : String(e) }, "Failed to start managed agent");
    agent.status = "crashed";
    agent.lastError = e instanceof Error ? e.message : String(e);
    return agent;
  }
}

export function stopManagedAgent(id: string): ManagedAgent | null {
  const entry = managedAgents.get(id);
  if (!entry) return null;

  if (entry.process) {
    try {
      entry.process.kill("SIGTERM");
    } catch {
      // ignore
    }
    entry.process = undefined;
  }

  entry.agent.status = "stopped";
  entry.agent.stoppedAt = new Date().toISOString();
  log.info({ agentId: id }, "Managed agent stopped");

  return entry.agent;
}

export function restartManagedAgent(id: string): ManagedAgent | null {
  stopManagedAgent(id);
  return startManagedAgent(id);
}

export function getManagedAgent(id: string): ManagedAgent | null {
  return managedAgents.get(id)?.agent || null;
}

export function listManagedAgents(): ManagedAgent[] {
  return Array.from(managedAgents.values()).map((e) => e.agent);
}

export function removeManagedAgent(id: string): boolean {
  const entry = managedAgents.get(id);
  if (!entry) return false;

  if (entry.process) {
    try {
      entry.process.kill("SIGTERM");
    } catch {
      // ignore
    }
    entry.process = undefined;
  }
  managedAgents.delete(id);
  log.info({ agentId: id }, "Managed agent removed");
  return true;
}

/**
 * Managed hosting is an opt-in platform feature. Spawning agent processes
 * on the host is powerful — operators must explicitly enable it via
 * `MANAGED_HOSTING_ENABLED=true` in the environment.
 */
export function managedHostingEnabled(): boolean {
  return process.env.MANAGED_HOSTING_ENABLED === "true";
}

/** Auto-restart crashed agents */
export function healthCheckManagedAgents(): void {
  for (const [id, entry] of managedAgents) {
    if (entry.agent.status === "crashed" && entry.agent.restartCount < 3) {
      log.info({ agentId: id, restartCount: entry.agent.restartCount }, "Auto-restarting managed agent");
      startManagedAgent(id);
    }
  }
}
