package com.agentbazaar.sdk;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Offline unit tests for AgentBazaarClient against a JDK built-in HTTP server.
 * No external network required.
 */
class AgentBazaarClientTest {

    private HttpServer server;
    private AgentBazaarClient client;
    private volatile Handler current;

    /** Captures the last request seen by the stub. */
    static final class Capture {
        String method;
        String path;
        String query = "";
        String body = "";
        final Map<String, String> headers = new HashMap<>();
    }

    @FunctionalInterface
    interface Handler {
        void handle(HttpExchange ex, Capture cap) throws IOException;
    }

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/", exchange -> {
            Handler h = current;
            Capture cap = new Capture();
            cap.method = exchange.getRequestMethod();
            cap.path = exchange.getRequestURI().getPath();
            cap.query = exchange.getRequestURI().getQuery() == null ? "" : exchange.getRequestURI().getQuery();
            exchange.getRequestHeaders().forEach((k, v) -> cap.headers.put(k.toLowerCase(), String.join(",", v)));
            cap.body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (h == null) {
                exchange.sendResponseHeaders(500, -1);
                exchange.close();
                return;
            }
            h.handle(exchange, cap);
        });
        server.start();
        client = new AgentBazaarClient(new AgentBazaarClient.Config()
                .baseUrl("http://localhost:" + server.getAddress().getPort()));
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    /** Stubs the next request with a handler that captures and responds. */
    private Capture stub(Response res) {
        Capture cap = new Capture();
        current = (exchange, c) -> {
            cap.method = c.method;
            cap.path = c.path;
            cap.query = c.query;
            cap.headers.putAll(c.headers);
            cap.body = c.body;
            byte[] out = res.body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(res.status, out.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(out);
            }
        };
        return cap;
    }

    private record Response(int status, String body) {}

    private static Response json(int status, String body) {
        return new Response(status, body);
    }

    // ------------------------------------------------------------------ tests

    @Test
    void registerPostsBodyAndStoresApiKey() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"agentId\":\"agent-1\",\"apiKey\":\"sk-test-123\",\"cardUrl\":\"/agents/agent-1\"}"));

        Models.RegisterResponse out = client.register(
                new Models.RegisterInput("MyBot", "0.0.1234", List.of("buyer", "text.translate"), "https://cb.example/hook", null, null));

        assertEquals("POST", cap.method);
        assertEquals("/api/v1/agents/register", cap.path);
        JSONObject body = new JSONObject(cap.body);
        assertEquals("MyBot", body.getString("name"));
        assertEquals("0.0.1234", body.getString("walletAccountId"));
        assertTrue(body.getJSONArray("capabilities").toList().contains("buyer"));
        assertEquals("https://cb.example/hook", body.getString("webhookUrl"));
        assertTrue(out.ok());
        assertEquals("agent-1", out.agentId());
        assertEquals("sk-test-123", out.apiKey());
        // register must store the key for subsequent authenticated calls
        Capture cap2 = stub(json(200, "{\"ok\":true}"));
        client.me();
        assertEquals("sk-test-123", cap2.headers.get("x-api-key"));
    }

    @Test
    void searchOffersBuildsQueryAndParsesRankedResults() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"results\":["
                + "{\"offer\":{\"id\":\"o1\",\"agentId\":\"a1\",\"capability\":\"text.translate\",\"title\":\"Translate\","
                + "\"priceAmount\":0.5,\"priceAsset\":\"HBAR\",\"fulfillmentType\":\"llm\",\"webhookConfigured\":false,"
                + "\"maxSeconds\":60,\"escrow\":true,\"tags\":[\"ai\",\"text\"]},"
                + "\"agent\":{\"id\":\"a1\",\"name\":\"Translator\"},\"score\":0.93}]}"));

        Models.SearchResponse out = client.searchOffers(
                new Models.SearchParams("translate", "text.translate", 1.0, "HBAR"));

        assertEquals("/api/v1/offers/search", cap.path);
        assertTrue(cap.query.contains("q=translate"));
        assertTrue(cap.query.contains("capability=text.translate"));
        assertTrue(cap.query.contains("maxPrice=1.0"));
        assertTrue(cap.query.contains("asset=HBAR"));
        assertEquals(1, out.results().size());
        Models.SearchResult r = out.results().get(0);
        assertEquals(0.93, r.score(), 1e-9);
        assertEquals("o1", r.offer().id());
        assertEquals("Translator", r.agentName());
        assertEquals(0.5, r.offer().priceAmount(), 1e-9);
        assertTrue(r.offer().escrow());
        assertEquals(List.of("ai", "text"), r.offer().tags());
    }

    @Test
    void searchOffersOmitsEmptyParams() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"results\":[]}"));
        client.searchOffers(new Models.SearchParams());
        assertFalse(cap.query.contains("q="));
        assertFalse(cap.query.contains("capability="));
        assertFalse(cap.query.contains("maxPrice="));
        assertFalse(cap.query.contains("asset="));
    }

    @Test
    void buyPostsOfferIdAndInputAndParsesOrder() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"order\":{\"id\":\"ord-9\",\"status\":\"pending\"},\"settlementMode\":\"internal\"}"));

        Models.BuyOptions opts = new Models.BuyOptions("0.0.1234-5678", false);
        JSONObject input = new JSONObject().put("text", "Hello");
        Models.BuyResponse out = client.buy("offer-x", input, opts);

        assertEquals("POST", cap.method);
        assertEquals("/api/v1/buy", cap.path);
        JSONObject body = new JSONObject(cap.body);
        assertEquals("offer-x", body.getString("offerId"));
        assertEquals("Hello", body.getJSONObject("input").getString("text"));
        assertEquals("0.0.1234-5678", body.getString("transactionId"));
        assertTrue(out.ok());
        assertEquals("ord-9", out.order().getString("id"));
        assertEquals("internal", out.settlementMode());
    }

    @Test
    void buyThrowsPaymentRequiredWithTransferInstructions() throws Exception {
        stub(json(402, "{\"ok\":false,\"orderId\":\"ord-402\",\"order\":{\"id\":\"ord-402\"},"
                + "\"payment\":{\"amount\":5.0,\"asset\":\"HBAR\",\"payTo\":\"0.0.987654\",\"memo\":\"agentbazaar:ord-402\"}}"));

        PaymentRequiredException e = assertThrows(PaymentRequiredException.class,
                () -> client.buy("offer-x", new JSONObject().put("text", "Hi"), new Models.BuyOptions()));

        assertEquals(402, e.getStatusCode());
        assertEquals("ord-402", e.getOrderId());
        assertEquals(5.0, e.getPayment().amount(), 1e-9);
        assertEquals("HBAR", e.getPayment().asset());
        assertEquals("0.0.987654", e.getPayment().payTo());
        assertEquals("agentbazaar:ord-402", e.getPayment().memo());
    }

    @Test
    void payOrderSendsTransactionIdOnRetry() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"order\":{\"id\":\"ord-402\",\"status\":\"paid\"}}"));
        client.payOrder("ord-402", new Models.BuyOptions("0.0.1234-5678", true));
        assertEquals("/api/v1/orders/ord-402/pay", cap.path);
        JSONObject body = new JSONObject(cap.body);
        assertEquals("0.0.1234-5678", body.getString("transactionId"));
        assertTrue(body.getBoolean("devFakePay"));
    }

    @Test
    void escrowReleasePostsProof() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"escrow\":{\"id\":\"esc-1\",\"status\":\"released\"}}"));
        Models.EscrowActionResponse out = client.releaseEscrow("esc-1", "delivery-proof-42");
        assertEquals("/api/v1/escrow/esc-1/release", cap.path);
        assertEquals("delivery-proof-42", new JSONObject(cap.body).getString("proof"));
        assertTrue(out.ok());
        assertEquals("released", out.escrow().getString("status"));
    }

    @Test
    void escrowDisputePostsReason() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"escrow\":{\"id\":\"esc-2\",\"status\":\"disputed\"}}"));
        client.disputeEscrow("esc-2", "never delivered");
        assertEquals("/api/v1/escrow/esc-2/dispute", cap.path);
        assertEquals("never delivered", new JSONObject(cap.body).getString("reason"));
    }

    @Test
    void listNotificationsSendsLimit() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"agentId\":\"a1\",\"unread\":1,\"notifications\":["
                + "{\"id\":\"n1\",\"agentId\":\"a1\",\"event\":\"order.completed\",\"title\":\"Paid\","
                + "\"message\":\"m\",\"read\":false,\"createdAt\":\"2026-08-06T00:00:00Z\"}]}"));
        Models.NotificationsResponse out = client.listNotifications(7);
        assertTrue(cap.query.contains("limit=7"));
        assertEquals(1, out.unread());
        assertEquals("order.completed", out.notifications().get(0).event());
        assertFalse(out.notifications().get(0).read());
    }

    @Test
    void listNotificationsDefaultsLimitTo50() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"notifications\":[]}"));
        client.listNotifications(0);
        assertTrue(cap.query.contains("limit=50"));
    }

    @Test
    void sendsApiKeyHeaderOnAuthenticatedCalls() throws Exception {
        client.setApiKey("sk-custom");
        Capture cap = stub(json(200, "{\"ok\":true,\"balance\":12.5,\"mode\":\"testnet\"}"));
        Models.BalanceResponse out = client.getBalance();
        assertEquals("sk-custom", cap.headers.get("x-api-key"));
        assertEquals(12.5, out.balance(), 1e-9);
        assertEquals("testnet", out.mode());
    }

    @Test
    void depositPostsAmount() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"balance\":10.0,\"mode\":\"testnet\"}"));
        client.deposit(new Models.DepositInput(10.0, "hbars", null));
        assertEquals("POST", cap.method);
        assertEquals(10.0, new JSONObject(cap.body).getDouble("amount"));
    }

    @Test
    void requestPayoutPostsAmountAndMethod() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"payout\":{\"id\":\"p1\",\"status\":\"requested\"},\"balance\":0.5}"));
        Models.RequestPayoutResponse out = client.requestPayout(new Models.PayoutInput(2.0, "hbar", "0.0.111"));
        assertEquals("POST", cap.method);
        JSONObject body = new JSONObject(cap.body);
        assertEquals(2.0, body.getDouble("amount"));
        assertEquals("hbar", body.getString("method"));
        assertTrue(out.ok());
    }

    @Test
    void listPayoutsParsesBalance() throws Exception {
        stub(json(200, "{\"ok\":true,\"balance\":3.25,\"payouts\":[{\"id\":\"p1\",\"amount\":1.0,\"method\":\"hbar\",\"status\":\"approved\"}]}"));
        Models.ListPayoutsResponse out = client.listPayouts();
        assertEquals(3.25, out.balance(), 1e-9);
        assertEquals("approved", out.payouts().get(0).status());
    }

    @Test
    void healthParsesFields() throws Exception {
        stub(json(200, "{\"ok\":true,\"status\":\"ready\",\"version\":\"1.4.5\",\"agents\":10,\"offers\":22,\"orders\":3,\"escrows\":1}"));
        Models.Health h = client.health();
        assertEquals("ready", h.status());
        assertEquals("1.4.5", h.version());
        assertEquals(10, h.agents());
        assertEquals(22, h.offers());
    }

    @Test
    void boostOfferPostsEmptyBody() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true,\"boostedUntil\":\"2026-08-13T00:00:00Z\",\"balance\":4.0}"));
        Models.BoostResponse out = client.boostOffer("offer-77");
        assertEquals("/api/v1/offers/offer-77/boost", cap.path);
        assertEquals(4.0, out.balance(), 1e-9);
    }

    @Test
    void apiErrorIncludesStatusCodeAndMessage() throws Exception {
        stub(json(500, "{\"error\":\"boom\"}"));
        ApiException e = assertThrows(ApiException.class, () -> client.me());
        assertEquals(500, e.getStatusCode());
        assertTrue(e.getMessage().contains("boom"));
    }

    @Test
    void deleteOfferSendsDeleteMethod() throws Exception {
        Capture cap = stub(json(200, "{\"ok\":true}"));
        client.deleteOffer("offer-old");
        assertEquals("DELETE", cap.method);
        assertEquals("/api/v1/offers/offer-old", cap.path);
    }

    @Test
    void getOfferReturnsRawJson() throws Exception {
        stub(json(200, "{\"ok\":true,\"offer\":{\"id\":\"o9\",\"title\":\"Raw\"}}"));
        JSONObject out = client.getOffer("o9");
        assertEquals("Raw", out.getJSONObject("offer").getString("title"));
    }

    @Test
    void encPercentEncodesPathSegments() {
        assertEquals("a%2Fb%20c", AgentBazaarClient.enc("a/b c"));
        assertEquals("plain-id", AgentBazaarClient.enc("plain-id"));
        assertEquals("0.0.1234", AgentBazaarClient.enc("0.0.1234"));
    }
}
