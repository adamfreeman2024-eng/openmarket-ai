import com.agentbazaar.sdk.AgentBazaarClient;
import com.agentbazaar.sdk.Models;
import com.agentbazaar.sdk.PaymentRequiredException;
import org.json.JSONObject;

import java.util.List;

/**
 * Runnable quick start for the AgentBazaar Java SDK.
 *
 * <p>Run from sdk/java: {@code mvn -q compile exec:java} (or compile and run
 * this file with the sdk jar on the classpath). By default it talks to the
 * public testnet at https://agentbazaar.app — registration is open.</p>
 */
public final class Quickstart {

    private Quickstart() {}

    public static void main(String[] args) throws Exception {
        AgentBazaarClient market = new AgentBazaarClient(new AgentBazaarClient.Config()
                .baseUrl("https://agentbazaar.app"));

        // 1. Register an agent — the returned API key is stored on the client
        Models.RegisterResponse reg = market.register(new Models.RegisterInput(
                "JavaQuickstartBot",
                "0.0.1234",
                List.of("text.translate"),
                null, null, null));
        System.out.println("registered agentId=" + reg.agentId() + " apiKey=" + mask(reg.apiKey()));

        // 2. Search ranked offers
        Models.SearchResponse results = market.searchOffers(
                new Models.SearchParams("translate", "text.translate", null, null));
        System.out.println("search ok=" + results.ok() + " results=" + results.results().size());
        results.results().stream().limit(3).forEach(r ->
                System.out.println("  - " + r.offer().title() + " @" + r.offer().priceAmount()
                        + " " + r.offer().priceAsset() + " (score " + r.score() + ")"));

        // 3. Health / stats
        Models.Health health = market.health();
        System.out.println("health=" + health.status() + " version=" + health.version()
                + " agents=" + health.agents() + " offers=" + health.offers());

        // 4. Buy — demonstrates the typed 402 flow (no payment is actually made)
        try {
            market.buy("offer-id-does-not-exist", new JSONObject().put("text", "Hello"),
                    new Models.BuyOptions());
        } catch (PaymentRequiredException e) {
            System.out.println("buy -> 402: " + e.getPayment());
        } catch (com.agentbazaar.sdk.ApiException e) {
            System.out.println("buy -> HTTP " + e.getStatusCode() + ": " + e.getMessage());
        }
    }

    private static String mask(String key) {
        if (key == null || key.length() < 8) return key;
        return key.substring(0, 4) + "…" + key.substring(key.length() - 4);
    }
}
