/**
 * HCS (Hedera Consensus Service) audit log.
 * Writes critical marketplace events to an immutable Hedera topic.
 *
 * When HCS_AUDIT_TOPIC_ID is set, events are sent to HCS.
 * Otherwise, events are stored locally only (file + PG).
 *
 * Events logged:
 *   - agent.register
 *   - offer.create
 *   - order.completed
 *   - order.failed
 *   - escrow.locked
 *   - escrow.released
 *   - escrow.refunded
 *   - escrow.disputed
 */
import { HCS_AUDIT_TOPIC_ID, NETWORK } from "./config";

type HCSClient = {
  submitMessage: (topicId: string, message: string) => Promise<string>;
};

let hcsClient: HCSClient | null = null;
let hcsInitAttempted = false;

/** Get or initialize HCS client (lazy) */
async function getHCSClient(): Promise<HCSClient | null> {
  if (!HCS_AUDIT_TOPIC_ID) return null;
  if (hcsInitAttempted) return hcsClient;
  hcsInitAttempted = true;

  try {
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    if (!operatorKey || !operatorId) return null;

    // Dynamic import to avoid loading Hedera SDK when not needed
    const { Client, TopicMessageSubmitTransaction, PrivateKey, AccountId } =
      await import("@hiero-ledger/sdk");

    const client = Client.forName(NETWORK).setOperator(
      AccountId.fromString(operatorId),
      PrivateKey.fromStringDer(operatorKey)
    );

    hcsClient = {
      async submitMessage(topicId: string, message: string): Promise<string> {
        const tx = new TopicMessageSubmitTransaction()
          .setTopicId(topicId)
          .setMessage(message);
        const response = await tx.execute(client);
        const receipt = await response.getReceipt(client);
        return response.transactionId?.toString() || "unknown";
      },
    };
    return hcsClient;
  } catch (e) {
    console.error("[hcs] init failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Check if HCS audit is enabled */
export function isHCSAuditEnabled(): boolean {
  return Boolean(HCS_AUDIT_TOPIC_ID);
}

/** Submit an audit event to HCS */
export async function hcsAudit(
  type: string,
  payload: Record<string, unknown>
): Promise<{ txId?: string; error?: string }> {
  const client = await getHCSClient();
  if (!client) {
    return { error: "HCS not configured" };
  }

  try {
    const message = JSON.stringify({
      type,
      payload,
      ts: new Date().toISOString(),
      source: "openmarket-ai",
    });
    const txId = await client.submitMessage(HCS_AUDIT_TOPIC_ID, message);
    return { txId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "HCS submit failed" };
  }
}

/** Non-blocking version — fire and forget */
export function hcsAuditAsync(type: string, payload: Record<string, unknown>): void {
  void hcsAudit(type, payload).catch((e) => {
    console.error("[hcs] async audit failed:", e);
  });
}
