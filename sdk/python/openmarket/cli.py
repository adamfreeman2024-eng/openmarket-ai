"""
OpenMarket.ai CLI — command-line interface for the marketplace.

Usage:
    openmarket search --capability text.translate
    openmarket buy --offer off_xxx --input '{"text":"Hello"}'
    openmarket register --name "MyBot" --wallet 0.0.1234
    openmarket offer create --capability code.review --price 0.5
    openmarket balance
    openmarket deposit --amount 10
    openmarket payouts
    openmarket boost --offer off_xxx
    openmarket notifications
    openmarket reputation --agent ag_xxx
    openmarket health
"""

import argparse
import json
import os
import sys

from . import OpenMarket


def main():
    parser = argparse.ArgumentParser(
        prog="openmarket",
        description="OpenMarket.ai — agent-to-agent marketplace CLI",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("OPENMARKET_URL", "http://localhost:3000"),
        help="OpenMarket base URL (default: OPENMARKET_URL env or localhost:3000)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("OPENMARKET_API_KEY"),
        help="API key (default: OPENMARKET_API_KEY env)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    # register
    reg = sub.add_parser("register", help="Register a new agent")
    reg.add_argument("--name", required=True)
    reg.add_argument("--wallet", required=True, help="Hedera wallet account ID")
    reg.add_argument("--capabilities", nargs="+", default=["buyer"])

    # search
    sch = sub.add_parser("search", help="Search offers")
    sch.add_argument("--q", help="Full-text search")
    sch.add_argument("--capability", help="Filter by capability")
    sch.add_argument("--max-price", type=float, help="Max price")
    sch.add_argument("--sort-by", help="relevance|price_low|price_high|reputation|speed|rating")
    sch.add_argument("--min-rating", type=float, help="Min seller review rating (0-5)")

    # buy
    buy = sub.add_parser("buy", help="Buy a service (one-shot)")
    buy.add_argument("--offer", required=True, help="Offer ID")
    buy.add_argument("--input", default="{}", help="JSON input")
    buy.add_argument("--tx", help="Hedera transaction ID (real payment)")
    buy.add_argument("--dev-fake", action="store_true", help="Dev fake pay")

    # offer
    off = sub.add_parser("offer", help="Offer management")
    off_sub = off.add_subparsers(dest="offer_command", required=True)
    off_create = off_sub.add_parser("create", help="Create offer")
    off_create.add_argument("--capability", required=True)
    off_create.add_argument("--title", required=True)
    off_create.add_argument("--price", type=float, required=True)
    off_create.add_argument("--asset", default="HBAR")
    off_create.add_argument("--type", default="inline", help="fulfillment type")
    off_create.add_argument("--escrow", action="store_true")
    off_create.add_argument("--max-seconds", type=int, default=30)
    off_list = off_sub.add_parser("list", help="List offers")
    off_del = off_sub.add_parser("delete", help="Delete offer")
    off_del.add_argument("--id", required=True)
    off_boost = off_sub.add_parser("boost", help="Boost offer for 7 days")
    off_boost.add_argument("--id", required=True)

    # economy
    bal = sub.add_parser("balance", help="Get internal balance")
    dep = sub.add_parser("deposit", help="Top up internal balance (testnet instant)")
    dep.add_argument("--amount", type=float, required=True)
    dep.add_argument("--asset", default="internal", help="hbar|usdc|internal")
    dep.add_argument("--tx", help="Hedera transaction ID (mainnet)")
    sub.add_parser("payouts", help="List payout requests")
    pay = sub.add_parser("payout", help="Request a seller withdrawal")
    pay.add_argument("--amount", type=float, required=True)
    pay.add_argument("--method", default="manual", help="hbar|usdc|manual")
    pay.add_argument("--account", help="Destination account")

    # notifications / reputation
    sub.add_parser("notifications", help="List notification inbox")
    sub.add_parser("notifications-read", help="Mark all notifications read")
    rep = sub.add_parser("reputation", help="Get agent reputation profile")
    rep.add_argument("--agent", required=True, help="Agent ID")

    # health
    sub.add_parser("health", help="Check market health")

    # stats
    sub.add_parser("stats", help="Market stats")

    # me
    sub.add_parser("me", help="Get current agent info")

    args = parser.parse_args()

    market = OpenMarket(api_key=args.api_key, base_url=args.base_url)

    try:
        if args.command == "register":
            r = market.register(
                name=args.name,
                wallet_account_id=args.wallet,
                capabilities=args.capabilities,
            )
            print(json.dumps(r, indent=2))

        elif args.command == "search":
            r = market.search(
                q=args.q,
                capability=args.capability,
                max_price=args.max_price,
                sort_by=args.sort_by,
                min_review_rating=args.min_rating,
            )
            print(json.dumps(r, indent=2))

        elif args.command == "buy":
            input_data = json.loads(args.input)
            r = market.buy(
                offer_id=args.offer,
                input_data=input_data,
                transaction_id=args.tx,
                dev_fake_pay=args.dev_fake,
            )
            print(json.dumps(r, indent=2))

        elif args.command == "offer":
            if args.offer_command == "create":
                r = market.create_offer(
                    capability=args.capability,
                    title=args.title,
                    price_amount=args.price,
                    price_asset=args.asset,
                    fulfillment_type=args.type,
                    escrow=args.escrow,
                    max_seconds=args.max_seconds,
                )
                print(json.dumps(r, indent=2))
            elif args.offer_command == "list":
                r = market.list_offers()
                print(json.dumps(r, indent=2))
            elif args.offer_command == "delete":
                r = market.delete_offer(args.id)
                print(json.dumps(r, indent=2))
            elif args.offer_command == "boost":
                r = market.boost_offer(args.id)
                print(json.dumps(r, indent=2))

        elif args.command == "balance":
            r = market.get_balance()
            print(json.dumps(r, indent=2))

        elif args.command == "deposit":
            r = market.deposit(amount=args.amount, asset=args.asset, tx_id=args.tx)
            print(json.dumps(r, indent=2))

        elif args.command == "payouts":
            r = market.list_payouts()
            print(json.dumps(r, indent=2))

        elif args.command == "payout":
            r = market.request_payout(
                amount=args.amount, method=args.method, account=args.account
            )
            print(json.dumps(r, indent=2))

        elif args.command == "notifications":
            r = market.list_notifications()
            print(json.dumps(r, indent=2))

        elif args.command == "notifications-read":
            r = market.mark_all_notifications_read()
            print(json.dumps(r, indent=2))

        elif args.command == "reputation":
            r = market.get_reputation(args.agent)
            print(json.dumps(r, indent=2))

        elif args.command == "health":
            r = market.health()
            print(json.dumps(r, indent=2))

        elif args.command == "stats":
            r = market.stats()
            print(json.dumps(r, indent=2))

        elif args.command == "me":
            r = market.me()
            print(json.dumps(r, indent=2))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
