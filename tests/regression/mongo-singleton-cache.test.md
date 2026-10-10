# Regression Test — Mongo Singleton + Seed Cache (globalThis)

## Context
In Next.js server bundles, modules can be **duplicated across route chunks**
(especially after adding a new route like `/sw.js/route.js`). A `let`
module-local cache then exists **per chunk**, so each cold chunk re-runs:

- `new MongoClient().connect()` → Atlas DNS SRV + TLS + topology handshake
- `ensureSeeded(db)` → full `employees.find({modules:{$exists:false}})` scan

In production this causes login to take **12-20 seconds** and
`/api/monitor`, `/api/dashboard` to **timeout**, even though all code and
data are healthy. See `/app/deployer-agent-docs/RCA_726c2b7c-*.MD`.

## Fix (do NOT revert without reading this first)
In `/app/app/api/[[...path]]/route.js`:

1. **MongoClient** cached on `globalThis.__mis_mongo_client` (singleton
   survives Next.js re-chunking).
2. **Connect promise** cached on `globalThis.__mis_mongo_connect` (concurrent
   cold requests share the same handshake).
3. **Pre-warm pool**: `minPoolSize: 1`, `maxPoolSize: 10`.
4. **Seed check** cached on `globalThis.__mis_seed_checked` (same reason).
5. **Fast-path in `ensureSeeded`**: after `_meta.seed.done === true` is
   detected, SKIP the `employees` migration scan (which has no supporting
   index — the `{$exists:false}` predicate is a full collection scan).
6. **Auth indexes flag** on `globalThis.__mis_auth_indexes_ensured`.

## Smoke test (manual, after any deploy)

Run this against the production URL — the 2nd+ requests MUST complete in
well under 1 second. If any attempt > 2s on a warmed-up pod, singleton
caching has regressed.

```bash
# login — attempt_1 may be cold (<1s on warm pod, <3s on fresh pod)
# attempt_2..4 MUST be sub-second
for i in 1 2 3 4; do
  curl -sS -o /dev/null -X POST \
    "https://merdekainv.online/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"x","password":"y"}' \
    --max-time 10 \
    -w "attempt_$i HTTP:%{http_code} time:%{time_total}s\n"
done

# monitor + dashboard — must respond in <2s
curl -sS -o /dev/null "https://merdekainv.online/api/monitor" \
  -w "monitor HTTP:%{http_code} time:%{time_total}s\n" --max-time 5
curl -sS -o /dev/null "https://merdekainv.online/api/dashboard" \
  -w "dashboard HTTP:%{http_code} time:%{time_total}s\n" --max-time 5
```

### Pass criteria
- All HTTP codes expected (401 for login w/ wrong creds, 200 for me/monitor
  when authed, 401 for monitor when unauthed, etc.)
- attempt_2..4 login: **time_total < 1s** (ideally <100ms)
- monitor + dashboard: **< 2s** on warm pod

### Fail symptom (triggers investigation)
- attempt_2..4 login time stays > 2s → singleton cache broken (new `let` cache
  added somewhere, or `globalThis` key renamed, or Next.js build moved to a
  mode that nukes globalThis per request)
- Any endpoint times out (15s+) → regression; check this file first, then
  `getDb()` + `ensureSeeded()` in `app/api/[[...path]]/route.js`.

## Known tripwires
- Never add `let X = null; async function Y() { if(!X){ X = ... }}` at
  module scope — always use `globalThis.__mis_X`.
- Adding a brand-new route handler (like `/sw.js/route.js`) can re-chunk
  modules → re-run this smoke test after any such addition.
- Never call `new MongoClient()` outside `getDb()`.
- `ensureSeeded` MUST short-circuit on `globalThis.__mis_seed_checked` or
  `_meta.seed.done === true` BEFORE touching `employees`.
