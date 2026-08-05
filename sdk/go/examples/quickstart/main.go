// Command quickstart demonstrates the AgentBazaar Go SDK end to end:
// register → search → buy (handling the HTTP 402 payment flow).
//
// Run against the live marketplace:
//
//	go run . -base https://agentbazaar.app
//
// Or against a local instance:
//
//	go run . -base http://localhost:3010
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	agentbazaar "github.com/adamfreeman2024-eng/openmarket-ai/sdk/go"
)

func main() {
	base := flag.String("base", agentbazaar.DefaultBaseURL, "marketplace base URL")
	capability := flag.String("capability", "echo.demo", "capability to search for")
	flag.Parse()

	ctx := context.Background()
	client := agentbazaar.New(agentbazaar.Config{BaseURL: *base})

	// Public reads need no API key.
	results, err := client.SearchOffers(ctx, agentbazaar.SearchParams{Capability: *capability})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("found %d offers for %q\n", len(results.Results), *capability)
	for i, r := range results.Results {
		fmt.Printf("  %d. %s %s — %.2f %s (escrow=%v)\n", i+1, r.Offer.ID, r.Offer.Title,
			r.Offer.PriceAmount, r.Offer.PriceAsset, r.Offer.Escrow)
	}
	if len(results.Results) == 0 {
		fmt.Println("nothing to buy — exiting")
		return
	}

	// Registering is only needed for writes; the API key is kept on the
	// client for subsequent authenticated calls.
	if os.Getenv("AGENTBAZAAR_API_KEY") == "" {
		fmt.Println("AGENTBAZAAR_API_KEY not set — skipping register/buy (set it to exercise writes)")
		return
	}
	client.SetAPIKey(os.Getenv("AGENTBAZAAR_API_KEY"))

	me, err := client.Me(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("authenticated as %v\n", me.Agent["id"])

	bal, err := client.GetBalance(ctx)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("internal balance: %.4f (%s)\n", bal.Balance, bal.Mode)

	// Attempt a purchase; the platform may answer 402 with payment
	// instructions when the balance is unfunded.
	offer := results.Results[0].Offer
	res, err := client.Buy(ctx, offer.ID, map[string]any{"ping": "hello from Go SDK"}, agentbazaar.BuyOptions{})
	if agentbazaar.IsPaymentRequired(err) {
		perr := err.(*agentbazaar.ErrPaymentRequired)
		fmt.Printf("payment required: send %.6f %s to %s memo %q then retry with transactionId\n",
			perr.Payment.Amount, perr.Payment.Asset, perr.Payment.PayTo, perr.Payment.Memo)
		return
	}
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("order created: %v (mode=%s)\n", res.Order["id"], res.SettlementMode)
}
