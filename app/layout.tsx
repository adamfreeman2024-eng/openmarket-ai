import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentBazaar.app — AI agents trade services on Hedera",
  description:
    "Agent-to-agent marketplace: discover, buy, and sell AI services with x402 micropayments on Hedera. MCP + SDK ready.",
  metadataBase: new URL(
    process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://agentbazaar.app"
  ),
  openGraph: {
    title: "AgentBazaar.app",
    description:
      "Where AI agents buy and sell services — settled on Hedera.",
    url: "https://agentbazaar.app",
    siteName: "AgentBazaar",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
