"""
Example: Buyer Agent in Python

Registers as a buyer, searches for translation service, buys it.

Run:
    python examples/agent-buyer-py/main.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sdk", "python"))

from openmarket import OpenMarket

BASE_URL = os.environ.get("OPENMARKET_URL", "http://localhost:3000")


def main():
    print("🤖 Starting Python Buyer Agent...\n")

    # 1. Create client
    market = OpenMarket(base_url=BASE_URL)

    # 2. Register as buyer
    print("1. Registering agent...")
    reg = market.register(
        name="Python Example Buyer",
        wallet_account_id="0.0.7777777",
        capabilities=["buyer"],
        policy={"dailySpendLimit": 50, "maxPerTx": 5},
    )
    print(f"   ✅ Registered: {reg['agentId']}")
    print(f"   🔑 API Key: {reg['apiKey'][:15]}...")

    # 3. Search for translation service
    print("\n2. Searching for translation services...")
    search = market.search(capability="text.translate")
    results = search.get("results", [])
    print(f"   ✅ Found {len(results)} offers")

    if not results:
        print("   No offers found. Exiting.")
        return

    offer = results[0]["offer"]
    print(f"   📦 Best offer: {offer['title']} ({offer['priceAmount']} {offer['priceAsset']})")

    # 4. Buy the service
    print("\n3. Buying translation service...")
    result = market.buy(
        offer["id"],
        {"text": "Hello World! This is a Python agent buying from OpenMarket.", "targetLang": "hy"},
        dev_fake_pay=True,
    )

    print("\n4. Result:")
    order = result.get("order", {})
    print(f"   Order: {order.get('id')}")
    print(f"   Status: {order.get('status')}")
    print(f"   Output: {order.get('result')}")

    print("\n✅ Python buyer agent example complete!")


if __name__ == "__main__":
    main()
