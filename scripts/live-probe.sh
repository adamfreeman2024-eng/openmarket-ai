#!/usr/bin/env bash
# Live smoke / quality probe against production URL (testnet OK).
set -euo pipefail
BASE="${OPENMARKET_URL:-https://agentbazaar.app}"
BASE="${BASE%/}"
FAIL=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

echo "=== AgentBazaar live probe ==="
echo "BASE=$BASE"
echo

# 1) Health
H=$(curl -sS -m 20 "$BASE/api/v1/health" || true)
echo "$H" | grep -q '"ok":true' && pass "health ok" || fail "health"
echo "$H" | grep -q '"devFakeSettlement":false' && pass "devFake off" || fail "devFake"
echo "$H" | grep -q '"network":"testnet"' && pass "network testnet" || echo "  INFO  network not testnet (check)"

# 2) Ready
R=$(curl -sS -m 20 "$BASE/api/v1/ready" || true)
echo "$R" | grep -q '"status":"ready"' && pass "ready" || fail "ready"

# 3) Pages
for p in / /catalog /how-it-works /terms /privacy /dashboard /llms.txt /agents.txt /openapi.json /.well-known/agent-card.json; do
  code=$(curl -sS -m 20 -o /tmp/ab_page.out -w "%{http_code}" "$BASE$p" || echo 000)
  if [ "$code" = "200" ]; then pass "GET $p ($code)"; else fail "GET $p ($code)"; fi
done

# 4) Branding (no Armenian homepage; AgentBazaar present)
HOME=$(curl -sS -m 20 "$BASE/" || true)
echo "$HOME" | grep -q 'AgentBazaar' && pass "brand AgentBazaar" || fail "brand"
echo "$HOME" | grep -qP '[\x{0531}-\x{0587}]' && fail "Armenian still on homepage" || pass "homepage English"

# 5) Search API
S=$(curl -sS -m 20 "$BASE/api/v1/offers/search?capability=echo.demo&limit=3" || true)
echo "$S" | grep -qE 'offer|offers|results|id' && pass "search returns data" || fail "search empty/error"

# 6) Register + quote + order path (no pay — tests pipeline without spend)
NAME="probe-$(date +%s)"
REG=$(curl -sS -m 30 -X POST "$BASE/api/v1/agents/register" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"$NAME\",\"walletAccountId\":\"0.0.999001\",\"capabilities\":[\"buyer\",\"probe\"]}" || true)
KEY=$(echo "$REG" | python3 -c "import sys,json;print(json.load(sys.stdin).get('apiKey') or json.load(open('/dev/stdin')) )" 2>/dev/null || true)
# robust parse
KEY=$(echo "$REG" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('apiKey',''))" 2>/dev/null || echo "")
if [ -n "$KEY" ]; then
  pass "register apiKey"
else
  fail "register"; echo "$REG" | head -c 300; echo
fi

OFFER=$(echo "$S" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# tolerate shapes
items=d.get('results') or d.get('offers') or d.get('items') or []
if isinstance(d,list): items=d
oid=''
for it in items:
  o=it.get('offer',it)
  oid=o.get('id','')
  if oid: break
print(oid)
" 2>/dev/null || echo "")

if [ -n "$OFFER" ] && [ -n "$KEY" ]; then
  Q=$(curl -sS -m 30 -X POST "$BASE/api/v1/quotes" \
    -H "content-type: application/json" -H "X-Api-Key: $KEY" \
    -d "{\"offerId\":\"$OFFER\",\"input\":{\"text\":\"probe\"}}" || true)
  QID=$(echo "$Q" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id') or d.get('quoteId') or (d.get('quote') or {}).get('id') or '')" 2>/dev/null || echo "")
  if [ -n "$QID" ]; then
    pass "quote $QID"
    echo "$Q" | grep -qiE 'platformFee|totalAmount|payTo' && pass "quote has payment fields" || fail "quote payment fields"
  else
    fail "quote"; echo "$Q" | head -c 400; echo
  fi
else
  echo "  SKIP  quote (no offer or key)"
fi

# 7) TLS
echo | openssl s_client -connect agentbazaar.app:443 -servername agentbazaar.app 2>/dev/null | grep -q 'Verify return code: 0' && pass "TLS verify" || fail "TLS"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "=== ALL LIVE CHECKS PASSED ==="
  exit 0
else
  echo "=== FAILED: $FAIL ==="
  exit 1
fi
