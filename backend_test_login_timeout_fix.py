#!/usr/bin/env python3
"""
Backend Test: Login Timeout Production Fix Verification
========================================================
Tests the 3 fixes applied to resolve HTTP 524 gateway timeout on login:
1. Login Index: ensureAuthIndexes(db) creates employees.username + sessions.token indexes
2. MongoDB timeout: serverSelectionTimeoutMS + connectTimeoutMS = 10s (fail-fast)
3. Seed single-run: ensureSeeded(db) gated by _seedChecked flag (no repeated DB reads)

Test Scenarios:
1. Login Owner — happy path (owner/owner123)
2. Login staff — happy path (cindy/cindy123)
3. Login invalid credentials (wrong username, wrong password, missing fields)
4. /api/auth/me with issued owner token
5. Latency check (5 consecutive logins, measure response times)
6. No regression — pre-existing endpoints (dashboard, payroll, tj, absensi)
7. Startup sanity (double login in quick succession)
8. Session validity (logout test)
9. Existing users data integrity (compare user data before/after)
"""

import requests
import time
import json
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login(username, password):
    """Helper to login and return (status_code, response_json, elapsed_ms)"""
    start = time.time()
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": username, "password": password},
            timeout=15
        )
        elapsed_ms = (time.time() - start) * 1000
        # Try to parse JSON regardless of status code (API returns JSON for errors too)
        try:
            data = resp.json()
        except:
            data = {"error": resp.text}
        return resp.status_code, data, elapsed_ms
    except requests.exceptions.Timeout:
        elapsed_ms = (time.time() - start) * 1000
        return 524, {"error": "Request timeout"}, elapsed_ms
    except Exception as e:
        elapsed_ms = (time.time() - start) * 1000
        return 500, {"error": str(e)}, elapsed_ms

def main():
    print("=" * 80)
    print("BACKEND TEST: Login Timeout Production Fix Verification")
    print("=" * 80)
    print()

    # Store test results
    results = {
        "passed": 0,
        "failed": 0,
        "tests": []
    }

    # ========================================================================
    # TEST 1: Login Owner — happy path
    # ========================================================================
    log("TEST 1: Login Owner — happy path (owner/owner123)")
    try:
        status, data, elapsed = test_login("owner", "owner123")
        if status == 200:
            if "token" in data and "user" in data:
                user = data["user"]
                if user.get("role") == "owner" and user.get("username") == "owner":
                    log(f"✅ PASS: Owner login successful in {elapsed:.0f}ms")
                    log(f"   Token: {data['token'][:20]}...")
                    log(f"   User: {user.get('name')} (role={user.get('role')})")
                    log(f"   Modules: {user.get('modules')}")
                    results["passed"] += 1
                    results["tests"].append({"test": "Owner login happy path", "status": "PASS", "elapsed_ms": elapsed})
                    # Store owner token for later tests
                    owner_token = data["token"]
                    owner_user = user
                else:
                    log(f"❌ FAIL: Owner login returned wrong user data")
                    log(f"   Expected role='owner', got role='{user.get('role')}'")
                    results["failed"] += 1
                    results["tests"].append({"test": "Owner login happy path", "status": "FAIL", "reason": "Wrong user data"})
                    owner_token = None
                    owner_user = None
            else:
                log(f"❌ FAIL: Owner login missing token or user in response")
                log(f"   Response: {data}")
                results["failed"] += 1
                results["tests"].append({"test": "Owner login happy path", "status": "FAIL", "reason": "Missing token/user"})
                owner_token = None
                owner_user = None
        else:
            log(f"❌ FAIL: Owner login returned status {status}")
            log(f"   Response: {data}")
            results["failed"] += 1
            results["tests"].append({"test": "Owner login happy path", "status": "FAIL", "reason": f"Status {status}"})
            owner_token = None
            owner_user = None
    except Exception as e:
        log(f"❌ FAIL: Owner login exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Owner login happy path", "status": "FAIL", "reason": str(e)})
        owner_token = None
        owner_user = None
    print()

    # ========================================================================
    # TEST 2: Login staff — happy path
    # ========================================================================
    log("TEST 2: Login staff — happy path (cindy/cindy123)")
    try:
        status, data, elapsed = test_login("cindy", "cindy123")
        if status == 200:
            if "token" in data and "user" in data:
                user = data["user"]
                if user.get("role") == "staff" and user.get("username") == "cindy":
                    log(f"✅ PASS: Staff login successful in {elapsed:.0f}ms")
                    log(f"   Token: {data['token'][:20]}...")
                    log(f"   User: {user.get('name')} (role={user.get('role')})")
                    log(f"   Modules: {user.get('modules')}")
                    if "modules" in user and isinstance(user["modules"], list):
                        log(f"   ✓ Modules array present with {len(user['modules'])} items")
                    results["passed"] += 1
                    results["tests"].append({"test": "Staff login happy path", "status": "PASS", "elapsed_ms": elapsed})
                    cindy_token = data["token"]
                    cindy_user = user
                else:
                    log(f"❌ FAIL: Staff login returned wrong user data")
                    log(f"   Expected role='staff', got role='{user.get('role')}'")
                    results["failed"] += 1
                    results["tests"].append({"test": "Staff login happy path", "status": "FAIL", "reason": "Wrong user data"})
                    cindy_token = None
                    cindy_user = None
            else:
                log(f"❌ FAIL: Staff login missing token or user in response")
                log(f"   Response: {data}")
                results["failed"] += 1
                results["tests"].append({"test": "Staff login happy path", "status": "FAIL", "reason": "Missing token/user"})
                cindy_token = None
                cindy_user = None
        else:
            log(f"❌ FAIL: Staff login returned status {status}")
            log(f"   Response: {data}")
            results["failed"] += 1
            results["tests"].append({"test": "Staff login happy path", "status": "FAIL", "reason": f"Status {status}"})
            cindy_token = None
            cindy_user = None
    except Exception as e:
        log(f"❌ FAIL: Staff login exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Staff login happy path", "status": "FAIL", "reason": str(e)})
        cindy_token = None
        cindy_user = None
    print()

    # ========================================================================
    # TEST 3: Login invalid credentials
    # ========================================================================
    log("TEST 3: Login invalid credentials")
    
    # 3a: Wrong username
    log("  3a: Wrong username")
    try:
        status, data, elapsed = test_login("nonexistent_user", "password123")
        if status == 401:
            if isinstance(data, dict) and "error" in data:
                if "tidak ditemukan" in data["error"].lower():
                    log(f"  ✅ PASS: Wrong username correctly returns 401 'User tidak ditemukan'")
                    results["passed"] += 1
                    results["tests"].append({"test": "Invalid credentials - wrong username", "status": "PASS"})
                else:
                    log(f"  ❌ FAIL: Wrong username returns 401 but wrong error message")
                    log(f"     Expected 'User tidak ditemukan', got '{data.get('error')}'")
                    results["failed"] += 1
                    results["tests"].append({"test": "Invalid credentials - wrong username", "status": "FAIL", "reason": "Wrong error message"})
            else:
                log(f"  ❌ FAIL: Wrong username returns 401 but no error field")
                results["failed"] += 1
                results["tests"].append({"test": "Invalid credentials - wrong username", "status": "FAIL", "reason": "No error field"})
        else:
            log(f"  ❌ FAIL: Wrong username returned status {status} (expected 401)")
            log(f"     Response: {data}")
            results["failed"] += 1
            results["tests"].append({"test": "Invalid credentials - wrong username", "status": "FAIL", "reason": f"Status {status}"})
    except Exception as e:
        log(f"  ❌ FAIL: Wrong username exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Invalid credentials - wrong username", "status": "FAIL", "reason": str(e)})

    # 3b: Wrong password
    log("  3b: Wrong password")
    try:
        status, data, elapsed = test_login("owner", "wrongpassword")
        if status == 401:
            if isinstance(data, dict) and "error" in data:
                if "password salah" in data["error"].lower():
                    log(f"  ✅ PASS: Wrong password correctly returns 401 'Password salah'")
                    results["passed"] += 1
                    results["tests"].append({"test": "Invalid credentials - wrong password", "status": "PASS"})
                else:
                    log(f"  ❌ FAIL: Wrong password returns 401 but wrong error message")
                    log(f"     Expected 'Password salah', got '{data.get('error')}'")
                    results["failed"] += 1
                    results["tests"].append({"test": "Invalid credentials - wrong password", "status": "FAIL", "reason": "Wrong error message"})
            else:
                log(f"  ❌ FAIL: Wrong password returns 401 but no error field")
                results["failed"] += 1
                results["tests"].append({"test": "Invalid credentials - wrong password", "status": "FAIL", "reason": "No error field"})
        else:
            log(f"  ❌ FAIL: Wrong password returned status {status} (expected 401)")
            log(f"     Response: {data}")
            results["failed"] += 1
            results["tests"].append({"test": "Invalid credentials - wrong password", "status": "FAIL", "reason": f"Status {status}"})
    except Exception as e:
        log(f"  ❌ FAIL: Wrong password exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Invalid credentials - wrong password", "status": "FAIL", "reason": str(e)})

    # 3c: Missing fields
    log("  3c: Missing fields")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={}, timeout=10)
        if resp.status_code == 400:
            data = resp.json() if resp.ok or resp.headers.get('content-type', '').startswith('application/json') else {}
            if "error" in data and "required" in data["error"].lower():
                log(f"  ✅ PASS: Missing fields correctly returns 400 with 'required' error")
                results["passed"] += 1
                results["tests"].append({"test": "Invalid credentials - missing fields", "status": "PASS"})
            else:
                log(f"  ❌ FAIL: Missing fields returns 400 but wrong error message")
                log(f"     Response: {data}")
                results["failed"] += 1
                results["tests"].append({"test": "Invalid credentials - missing fields", "status": "FAIL", "reason": "Wrong error message"})
        else:
            log(f"  ❌ FAIL: Missing fields returned status {resp.status_code} (expected 400)")
            results["failed"] += 1
            results["tests"].append({"test": "Invalid credentials - missing fields", "status": "FAIL", "reason": f"Status {resp.status_code}"})
    except Exception as e:
        log(f"  ❌ FAIL: Missing fields exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Invalid credentials - missing fields", "status": "FAIL", "reason": str(e)})
    print()

    # ========================================================================
    # TEST 4: /api/auth/me with issued owner token
    # ========================================================================
    log("TEST 4: /api/auth/me with issued owner token")
    if owner_token:
        try:
            resp = requests.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Authorization": f"Bearer {owner_token}"},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                if "user" in data:
                    user = data["user"]
                    if user.get("role") == "owner" and user.get("username") == "owner":
                        log(f"✅ PASS: /api/auth/me returns correct owner user")
                        log(f"   User: {user.get('name')} (role={user.get('role')})")
                        log(f"   Modules: {user.get('modules')}")
                        if "modules" in user and isinstance(user["modules"], list):
                            log(f"   ✓ Effective modules populated ({len(user['modules'])} items)")
                        results["passed"] += 1
                        results["tests"].append({"test": "/api/auth/me with owner token", "status": "PASS"})
                    else:
                        log(f"❌ FAIL: /api/auth/me returned wrong user")
                        log(f"   Expected owner, got {user}")
                        results["failed"] += 1
                        results["tests"].append({"test": "/api/auth/me with owner token", "status": "FAIL", "reason": "Wrong user"})
                else:
                    log(f"❌ FAIL: /api/auth/me missing user in response")
                    log(f"   Response: {data}")
                    results["failed"] += 1
                    results["tests"].append({"test": "/api/auth/me with owner token", "status": "FAIL", "reason": "Missing user"})
            else:
                log(f"❌ FAIL: /api/auth/me returned status {resp.status_code}")
                log(f"   Response: {resp.text}")
                results["failed"] += 1
                results["tests"].append({"test": "/api/auth/me with owner token", "status": "FAIL", "reason": f"Status {resp.status_code}"})
        except Exception as e:
            log(f"❌ FAIL: /api/auth/me exception: {e}")
            results["failed"] += 1
            results["tests"].append({"test": "/api/auth/me with owner token", "status": "FAIL", "reason": str(e)})
    else:
        log("⚠️  SKIP: No owner token available (TEST 1 failed)")
        results["tests"].append({"test": "/api/auth/me with owner token", "status": "SKIP", "reason": "No owner token"})
    print()

    # ========================================================================
    # TEST 5: Latency check (5 consecutive logins)
    # ========================================================================
    log("TEST 5: Latency check (5 consecutive owner logins)")
    latencies = []
    try:
        for i in range(5):
            status, data, elapsed = test_login("owner", "owner123")
            if status == 200:
                latencies.append(elapsed)
                log(f"  Login {i+1}: {elapsed:.0f}ms ✓")
            else:
                log(f"  Login {i+1}: FAILED (status {status})")
                latencies.append(None)
        
        valid_latencies = [l for l in latencies if l is not None]
        if len(valid_latencies) == 5:
            median = sorted(valid_latencies)[2]
            max_latency = max(valid_latencies)
            min_latency = min(valid_latencies)
            avg_latency = sum(valid_latencies) / len(valid_latencies)
            
            log(f"✅ PASS: All 5 logins successful")
            log(f"   Min: {min_latency:.0f}ms, Max: {max_latency:.0f}ms, Median: {median:.0f}ms, Avg: {avg_latency:.0f}ms")
            
            # Informational checks (not strict assertions)
            if median < 500:
                log(f"   ✓ Median latency under 500ms (good)")
            else:
                log(f"   ⚠️  Median latency over 500ms (informational, not a failure)")
            
            if max_latency < 2000:
                log(f"   ✓ Max latency under 2s (good)")
            else:
                log(f"   ⚠️  Max latency over 2s (informational, not a failure)")
            
            if max_latency > 10000:
                log(f"   ⚠️  WARNING: Max latency over 10s (possible DB timeout issue)")
            
            results["passed"] += 1
            results["tests"].append({
                "test": "Latency check (5 consecutive logins)",
                "status": "PASS",
                "latencies_ms": valid_latencies,
                "median_ms": median,
                "max_ms": max_latency,
                "min_ms": min_latency,
                "avg_ms": avg_latency
            })
        else:
            log(f"❌ FAIL: Only {len(valid_latencies)}/5 logins successful")
            results["failed"] += 1
            results["tests"].append({
                "test": "Latency check (5 consecutive logins)",
                "status": "FAIL",
                "reason": f"Only {len(valid_latencies)}/5 successful"
            })
    except Exception as e:
        log(f"❌ FAIL: Latency check exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Latency check (5 consecutive logins)", "status": "FAIL", "reason": str(e)})
    print()

    # ========================================================================
    # TEST 6: No regression — pre-existing endpoints
    # ========================================================================
    log("TEST 6: No regression — pre-existing endpoints")
    if owner_token:
        endpoints = [
            ("GET /api/om/dashboard", f"{BASE_URL}/api/om/dashboard"),
            ("GET /api/payroll/cycles", f"{BASE_URL}/api/payroll/cycles"),
            ("GET /api/tj/compounding", f"{BASE_URL}/api/tj/compounding"),
            ("GET /api/absensi/dashboard", f"{BASE_URL}/api/absensi/dashboard"),
        ]
        
        regression_passed = 0
        regression_failed = 0
        
        for name, url in endpoints:
            try:
                resp = requests.get(
                    url,
                    headers={"Authorization": f"Bearer {owner_token}"},
                    timeout=10
                )
                if resp.status_code == 200:
                    log(f"  ✅ {name} → 200")
                    regression_passed += 1
                else:
                    log(f"  ❌ {name} → {resp.status_code}")
                    log(f"     Response: {resp.text[:200]}")
                    regression_failed += 1
            except Exception as e:
                log(f"  ❌ {name} → Exception: {e}")
                regression_failed += 1
        
        if regression_failed == 0:
            log(f"✅ PASS: All {regression_passed} pre-existing endpoints working")
            results["passed"] += 1
            results["tests"].append({"test": "No regression - pre-existing endpoints", "status": "PASS", "endpoints_tested": regression_passed})
        else:
            log(f"❌ FAIL: {regression_failed}/{len(endpoints)} endpoints failed")
            results["failed"] += 1
            results["tests"].append({"test": "No regression - pre-existing endpoints", "status": "FAIL", "reason": f"{regression_failed} endpoints failed"})
    else:
        log("⚠️  SKIP: No owner token available (TEST 1 failed)")
        results["tests"].append({"test": "No regression - pre-existing endpoints", "status": "SKIP", "reason": "No owner token"})
    print()

    # ========================================================================
    # TEST 7: Startup sanity (double login in quick succession)
    # ========================================================================
    log("TEST 7: Startup sanity (double login in quick succession)")
    try:
        # First login
        status1, data1, elapsed1 = test_login("owner", "owner123")
        # Immediate second login (no delay)
        status2, data2, elapsed2 = test_login("owner", "owner123")
        
        if status1 == 200 and status2 == 200:
            log(f"✅ PASS: Both logins successful")
            log(f"   First login: {elapsed1:.0f}ms")
            log(f"   Second login: {elapsed2:.0f}ms")
            log(f"   ✓ No double index creation failure")
            results["passed"] += 1
            results["tests"].append({"test": "Startup sanity (double login)", "status": "PASS", "elapsed1_ms": elapsed1, "elapsed2_ms": elapsed2})
        else:
            log(f"❌ FAIL: One or both logins failed")
            log(f"   First login: status {status1}")
            log(f"   Second login: status {status2}")
            results["failed"] += 1
            results["tests"].append({"test": "Startup sanity (double login)", "status": "FAIL", "reason": f"Status {status1}/{status2}"})
    except Exception as e:
        log(f"❌ FAIL: Double login exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Startup sanity (double login)", "status": "FAIL", "reason": str(e)})
    print()

    # ========================================================================
    # TEST 8: Session validity (logout test)
    # ========================================================================
    log("TEST 8: Session validity (logout test)")
    if owner_token:
        try:
            # First, verify token works with /api/auth/me
            resp1 = requests.get(
                f"{BASE_URL}/api/auth/me",
                headers={"Authorization": f"Bearer {owner_token}"},
                timeout=10
            )
            if resp1.status_code == 200:
                log(f"  ✓ Token valid before logout (200)")
                
                # Logout
                resp2 = requests.post(
                    f"{BASE_URL}/api/auth/logout",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    timeout=10
                )
                if resp2.status_code == 200:
                    log(f"  ✓ Logout successful (200)")
                    
                    # Try to use token after logout (should fail with 401)
                    resp3 = requests.get(
                        f"{BASE_URL}/api/auth/me",
                        headers={"Authorization": f"Bearer {owner_token}"},
                        timeout=10
                    )
                    if resp3.status_code == 401:
                        log(f"  ✓ Token invalid after logout (401)")
                        log(f"✅ PASS: Session validity test passed")
                        results["passed"] += 1
                        results["tests"].append({"test": "Session validity (logout test)", "status": "PASS"})
                    else:
                        log(f"  ❌ Token still valid after logout (status {resp3.status_code})")
                        log(f"❌ FAIL: Session not deleted on logout")
                        results["failed"] += 1
                        results["tests"].append({"test": "Session validity (logout test)", "status": "FAIL", "reason": "Token still valid after logout"})
                else:
                    log(f"  ❌ Logout failed (status {resp2.status_code})")
                    log(f"❌ FAIL: Logout endpoint failed")
                    results["failed"] += 1
                    results["tests"].append({"test": "Session validity (logout test)", "status": "FAIL", "reason": f"Logout status {resp2.status_code}"})
            else:
                log(f"  ❌ Token invalid before logout (status {resp1.status_code})")
                log(f"❌ FAIL: Token not working before logout")
                results["failed"] += 1
                results["tests"].append({"test": "Session validity (logout test)", "status": "FAIL", "reason": "Token invalid before logout"})
        except Exception as e:
            log(f"❌ FAIL: Session validity exception: {e}")
            results["failed"] += 1
            results["tests"].append({"test": "Session validity (logout test)", "status": "FAIL", "reason": str(e)})
    else:
        log("⚠️  SKIP: No owner token available (TEST 1 failed)")
        results["tests"].append({"test": "Session validity (logout test)", "status": "SKIP", "reason": "No owner token"})
    print()

    # ========================================================================
    # TEST 9: Existing users data integrity
    # ========================================================================
    log("TEST 9: Existing users data integrity")
    try:
        # Login owner and cindy again to get fresh data
        status_owner, data_owner, _ = test_login("owner", "owner123")
        status_cindy, data_cindy, _ = test_login("cindy", "cindy123")
        
        if status_owner == 200 and status_cindy == 200:
            owner_new = data_owner["user"]
            cindy_new = data_cindy["user"]
            
            # Compare with data from TEST 1 and TEST 2
            integrity_ok = True
            
            # Owner checks
            if owner_user and owner_new.get("role") == owner_user.get("role") == "owner":
                log(f"  ✓ Owner role unchanged: {owner_new.get('role')}")
            else:
                log(f"  ❌ Owner role changed or missing")
                integrity_ok = False
            
            if owner_user and owner_new.get("name") == owner_user.get("name"):
                log(f"  ✓ Owner name unchanged: {owner_new.get('name')}")
            else:
                log(f"  ❌ Owner name changed")
                integrity_ok = False
            
            # Cindy checks
            if cindy_user and cindy_new.get("role") == cindy_user.get("role") == "staff":
                log(f"  ✓ Cindy role unchanged: {cindy_new.get('role')}")
            else:
                log(f"  ❌ Cindy role changed or missing")
                integrity_ok = False
            
            if cindy_user and cindy_new.get("name") == cindy_user.get("name"):
                log(f"  ✓ Cindy name unchanged: {cindy_new.get('name')}")
            else:
                log(f"  ❌ Cindy name changed")
                integrity_ok = False
            
            if cindy_user and cindy_new.get("modules") == cindy_user.get("modules"):
                log(f"  ✓ Cindy modules unchanged: {cindy_new.get('modules')}")
            else:
                log(f"  ⚠️  Cindy modules may have changed (could be due to withGlobalModules)")
                log(f"     Before: {cindy_user.get('modules') if cindy_user else 'N/A'}")
                log(f"     After: {cindy_new.get('modules')}")
                # Not marking as failure since withGlobalModules adds 'faktur' to all staff
            
            if integrity_ok:
                log(f"✅ PASS: User data integrity maintained")
                results["passed"] += 1
                results["tests"].append({"test": "Existing users data integrity", "status": "PASS"})
            else:
                log(f"❌ FAIL: User data integrity compromised")
                results["failed"] += 1
                results["tests"].append({"test": "Existing users data integrity", "status": "FAIL", "reason": "Data changed"})
        else:
            log(f"❌ FAIL: Could not re-login users for integrity check")
            log(f"   Owner status: {status_owner}, Cindy status: {status_cindy}")
            results["failed"] += 1
            results["tests"].append({"test": "Existing users data integrity", "status": "FAIL", "reason": "Re-login failed"})
    except Exception as e:
        log(f"❌ FAIL: Data integrity exception: {e}")
        results["failed"] += 1
        results["tests"].append({"test": "Existing users data integrity", "status": "FAIL", "reason": str(e)})
    print()

    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    total = results["passed"] + results["failed"]
    print(f"Total Tests: {total}")
    print(f"Passed: {results['passed']} ✅")
    print(f"Failed: {results['failed']} ❌")
    print(f"Success Rate: {(results['passed']/total*100) if total > 0 else 0:.1f}%")
    print()
    
    if results["failed"] == 0:
        print("🎉 ALL TESTS PASSED! Login timeout production fix is FULLY WORKING.")
    else:
        print("⚠️  SOME TESTS FAILED. Review the failures above.")
    
    print()
    print("Detailed Results:")
    for test in results["tests"]:
        status_icon = "✅" if test["status"] == "PASS" else "❌" if test["status"] == "FAIL" else "⚠️"
        print(f"  {status_icon} {test['test']}: {test['status']}")
        if "reason" in test:
            print(f"     Reason: {test['reason']}")
        if "elapsed_ms" in test:
            print(f"     Elapsed: {test['elapsed_ms']:.0f}ms")
        if "latencies_ms" in test:
            print(f"     Latencies: {[f'{l:.0f}ms' for l in test['latencies_ms']]}")
            print(f"     Median: {test['median_ms']:.0f}ms, Max: {test['max_ms']:.0f}ms")
    
    print()
    print("=" * 80)
    
    # Return exit code
    return 0 if results["failed"] == 0 else 1

if __name__ == "__main__":
    exit(main())
