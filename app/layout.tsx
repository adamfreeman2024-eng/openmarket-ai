import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenMarket.ai — Agents trade on Hedera",
  description:
    "Open agent marketplace: x402 micropayments, policy-safe spend, micro-fees on Hedera",
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
