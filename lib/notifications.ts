/**
 * Notification System — multi-channel notifications for agents.
 * 
 * Channels:
 * 1. Webhook (already exists in webhook-fulfillment)
 * 2. Email (via SMTP or API)
 * 3. Telegram (via Telegram Bot API)
 * 
 * Usage:
 *   import { notify } from "@/lib/notifications";
 *   await notify.agent(agentId, "order_completed", { orderId, result });
 */

import { db } from "./store";
import { log } from "./logger";
import type { NotificationRecord } from "./types";
import { newId } from "./store";

export type NotificationEvent = NotificationRecord["event"];

export type Notification = {
  agentId: string;
  event: NotificationEvent;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
};

// In-memory notification queue (in production, use a proper queue)
const notificationQueue: Notification[] = [];

// ─── Telegram ───
async function sendTelegram(
  chatId: string,
  text: string,
  botToken?: string
): Promise<boolean> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    return resp.ok;
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : String(e) }, "Telegram notification failed");
    return false;
  }
}

// ─── Email ───
async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  // In production, use a proper email service (SendGrid, SES, etc.)
  // For now, we just log it
  log.info({ to, subject }, "Email notification (stub)");
  return true;
}

// ─── Webhook ───
async function sendWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Main Notification API ───
export const notify = {
  async agent(
    agentId: string,
    event: NotificationEvent,
    data: Record<string, unknown>
  ): Promise<void> {
    const agent = db.getAgent(agentId);
    if (!agent) return;

    const notification: Notification = {
      agentId,
      event,
      title: formatTitle(event, data),
      message: formatMessage(event, data),
      data,
      createdAt: new Date().toISOString(),
    };

    notificationQueue.push(notification);
    log.info({ agentId, event, title: notification.title }, "Notification queued");

    // Persist to durable store (inbox). Never throw — fallback is in-memory only.
    try {
      const record: NotificationRecord = {
        ...notification,
        id: newId("ntf"),
        read: false,
      };
      db.putNotification(record);
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, "Notification persist failed (in-memory fallback)");
    }

    // Send via available channels
    const promises: Promise<boolean>[] = [];

    // Webhook (if configured)
    if (agent.webhookUrl) {
      promises.push(
        sendWebhook(agent.webhookUrl, {
          event,
          agentId,
          ...data,
        })
      );
    }

    // Telegram (if chat_id stored in agent metadata)
    const telegramChatId = (agent as unknown as { telegramChatId?: string }).telegramChatId;
    if (telegramChatId) {
      promises.push(
        sendTelegram(telegramChatId, `${notification.title}\n\n${notification.message}`)
      );
    }

    // Email (if email stored in agent metadata)
    const email = (agent as unknown as { email?: string }).email;
    if (email) {
      promises.push(sendEmail(email, notification.title, notification.message));
    }

    await Promise.allSettled(promises);
  },

  async buyer(
    buyerAgentId: string,
    event: NotificationEvent,
    data: Record<string, unknown>
  ): Promise<void> {
    return this.agent(buyerAgentId, event, data);
  },

  async seller(
    sellerAgentId: string,
    event: NotificationEvent,
    data: Record<string, unknown>
  ): Promise<void> {
    return this.agent(sellerAgentId, event, data);
  },

  getQueue(): Notification[] {
    return [...notificationQueue];
  },

  clearQueue(): void {
    notificationQueue.length = 0;
  },

  // ─── Inbox (durable store) ───
  list(agentId: string, limit = 50): NotificationRecord[] {
    try {
      return db.listNotifications(agentId, limit);
    } catch {
      return [];
    }
  },

  unreadCount(agentId: string): number {
    try {
      return db.unreadNotifications(agentId);
    } catch {
      return 0;
    }
  },

  markAllRead(agentId: string): number {
    try {
      return db.markNotificationsRead(agentId);
    } catch {
      return 0;
    }
  },
};

// ─── Formatting ───
function formatTitle(event: NotificationEvent, data: Record<string, unknown>): string {
  const orderId = data.orderId ? ` [#${String(data.orderId).slice(0, 8)}]` : "";
  switch (event) {
    case "order_created":
      return `🛒 New Order${orderId}`;
    case "order_completed":
      return `✅ Order Completed${orderId}`;
    case "order_failed":
      return `❌ Order Failed${orderId}`;
    case "payment_received":
      return `💰 Payment Received${orderId}`;
    case "escrow_locked":
      return `🔒 Escrow Locked${orderId}`;
    case "escrow_released":
      return `🔓 Escrow Released${orderId}`;
    case "escrow_refunded":
      return `↩️ Escrow Refunded${orderId}`;
    case "dispute_opened":
      return `⚠️ Dispute Opened${orderId}`;
    case "dispute_resolved":
      return `✅ Dispute Resolved${orderId}`;
    case "review_received":
      return `⭐ New Review${orderId}`;
    default:
      return `📢 Notification${orderId}`;
  }
}

function formatMessage(event: NotificationEvent, data: Record<string, unknown>): string {
  const amount = data.amount ? `${data.amount} ${data.asset || "HBAR"}` : "";
  const capability = data.capability ? `Capability: ${data.capability}` : "";

  switch (event) {
    case "order_created":
      return `A new order has been created.\n${capability}\nAmount: ${amount}`;
    case "order_completed":
      return `Your order has been completed successfully.\n${capability}`;
    case "order_failed":
      return `Order failed. ${data.error ? `Reason: ${data.error}` : "Please check logs."}`;
    case "payment_received":
      return `Payment received: ${amount}`;
    case "escrow_locked":
      return `Escrow locked for ${amount}. Funds will be released upon delivery.`;
    case "escrow_released":
      return `Escrow released. ${amount} sent to seller.`;
    case "escrow_refunded":
      return `Escrow refunded. ${amount} returned to buyer.`;
    case "dispute_opened":
      return `A dispute has been opened. Reason: ${data.reason || "unspecified"}`;
    case "dispute_resolved":
      return `Dispute resolved. Resolution: ${data.resolution || "resolved"}`;
    case "review_received":
      return `You received a ${data.rating || "?"}-star review.`;
    default:
      return "You have a new notification.";
  }
}
