package com.agentbazaar.sdk;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Typed models mirroring the AgentBazaar API payloads.
 *
 * <p>Request records expose {@code toJson()}; response records expose static
 * {@code fromJson(JSONObject)} parsers. Responses whose exact shape is not
 * stable (offers, orders, escrows, agents) are surfaced as raw
 * {@link JSONObject}s so callers can read any field.</p>
 */
public final class Models {

    private Models() {}

    /** Null-safe field readers. */
    static final class J {
        static String str(JSONObject o, String key) {
            Object v = o.opt(key);
            return v == null || v == JSONObject.NULL ? null : v.toString();
        }

        static double dbl(JSONObject o, String key) {
            Object v = o.opt(key);
            if (v == null || v == JSONObject.NULL) return 0.0;
            if (v instanceof Number n) return n.doubleValue();
            return Double.parseDouble(v.toString());
        }

        static boolean bool(JSONObject o, String key) {
            Object v = o.opt(key);
            return v != null && v != JSONObject.NULL && (Boolean) v;
        }

        static int num(JSONObject o, String key) {
            Object v = o.opt(key);
            if (v == null || v == JSONObject.NULL) return 0;
            if (v instanceof Number n) return n.intValue();
            return Integer.parseInt(v.toString());
        }

        static List<String> strs(JSONObject o, String key) {
            JSONArray a = o.optJSONArray(key);
            if (a == null) return List.of();
            List<String> out = new ArrayList<>(a.length());
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
            return out;
        }

        static JSONObject obj(JSONObject o, String key) {
            Object v = o.opt(key);
            return v instanceof JSONObject jo ? jo : null;
        }

        static JSONArray arr(JSONObject o, String key) {
            Object v = o.opt(key);
            return v instanceof JSONArray ja ? ja : null;
        }
    }

    // ---------------------------------------------------------------- agent

    /** Spend Guardian policy constraining an agent's spending. */
    public record AgentPolicy(Double dailySpendLimit, Double maxPerTx, List<String> allowedCounterparties) {
        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            if (dailySpendLimit != null) o.put("dailySpendLimit", dailySpendLimit);
            if (maxPerTx != null) o.put("maxPerTx", maxPerTx);
            if (allowedCounterparties != null && !allowedCounterparties.isEmpty())
                o.put("allowedCounterparties", new JSONArray(allowedCounterparties));
            return o;
        }
    }

    /** Payload for POST /api/v1/agents/register. */
    public record RegisterInput(String name, String walletAccountId, List<String> capabilities,
                                String webhookUrl, String homepage, AgentPolicy policy) {
        public RegisterInput(String name, String walletAccountId, List<String> capabilities) {
            this(name, walletAccountId, capabilities, null, null, null);
        }

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            o.put("name", name);
            o.put("walletAccountId", walletAccountId);
            o.put("capabilities", new JSONArray(capabilities == null ? List.of() : capabilities));
            if (webhookUrl != null) o.put("webhookUrl", webhookUrl);
            if (homepage != null) o.put("homepage", homepage);
            if (policy != null) o.put("policy", policy.toJson());
            return o;
        }
    }

    /** Response of register. */
    public record RegisterResponse(boolean ok, String agentId, String apiKey, String cardUrl) {
        static RegisterResponse fromJson(JSONObject o) {
            return new RegisterResponse(J.bool(o, "ok"), J.str(o, "agentId"), J.str(o, "apiKey"), J.str(o, "cardUrl"));
        }
    }

    // ---------------------------------------------------------------- offers

    /** Filters for GET /api/v1/offers/search. */
    public record SearchParams(String query, String capability, Double maxPrice, String asset) {
        public SearchParams() {
            this(null, null, null, null);
        }
    }

    /** A marketplace listing. */
    public record Offer(String id, String agentId, String capability, String title, String description,
                        double priceAmount, String priceAsset, String fulfillmentType,
                        boolean webhookConfigured, int maxSeconds, boolean escrow,
                        List<String> tags, String createdAt) {
        static Offer fromJson(JSONObject o) {
            return new Offer(
                    J.str(o, "id"), J.str(o, "agentId"), J.str(o, "capability"), J.str(o, "title"),
                    J.str(o, "description"), J.dbl(o, "priceAmount"), J.str(o, "priceAsset"),
                    J.str(o, "fulfillmentType"), J.bool(o, "webhookConfigured"), J.num(o, "maxSeconds"),
                    J.bool(o, "escrow"), J.strs(o, "tags"), J.str(o, "createdAt"));
        }
    }

    /** One ranked hit from search. */
    public record SearchResult(Offer offer, String agentId, String agentName, double score) {
        static SearchResult fromJson(JSONObject o) {
            JSONObject offer = J.obj(o, "offer");
            JSONObject agent = J.obj(o, "agent");
            return new SearchResult(
                    offer == null ? null : Offer.fromJson(offer),
                    agent == null ? null : J.str(agent, "id"),
                    agent == null ? null : J.str(agent, "name"),
                    J.dbl(o, "score"));
        }
    }

    /** Response of search. */
    public record SearchResponse(boolean ok, List<SearchResult> results) {
        static SearchResponse fromJson(JSONObject o) {
            List<SearchResult> results = new ArrayList<>();
            JSONArray a = J.arr(o, "results");
            if (a != null) for (int i = 0; i < a.length(); i++) results.add(SearchResult.fromJson(a.getJSONObject(i)));
            return new SearchResponse(J.bool(o, "ok"), results);
        }
    }

    /** Response of list offers. */
    public record ListOffersResponse(boolean ok, List<Offer> offers) {
        static ListOffersResponse fromJson(JSONObject o) {
            List<Offer> offers = new ArrayList<>();
            JSONArray a = J.arr(o, "offers");
            if (a != null) for (int i = 0; i < a.length(); i++) offers.add(Offer.fromJson(a.getJSONObject(i)));
            return new ListOffersResponse(J.bool(o, "ok"), offers);
        }
    }

    /** Payload for POST /api/v1/offers (seller side). */
    public record CreateOfferInput(String capability, String title, String description,
                                   double priceAmount, String priceAsset, String fulfillmentType,
                                   String webhookUrl, int maxSeconds, boolean escrow, List<String> tags) {
        public CreateOfferInput(String capability, String title, double priceAmount) {
            this(capability, title, null, priceAmount, null, null, null, 0, false, null);
        }

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            o.put("capability", capability);
            o.put("title", title);
            o.put("priceAmount", priceAmount);
            if (description != null) o.put("description", description);
            if (priceAsset != null) o.put("priceAsset", priceAsset);
            if (fulfillmentType != null) o.put("fulfillmentType", fulfillmentType);
            if (webhookUrl != null) o.put("webhookUrl", webhookUrl);
            if (maxSeconds > 0) o.put("maxSeconds", maxSeconds);
            if (escrow) o.put("escrow", true);
            if (tags != null && !tags.isEmpty()) o.put("tags", new JSONArray(tags));
            return o;
        }
    }

    /** Response of create offer. */
    public record CreateOfferResponse(boolean ok, JSONObject offer) {
        static CreateOfferResponse fromJson(JSONObject o) {
            return new CreateOfferResponse(J.bool(o, "ok"), J.obj(o, "offer"));
        }
    }

    /** Response of boost offer. */
    public record BoostResponse(boolean ok, String boostedUntil, double balance) {
        static BoostResponse fromJson(JSONObject o) {
            return new BoostResponse(J.bool(o, "ok"), J.str(o, "boostedUntil"), J.dbl(o, "balance"));
        }
    }

    // ---------------------------------------------------------------- buy

    /** Options controlling a buy / payOrder call. */
    public record BuyOptions(String transactionId, boolean devFakePay) {
        public BuyOptions() {
            this(null, false);
        }
    }

    /** Response of buy. */
    public record BuyResponse(boolean ok, JSONObject order, String settlementMode,
                              PaymentRequiredException.PaymentInfo payment, JSONObject escrow) {
        static BuyResponse fromJson(JSONObject o) {
            JSONObject pay = J.obj(o, "payment");
            PaymentRequiredException.PaymentInfo pi = pay == null ? null
                    : new PaymentRequiredException.PaymentInfo(
                            pay.optDouble("amount", 0.0), pay.optString("asset", ""),
                            pay.optString("payTo", ""), pay.optString("memo", ""));
            return new BuyResponse(J.bool(o, "ok"), J.obj(o, "order"), J.str(o, "settlementMode"), pi, J.obj(o, "escrow"));
        }
    }

    // ---------------------------------------------------------------- economy

    /** Payload for POST /api/v1/deposit. */
    public record DepositInput(double amount, String asset, String txId) {
        public DepositInput(double amount) {
            this(amount, null, null);
        }

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            o.put("amount", amount);
            if (asset != null) o.put("asset", asset);
            if (txId != null) o.put("txId", txId);
            return o;
        }
    }

    /** Response of getBalance / deposit. */
    public record BalanceResponse(boolean ok, double balance, String mode) {
        static BalanceResponse fromJson(JSONObject o) {
            return new BalanceResponse(J.bool(o, "ok"), J.dbl(o, "balance"), J.str(o, "mode"));
        }
    }

    /** Payload for POST /api/v1/payouts. */
    public record PayoutInput(double amount, String method, String account) {
        public PayoutInput(double amount) {
            this(amount, null, null);
        }

        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            o.put("amount", amount);
            if (method != null) o.put("method", method);
            if (account != null) o.put("account", account);
            return o;
        }
    }

    /** A seller withdrawal request. */
    public record Payout(String id, double amount, String method, String status, String createdAt) {
        static Payout fromJson(JSONObject o) {
            return new Payout(J.str(o, "id"), J.dbl(o, "amount"), J.str(o, "method"), J.str(o, "status"), J.str(o, "createdAt"));
        }
    }

    /** Response of list payouts. */
    public record ListPayoutsResponse(boolean ok, double balance, List<Payout> payouts) {
        static ListPayoutsResponse fromJson(JSONObject o) {
            List<Payout> payouts = new ArrayList<>();
            JSONArray a = J.arr(o, "payouts");
            if (a != null) for (int i = 0; i < a.length(); i++) payouts.add(Payout.fromJson(a.getJSONObject(i)));
            return new ListPayoutsResponse(J.bool(o, "ok"), J.dbl(o, "balance"), payouts);
        }
    }

    /** Response of request payout. */
    public record RequestPayoutResponse(boolean ok, JSONObject payout, double balance) {
        static RequestPayoutResponse fromJson(JSONObject o) {
            return new RequestPayoutResponse(J.bool(o, "ok"), J.obj(o, "payout"), J.dbl(o, "balance"));
        }
    }

    // ---------------------------------------------------------------- notifications

    /** An inbox record for the current agent. */
    public record Notification(String id, String agentId, String event, String title, String message,
                               boolean read, String createdAt) {
        static Notification fromJson(JSONObject o) {
            return new Notification(J.str(o, "id"), J.str(o, "agentId"), J.str(o, "event"), J.str(o, "title"),
                    J.str(o, "message"), J.bool(o, "read"), J.str(o, "createdAt"));
        }
    }

    /** Response of list notifications. */
    public record NotificationsResponse(boolean ok, String agentId, int unread, List<Notification> notifications) {
        static NotificationsResponse fromJson(JSONObject o) {
            List<Notification> notifications = new ArrayList<>();
            JSONArray a = J.arr(o, "notifications");
            if (a != null) for (int i = 0; i < a.length(); i++) notifications.add(Notification.fromJson(a.getJSONObject(i)));
            return new NotificationsResponse(J.bool(o, "ok"), J.str(o, "agentId"), J.num(o, "unread"), notifications);
        }
    }

    /** Response of mark all notifications read. */
    public record MarkNotificationsResponse(boolean ok, int marked) {
        static MarkNotificationsResponse fromJson(JSONObject o) {
            return new MarkNotificationsResponse(J.bool(o, "ok"), J.num(o, "marked"));
        }
    }

    // ---------------------------------------------------------------- escrow / orders

    /** A marketplace order. */
    public record Order(String id, String offerId, String buyerId, String sellerId, String status,
                        double amount, String asset, String createdAt) {
        static Order fromJson(JSONObject o) {
            return new Order(J.str(o, "id"), J.str(o, "offerId"), J.str(o, "buyerId"), J.str(o, "sellerId"),
                    J.str(o, "status"), J.dbl(o, "amount"), J.str(o, "asset"), J.str(o, "createdAt"));
        }
    }

    /** An escrowed order (locked funds released on delivery). */
    public record Escrow(String id, String orderId, String status, double amount, String asset, String createdAt) {
        static Escrow fromJson(JSONObject o) {
            return new Escrow(J.str(o, "id"), J.str(o, "orderId"), J.str(o, "status"),
                    J.dbl(o, "amount"), J.str(o, "asset"), J.str(o, "createdAt"));
        }
    }

    /** Generic {ok, items:[...]} envelope for list agents / orders / escrows. */
    public record ListResponse(boolean ok, JSONObject raw) {
        static ListResponse fromJson(JSONObject o) {
            return new ListResponse(J.bool(o, "ok"), o);
        }
    }

    /** Response of escrow release / refund / dispute. */
    public record EscrowActionResponse(boolean ok, JSONObject escrow, JSONObject order) {
        static EscrowActionResponse fromJson(JSONObject o) {
            return new EscrowActionResponse(J.bool(o, "ok"), J.obj(o, "escrow"), J.obj(o, "order"));
        }
    }

    // ---------------------------------------------------------------- health / misc

    /** Market health payload. */
    public record Health(boolean ok, String status, String version, int agents, int offers, int orders, int escrows) {
        static Health fromJson(JSONObject o) {
            return new Health(J.bool(o, "ok"), J.str(o, "status"), J.str(o, "version"),
                    J.num(o, "agents"), J.num(o, "offers"), J.num(o, "orders"), J.num(o, "escrows"));
        }
    }
}
