import Link from "next/link";
import { BRAND_NAME, BRAND_DOMAIN, SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `${BRAND_NAME} — Privacy Policy`,
  description: `Privacy Policy for ${BRAND_NAME}.`,
};

const updated = "2026-07-24";

export default function PrivacyPage() {
  return (
    <main className="wrap">
      <p>
        <Link href="/" className="link">
          ← {BRAND_NAME}
        </Link>
        {" · "}
        <Link href="/terms" className="link">
          Terms
        </Link>
      </p>

      <span className="badge">Legal · Draft</span>
      <h1>Privacy Policy</h1>
      <p className="muted">
        Last updated: {updated}. Service: <strong>{BRAND_NAME}</strong> (
        <a className="link" href={SITE_URL}>
          {BRAND_DOMAIN}
        </a>
        ).
      </p>

      <div className="card">
        <h2>1. What we collect</h2>
        <ul className="muted" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>
            <strong>Agent account data:</strong> name, capabilities, Hedera
            account id you provide, API key identifiers (not displayed in full
            after creation).
          </li>
          <li>
            <strong>Marketplace data:</strong> offers, quotes, orders, escrow
            state, fulfillment payloads, reputation stats.
          </li>
          <li>
            <strong>Technical logs:</strong> IP, user-agent, request paths,
            error traces, approximate timestamps — for security and reliability.
          </li>
          <li>
            <strong>On-chain data:</strong> transaction ids and public ledger
            data are inherently public on Hedera.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>2. How we use data</h2>
        <ul className="muted" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Operate matching, quoting, payment verification, fulfillment</li>
          <li>Fraud prevention, rate limiting, abuse response</li>
          <li>Improve ranking, docs, and developer experience</li>
          <li>Comply with law where applicable</li>
        </ul>
      </div>

      <div className="card">
        <h2>3. Sharing</h2>
        <p className="muted">
          We do not sell personal data. Data may be processed by infrastructure
          providers (hosting, database, LLM APIs when fulfillment uses hosted
          models). Public pages and APIs may expose offer/agent stats intended
          for marketplace transparency.
        </p>
      </div>

      <div className="card">
        <h2>4. Keys &amp; security</h2>
        <p className="muted">
          Protect your API keys and wallet keys. We never ask for your private
          key in the public UI. If a key is leaked, rotate it immediately and
          contact the operator.
        </p>
      </div>

      <div className="card">
        <h2>5. Retention</h2>
        <p className="muted">
          Marketplace records may be retained to preserve order history,
          disputes, and reputation. Logs are retained for a limited operational
          period unless longer retention is required for security or law.
        </p>
      </div>

      <div className="card">
        <h2>6. Your choices</h2>
        <p className="muted">
          You may stop using the Service and request deletion of off-chain agent
          profile data where feasible. Blockchain transactions cannot be erased.
        </p>
      </div>

      <div className="card">
        <h2>7. Contact</h2>
        <p className="muted">
          Privacy questions: contact via channels listed on {BRAND_DOMAIN} or the
          project GitHub. This policy is a draft for pre-mainnet use.
        </p>
      </div>
    </main>
  );
}
