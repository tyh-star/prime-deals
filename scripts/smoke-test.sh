#!/usr/bin/env bash
# End-to-end smoke test against a running stack (default: docker compose on :8080).
# Registers a buyer, buys a seeded product with an Idempotency-Key, replays the
# request, pays, and checks the stock moved exactly once.
set -euo pipefail

BASE="${1:-http://localhost:8080}"
API="$BASE/api"
need() { command -v "$1" >/dev/null || { echo "missing dependency: $1" >&2; exit 1; }; }
need curl
need jq

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

step "Frontend serves the app"
curl -fsS "$BASE/" | grep -q '<div id="root">' || fail "index.html not served"

step "API is healthy"
curl -fsS "$API/health" | jq -e '.status == "ok"' >/dev/null || fail "health check"

step "Demo catalogue is seeded"
PRODUCT=$(curl -fsS "$API/products?pageSize=50" | jq '[.items[] | select(.stock >= 2)][0]')
[ "$PRODUCT" != "null" ] || fail "no product with stock"
PID=$(jq -r .id <<<"$PRODUCT")
STOCK_BEFORE=$(jq -r .stock <<<"$PRODUCT")
echo "product $PID, stock $STOCK_BEFORE"

step "Register a buyer"
USER="smoke$RANDOM$RANDOM"
TOKEN=$(curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"password123\"}" | jq -r .accessToken)
AUTH="Authorization: Bearer $TOKEN"

step "Place an order"
KEY=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
BODY="{\"items\":[{\"productId\":$PID,\"quantity\":2}]}"
CODE=$(curl -sS -o /tmp/order.json -w '%{http_code}' -X POST "$API/orders" -H "$AUTH" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY")
[ "$CODE" = 201 ] || { cat /tmp/order.json; fail "expected 201, got $CODE"; }
OID=$(jq -r .id /tmp/order.json)
echo "order $OID"

step "Retrying with the same key replays the same order"
CODE=$(curl -sS -o /tmp/replay.json -w '%{http_code}' -X POST "$API/orders" -H "$AUTH" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY")
[ "$CODE" = 200 ] || fail "expected 200 on replay, got $CODE"
[ "$(jq -r .id /tmp/replay.json)" = "$OID" ] || fail "replay returned a different order"

STOCK_AFTER=$(curl -fsS "$API/products/$PID" | jq -r .stock)
[ "$STOCK_AFTER" -eq $((STOCK_BEFORE - 2)) ] || fail "stock $STOCK_BEFORE -> $STOCK_AFTER, expected -2"

step "Pay"
curl -fsS -X POST "$API/orders/$OID/pay" -H "$AUTH" | jq -e '.status == "PAID"' >/dev/null || fail "pay"

step "Paying twice is rejected by the state machine"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/orders/$OID/pay" -H "$AUTH")
[ "$CODE" = 409 ] || fail "expected 409, got $CODE"

echo; echo "Smoke test passed."
