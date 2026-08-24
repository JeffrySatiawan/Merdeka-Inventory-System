#!/usr/bin/env python3
"""
Backend test for Absensi module permission changes (2026-02).
Verifies that Absensi access is now per-employee (not global-universal).

Test plan (11 cases):
1. GET /api/employees as owner → find cindy's employee record; capture id, note current modules array
2. GET /api/auth/me as cindy → user.modules MUST include 'faktur' and MUST NOT include 'absensi'
3. GET /api/absensi/settings as cindy → HTTP 403 with error text containing "belum diaktifkan"
4. GET /api/absensi/today as cindy → HTTP 403
5. POST /api/absensi/check-in as cindy → HTTP 403
6. GET /api/absensi/settings as owner → HTTP 200 (owner unaffected)
7. GET /api/absensi/dashboard as owner → HTTP 200
8. Grant cindy the absensi module: PATCH /api/employees/<id> with body { modules: [...existing, 'absensi'] }
9. Re-login as cindy → user.modules must now include 'absensi' (and still 'faktur')
10. GET /api/absensi/settings as cindy (with new token) → HTTP 200
11. Regression: GET /api/om/dashboard, /api/dashboard, /api/faktur — all 200 for both owner and staff

Cleanup: Restore cindy's original modules, verify 403 again
"""

import requests
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

# Credentials
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"
STAFF_USERNAME = "cindy"
STAFF_PASSWORD = "cindy123"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            log(f"✅ Login successful for {username} (token: {token[:20]}...)")
            return token
        else:
            log(f"❌ Login failed for {username}: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ Login exception for {username}: {e}")
        return None

def test_absensi_permission():
    """Run all 11 test cases"""
    
    log("=" * 80)
    log("ABSENSI PERMISSION TEST — 11 CASES")
    log("=" * 80)
    
    passed = 0
    failed = 0
    
    # ========== CASE 1: GET /api/employees as owner → find cindy ==========
    log("\n[CASE 1] GET /api/employees as owner → find cindy's employee record")
    try:
        owner_token = login(OWNER_USERNAME, OWNER_PASSWORD)
        if not owner_token:
            log("❌ CASE 1 FAILED: Owner login failed")
            return
        
        resp = requests.get(f"{BASE_URL}/api/employees", headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        if resp.status_code != 200:
            log(f"❌ CASE 1 FAILED: GET /api/employees returned {resp.status_code}")
            failed += 1
        else:
            data = resp.json()
            employees = data.get("items", []) if isinstance(data, dict) else data
            cindy = next((e for e in employees if e.get("username") == STAFF_USERNAME), None)
            if not cindy:
                log(f"❌ CASE 1 FAILED: Cindy not found in employees list")
                failed += 1
                return
            
            cindy_id = cindy.get("id")
            cindy_modules_original = cindy.get("modules", [])
            log(f"✅ CASE 1 PASSED: Found cindy (id={cindy_id}, modules={cindy_modules_original})")
            
            # Ensure cindy does NOT have 'absensi' in modules (starting state)
            if 'absensi' in cindy_modules_original:
                log(f"⚠️  WARNING: Cindy already has 'absensi' in modules. Removing it first...")
                # Remove absensi from cindy's modules to establish baseline
                modules_without_absensi = [m for m in cindy_modules_original if m != 'absensi']
                patch_resp = requests.put(
                    f"{BASE_URL}/api/employees/{cindy_id}",
                    headers={"Authorization": f"Bearer {owner_token}"},
                    json={"modules": modules_without_absensi},
                    timeout=10
                )
                if patch_resp.status_code == 200:
                    log(f"✅ Removed 'absensi' from cindy's modules. New modules: {modules_without_absensi}")
                    cindy_modules_original = modules_without_absensi
                else:
                    log(f"❌ Failed to remove 'absensi': {patch_resp.status_code} {patch_resp.text}")
                    failed += 1
                    return
            
            passed += 1
    except Exception as e:
        log(f"❌ CASE 1 EXCEPTION: {e}")
        failed += 1
        return
    
    # ========== CASE 2: GET /api/auth/me as cindy → modules check ==========
    log("\n[CASE 2] GET /api/auth/me as cindy → user.modules MUST include 'faktur' and MUST NOT include 'absensi'")
    try:
        cindy_token = login(STAFF_USERNAME, STAFF_PASSWORD)
        if not cindy_token:
            log("❌ CASE 2 FAILED: Cindy login failed")
            failed += 1
            return
        
        resp = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {cindy_token}"}, timeout=10)
        if resp.status_code != 200:
            log(f"❌ CASE 2 FAILED: GET /api/auth/me returned {resp.status_code}")
            failed += 1
        else:
            data = resp.json()
            user = data.get("user", data)  # Handle both {user: {...}} and {...} formats
            user_modules = user.get("modules", [])
            log(f"   Cindy's user.modules: {user_modules}")
            
            has_faktur = 'faktur' in user_modules
            has_absensi = 'absensi' in user_modules
            
            if has_faktur and not has_absensi:
                log(f"✅ CASE 2 PASSED: user.modules includes 'faktur' and does NOT include 'absensi'")
                passed += 1
            else:
                log(f"❌ CASE 2 FAILED: Expected 'faktur' in modules (got {has_faktur}), 'absensi' NOT in modules (got {has_absensi})")
                failed += 1
    except Exception as e:
        log(f"❌ CASE 2 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 3: GET /api/absensi/settings as cindy → 403 ==========
    log("\n[CASE 3] GET /api/absensi/settings as cindy → HTTP 403 with error text containing 'belum diaktifkan'")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers={"Authorization": f"Bearer {cindy_token}"}, timeout=10)
        if resp.status_code == 403:
            error_text = resp.text
            if "belum diaktifkan" in error_text:
                log(f"✅ CASE 3 PASSED: GET /api/absensi/settings → 403 with 'belum diaktifkan' in error")
                passed += 1
            else:
                log(f"❌ CASE 3 FAILED: Got 403 but error text missing 'belum diaktifkan': {error_text}")
                failed += 1
        else:
            log(f"❌ CASE 3 FAILED: Expected 403, got {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 3 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 4: GET /api/absensi/today as cindy → 403 ==========
    log("\n[CASE 4] GET /api/absensi/today as cindy → HTTP 403")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/today", headers={"Authorization": f"Bearer {cindy_token}"}, timeout=10)
        if resp.status_code == 403:
            log(f"✅ CASE 4 PASSED: GET /api/absensi/today → 403")
            passed += 1
        else:
            log(f"❌ CASE 4 FAILED: Expected 403, got {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 4 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 5: POST /api/absensi/check-in as cindy → 403 ==========
    log("\n[CASE 5] POST /api/absensi/check-in as cindy → HTTP 403")
    try:
        resp = requests.post(f"{BASE_URL}/api/absensi/check-in", headers={"Authorization": f"Bearer {cindy_token}"}, json={}, timeout=10)
        if resp.status_code == 403:
            log(f"✅ CASE 5 PASSED: POST /api/absensi/check-in → 403")
            passed += 1
        else:
            log(f"❌ CASE 5 FAILED: Expected 403, got {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 5 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 6: GET /api/absensi/settings as owner → 200 ==========
    log("\n[CASE 6] GET /api/absensi/settings as owner → HTTP 200 (owner unaffected)")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        if resp.status_code == 200:
            log(f"✅ CASE 6 PASSED: GET /api/absensi/settings as owner → 200")
            passed += 1
        else:
            log(f"❌ CASE 6 FAILED: Expected 200, got {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 6 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 7: GET /api/absensi/dashboard as owner → 200 ==========
    log("\n[CASE 7] GET /api/absensi/dashboard as owner → HTTP 200")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/dashboard", headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        if resp.status_code == 200:
            log(f"✅ CASE 7 PASSED: GET /api/absensi/dashboard as owner → 200")
            passed += 1
        else:
            log(f"❌ CASE 7 FAILED: Expected 200, got {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 7 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 8: Grant cindy the absensi module ==========
    log("\n[CASE 8] Grant cindy the absensi module: PUT /api/employees/<id> with modules=[...existing, 'absensi']")
    try:
        # Add 'absensi' to cindy's modules
        new_modules = cindy_modules_original + ['absensi']
        resp = requests.put(
            f"{BASE_URL}/api/employees/{cindy_id}",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"modules": new_modules},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            updated_employee = data.get("employee", data)  # Handle both {employee: {...}} and {...} formats
            updated_modules = updated_employee.get("modules", [])
            if 'absensi' in updated_modules:
                log(f"✅ CASE 8 PASSED: Granted 'absensi' to cindy. New modules: {updated_modules}")
                passed += 1
            else:
                log(f"❌ CASE 8 FAILED: 'absensi' not in updated modules: {updated_modules}")
                failed += 1
        else:
            log(f"❌ CASE 8 FAILED: PUT /api/employees/{cindy_id} returned {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 8 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 9: Re-login as cindy → user.modules must include 'absensi' ==========
    log("\n[CASE 9] Re-login as cindy → user.modules must now include 'absensi' (and still 'faktur')")
    try:
        cindy_token_new = login(STAFF_USERNAME, STAFF_PASSWORD)
        if not cindy_token_new:
            log("❌ CASE 9 FAILED: Cindy re-login failed")
            failed += 1
        else:
            resp = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {cindy_token_new}"}, timeout=10)
            if resp.status_code != 200:
                log(f"❌ CASE 9 FAILED: GET /api/auth/me returned {resp.status_code}")
                failed += 1
            else:
                data = resp.json()
                user = data.get("user", data)  # Handle both {user: {...}} and {...} formats
                user_modules = user.get("modules", [])
                log(f"   Cindy's user.modules after grant: {user_modules}")
                
                has_faktur = 'faktur' in user_modules
                has_absensi = 'absensi' in user_modules
                
                if has_faktur and has_absensi:
                    log(f"✅ CASE 9 PASSED: user.modules includes both 'faktur' and 'absensi'")
                    passed += 1
                else:
                    log(f"❌ CASE 9 FAILED: Expected both 'faktur' and 'absensi' in modules. Got: {user_modules}")
                    failed += 1
    except Exception as e:
        log(f"❌ CASE 9 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 10: GET /api/absensi/settings as cindy (with new token) → 200 ==========
    log("\n[CASE 10] GET /api/absensi/settings as cindy (with new token) → HTTP 200")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers={"Authorization": f"Bearer {cindy_token_new}"}, timeout=10)
        if resp.status_code == 200:
            log(f"✅ CASE 10 PASSED: GET /api/absensi/settings as cindy → 200")
            passed += 1
        else:
            log(f"❌ CASE 10 FAILED: Expected 200, got {resp.status_code}")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 10 EXCEPTION: {e}")
        failed += 1
    
    # ========== CASE 11: Regression tests ==========
    log("\n[CASE 11] Regression: GET /api/om/dashboard, /api/dashboard, /api/faktur — all 200 for both owner and staff")
    try:
        regression_passed = 0
        regression_failed = 0
        
        # Test owner
        endpoints = [
            ("/api/om/dashboard", "OM Dashboard"),
            ("/api/dashboard", "CC Dashboard"),
            ("/api/faktur", "Faktur")
        ]
        
        for endpoint, name in endpoints:
            resp = requests.get(f"{BASE_URL}{endpoint}", headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
            if resp.status_code == 200:
                log(f"   ✅ Owner: GET {endpoint} → 200")
                regression_passed += 1
            else:
                log(f"   ❌ Owner: GET {endpoint} → {resp.status_code}")
                regression_failed += 1
        
        # Test staff (cindy with new token)
        for endpoint, name in endpoints:
            resp = requests.get(f"{BASE_URL}{endpoint}", headers={"Authorization": f"Bearer {cindy_token_new}"}, timeout=10)
            if resp.status_code == 200:
                log(f"   ✅ Cindy: GET {endpoint} → 200")
                regression_passed += 1
            else:
                log(f"   ❌ Cindy: GET {endpoint} → {resp.status_code}")
                regression_failed += 1
        
        if regression_failed == 0:
            log(f"✅ CASE 11 PASSED: All regression tests passed ({regression_passed}/6)")
            passed += 1
        else:
            log(f"❌ CASE 11 FAILED: {regression_failed} regression tests failed")
            failed += 1
    except Exception as e:
        log(f"❌ CASE 11 EXCEPTION: {e}")
        failed += 1
    
    # ========== CLEANUP: Restore cindy's original modules ==========
    log("\n[CLEANUP] Restore cindy's original modules (remove 'absensi')")
    try:
        resp = requests.put(
            f"{BASE_URL}/api/employees/{cindy_id}",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"modules": cindy_modules_original},
            timeout=10
        )
        if resp.status_code == 200:
            log(f"✅ CLEANUP: Restored cindy's modules to {cindy_modules_original}")
            
            # Verify 403 again
            cindy_token_final = login(STAFF_USERNAME, STAFF_PASSWORD)
            resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers={"Authorization": f"Bearer {cindy_token_final}"}, timeout=10)
            if resp.status_code == 403:
                log(f"✅ CLEANUP VERIFIED: GET /api/absensi/settings as cindy → 403 (permission revoked)")
            else:
                log(f"⚠️  CLEANUP WARNING: Expected 403, got {resp.status_code}")
        else:
            log(f"⚠️  CLEANUP WARNING: Failed to restore modules: {resp.status_code}")
    except Exception as e:
        log(f"⚠️  CLEANUP EXCEPTION: {e}")
    
    # ========== SUMMARY ==========
    log("\n" + "=" * 80)
    log(f"ABSENSI PERMISSION TEST COMPLETE")
    log(f"PASSED: {passed}/11")
    log(f"FAILED: {failed}/11")
    log("=" * 80)
    
    if failed == 0:
        log("✅ ALL TESTS PASSED — Absensi permission gating working correctly")
        return 0
    else:
        log(f"❌ {failed} TESTS FAILED — See details above")
        return 1

if __name__ == "__main__":
    sys.exit(test_absensi_permission())
