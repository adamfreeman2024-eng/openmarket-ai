import { describe, it, expect } from "vitest";
import { parsePublicHttpUrl } from "../lib/ssrf";

describe("ssrf parsePublicHttpUrl", () => {
  it("allows public https", () => {
    const r = parsePublicHttpUrl("https://example.com/hook");
    expect(r.ok).toBe(true);
  });

  it("blocks localhost", () => {
    const r = parsePublicHttpUrl("http://localhost:3000/x");
    expect(r.ok).toBe(false);
  });

  it("blocks private IPv4", () => {
    expect(parsePublicHttpUrl("http://127.0.0.1/").ok).toBe(false);
    expect(parsePublicHttpUrl("http://10.0.0.5/h").ok).toBe(false);
    expect(parsePublicHttpUrl("http://192.168.1.1/h").ok).toBe(false);
    expect(parsePublicHttpUrl("http://169.254.169.254/latest").ok).toBe(false);
  });

  it("blocks non-http schemes", () => {
    expect(parsePublicHttpUrl("file:///etc/passwd").ok).toBe(false);
    expect(parsePublicHttpUrl("ftp://example.com").ok).toBe(false);
  });
});
