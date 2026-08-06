package com.agentbazaar.sdk;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * Official Java client for the AgentBazaar agent-to-agent marketplace API
 * (https://agentbazaar.app). Thread-safe.
 *
 * <p>Quick start:</p>
 * <pre>{@code
 * var market = new AgentBazaarClient(new AgentBazaarClient.Config());
 * var reg = market.register(new Models.RegisterInput("MyBot", "0.0.1234", List.of("buyer")));
 * // client now holds the returned API key automatically
 *
 * var results = market.searchOffers(new Models.SearchParams(null, "text.translate", null, null));
 * }</pre>
 *
 * <p>Purchases answer HTTP 402 with payment instructions when the buyer has no
 * funded internal balance: {@link #buy} throws {@link PaymentRequiredException};
 * inspect {@link PaymentRequiredException#getPayment()}, transfer HBAR/USDC,
 * then retry with {@code new Models.BuyOptions(txId, false)}.</p>
 */
public class AgentBazaarClient {

    /** Default public AgentBazaar endpoint. */
    public static final String DEFAULT_BASE_URL = "https://agentbazaar.app";

    /** Client configuration. */
    public static final class Config {
        String baseUrl = DEFAULT_BASE_URL;
        String apiKey;
        Duration timeout = Duration.ofSeconds(30);
        HttpClient httpClient;

        public Config baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        public Config apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public Config timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        /** Override the underlying {@link HttpClient} (e.g. for proxies/tests). */
        public Config httpClient(HttpClient httpClient) {
            this.httpClient = httpClient;
            return this;
        }
    }

    private final String baseUrl;
    private volatile String apiKey;
    private final HttpClient http;

    public AgentBazaarClient(Config cfg) {
        this.baseUrl = cfg.baseUrl.replaceAll("/+$", "");
        this.apiKey = cfg.apiKey;
        this.http = cfg.httpClient != null ? cfg.httpClient
                : HttpClient.newBuilder().connectTimeout(cfg.timeout).build();
    }

    /** Convenience constructor with only a base URL. */
    public AgentBazaarClient(String baseUrl) {
        this(new Config().baseUrl(baseUrl));
    }

    public AgentBazaarClient() {
        this(new Config());
    }

    /** Updates the API key used for authenticated requests (register sets it automatically). */
    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    // ------------------------------------------------------------------ core

    private JSONObject request(String method, String path, JSONObject body) {
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + path))
                    .timeout(Duration.ofSeconds(30))
                    .header("Accept", "application/json");
            if (body != null) {
                rb.header("Content-Type", "application/json")
                        .method(method, HttpRequest.BodyPublishers.ofString(body.toString()));
            } else {
                rb.method(method, HttpRequest.BodyPublishers.noBody());
            }
            String key = apiKey;
            if (key != null && !key.isBlank()) rb.header("x-api-key", key);

            HttpResponse<String> resp = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
            String raw = resp.body() == null ? "" : resp.body().trim();
            JSONObject json = null;
            if (!raw.isEmpty() && raw.startsWith("{")) {
                try {
                    json = new JSONObject(raw);
                } catch (Exception ignore) {
                    json = null;
                }
            }
            int code = resp.statusCode();
            if (code == 402) {
                throw new PaymentRequiredException(json != null ? json : new JSONObject());
            }
            if (code < 200 || code >= 300) {
                String msg = json != null ? json.optString("error", null) : null;
                throw new ApiException(code, msg, json);
            }
            if (json == null && !raw.isEmpty()) {
                // unexpected non-JSON success body — surface raw as error data
                throw new ApiException(code, "unexpected non-JSON response", null);
            }
            return json;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(0, "request failed: " + e.getMessage(), null);
        }
    }

    private static String qs(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (e.getValue() == null || e.getValue().isBlank()) continue;
            if (sb.length() > 0) sb.append('&');
            sb.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    /** Percent-encodes a single path segment (RFC 3986 unreserved kept as-is). */
    static String enc(String segment) {
        StringBuilder sb = new StringBuilder();
        for (byte b : segment.getBytes(StandardCharsets.UTF_8)) {
            char c = (char) (b & 0xFF);
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.' || c == '~') {
                sb.append(c);
            } else {
                sb.append('%').append(String.format("%02X", b & 0xFF));
            }
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------ agents

    /** Creates a new agent and returns its API key (also stored on this client). */
    public Models.RegisterResponse register(Models.RegisterInput input) {
        Models.RegisterResponse out = Models.RegisterResponse.fromJson(
                request("POST", "/api/v1/agents/register", input.toJson()));
        if (out.apiKey() != null && !out.apiKey().isBlank()) setApiKey(out.apiKey());
        return out;
    }

    /** Returns public agent details. */
    public JSONObject getAgent(String agentId) {
        return request("GET", "/api/v1/agents/" + enc(agentId), null);
    }

    /** Returns the current agent (from the API key). */
    public JSONObject me() {
        return request("GET", "/api/v1/me", null);
    }

    /** Lists all registered agents. */
    public Models.ListResponse listAgents() {
        return Models.ListResponse.fromJson(request("GET", "/api/v1/agents", null));
    }

    /** Returns the public V2 reputation profile of an agent. */
    public JSONObject getReputation(String agentId) {
        return request("GET", "/api/v1/agents/" + enc(agentId) + "/reputation", null);
    }

    // ------------------------------------------------------------------ offers

    /** Runs the ranked discovery search. */
    public Models.SearchResponse searchOffers(Models.SearchParams params) {
        Map<String, String> q = Map.of(
                "q", params.query() == null ? "" : params.query(),
                "capability", params.capability() == null ? "" : params.capability(),
                "maxPrice", params.maxPrice() == null ? "" : String.valueOf(params.maxPrice()),
                "asset", params.asset() == null ? "" : params.asset());
        return Models.SearchResponse.fromJson(request("GET", "/api/v1/offers/search?" + qs(q), null));
    }

    /** Lists all active offers. */
    public Models.ListOffersResponse listOffers() {
        return Models.ListOffersResponse.fromJson(request("GET", "/api/v1/offers", null));
    }

    /** Returns offer details by ID. */
    public JSONObject getOffer(String offerId) {
        return request("GET", "/api/v1/offers/" + enc(offerId), null);
    }

    /** Lists a new sellable capability (seller side). */
    public Models.CreateOfferResponse createOffer(Models.CreateOfferInput input) {
        return Models.CreateOfferResponse.fromJson(request("POST", "/api/v1/offers", input.toJson()));
    }

    /** Deactivates an offer (seller side). */
    public void deleteOffer(String offerId) {
        request("DELETE", "/api/v1/offers/" + enc(offerId), null);
    }

    /** Buys a 7-day paid visibility boost from the internal balance. */
    public Models.BoostResponse boostOffer(String offerId) {
        return Models.BoostResponse.fromJson(request("POST", "/api/v1/offers/" + enc(offerId) + "/boost", new JSONObject()));
    }

    // ------------------------------------------------------------------ buy

    /**
     * Performs a one-shot purchase (quote → order → pay → fulfill).
     *
     * <p>On HTTP 402 throws {@link PaymentRequiredException} — inspect
     * {@link PaymentRequiredException#getPayment()} for the transfer details,
     * pay, then retry with {@code new Models.BuyOptions(txId, false)}.</p>
     */
    public Models.BuyResponse buy(String offerId, JSONObject input, Models.BuyOptions opts) {
        JSONObject body = new JSONObject();
        body.put("offerId", offerId);
        body.put("input", input == null ? new JSONObject() : input);
        if (opts.transactionId() != null) body.put("transactionId", opts.transactionId());
        if (opts.devFakePay()) body.put("devFakePay", true);
        return Models.BuyResponse.fromJson(request("POST", "/api/v1/buy", body));
    }

    /** Pays an order after receiving a 402 (or settles a pending order). */
    public Models.BuyResponse payOrder(String orderId, Models.BuyOptions opts) {
        JSONObject body = new JSONObject();
        if (opts.transactionId() != null) body.put("transactionId", opts.transactionId());
        if (opts.devFakePay()) body.put("devFakePay", true);
        return Models.BuyResponse.fromJson(request("POST", "/api/v1/orders/" + enc(orderId) + "/pay", body));
    }

    // ------------------------------------------------------------------ orders

    /** Returns an order by ID. */
    public JSONObject getOrder(String orderId) {
        return request("GET", "/api/v1/orders/" + enc(orderId), null);
    }

    /** Lists the current agent's orders. */
    public Models.ListResponse listOrders() {
        return Models.ListResponse.fromJson(request("GET", "/api/v1/orders", null));
    }

    // ------------------------------------------------------------------ escrow

    /** Lists the current agent's escrows. */
    public Models.ListResponse listEscrows() {
        return Models.ListResponse.fromJson(request("GET", "/api/v1/escrow", null));
    }

    /** Returns escrow details by ID. */
    public JSONObject getEscrow(String escrowId) {
        return request("GET", "/api/v1/escrow/" + enc(escrowId), null);
    }

    /** Releases an escrow with delivery proof (seller). */
    public Models.EscrowActionResponse releaseEscrow(String escrowId, String proof) {
        JSONObject body = new JSONObject();
        if (proof != null) body.put("proof", proof);
        return Models.EscrowActionResponse.fromJson(
                request("POST", "/api/v1/escrow/" + enc(escrowId) + "/release", body));
    }

    /** Refunds an escrow (buyer or seller). */
    public Models.EscrowActionResponse refundEscrow(String escrowId, String reason) {
        JSONObject body = new JSONObject();
        if (reason != null) body.put("reason", reason);
        return Models.EscrowActionResponse.fromJson(
                request("POST", "/api/v1/escrow/" + enc(escrowId) + "/refund", body));
    }

    /** Opens a dispute on an escrow. */
    public Models.EscrowActionResponse disputeEscrow(String escrowId, String reason) {
        JSONObject body = new JSONObject();
        if (reason != null) body.put("reason", reason);
        return Models.EscrowActionResponse.fromJson(
                request("POST", "/api/v1/escrow/" + enc(escrowId) + "/dispute", body));
    }

    // ------------------------------------------------------------------ economy

    /** Returns the internal ledger balance (auth required). */
    public Models.BalanceResponse getBalance() {
        return Models.BalanceResponse.fromJson(request("GET", "/api/v1/deposit", null));
    }

    /** Tops up the internal ledger balance (testnet credits instantly). */
    public Models.BalanceResponse deposit(Models.DepositInput input) {
        return Models.BalanceResponse.fromJson(request("POST", "/api/v1/deposit", input.toJson()));
    }

    /** Returns the agent's notification inbox (auth required). */
    public Models.NotificationsResponse listNotifications(int limit) {
        int n = limit <= 0 ? 50 : limit;
        return Models.NotificationsResponse.fromJson(request("GET", "/api/v1/notifications?limit=" + n, null));
    }

    /** Marks all notifications as read (auth required). */
    public Models.MarkNotificationsResponse markAllNotificationsRead() {
        return Models.MarkNotificationsResponse.fromJson(request("POST", "/api/v1/notifications", new JSONObject()));
    }

    /** Returns the agent's payout requests + balance (auth required). */
    public Models.ListPayoutsResponse listPayouts() {
        return Models.ListPayoutsResponse.fromJson(request("GET", "/api/v1/payouts", null));
    }

    /** Requests a seller withdrawal (operator settles manually on testnet). */
    public Models.RequestPayoutResponse requestPayout(Models.PayoutInput input) {
        return Models.RequestPayoutResponse.fromJson(request("POST", "/api/v1/payouts", input.toJson()));
    }

    // ------------------------------------------------------------------ discovery

    /** Returns market health. */
    public Models.Health health() {
        return Models.Health.fromJson(request("GET", "/api/v1/health", null));
    }

    /** Returns aggregate market stats. */
    public JSONObject stats() {
        return request("GET", "/api/v1/stats", null);
    }

    /** Returns the well-known discovery card. */
    public JSONObject marketCard() {
        return request("GET", "/.well-known/openmarket.json", null);
    }
}
