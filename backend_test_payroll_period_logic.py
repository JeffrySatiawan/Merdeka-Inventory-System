#!/usr/bin/env python3
"""
Backend Test: Payroll Period Logic (26→25) & First Cycle Validation
Test Date: 2026-09-25 (server time)
Base URL: https://absensi-foundation.preview.emergentagent.com

Test Scenarios:
1. Login as owner
2. GET /api/payroll/cycles - verify cycle list rules
3. GET /api/payroll/period?cycle=2026-09 - verify first cycle
4. GET /api/payroll/period?cycle=2026-08 - verify rejection (before first)
5. GET /api/payroll/period?cycle=2025-12 - verify rejection (before first)
6. GET /api/payroll/period?cycle=2026-10 - verify future cycle (should succeed)
7. PUT /api/payroll/period with cycle=2026-08 - verify rejection
8. PUT /api/payroll/period with cycle=2026-09 - verify success
9. POST /api/payroll/period/finalize with cycle=2026-08 - verify rejection
10. BWC: GET /api/payroll/period?from=2026-08-26&to=2026-09-25 - verify success
11. BWC: GET /api/payroll/period?from=2026-07-26&to=2026-08-25 - verify rejection
12. Cleanup: delete test-created periods
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

def log(msg):
    print(f"[{datetime.utcnow().strftime('%H:%M:%S')}] {msg}")

def test_payroll_period_logic():
    session = requests.Session()
    token = None
    original_komisi_penjualan = None
    created_periods = []
    
    try:
        # ============================================================
        # TEST 1: LOGIN AS OWNER
        # ============================================================
        log("TEST 1: Login as owner")
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "username": OWNER_USERNAME,
            "password": OWNER_PASSWORD
        })
        assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "token" in data, "No token in login response"
        token = data["token"]
        session.headers.update({"Authorization": f"Bearer {token}"})
        log("✅ TEST 1 PASSED: Owner login successful")
        
        # ============================================================
        # TEST 2: GET /api/payroll/cycles - verify cycle list rules
        # ============================================================
        log("\nTEST 2: GET /api/payroll/cycles")
        resp = session.get(f"{BASE_URL}/api/payroll/cycles")
        assert resp.status_code == 200, f"GET cycles failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "cycles" in data, "No cycles field in response"
        cycles = data["cycles"]
        assert isinstance(cycles, list), "cycles is not a list"
        log(f"   Cycles count: {len(cycles)}")
        
        # Verify all cycles >= 2026-09
        for cycle in cycles:
            assert "cycle_key" in cycle, f"cycle missing cycle_key: {cycle}"
            assert "from" in cycle, f"cycle missing from: {cycle}"
            assert "to" in cycle, f"cycle missing to: {cycle}"
            assert cycle["cycle_key"] >= "2026-09", f"cycle_key {cycle['cycle_key']} < 2026-09"
            # Verify from ends with -26 (day 26)
            assert cycle["from"].endswith("-26"), f"from {cycle['from']} does not end with -26"
            # Verify to ends with -25 (day 25)
            assert cycle["to"].endswith("-25"), f"to {cycle['to']} does not end with -25"
            log(f"   Cycle: {cycle['cycle_key']} ({cycle['from']} → {cycle['to']})")
        
        # Verify cycles are sorted descending
        cycle_keys = [c["cycle_key"] for c in cycles]
        assert cycle_keys == sorted(cycle_keys, reverse=True), "Cycles not sorted descending"
        
        # At time of test (Sept 25, 2026, day < 26), only 2026-09 should appear
        # (since day < 26, no next period yet)
        assert len(cycles) == 1, f"Expected 1 cycle (2026-09 only), got {len(cycles)}"
        assert cycles[0]["cycle_key"] == "2026-09", f"Expected cycle_key 2026-09, got {cycles[0]['cycle_key']}"
        log("✅ TEST 2 PASSED: Cycles list valid (only 2026-09, day < 26)")
        
        # ============================================================
        # TEST 3: GET /api/payroll/period?cycle=2026-09 - verify first cycle
        # ============================================================
        log("\nTEST 3: GET /api/payroll/period?cycle=2026-09")
        resp = session.get(f"{BASE_URL}/api/payroll/period?cycle=2026-09")
        assert resp.status_code == 200, f"GET period 2026-09 failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["cycle_key"] == "2026-09", f"cycle_key mismatch: {data['cycle_key']}"
        assert data["from"] == "2026-08-26", f"from mismatch: {data['from']}"
        assert data["to"] == "2026-09-25", f"to mismatch: {data['to']}"
        assert "period" in data, "No period field"
        assert "breakdown" in data, "No breakdown field"
        log(f"   cycle_key: {data['cycle_key']}, from: {data['from']}, to: {data['to']}")
        log("✅ TEST 3 PASSED: First cycle 2026-09 valid")
        
        # Save original komisi_penjualan for cleanup
        original_komisi_penjualan = data["period"]["globals"].get("komisi_penjualan", 0)
        log(f"   Original komisi_penjualan: {original_komisi_penjualan}")
        
        # ============================================================
        # TEST 4: GET /api/payroll/period?cycle=2026-08 - verify rejection
        # ============================================================
        log("\nTEST 4: GET /api/payroll/period?cycle=2026-08 (before first cycle)")
        resp = session.get(f"{BASE_URL}/api/payroll/period?cycle=2026-08")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error field in response"
        error_msg = data["error"].lower()
        assert "sebelum periode pertama" in error_msg or "2026-09" in error_msg, f"Error message unexpected: {data['error']}"
        log(f"   Error message: {data['error']}")
        log("✅ TEST 4 PASSED: Cycle 2026-08 rejected (before first)")
        
        # ============================================================
        # TEST 5: GET /api/payroll/period?cycle=2025-12 - verify rejection
        # ============================================================
        log("\nTEST 5: GET /api/payroll/period?cycle=2025-12 (before first cycle)")
        resp = session.get(f"{BASE_URL}/api/payroll/period?cycle=2025-12")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error field in response"
        error_msg = data["error"].lower()
        assert "sebelum periode pertama" in error_msg or "2026-09" in error_msg, f"Error message unexpected: {data['error']}"
        log(f"   Error message: {data['error']}")
        log("✅ TEST 5 PASSED: Cycle 2025-12 rejected (before first)")
        
        # ============================================================
        # TEST 6: GET /api/payroll/period?cycle=2026-10 - verify future cycle
        # ============================================================
        log("\nTEST 6: GET /api/payroll/period?cycle=2026-10 (future period)")
        resp = session.get(f"{BASE_URL}/api/payroll/period?cycle=2026-10")
        assert resp.status_code == 200, f"GET period 2026-10 failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["cycle_key"] == "2026-10", f"cycle_key mismatch: {data['cycle_key']}"
        assert data["from"] == "2026-09-26", f"from mismatch: {data['from']}"
        assert data["to"] == "2026-10-25", f"to mismatch: {data['to']}"
        log(f"   cycle_key: {data['cycle_key']}, from: {data['from']}, to: {data['to']}")
        log("✅ TEST 6 PASSED: Future cycle 2026-10 valid (>= FIRST_CYCLE_KEY)")
        created_periods.append("2026-10")
        
        # ============================================================
        # TEST 7: PUT /api/payroll/period with cycle=2026-08 - verify rejection
        # ============================================================
        log("\nTEST 7: PUT /api/payroll/period with cycle=2026-08 (before first)")
        resp = session.put(f"{BASE_URL}/api/payroll/period", json={
            "cycle": "2026-08",
            "globals": {"komisi_penjualan": 0}
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error field in response"
        error_msg = data["error"].lower()
        assert "tidak valid" in error_msg or "sebelum" in error_msg, f"Error message unexpected: {data['error']}"
        log(f"   Error message: {data['error']}")
        log("✅ TEST 7 PASSED: PUT cycle 2026-08 rejected")
        
        # ============================================================
        # TEST 8: PUT /api/payroll/period with cycle=2026-09 - verify success
        # ============================================================
        log("\nTEST 8: PUT /api/payroll/period with cycle=2026-09 (valid)")
        resp = session.put(f"{BASE_URL}/api/payroll/period", json={
            "cycle": "2026-09",
            "globals": {"komisi_penjualan": 100000}
        })
        assert resp.status_code == 200, f"PUT period 2026-09 failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["from"] == "2026-08-26", f"from mismatch: {data['from']}"
        assert data["to"] == "2026-09-25", f"to mismatch: {data['to']}"
        assert data["period"]["globals"]["komisi_penjualan"] == 100000, f"komisi_penjualan not updated: {data['period']['globals']['komisi_penjualan']}"
        log(f"   Updated komisi_penjualan: {data['period']['globals']['komisi_penjualan']}")
        log("✅ TEST 8 PASSED: PUT cycle 2026-09 successful")
        
        # ============================================================
        # TEST 9: POST /api/payroll/period/finalize with cycle=2026-08 - verify rejection
        # ============================================================
        log("\nTEST 9: POST /api/payroll/period/finalize with cycle=2026-08 (before first)")
        resp = session.post(f"{BASE_URL}/api/payroll/period/finalize", json={
            "cycle": "2026-08"
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error field in response"
        error_msg = data["error"].lower()
        assert "tidak valid" in error_msg or "sebelum" in error_msg, f"Error message unexpected: {data['error']}"
        log(f"   Error message: {data['error']}")
        log("✅ TEST 9 PASSED: Finalize cycle 2026-08 rejected")
        
        # ============================================================
        # TEST 10: BWC - GET /api/payroll/period?from=2026-08-26&to=2026-09-25
        # ============================================================
        log("\nTEST 10: BWC - GET /api/payroll/period?from=2026-08-26&to=2026-09-25")
        resp = session.get(f"{BASE_URL}/api/payroll/period?from=2026-08-26&to=2026-09-25")
        assert resp.status_code == 200, f"GET period BWC failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["cycle_key"] == "2026-09", f"cycle_key mismatch: {data['cycle_key']}"
        assert data["from"] == "2026-08-26", f"from mismatch: {data['from']}"
        assert data["to"] == "2026-09-25", f"to mismatch: {data['to']}"
        log(f"   Derived cycle_key: {data['cycle_key']}")
        log("✅ TEST 10 PASSED: BWC from/to params work (derived cycle_key 2026-09)")
        
        # ============================================================
        # TEST 11: BWC - GET /api/payroll/period?from=2026-07-26&to=2026-08-25 (before first)
        # ============================================================
        log("\nTEST 11: BWC - GET /api/payroll/period?from=2026-07-26&to=2026-08-25 (before first)")
        resp = session.get(f"{BASE_URL}/api/payroll/period?from=2026-07-26&to=2026-08-25")
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error field in response"
        error_msg = data["error"].lower()
        assert "sebelum periode pertama" in error_msg or "2026-09" in error_msg, f"Error message unexpected: {data['error']}"
        log(f"   Error message: {data['error']}")
        log("✅ TEST 11 PASSED: BWC from/to rejected (derived cycle_key 2026-08 < 2026-09)")
        
        # ============================================================
        # CLEANUP: Revert komisi_penjualan to original value
        # ============================================================
        log("\nCLEANUP: Revert komisi_penjualan to original value")
        resp = session.put(f"{BASE_URL}/api/payroll/period", json={
            "cycle": "2026-09",
            "globals": {"komisi_penjualan": original_komisi_penjualan}
        })
        assert resp.status_code == 200, f"Revert failed: {resp.status_code} {resp.text}"
        log(f"   Reverted komisi_penjualan to {original_komisi_penjualan}")
        
        # ============================================================
        # CLEANUP: Delete test-created periods (2026-10)
        # ============================================================
        log("\nCLEANUP: Delete test-created periods")
        from pymongo import MongoClient
        client = MongoClient("mongodb://localhost:27017")
        db = client["cycle_count"]
        for cycle_key in created_periods:
            result = db.payroll_periods.delete_one({"cycle_key": cycle_key})
            log(f"   Deleted period {cycle_key}: {result.deleted_count} document(s)")
        client.close()
        
        # ============================================================
        # SUMMARY
        # ============================================================
        log("\n" + "="*60)
        log("✅ ALL 11 TESTS PASSED (100%)")
        log("="*60)
        log("\nTEST SUMMARY:")
        log("✅ TEST 1: Owner login - WORKING")
        log("✅ TEST 2: GET /api/payroll/cycles (only 2026-09, day < 26) - WORKING")
        log("✅ TEST 3: GET period 2026-09 (first cycle) - WORKING")
        log("✅ TEST 4: GET period 2026-08 rejected (before first) - WORKING")
        log("✅ TEST 5: GET period 2025-12 rejected (before first) - WORKING")
        log("✅ TEST 6: GET period 2026-10 (future, >= first) - WORKING")
        log("✅ TEST 7: PUT period 2026-08 rejected - WORKING")
        log("✅ TEST 8: PUT period 2026-09 successful - WORKING")
        log("✅ TEST 9: Finalize 2026-08 rejected - WORKING")
        log("✅ TEST 10: BWC from/to params (derived 2026-09) - WORKING")
        log("✅ TEST 11: BWC from/to rejected (derived 2026-08) - WORKING")
        log("\nKEY FINDINGS:")
        log("1. FIRST_CYCLE_KEY = '2026-09' enforced correctly")
        log("2. cycleRange() rejects cycles < 2026-09")
        log("3. listCycles() returns only 2026-09 (day 25 < 26, no next period)")
        log("4. Cycle format: cycle_key='YYYY-MM' = 26 prev month → 25 current month")
        log("5. GET period 2026-09: from=2026-08-26, to=2026-09-25 ✓")
        log("6. GET period 2026-10: from=2026-09-26, to=2026-10-25 ✓")
        log("7. PUT/Finalize reject cycles < 2026-09 with clear error messages")
        log("8. BWC from/to params work, derive cycle_key from 'to' month")
        log("9. BWC rejects derived cycle_key < 2026-09")
        log("10. Cleanup successful (reverted komisi_penjualan, deleted 2026-10)")
        
        return True
        
    except AssertionError as e:
        log(f"\n❌ TEST FAILED: {e}")
        return False
    except Exception as e:
        log(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_payroll_period_logic()
    exit(0 if success else 1)
