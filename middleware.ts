import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("cf-ray") ||
    crypto.randomUUID();

  res.headers.set("X-Request-Id", requestId);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https: http:; frame-ancestors 'none'"
  );

  // HSTS when served over HTTPS (behind nginx TLS)
  const proto =
    req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  if (proto === "https") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  // Agent-friendly CORS for API + discovery surfaces
  if (
    path.startsWith("/api/") ||
    path.startsWith("/.well-known/") ||
    path === "/llms.txt" ||
    path === "/agents.txt" ||
    path === "/openapi.json"
  ) {
    const allow = process.env.CORS_ORIGINS?.trim();
    const origin = req.headers.get("origin");
    if (allow && allow !== "*") {
      const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
      if (origin && list.includes(origin)) {
        res.headers.set("Access-Control-Allow-Origin", origin);
        res.headers.set("Vary", "Origin");
      }
    } else {
      res.headers.set("Access-Control-Allow-Origin", "*");
    }
    res.headers.set(
      "Access-Control-Allow-Methods",
      "GET,POST,DELETE,OPTIONS"
    );
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Api-Key, X-Request-Id"
    );
    res.headers.set("Access-Control-Expose-Headers", "X-Request-Id, Retry-After");
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
