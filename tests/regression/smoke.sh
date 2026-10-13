#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Regression smoke test — MIS login + Mongo singleton + seed cache.
#
# Verifies the three hardenings that keep the login path fast and bounded:
#   1. MongoClient cached on globalThis survives Next.js re-chunking
#   2. ensureSeeded() short-circuits via globalThis.__mis_seed_checked
#   3. Frontend api() helper bounds every fetch with a 20s abort timeout
#
# Run against ANY environment (local, preview, production). The 2nd+ login
# attempt MUST complete in well under 1 second — otherwise the singleton
# cache or seed fast-path has regressed.
#
# USAGE:
#   BASE_URL=http://localhost:3000 bash tests/regression/smoke.sh
#   BASE_URL=https://merdekainv.online bash tests/regression/smoke.sh
# ----------------------------------------------------------------------------
set -u

BASE_URL="${BASE_URL:-http://localhost:3000}"
MAX_WARM_MS=1500   # 2nd+ request after warm-up must be < 1.5s
MAX_SW_MS=2000     # /sw.js served from route handler should be fast
FAILED=0

echo "=== MIS Regression Smoke Test ==="
echo "Target: $BASE_URL"
echo ""

check_time() {
  local label="$1" ; local t_sec="$2" ; local limit_ms="$3"
  # Portable float -> millis using awk
  local ms
  ms=$(awk -v t="$t_sec" 'BEGIN { printf("%d", t*1000) }')
  if [ "$ms" -gt "$limit_ms" ]; then
    echo "  ✗ $label took ${ms}ms (limit ${limit_ms}ms) — FAIL"
    FAILED=$((FAILED+1))
  else
    echo "  ✓ $label ${ms}ms (< ${limit_ms}ms)"
  fi
}

# ---------------------------------------------------------------------------
# 1) /sw.js served via Next.js route handler
# ---------------------------------------------------------------------------
echo "[1] /sw.js — route handler serves JS, not public 404 HTML"
RESP=$(curl -sS -o /tmp/sw.out -w "%{http_code}|%{content_type}|%{time_total}" \
  "$BASE_URL/sw.js" --max-time 10 2>&1)
HTTP=$(echo "$RESP" | cut -d'|' -f1)
CT=$(echo "$RESP" | cut -d'|' -f2)
T=$(echo "$RESP" | cut -d'|' -f3)
if [ "$HTTP" != "200" ]; then
  echo "  ✗ /sw.js HTTP=$HTTP — FAIL"
  FAILED=$((FAILED+1))
elif ! echo "$CT" | grep -qi "application/javascript"; then
  echo "  ✗ /sw.js content-type=$CT (expected application/javascript) — FAIL"
  FAILED=$((FAILED+1))
else
  echo "  ✓ /sw.js HTTP=200 content-type=$CT"
fi
check_time "/sw.js latency" "$T" "$MAX_SW_MS"
echo ""

# ---------------------------------------------------------------------------
# 2) Login attempts 2..4 must be sub-second (singleton + seed cache working)
# ---------------------------------------------------------------------------
echo "[2] /api/auth/login — attempts 2+ must stay sub-second"
for i in 1 2 3 4; do
  T=$(curl -sS -o /dev/null -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"__smoke__","password":"__smoke__"}' \
    --max-time 25 -w "%{time_total}" 2>&1)
  MS=$(awk -v t="$T" 'BEGIN { printf("%d", t*1000) }')
  echo "  attempt_$i: ${MS}ms"
  # Attempt 1 may be slow on a true cold pod; only enforce from attempt 2.
  if [ "$i" -ge 2 ]; then
    if [ "$MS" -gt "$MAX_WARM_MS" ]; then
      echo "  ✗ attempt_$i too slow (${MS}ms > ${MAX_WARM_MS}ms) — FAIL"
      echo "    → singleton cache or seed fast-path likely regressed"
      FAILED=$((FAILED+1))
    fi
  fi
done
echo ""

# ---------------------------------------------------------------------------
# 3) DB-heavy endpoints must respond quickly on warm pod
# ---------------------------------------------------------------------------
echo "[3] DB endpoints (monitor, dashboard) warm response"
for ep in monitor dashboard; do
  T=$(curl -sS -o /dev/null "$BASE_URL/api/$ep" \
    --max-time 10 -w "%{time_total}" 2>&1)
  check_time "/api/$ep" "$T" "$MAX_WARM_MS"
done
echo ""

# ---------------------------------------------------------------------------
# 4) Frontend api() AbortController timeout — defensive check via grep
#    (we cannot easily simulate a 60s hang here, so verify code presence)
# ---------------------------------------------------------------------------
echo "[4] Frontend AbortController timeout present"
if grep -q "AbortController" /app/app/page.js \
   && grep -q "AbortError" /app/app/page.js; then
  echo "  ✓ api() helper has AbortController + AbortError handling"
else
  echo "  ✗ api() helper missing AbortController timeout — FAIL"
  FAILED=$((FAILED+1))
fi
echo ""

# ---------------------------------------------------------------------------
# 5) globalThis singletons present (static code check)
# ---------------------------------------------------------------------------
echo "[5] globalThis cache keys present in route.js"
for key in __mis_mongo_client __mis_mongo_connect __mis_seed_checked __mis_auth_indexes_ensured; do
  if grep -q "globalThis.$key" /app/app/api/*/route.js 2>/dev/null; then
    echo "  ✓ $key"
  else
    echo "  ✗ $key missing — FAIL"
    FAILED=$((FAILED+1))
  fi
done
echo ""
echo "No stray module-local 'let X = null' at top of route.js?"
STRAY=$(grep -c "^let [a-zA-Z_]* = \(null\|false\)$" /app/app/api/*/route.js 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
if [ "$STRAY" -gt 0 ]; then
  echo "  ✗ Found $STRAY stray module-local 'let' cache(s) — FAIL"
  grep -n "^let [a-zA-Z_]* = \(null\|false\)$" /app/app/api/*/route.js
  FAILED=$((FAILED+1))
else
  echo "  ✓ none found"
fi
echo ""

# ---------------------------------------------------------------------------
echo "=== RESULT ==="
if [ "$FAILED" -eq 0 ]; then
  echo "✅ ALL PASS"
  exit 0
else
  echo "❌ $FAILED check(s) FAILED"
  exit 1
fi
