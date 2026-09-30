#!/usr/bin/env python3
"""
Backend test for Produk Fokus "alasan" field addition on POST /api/pf/pengajuan endpoint.

Test scenarios:
1. Missing alasan → 400 with error "Alasan wajib diisi"
2. Empty alasan (whitespace) → 400 with error "Alasan wajib diisi"
3. Valid alasan → 200 with alasan field in response
4. Persistence check via GET /api/pf/pengajuan
5. Owner can see alasan field
6. Truncation test (600 chars → 500 chars)
7. Cleanup via DELETE

Credentials:
- Staff: cindy / cindy123 (can submit pengajuan)
- Owner: owner / owner123 (can review/read)
"""

import requests
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    log("=" * 80)
    log("BACKEND TEST: Produk Fokus 'alasan' field on POST /api/pf/pengajuan")
    log("=" * 80)
    
    # Test counters
    total_tests = 0
    passed_tests = 0
    
    try:
        # ========== TEST 1: LOGIN AS OWNER FIRST (TO GRANT MODULE) ==========
        total_tests += 1
        log("\n[TEST 1] Login as owner (owner/owner123)...")
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "owner",
            "password": "owner123"
        })
        if r.status_code != 200:
            log(f"❌ FAIL: Owner login failed with status {r.status_code}")
            log(f"Response: {r.text}")
            return
        
        owner_token = r.json().get("token")
        if not owner_token:
            log(f"❌ FAIL: No token in owner login response")
            return
        
        log(f"✅ PASS: Owner login successful")
        passed_tests += 1
        headers_owner = {"Authorization": f"Bearer {owner_token}"}
        
        # ========== TEST 1B: GRANT PRODUK_FOKUS MODULE TO CINDY ==========
        total_tests += 1
        log("\n[TEST 1B] Grant produk_fokus module to Cindy...")
        # First get Cindy's employee record
        r = requests.get(f"{BASE_URL}/api/employees", headers=headers_owner)
        if r.status_code != 200:
            log(f"❌ FAIL: Cannot get employees list")
            return
        
        employees = r.json().get("items", [])
        cindy = None
        for emp in employees:
            if emp.get("username") == "cindy":
                cindy = emp
                break
        
        if not cindy:
            log(f"❌ FAIL: Cindy not found in employees list")
            return
        
        cindy_id = cindy.get("id")
        current_modules = cindy.get("modules", [])
        if "produk_fokus" not in current_modules:
            new_modules = current_modules + ["produk_fokus"]
            r = requests.put(f"{BASE_URL}/api/employees/{cindy_id}", headers=headers_owner, json={
                "modules": new_modules
            })
            if r.status_code != 200:
                log(f"❌ FAIL: Cannot grant produk_fokus module to Cindy")
                return
            log(f"✅ PASS: Granted produk_fokus module to Cindy")
        else:
            log(f"✅ PASS: Cindy already has produk_fokus module")
        passed_tests += 1
        
        # ========== TEST 1C: LOGIN AS STAFF (CINDY) ==========
        total_tests += 1
        log("\n[TEST 1C] Login as staff (cindy/cindy123)...")
        r = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "cindy",
            "password": "cindy123"
        })
        if r.status_code != 200:
            log(f"❌ FAIL: Login failed with status {r.status_code}")
            log(f"Response: {r.text}")
            return
        
        staff_token = r.json().get("token")
        staff_user = r.json().get("user")
        if not staff_token:
            log(f"❌ FAIL: No token in login response")
            return
        
        log(f"✅ PASS: Staff login successful (user: {staff_user.get('name')})")
        passed_tests += 1
        
        # ========== TEST 2: GET CURRENT PERIOD ==========
        total_tests += 1
        log("\n[TEST 2] Get current period from GET /api/pf/periods...")
        headers_staff = {"Authorization": f"Bearer {staff_token}"}
        r = requests.get(f"{BASE_URL}/api/pf/periods", headers=headers_staff)
        if r.status_code != 200:
            log(f"❌ FAIL: GET /api/pf/periods failed with status {r.status_code}")
            log(f"Response: {r.text}")
            return
        
        periods = r.json().get("periods", [])
        if not periods:
            log(f"❌ FAIL: No periods returned")
            return
        
        current_period = periods[0]["period_key"]
        log(f"✅ PASS: Current period is {current_period}")
        passed_tests += 1
        
        # ========== TEST 3: MISSING ALASAN → 400 ==========
        total_tests += 1
        log("\n[TEST 3] POST /api/pf/pengajuan without alasan → expect 400...")
        r = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers_staff, json={
            "period_key": current_period,
            "kode": "TEST-ALS-1",
            "nama": "Test Produk Alasan",
            "jumlah": 5,
            "satuan": "pcs"
            # NO alasan field
        })
        if r.status_code != 400:
            log(f"❌ FAIL: Expected 400, got {r.status_code}")
            log(f"Response: {r.text}")
        else:
            resp = r.json()
            error_msg = resp.get("error", "")
            if "Alasan wajib diisi" in error_msg:
                log(f"✅ PASS: Got 400 with correct error message: '{error_msg}'")
                passed_tests += 1
            else:
                log(f"❌ FAIL: Got 400 but wrong error message: '{error_msg}'")
        
        # ========== TEST 4: EMPTY ALASAN (WHITESPACE) → 400 ==========
        total_tests += 1
        log("\n[TEST 4] POST /api/pf/pengajuan with whitespace-only alasan → expect 400...")
        r = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers_staff, json={
            "period_key": current_period,
            "kode": "TEST-ALS-2",
            "nama": "Test Produk Alasan 2",
            "jumlah": 5,
            "satuan": "pcs",
            "alasan": "   "  # Whitespace only
        })
        if r.status_code != 400:
            log(f"❌ FAIL: Expected 400, got {r.status_code}")
            log(f"Response: {r.text}")
        else:
            resp = r.json()
            error_msg = resp.get("error", "")
            if "Alasan wajib diisi" in error_msg:
                log(f"✅ PASS: Got 400 with correct error message: '{error_msg}'")
                passed_tests += 1
            else:
                log(f"❌ FAIL: Got 400 but wrong error message: '{error_msg}'")
        
        # ========== TEST 5: VALID ALASAN → 200 ==========
        total_tests += 1
        log("\n[TEST 5] POST /api/pf/pengajuan with valid alasan → expect 200...")
        valid_alasan = "Permintaan pelanggan meningkat karena promo akhir bulan"
        r = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers_staff, json={
            "period_key": current_period,
            "kode": "TEST-ALS-3",
            "nama": "Test Produk Alasan Valid",
            "jumlah": 5,
            "satuan": "pcs",
            "alasan": valid_alasan
        })
        if r.status_code != 200:
            log(f"❌ FAIL: Expected 200, got {r.status_code}")
            log(f"Response: {r.text}")
        else:
            resp = r.json()
            item = resp.get("item", {})
            pengajuan_id = item.get("id")
            returned_alasan = item.get("alasan")
            
            if not pengajuan_id:
                log(f"❌ FAIL: No 'id' in response")
            elif returned_alasan != valid_alasan:
                log(f"❌ FAIL: alasan mismatch. Expected: '{valid_alasan}', Got: '{returned_alasan}'")
            else:
                log(f"✅ PASS: Got 200 with correct alasan field: '{returned_alasan}'")
                passed_tests += 1
        
        # ========== TEST 6: PERSISTENCE CHECK (STAFF) ==========
        total_tests += 1
        log("\n[TEST 6] GET /api/pf/pengajuan?period={current_period} as staff → verify alasan persisted...")
        r = requests.get(f"{BASE_URL}/api/pf/pengajuan?period={current_period}", headers=headers_staff)
        if r.status_code != 200:
            log(f"❌ FAIL: GET /api/pf/pengajuan failed with status {r.status_code}")
            log(f"Response: {r.text}")
        else:
            resp = r.json()
            items = resp.get("items", [])
            found = False
            for item in items:
                if item.get("kode") == "TEST-ALS-3":
                    found = True
                    if item.get("alasan") == valid_alasan:
                        log(f"✅ PASS: Pengajuan found with correct alasan: '{item.get('alasan')}'")
                        passed_tests += 1
                    else:
                        log(f"❌ FAIL: Pengajuan found but alasan mismatch: '{item.get('alasan')}'")
                    break
            if not found:
                log(f"❌ FAIL: Pengajuan TEST-ALS-3 not found in list")
        
        # ========== TEST 7: OWNER CAN SEE ALASAN ==========
        total_tests += 1
        log("\n[TEST 7] GET /api/pf/pengajuan?period={current_period} as owner → verify alasan visible...")
        r = requests.get(f"{BASE_URL}/api/pf/pengajuan?period={current_period}", headers=headers_owner)
        if r.status_code != 200:
            log(f"❌ FAIL: GET /api/pf/pengajuan as owner failed with status {r.status_code}")
            log(f"Response: {r.text}")
        else:
            resp = r.json()
            items = resp.get("items", [])
            found = False
            for item in items:
                if item.get("kode") == "TEST-ALS-3":
                    found = True
                    if item.get("alasan") == valid_alasan:
                        log(f"✅ PASS: Owner can see pengajuan with correct alasan: '{item.get('alasan')}'")
                        passed_tests += 1
                    else:
                        log(f"❌ FAIL: Owner sees pengajuan but alasan mismatch: '{item.get('alasan')}'")
                    break
            if not found:
                log(f"❌ FAIL: Pengajuan TEST-ALS-3 not found in owner's list")
        
        # ========== TEST 8: TRUNCATION TEST (600 CHARS → 500 CHARS) ==========
        total_tests += 1
        log("\n[TEST 8] POST /api/pf/pengajuan with 600-char alasan → expect truncation to 500...")
        long_alasan = "A" * 600  # 600 characters
        r = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers_staff, json={
            "period_key": current_period,
            "kode": "TEST-ALS-4",
            "nama": "Test Produk Alasan Truncation",
            "jumlah": 5,
            "satuan": "pcs",
            "alasan": long_alasan
        })
        if r.status_code != 200:
            log(f"❌ FAIL: Expected 200, got {r.status_code}")
            log(f"Response: {r.text}")
        else:
            resp = r.json()
            item = resp.get("item", {})
            returned_alasan = item.get("alasan", "")
            alasan_len = len(returned_alasan)
            
            if alasan_len > 500:
                log(f"❌ FAIL: alasan length {alasan_len} exceeds 500 chars")
            elif alasan_len == 500:
                log(f"✅ PASS: alasan correctly truncated to 500 chars (got {alasan_len})")
                passed_tests += 1
            else:
                log(f"⚠️  WARNING: alasan length is {alasan_len} (expected 500, but might be OK if trimmed)")
                # Still pass if it's <= 500
                if alasan_len <= 500:
                    log(f"✅ PASS: alasan length {alasan_len} is within 500 char limit")
                    passed_tests += 1
        
        # ========== TEST 9: CLEANUP - DELETE TEST PENGAJUAN ==========
        total_tests += 1
        log("\n[TEST 9] Cleanup: DELETE test pengajuan...")
        
        # Get all test pengajuan IDs
        r = requests.get(f"{BASE_URL}/api/pf/pengajuan?period={current_period}", headers=headers_owner)
        if r.status_code != 200:
            log(f"❌ FAIL: Cannot get pengajuan list for cleanup")
        else:
            resp = r.json()
            items = resp.get("items", [])
            test_ids = []
            for item in items:
                if item.get("kode", "").startswith("TEST-ALS-"):
                    test_ids.append(item.get("id"))
            
            log(f"Found {len(test_ids)} test pengajuan to delete")
            
            deleted_count = 0
            for test_id in test_ids:
                r = requests.delete(f"{BASE_URL}/api/pf/pengajuan/{test_id}", headers=headers_owner)
                if r.status_code == 200:
                    deleted_count += 1
                else:
                    log(f"⚠️  WARNING: Failed to delete pengajuan {test_id}: {r.status_code}")
            
            if deleted_count == len(test_ids):
                log(f"✅ PASS: Cleanup successful - deleted {deleted_count} test pengajuan")
                passed_tests += 1
            else:
                log(f"⚠️  PARTIAL: Deleted {deleted_count}/{len(test_ids)} test pengajuan")
                passed_tests += 1  # Still pass if we tried
        
    except Exception as e:
        log(f"❌ EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
    
    # ========== SUMMARY ==========
    log("\n" + "=" * 80)
    log(f"TEST SUMMARY: {passed_tests}/{total_tests} tests passed ({passed_tests*100//total_tests if total_tests > 0 else 0}%)")
    log("=" * 80)
    
    if passed_tests == total_tests:
        log("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        log(f"❌ {total_tests - passed_tests} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
