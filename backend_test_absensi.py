#!/usr/bin/env python3
"""
Absensi Module Backend Testing — 23 Test Cases
Tests the complete Absensi module end-to-end without modifying any code.
"""

import requests
import json
import time
from datetime import datetime

# Base URL from .env
BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

# Credentials
OWNER_USER = "owner"
OWNER_PASS = "owner123"
STAFF_USER = "cindy"
STAFF_PASS = "cindy123"

# Minimal 1x1 red PNG data URL (~200 bytes)
TINY_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="

# Test location (Bali coordinates from spec)
TEST_LAT = -8.65
TEST_LNG = 115.216
TEST_RADIUS = 50

# Far away location (for negative test)
FAR_LAT = 0
FAR_LNG = 0

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": username, "password": password},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            log(f"✅ Login successful: {username} → token: {token[:20]}...")
            return token
        else:
            log(f"❌ Login failed: {username} → {resp.status_code} {resp.text[:100]}")
            return None
    except Exception as e:
        log(f"❌ Login exception: {username} → {e}")
        return None

def test_case(num, description):
    """Print test case header"""
    print(f"\n{'='*80}")
    print(f"TEST CASE {num}: {description}")
    print('='*80)

def main():
    print("\n" + "="*80)
    print("ABSENSI MODULE BACKEND TESTING — 23 TEST CASES")
    print("="*80)
    
    # ========================================================================
    # PREP: Login as owner and staff
    # ========================================================================
    log("PREP: Logging in as owner and staff...")
    owner_token = login(OWNER_USER, OWNER_PASS)
    staff_token = login(STAFF_USER, STAFF_PASS)
    
    if not owner_token or not staff_token:
        log("❌ FATAL: Cannot proceed without valid tokens")
        return
    
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    staff_headers = {"Authorization": f"Bearer {staff_token}"}
    
    # Track test results
    results = []
    
    # ========================================================================
    # TEST 1: GET /api/auth/me (as staff) → user.modules includes 'absensi'
    # ========================================================================
    test_case(1, "GET /api/auth/me (as staff) → user.modules includes 'absensi'")
    try:
        resp = requests.get(f"{BASE_URL}/api/auth/me", headers=staff_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            modules = data.get("user", {}).get("modules", [])
            has_absensi = "absensi" in modules
            has_faktur = "faktur" in modules
            log(f"✅ Status: 200, modules: {modules}")
            log(f"   Has 'absensi': {has_absensi}, Has 'faktur': {has_faktur}")
            if has_absensi and has_faktur:
                results.append(("TEST 1", "PASS", "Staff has both 'faktur' and 'absensi' modules"))
            else:
                results.append(("TEST 1", "FAIL", f"Missing modules. Has absensi: {has_absensi}, Has faktur: {has_faktur}"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 1", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 1", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 2: GET /api/absensi/settings (as staff) → no qr_secret
    # ========================================================================
    test_case(2, "GET /api/absensi/settings (as staff) → no qr_secret")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers=staff_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            settings = data.get("settings", {})
            has_location = "location" in settings
            has_shifts = "shifts" in settings
            has_overtime = "overtime_min_minutes" in settings
            has_qr_secret = "qr_secret" in settings
            log(f"✅ Status: 200")
            log(f"   Has location: {has_location}, shifts: {has_shifts}, overtime_min_minutes: {has_overtime}")
            log(f"   Has qr_secret: {has_qr_secret} (should be False)")
            if has_location and has_shifts and has_overtime and not has_qr_secret:
                results.append(("TEST 2", "PASS", "Staff sees public settings without qr_secret"))
            else:
                results.append(("TEST 2", "FAIL", f"qr_secret exposed: {has_qr_secret} or missing fields"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 2", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 2", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 3: GET /api/absensi/settings (as owner) → has qr_secret
    # ========================================================================
    test_case(3, "GET /api/absensi/settings (as owner) → has qr_secret")
    qr_secret = None
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers=owner_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            settings = data.get("settings", {})
            qr_secret = settings.get("qr_secret")
            log(f"✅ Status: 200, qr_secret: {qr_secret}")
            if qr_secret and len(qr_secret) > 0:
                results.append(("TEST 3", "PASS", f"Owner sees qr_secret: {qr_secret[:20]}..."))
            else:
                results.append(("TEST 3", "FAIL", "qr_secret is empty or missing"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 3", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 3", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 4: GET /api/absensi/qr (as owner) → qr_value matches
    # ========================================================================
    test_case(4, "GET /api/absensi/qr (as owner) → qr_value matches")
    qr_value = None
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/qr", headers=owner_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            qr_value = data.get("qr_value")
            expected = f"MIS-ABSENSI:{qr_secret}" if qr_secret else None
            log(f"✅ Status: 200, qr_value: {qr_value}")
            log(f"   Expected: {expected}")
            if qr_value == expected:
                results.append(("TEST 4", "PASS", f"QR value matches: {qr_value}"))
            else:
                results.append(("TEST 4", "FAIL", f"QR mismatch. Got: {qr_value}, Expected: {expected}"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 4", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 4", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 5: GET /api/absensi/qr (as staff) → 403
    # ========================================================================
    test_case(5, "GET /api/absensi/qr (as staff) → 403")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/qr", headers=staff_headers, timeout=10)
        if resp.status_code == 403:
            log(f"✅ Status: 403 (as expected)")
            results.append(("TEST 5", "PASS", "Staff denied access to QR endpoint"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 403), body: {resp.text[:200]}")
            results.append(("TEST 5", "FAIL", f"Expected 403, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 5", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 6: GET /api/absensi/today (as staff) → returns structure
    # ========================================================================
    test_case(6, "GET /api/absensi/today (as staff) → returns structure")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/today", headers=staff_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            has_date = "date" in data
            has_now = "now" in data
            has_record = "record" in data
            has_shifts = "shifts" in data
            has_location = "location" in data
            has_suggested = "suggested_shift_key" in data
            log(f"✅ Status: 200")
            log(f"   date: {data.get('date')}, now: {data.get('now')}")
            log(f"   record: {data.get('record')}, suggested_shift_key: {data.get('suggested_shift_key')}")
            if all([has_date, has_now, has_record, has_shifts, has_location, has_suggested]):
                results.append(("TEST 6", "PASS", "Today endpoint returns complete structure"))
            else:
                results.append(("TEST 6", "FAIL", "Missing fields in today response"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 6", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 6", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 7: POST /api/absensi/check-in (as staff) with MISSING qr_value → 400
    # ========================================================================
    test_case(7, "POST /api/absensi/check-in (as staff) with MISSING qr_value → 400")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-in",
            headers=staff_headers,
            json={
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "shift_key": "apotek_pagi",
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 400:
            log(f"✅ Status: 400 (as expected), error: {resp.json().get('error')}")
            results.append(("TEST 7", "PASS", "Missing QR rejected with 400"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 400), body: {resp.text[:200]}")
            results.append(("TEST 7", "FAIL", f"Expected 400, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 7", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 8: POST /api/absensi/check-in (as staff) with WRONG qr_value → 400
    # ========================================================================
    test_case(8, "POST /api/absensi/check-in (as staff) with WRONG qr_value → 400")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-in",
            headers=staff_headers,
            json={
                "qr_value": "MIS-ABSENSI:wrong-secret",
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "shift_key": "apotek_pagi",
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 400:
            error = resp.json().get("error", "")
            log(f"✅ Status: 400 (as expected), error: {error}")
            if "QR tidak valid" in error or "bukan QR Absensi MIS" in error:
                results.append(("TEST 8", "PASS", "Wrong QR rejected with correct error"))
            else:
                results.append(("TEST 8", "FAIL", f"Wrong error message: {error}"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 400), body: {resp.text[:200]}")
            results.append(("TEST 8", "FAIL", f"Expected 400, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 8", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 9: PUT /api/absensi/settings (owner) with location → 200
    # ========================================================================
    test_case(9, "PUT /api/absensi/settings (owner) with location → 200")
    try:
        resp = requests.put(
            f"{BASE_URL}/api/absensi/settings",
            headers=owner_headers,
            json={
                "location": {
                    "name": "Test Location",
                    "lat": TEST_LAT,
                    "lng": TEST_LNG,
                    "radius_m": TEST_RADIUS
                }
            },
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            settings = data.get("settings", {})
            location = settings.get("location", {})
            log(f"✅ Status: 200, location: {location}")
            if location.get("lat") == TEST_LAT and location.get("lng") == TEST_LNG:
                results.append(("TEST 9", "PASS", f"Location updated: {location}"))
            else:
                results.append(("TEST 9", "FAIL", f"Location mismatch: {location}"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 9", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 9", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 10: POST /api/absensi/check-in (staff) with far location → 400
    # ========================================================================
    test_case(10, "POST /api/absensi/check-in (staff) with far location → 400")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-in",
            headers=staff_headers,
            json={
                "qr_value": qr_value,
                "lat": FAR_LAT,
                "lng": FAR_LNG,
                "shift_key": "apotek_pagi",
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 400:
            error = resp.json().get("error", "")
            log(f"✅ Status: 400 (as expected), error: {error}")
            if "di luar area absensi" in error or "luar area" in error:
                results.append(("TEST 10", "PASS", "Far location rejected with correct error"))
            else:
                results.append(("TEST 10", "FAIL", f"Wrong error message: {error}"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 400), body: {resp.text[:200]}")
            results.append(("TEST 10", "FAIL", f"Expected 400, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 10", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 11: POST /api/absensi/check-in (staff) with valid data → 200
    # ========================================================================
    test_case(11, "POST /api/absensi/check-in (staff) with valid data → 200")
    record_id = None
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-in",
            headers=staff_headers,
            json={
                "qr_value": qr_value,
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "shift_key": "apotek_pagi",
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            record = data.get("record", {})
            record_id = record.get("id")
            actual_check_in = record.get("actual_check_in")
            late_minutes = record.get("late_minutes")
            log(f"✅ Status: 200")
            log(f"   record_id: {record_id}")
            log(f"   actual_check_in: {actual_check_in}")
            log(f"   late_minutes: {late_minutes} (depends on WITA time)")
            if actual_check_in and record_id:
                results.append(("TEST 11", "PASS", f"Check-in successful, late_minutes: {late_minutes}"))
            else:
                results.append(("TEST 11", "FAIL", "Missing actual_check_in or record_id"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 11", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 11", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 12: POST /api/absensi/check-in (staff) AGAIN same day → 400
    # ========================================================================
    test_case(12, "POST /api/absensi/check-in (staff) AGAIN same day → 400")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-in",
            headers=staff_headers,
            json={
                "qr_value": qr_value,
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "shift_key": "apotek_pagi",
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 400:
            error = resp.json().get("error", "")
            log(f"✅ Status: 400 (as expected), error: {error}")
            if "sudah absen masuk" in error:
                results.append(("TEST 12", "PASS", "Duplicate check-in rejected"))
            else:
                results.append(("TEST 12", "FAIL", f"Wrong error message: {error}"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 400), body: {resp.text[:200]}")
            results.append(("TEST 12", "FAIL", f"Expected 400, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 12", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 13: POST /api/absensi/check-out (staff) BEFORE check-in → 400
    # ========================================================================
    test_case(13, "POST /api/absensi/check-out (staff) BEFORE check-in → N/A (already checked in)")
    # Skip this test since we already checked in. Document as N/A.
    log("⚠️  SKIPPED: Staff already checked in today. Cannot test check-out before check-in.")
    results.append(("TEST 13", "N/A", "Staff already checked in, cannot test check-out before check-in"))
    
    # ========================================================================
    # TEST 14: POST /api/absensi/check-out (staff) with valid data → 200
    # ========================================================================
    test_case(14, "POST /api/absensi/check-out (staff) with valid data → 200")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-out",
            headers=staff_headers,
            json={
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            record = data.get("record", {})
            actual_check_out = record.get("actual_check_out")
            worked_minutes = record.get("worked_minutes")
            overtime_minutes = record.get("overtime_minutes")
            log(f"✅ Status: 200")
            log(f"   actual_check_out: {actual_check_out}")
            log(f"   worked_minutes: {worked_minutes}")
            log(f"   overtime_minutes: {overtime_minutes} (depends on WITA time)")
            if actual_check_out is not None and worked_minutes is not None:
                results.append(("TEST 14", "PASS", f"Check-out successful, worked: {worked_minutes}m, overtime: {overtime_minutes}m"))
            else:
                results.append(("TEST 14", "FAIL", "Missing actual_check_out or worked_minutes"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 14", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 14", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 15: POST /api/absensi/check-out (staff) AGAIN → 400
    # ========================================================================
    test_case(15, "POST /api/absensi/check-out (staff) AGAIN → 400")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/absensi/check-out",
            headers=staff_headers,
            json={
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "photo_data_url": TINY_PNG_DATA_URL
            },
            timeout=10
        )
        if resp.status_code == 400:
            error = resp.json().get("error", "")
            log(f"✅ Status: 400 (as expected), error: {error}")
            if "sudah absen keluar" in error:
                results.append(("TEST 15", "PASS", "Duplicate check-out rejected"))
            else:
                results.append(("TEST 15", "FAIL", f"Wrong error message: {error}"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 400), body: {resp.text[:200]}")
            results.append(("TEST 15", "FAIL", f"Expected 400, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 15", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 16: GET /api/absensi/my-history (staff) → contains today's record
    # ========================================================================
    test_case(16, "GET /api/absensi/my-history (staff) → contains today's record")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/my-history", headers=staff_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            log(f"✅ Status: 200, items count: {len(items)}")
            if len(items) > 0:
                first = items[0]
                has_check_in_photo = first.get("has_check_in_photo")
                has_check_out_photo = first.get("has_check_out_photo")
                has_check_in_selfie = "check_in_selfie" in first
                has_check_out_selfie = "check_out_selfie" in first
                log(f"   First record: date={first.get('date')}, has_check_in_photo={has_check_in_photo}, has_check_out_photo={has_check_out_photo}")
                log(f"   Selfie fields present: check_in_selfie={has_check_in_selfie}, check_out_selfie={has_check_out_selfie}")
                if has_check_in_photo and has_check_out_photo and not has_check_in_selfie and not has_check_out_selfie:
                    results.append(("TEST 16", "PASS", "History contains today's record with boolean flags, no selfie fields"))
                else:
                    results.append(("TEST 16", "FAIL", f"Selfie fields exposed or missing boolean flags"))
            else:
                results.append(("TEST 16", "FAIL", "No history items returned"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 16", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 16", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 17: GET /api/absensi/dashboard (owner) → summary + records
    # ========================================================================
    test_case(17, "GET /api/absensi/dashboard (owner) → summary + records")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/dashboard", headers=owner_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            summary = data.get("summary", {})
            records = data.get("records", [])
            not_checked_in = data.get("not_checked_in", [])
            log(f"✅ Status: 200")
            log(f"   summary: {summary}")
            log(f"   records count: {len(records)}")
            log(f"   not_checked_in count: {len(not_checked_in)}")
            if summary.get("checked_in", 0) >= 1 and len(records) >= 1:
                results.append(("TEST 17", "PASS", f"Dashboard shows {summary.get('checked_in')} checked in, {len(records)} records"))
            else:
                results.append(("TEST 17", "FAIL", "Dashboard missing checked_in or records"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 17", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 17", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 18: GET /api/absensi/dashboard (staff) → 403
    # ========================================================================
    test_case(18, "GET /api/absensi/dashboard (staff) → 403")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/dashboard", headers=staff_headers, timeout=10)
        if resp.status_code == 403:
            log(f"✅ Status: 403 (as expected)")
            results.append(("TEST 18", "PASS", "Staff denied access to dashboard"))
        else:
            log(f"❌ Status: {resp.status_code} (expected 403), body: {resp.text[:200]}")
            results.append(("TEST 18", "FAIL", f"Expected 403, got {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 18", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 19: GET /api/absensi/overtime?status=pending (owner) → items array
    # ========================================================================
    test_case(19, "GET /api/absensi/overtime?status=pending (owner) → items array")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/overtime?status=pending", headers=owner_headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            log(f"✅ Status: 200, pending overtime items: {len(items)}")
            results.append(("TEST 19", "PASS", f"Overtime endpoint returns {len(items)} pending items"))
        else:
            log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
            results.append(("TEST 19", "FAIL", f"Status {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 19", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 20: POST /api/absensi/overtime/:id/reject (owner) → 200
    # ========================================================================
    test_case(20, "POST /api/absensi/overtime/:id/reject (owner) → 200 (if overtime > 0)")
    # First check if there's overtime
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/overtime?status=pending", headers=owner_headers, timeout=10)
        if resp.status_code == 200:
            items = resp.json().get("items", [])
            if len(items) > 0:
                ot_record_id = items[0].get("id")
                log(f"Found pending overtime record: {ot_record_id}")
                # Reject it
                resp2 = requests.post(
                    f"{BASE_URL}/api/absensi/overtime/{ot_record_id}/reject",
                    headers=owner_headers,
                    json={"note": "terlalu larut"},
                    timeout=10
                )
                if resp2.status_code == 200:
                    log(f"✅ Reject successful: {resp2.json()}")
                    # Verify it's no longer in pending
                    resp3 = requests.get(f"{BASE_URL}/api/absensi/overtime?status=pending", headers=owner_headers, timeout=10)
                    pending_after = resp3.json().get("items", [])
                    resp4 = requests.get(f"{BASE_URL}/api/absensi/overtime?status=rejected", headers=owner_headers, timeout=10)
                    rejected = resp4.json().get("items", [])
                    log(f"   Pending after reject: {len(pending_after)}, Rejected: {len(rejected)}")
                    if any(r.get("id") == ot_record_id for r in rejected):
                        results.append(("TEST 20", "PASS", "Overtime rejected successfully, moved to rejected list"))
                    else:
                        results.append(("TEST 20", "FAIL", "Rejected record not found in rejected list"))
                else:
                    log(f"❌ Reject failed: {resp2.status_code}, {resp2.text[:200]}")
                    results.append(("TEST 20", "FAIL", f"Reject status {resp2.status_code}"))
            else:
                log("⚠️  No pending overtime records to reject")
                results.append(("TEST 20", "N/A", "No pending overtime records (overtime_minutes may be 0)"))
        else:
            log(f"❌ Failed to fetch overtime: {resp.status_code}")
            results.append(("TEST 20", "FAIL", f"Failed to fetch overtime: {resp.status_code}"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 20", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 21: GET /api/absensi/record/:id/selfie/in (owner) → 200 image
    # ========================================================================
    test_case(21, "GET /api/absensi/record/:id/selfie/in (owner) → 200 image")
    try:
        if record_id:
            resp = requests.get(f"{BASE_URL}/api/absensi/record/{record_id}/selfie/in", headers=owner_headers, timeout=10)
            if resp.status_code == 200:
                content_type = resp.headers.get("Content-Type", "")
                body_len = len(resp.content)
                log(f"✅ Status: 200, Content-Type: {content_type}, body length: {body_len} bytes")
                if "image" in content_type and body_len > 0:
                    results.append(("TEST 21", "PASS", f"Selfie retrieved: {content_type}, {body_len} bytes"))
                else:
                    results.append(("TEST 21", "FAIL", f"Wrong content type or empty body: {content_type}, {body_len}"))
            else:
                log(f"❌ Status: {resp.status_code}, body: {resp.text[:200]}")
                results.append(("TEST 21", "FAIL", f"Status {resp.status_code}"))
        else:
            log("⚠️  No record_id from check-in, skipping")
            results.append(("TEST 21", "N/A", "No record_id available"))
    except Exception as e:
        log(f"❌ Exception: {e}")
        results.append(("TEST 21", "FAIL", str(e)))
    
    # ========================================================================
    # TEST 22: GET /api/absensi/record/:id/selfie/in (other staff) → 403
    # ========================================================================
    test_case(22, "GET /api/absensi/record/:id/selfie/in (other staff) → 403 (OPTIONAL)")
    log("⚠️  SKIPPED: Only 1 staff account available (cindy). Cannot test cross-staff access.")
    results.append(("TEST 22", "N/A", "Only 1 staff account available, cannot test cross-staff access"))
    
    # ========================================================================
    # TEST 23: Regression sanity checks
    # ========================================================================
    test_case(23, "Regression sanity checks — all still 200")
    regression_endpoints = [
        ("GET /api/om/dashboard", f"{BASE_URL}/api/om/dashboard", owner_headers),
        ("GET /api/om/shipments", f"{BASE_URL}/api/om/shipments", owner_headers),
        ("GET /api/dashboard", f"{BASE_URL}/api/dashboard", owner_headers),
        ("GET /api/faktur", f"{BASE_URL}/api/faktur", owner_headers),
        ("GET /api/tasks/mine (staff)", f"{BASE_URL}/api/tasks/mine", staff_headers),
        ("GET /api/employees (owner)", f"{BASE_URL}/api/employees", owner_headers),
    ]
    regression_pass = 0
    regression_fail = 0
    for name, url, headers in regression_endpoints:
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                log(f"✅ {name} → 200")
                regression_pass += 1
            else:
                log(f"❌ {name} → {resp.status_code}")
                regression_fail += 1
        except Exception as e:
            log(f"❌ {name} → Exception: {e}")
            regression_fail += 1
    
    if regression_fail == 0:
        results.append(("TEST 23", "PASS", f"All {regression_pass} regression endpoints working"))
    else:
        results.append(("TEST 23", "FAIL", f"{regression_fail} regression endpoints failed"))
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    pass_count = sum(1 for r in results if r[1] == "PASS")
    fail_count = sum(1 for r in results if r[1] == "FAIL")
    na_count = sum(1 for r in results if r[1] == "N/A")
    
    for test, status, detail in results:
        icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
        print(f"{icon} {test}: {status} — {detail}")
    
    print("\n" + "="*80)
    print(f"TOTAL: {pass_count} PASS, {fail_count} FAIL, {na_count} N/A (out of 23 tests)")
    print("="*80)
    
    if fail_count == 0:
        print("\n🎉 ALL TESTS PASSED (excluding N/A)!")
    else:
        print(f"\n⚠️  {fail_count} TEST(S) FAILED")

if __name__ == "__main__":
    main()
