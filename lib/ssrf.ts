/**
 * SSRF guards for outbound webhook / seller URLs.
 * Blocks localhost, private/link-local, metadata hosts, non-http(s).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

function ipv4ToInt(ip: string): number {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return -1;
  }
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    if (n < 0) return true;
    const u = n >>> 0;
    // comparisons must stay unsigned (JS bitwise is signed int32)
    if (((u & 0xff000000) >>> 0) === 0x00000000) return true;
    if (((u & 0xff000000) >>> 0) === 0x0a000000) return true;
    if (((u & 0xff000000) >>> 0) === 0x7f000000) return true;
    if (((u & 0xffff0000) >>> 0) === 0xa9fe0000) return true;
    if (((u & 0xfff00000) >>> 0) === 0xac100000) return true;
    if (((u & 0xffff0000) >>> 0) === 0xc0a80000) return true;
    if (((u & 0xffc00000) >>> 0) === 0x64400000) return true;
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // link-local
    // IPv4-mapped
    if (lower.includes(".")) {
      const mapped = lower.slice(lower.lastIndexOf(":") + 1);
      if (isIP(mapped) === 4) return isPrivateIp(mapped);
    }
    return false;
  }
  return true;
}

export type SafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; error: string };

/** Sync parse + host blocklist (no DNS). Use before storing URLs. */
export function parsePublicHttpUrl(raw: string): SafeUrlResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Only http/https webhooks allowed" };
  }
  if (u.username || u.password) {
    return { ok: false, error: "URL userinfo not allowed" };
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, error: "Host not allowed" };
  }
  if (isIP(host) && isPrivateIp(host)) {
    return { ok: false, error: "Private IP not allowed" };
  }
  // Block obvious cloud metadata IP
  if (host === "169.254.169.254") {
    return { ok: false, error: "Metadata IP blocked" };
  }
  return { ok: true, url: u };
}

/** Full check with DNS resolution (call before fetch). */
export async function assertSafeOutboundUrl(raw: string): Promise<SafeUrlResult> {
  const parsed = parsePublicHttpUrl(raw);
  if (!parsed.ok) return parsed;
  const host = parsed.url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, error: "Private IP not allowed" };
    return parsed;
  }
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        return { ok: false, error: `Host resolves to private IP ${r.address}` };
      }
    }
    if (!records.length) {
      return { ok: false, error: "Host DNS lookup empty" };
    }
  } catch {
    return { ok: false, error: "Host DNS lookup failed" };
  }
  return parsed;
}
