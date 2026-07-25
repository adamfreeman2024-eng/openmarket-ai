/**
 * Structured logging via pino — fast, JSON-based, production-ready.
 * Logs to stdout (Docker captures automatically).
 * 
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info({ capability, orderId }, "Fulfilling order");
 *   log.error({ err: e.message }, "LLM call failed");
 */
import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

export const log = pino({
  level,
  base: {
    service: "agentbazaar",
    env: process.env.NODE_ENV || "production",
  },
  redact: {
    paths: [
      "apiKey",
      "*.apiKey",
      "webhookSecret",
      "*.webhookSecret",
      "HEDERA_OPERATOR_KEY",
      "TOKENROUTER_API_KEY",
      "LLM_API_KEY",
      "*.token",
      "*.password",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});

/** Convenience helpers */
export function info(msg: string, data?: object) {
  if (data) log.info(data, msg);
  else log.info(msg);
}

export function warn(msg: string, data?: object) {
  if (data) log.warn(data, msg);
  else log.warn(msg);
}

export function error(msg: string, data?: object) {
  if (data) log.error(data, msg);
  else log.error(msg);
}

export function debug(msg: string, data?: object) {
  if (data) log.debug(data, msg);
  else log.debug(msg);
}
