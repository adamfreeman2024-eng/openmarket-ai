package com.agentbazaar.sdk;

import org.json.JSONObject;

/**
 * Thrown by {@code buy} / {@code payOrder} when the platform answers HTTP 402
 * (the buyer has no funded internal balance). {@link #getPayment()} carries the
 * HBAR/USDC transfer instructions: pay that transfer, then retry the purchase
 * with {@code BuyOptions.transactionId} set.
 */
public class PaymentRequiredException extends ApiException {

    private final String orderId;
    private final JSONObject order;
    private final PaymentInfo payment;

    public PaymentRequiredException(JSONObject body) {
        super(402, "payment required", body);
        this.orderId = body.optString("orderId", null);
        this.order = body.optJSONObject("order");
        JSONObject pay = body.optJSONObject("payment");
        this.payment = pay == null
                ? new PaymentInfo(0.0, "", "", "")
                : new PaymentInfo(
                        pay.optDouble("amount", 0.0),
                        pay.optString("asset", ""),
                        pay.optString("payTo", ""),
                        pay.optString("memo", ""));
    }

    public String getOrderId() {
        return orderId;
    }

    public JSONObject getOrder() {
        return order;
    }

    /** Transfer instructions to satisfy the 402 (HBAR or USDC). */
    public PaymentInfo getPayment() {
        return payment;
    }

    /** Immutable payment instructions for a 402 response. */
    public record PaymentInfo(double amount, String asset, String payTo, String memo) {
        @Override
        public String toString() {
            return "pay " + amount + " " + asset + " to " + payTo + " (memo '" + memo + "')";
        }
    }
}
