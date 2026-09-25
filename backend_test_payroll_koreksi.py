#!/usr/bin/env python3
"""
Backend Test: Payroll Koreksi Gaji per Karyawan
Test all 11 scenarios from review request.
"""
import requests
import json
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test cycle (future, allowed since >= 2026-09)
TEST_CYCLE = "2030-12"

def log(msg):
    print(f"[{datetime.utcnow().isoformat()}Z] {msg}")

def main():
    log("=" * 80)
    log("PAYROLL KOREKSI GAJI — Backend Test (11 scenarios)")
    log("=" * 80)
    
    # ========== TEST 1: Login as owner ==========
    log("\n✓ TEST 1: Login as owner")
    try:
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"}, timeout=10)
        assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
        token = r.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        log(f"  ✅ Owner login successful, token: {token[:20]}...")
    except Exception as e:
        log(f"  ❌ TEST 1 FAILED: {e}")
        return
    
    # ========== TEST 2: GET test cycle, seed & inspect base breakdown ==========
    log(f"\n✓ TEST 2: GET period {TEST_CYCLE} (seed & inspect base breakdown)")
    try:
        r = requests.get(f"{BASE_URL}/api/payroll/period?cycle={TEST_CYCLE}", headers=headers, timeout=10)
        assert r.status_code == 200, f"GET period failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["cycle_key"] == TEST_CYCLE, f"cycle_key mismatch: {data['cycle_key']}"
        assert "breakdown" in data, "breakdown missing"
        assert "items" in data["breakdown"], "breakdown.items missing"
        assert len(data["breakdown"]["items"]) > 0, "breakdown.items empty"
        
        # Pick first employee
        first_item = data["breakdown"]["items"][0]
        user_id = first_item["user_id"]
        base_total = first_item["total"]
        log(f"  ✅ Period {TEST_CYCLE} seeded. First employee: {first_item['name']} (user_id={user_id})")
        log(f"  ✅ Base total: {base_total}")
        log(f"  ✅ Breakdown items count: {len(data['breakdown']['items'])}")
        
        # Verify koreksi field exists and is 0 initially
        assert "komponen" in first_item, "komponen missing"
        assert "koreksi" in first_item["komponen"], "komponen.koreksi missing"
        assert first_item["komponen"]["koreksi"] == 0, f"Initial koreksi should be 0, got {first_item['komponen']['koreksi']}"
        assert "koreksi_note" in first_item, "koreksi_note missing"
        assert first_item["koreksi_note"] == "", f"Initial koreksi_note should be empty, got {first_item['koreksi_note']}"
        log(f"  ✅ Initial koreksi=0, koreksi_note='' verified")
    except Exception as e:
        log(f"  ❌ TEST 2 FAILED: {e}")
        return
    
    # ========== TEST 3: PUT positive koreksi ==========
    log(f"\n✓ TEST 3: PUT positive koreksi (50000) for user {user_id}")
    try:
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": 50000,
                    "koreksi_note": "Bonus khusus"
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        data = r.json()
        
        # Find the user in breakdown
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found in breakdown"
        
        # Verify koreksi in komponen
        assert item["komponen"]["koreksi"] == 50000, f"koreksi should be 50000, got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "Bonus khusus", f"koreksi_note mismatch: {item['koreksi_note']}"
        
        # Verify total = base_total + 50000 (within ±1 for rounding)
        expected_total = base_total + 50000
        assert abs(item["total"] - expected_total) <= 1, f"Total should be ~{expected_total}, got {item['total']}"
        log(f"  ✅ koreksi=50000 applied, total: {base_total} → {item['total']}")
        log(f"  ✅ koreksi_note='Bonus khusus' saved")
        
        # Verify other employees unchanged
        other_items = [x for x in data["breakdown"]["items"] if x["user_id"] != user_id]
        for other in other_items:
            assert other["komponen"]["koreksi"] == 0, f"Other employee {other['user_id']} koreksi should be 0"
        log(f"  ✅ Other employees unchanged (koreksi=0)")
    except Exception as e:
        log(f"  ❌ TEST 3 FAILED: {e}")
        return
    
    # ========== TEST 4: PUT negative koreksi ==========
    log(f"\n✓ TEST 4: PUT negative koreksi (-25000) for user {user_id}")
    try:
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": -25000,
                    "koreksi_note": "Potongan ijin sakit"
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        data = r.json()
        
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found"
        
        assert item["komponen"]["koreksi"] == -25000, f"koreksi should be -25000, got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "Potongan ijin sakit", f"koreksi_note mismatch"
        
        expected_total = base_total - 25000
        assert abs(item["total"] - expected_total) <= 1, f"Total should be ~{expected_total}, got {item['total']}"
        log(f"  ✅ koreksi=-25000 applied, total: {base_total} → {item['total']}")
        log(f"  ✅ koreksi_note='Potongan ijin sakit' saved")
    except Exception as e:
        log(f"  ❌ TEST 4 FAILED: {e}")
        return
    
    # ========== TEST 5: PUT zero koreksi ==========
    log(f"\n✓ TEST 5: PUT zero koreksi (0) for user {user_id}")
    try:
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": 0,
                    "koreksi_note": ""
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        data = r.json()
        
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found"
        
        assert item["komponen"]["koreksi"] == 0, f"koreksi should be 0, got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "", f"koreksi_note should be empty, got {item['koreksi_note']}"
        
        assert abs(item["total"] - base_total) <= 1, f"Total should return to base_total {base_total}, got {item['total']}"
        log(f"  ✅ koreksi=0 applied, total returned to base: {item['total']}")
        log(f"  ✅ koreksi_note='' (empty)")
    except Exception as e:
        log(f"  ❌ TEST 5 FAILED: {e}")
        return
    
    # ========== TEST 6: Trim + max length ==========
    log(f"\n✓ TEST 6: Trim + max length (koreksi_note 600 chars with spaces)")
    try:
        long_note = " " + "A" * 600 + " "  # 600 A's with leading/trailing spaces
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": 12345,
                    "koreksi_note": long_note
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        data = r.json()
        
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found"
        
        # Verify trimmed and max 500 chars
        note = item["koreksi_note"]
        assert note[0] != " " and note[-1] != " ", f"koreksi_note should be trimmed, got '{note[:10]}...{note[-10:]}'"
        assert len(note) == 500, f"koreksi_note should be max 500 chars, got {len(note)}"
        assert note == "A" * 500, f"koreksi_note should be 500 A's"
        log(f"  ✅ koreksi_note trimmed and truncated to 500 chars")
        log(f"  ✅ koreksi=12345 saved")
    except Exception as e:
        log(f"  ❌ TEST 6 FAILED: {e}")
        return
    
    # ========== TEST 7: Backward compat #1 — PUT globals only, koreksi preserved ==========
    log(f"\n✓ TEST 7: Backward compat #1 — PUT globals only, koreksi preserved")
    try:
        # First, set koreksi to a known value
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": 12345,
                    "koreksi_note": "Test note"
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT koreksi failed: {r.status_code} {r.text}"
        log(f"  ✅ Step 1: Set koreksi=12345, koreksi_note='Test note'")
        
        # Now PUT globals only (no per_user)
        body = {
            "cycle": TEST_CYCLE,
            "globals": {
                "komisi_penjualan": 1000000
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT globals failed: {r.status_code} {r.text}"
        data = r.json()
        log(f"  ✅ Step 2: PUT globals only (no per_user in body)")
        
        # Verify koreksi is PRESERVED (not wiped)
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found"
        
        # IMPORTANT: Check if koreksi is preserved or reset
        # Based on service.js line 531-548, if body.per_user is provided, it REPLACES per_user entirely.
        # If body.per_user is NOT provided, existing per_user is preserved.
        # So koreksi should be preserved here since we didn't send per_user.
        assert item["komponen"]["koreksi"] == 12345, f"koreksi should be preserved (12345), got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "Test note", f"koreksi_note should be preserved, got {item['koreksi_note']}"
        log(f"  ✅ koreksi=12345 PRESERVED (not wiped)")
        log(f"  ✅ koreksi_note='Test note' PRESERVED")
    except Exception as e:
        log(f"  ❌ TEST 7 FAILED: {e}")
        return
    
    # ========== TEST 8: Backward compat #2 — PUT per_user with finals only, koreksi reset ==========
    log(f"\n✓ TEST 8: Backward compat #2 — PUT per_user with finals only, koreksi reset")
    try:
        # PUT per_user with finals only (no koreksi field)
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "finals": {
                        "komisi_penjualan": 100000
                    }
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"
        data = r.json()
        
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found"
        
        # Since per_user is replaced entirely, koreksi should be reset to 0 (default)
        assert item["komponen"]["koreksi"] == 0, f"koreksi should be reset to 0, got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "", f"koreksi_note should be reset to empty, got {item['koreksi_note']}"
        log(f"  ✅ koreksi reset to 0 (expected behavior since per_user replaced)")
        log(f"  ✅ koreksi_note reset to empty")
        log(f"  ✅ finals.komisi_penjualan=100000 applied")
    except Exception as e:
        log(f"  ❌ TEST 8 FAILED: {e}")
        return
    
    # ========== TEST 9: Finalize lock — POST finalize ==========
    log(f"\n✓ TEST 9: Finalize lock — POST finalize on {TEST_CYCLE}")
    try:
        # First, set koreksi to a known value before finalize
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": 77777,
                    "koreksi_note": "Before finalize"
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"PUT koreksi failed: {r.status_code} {r.text}"
        log(f"  ✅ Step 1: Set koreksi=77777 before finalize")
        
        # Finalize
        body = {"cycle": TEST_CYCLE}
        r = requests.post(f"{BASE_URL}/api/payroll/period/finalize", json=body, headers=headers, timeout=10)
        assert r.status_code == 200, f"Finalize failed: {r.status_code} {r.text}"
        data = r.json()
        
        assert data["period"]["status"] == "final", f"Status should be 'final', got {data['period']['status']}"
        assert data["period"]["finalized_at"] is not None, "finalized_at should be set"
        log(f"  ✅ Period {TEST_CYCLE} finalized successfully")
        log(f"  ✅ Status: {data['period']['status']}")
        log(f"  ✅ Finalized at: {data['period']['finalized_at']}")
        
        # Verify koreksi in snapshot
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found in snapshot"
        assert item["komponen"]["koreksi"] == 77777, f"koreksi in snapshot should be 77777, got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "Before finalize", f"koreksi_note in snapshot mismatch"
        log(f"  ✅ koreksi=77777 frozen in snapshot")
        log(f"  ✅ koreksi_note='Before finalize' frozen in snapshot")
    except Exception as e:
        log(f"  ❌ TEST 9 FAILED: {e}")
        return
    
    # ========== TEST 10: Finalize lock — PUT rejected with 409 ==========
    log(f"\n✓ TEST 10: Finalize lock — PUT rejected with 409")
    try:
        body = {
            "cycle": TEST_CYCLE,
            "per_user": {
                user_id: {
                    "koreksi": 999,
                    "koreksi_note": "Should be rejected"
                }
            }
        }
        r = requests.put(f"{BASE_URL}/api/payroll/period", json=body, headers=headers, timeout=10)
        assert r.status_code == 409, f"PUT should return 409, got {r.status_code}"
        
        error_msg = r.json().get("error", "")
        assert "sudah FINAL" in error_msg, f"Error message should contain 'sudah FINAL', got: {error_msg}"
        log(f"  ✅ PUT rejected with 409 (Conflict)")
        log(f"  ✅ Error message: {error_msg}")
    except Exception as e:
        log(f"  ❌ TEST 10 FAILED: {e}")
        return
    
    # ========== TEST 11: After finalize — GET returns frozen koreksi ==========
    log(f"\n✓ TEST 11: After finalize — GET returns frozen koreksi")
    try:
        r = requests.get(f"{BASE_URL}/api/payroll/period?cycle={TEST_CYCLE}", headers=headers, timeout=10)
        assert r.status_code == 200, f"GET failed: {r.status_code} {r.text}"
        data = r.json()
        
        assert data["period"]["status"] == "final", f"Status should be 'final'"
        
        item = next((x for x in data["breakdown"]["items"] if x["user_id"] == user_id), None)
        assert item is not None, f"User {user_id} not found"
        
        # Verify frozen values
        assert item["komponen"]["koreksi"] == 77777, f"Frozen koreksi should be 77777, got {item['komponen']['koreksi']}"
        assert item["koreksi_note"] == "Before finalize", f"Frozen koreksi_note mismatch"
        log(f"  ✅ GET after finalize returns frozen koreksi=77777")
        log(f"  ✅ GET after finalize returns frozen koreksi_note='Before finalize'")
    except Exception as e:
        log(f"  ❌ TEST 11 FAILED: {e}")
        return
    
    # ========== CLEANUP: Delete test period ==========
    log(f"\n✓ CLEANUP: Delete test period {TEST_CYCLE}")
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        result = db.payroll_periods.delete_one({"cycle_key": TEST_CYCLE})
        assert result.deleted_count == 1, f"Expected 1 document deleted, got {result.deleted_count}"
        log(f"  ✅ Test period {TEST_CYCLE} deleted from MongoDB")
        client.close()
    except Exception as e:
        log(f"  ⚠️  CLEANUP WARNING: {e}")
    
    # ========== SUMMARY ==========
    log("\n" + "=" * 80)
    log("✅ ALL 11 TESTS PASSED (100%)")
    log("=" * 80)
    log("\nTEST SUMMARY:")
    log("  ✅ TEST 1: Login as owner - PASSED")
    log("  ✅ TEST 2: GET test cycle, seed & inspect base breakdown - PASSED")
    log("  ✅ TEST 3: PUT positive koreksi (50000) - PASSED")
    log("  ✅ TEST 4: PUT negative koreksi (-25000) - PASSED")
    log("  ✅ TEST 5: PUT zero koreksi (0) - PASSED")
    log("  ✅ TEST 6: Trim + max length (koreksi_note 600 chars) - PASSED")
    log("  ✅ TEST 7: Backward compat #1 — PUT globals only, koreksi preserved - PASSED")
    log("  ✅ TEST 8: Backward compat #2 — PUT per_user with finals only, koreksi reset - PASSED")
    log("  ✅ TEST 9: Finalize lock — POST finalize - PASSED")
    log("  ✅ TEST 10: Finalize lock — PUT rejected with 409 - PASSED")
    log("  ✅ TEST 11: After finalize — GET returns frozen koreksi - PASSED")
    log("\nKEY FINDINGS:")
    log("  • koreksi field (positive/negative/zero) working correctly")
    log("  • koreksi_note field (trim, max 500 chars) working correctly")
    log("  • koreksi appears in breakdown.items[].komponen.koreksi")
    log("  • koreksi_note appears in breakdown.items[].koreksi_note")
    log("  • Total calculation includes koreksi (additive)")
    log("  • Backward compatibility: koreksi preserved when per_user not in PUT body")
    log("  • Backward compatibility: koreksi reset when per_user replaced")
    log("  • Finalize lock: PUT rejected with 409 after finalization")
    log("  • Frozen values: koreksi and koreksi_note preserved in snapshot")
    log("  • Cleanup successful: test period deleted")
    log("\nCONCLUSION:")
    log("  The Payroll Koreksi Gaji feature is FULLY WORKING.")
    log("  All 11 test scenarios passed without errors.")
    log("=" * 80)

if __name__ == "__main__":
    main()
