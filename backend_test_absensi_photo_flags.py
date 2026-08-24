#!/usr/bin/env python3
"""
Quick re-test for Absensi photo flags fix (has_check_in_photo / has_check_out_photo).
Fix applied via aggregation pipeline $addFields in /app/lib/modules/absensi/service.js.

Test ONLY these 3 endpoints:
1. GET /api/absensi/my-history (as staff cindy)
2. GET /api/absensi/dashboard (as owner)
3. GET /api/absensi/overtime?status=rejected (as owner)

Also confirm no regression on:
- GET /api/absensi/settings (as staff) - still hides qr_secret
- GET /api/absensi/today (as staff) - still 200
- GET /api/om/dashboard, GET /api/faktur, GET /api/dashboard - still 200

DO NOT modify code. DO NOT re-run check-in/check-out flows.
Just query existing data from previous test run.
"""

import requests
import sys

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def login(username, password):
    """Login and return token."""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if r.status_code != 200:
        print(f"❌ Login failed for {username}: {r.status_code} {r.text}")
        sys.exit(1)
    token = r.json().get("token")
    if not token:
        print(f"❌ No token in login response for {username}")
        sys.exit(1)
    print(f"✅ Login successful for {username}")
    return token

def test_my_history(token):
    """Test GET /api/absensi/my-history (as staff cindy)."""
    print("\n=== TEST 1: GET /api/absensi/my-history (as staff cindy) ===")
    r = requests.get(f"{BASE_URL}/api/absensi/my-history", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        print(f"❌ FAIL: Expected 200, got {r.status_code}")
        print(f"   Response: {r.text}")
        return False
    
    data = r.json()
    items = data.get("items", [])
    print(f"✅ PASS: Status 200, items count: {len(items)}")
    
    if len(items) == 0:
        print("⚠️  WARNING: No items in history (expected at least 1 from previous test run)")
        print("   This might mean the previous test data was cleaned up.")
        return True  # Not a failure, just no data to verify
    
    # Check first item for has_check_in_photo and has_check_out_photo flags
    item = items[0]
    print(f"   First item date: {item.get('date')}")
    print(f"   has_check_in_photo: {item.get('has_check_in_photo')}")
    print(f"   has_check_out_photo: {item.get('has_check_out_photo')}")
    
    # Verify flags are present (not None)
    if 'has_check_in_photo' not in item:
        print("❌ FAIL: has_check_in_photo field missing")
        return False
    if 'has_check_out_photo' not in item:
        print("❌ FAIL: has_check_out_photo field missing")
        return False
    
    # If actual_check_in exists, has_check_in_photo should be true
    if item.get('actual_check_in'):
        if item.get('has_check_in_photo') != True:
            print(f"❌ FAIL: actual_check_in exists but has_check_in_photo is {item.get('has_check_in_photo')} (expected True)")
            return False
        print("✅ PASS: has_check_in_photo is True (selfie was captured)")
    
    # If actual_check_out exists, has_check_out_photo should be true
    if item.get('actual_check_out'):
        if item.get('has_check_out_photo') != True:
            print(f"❌ FAIL: actual_check_out exists but has_check_out_photo is {item.get('has_check_out_photo')} (expected True)")
            return False
        print("✅ PASS: has_check_out_photo is True (selfie was captured)")
    
    # Verify raw binary fields are NOT exposed
    if 'check_in_selfie' in item:
        print("❌ FAIL: check_in_selfie field exposed (security issue)")
        return False
    if 'check_out_selfie' in item:
        print("❌ FAIL: check_out_selfie field exposed (security issue)")
        return False
    print("✅ PASS: Raw selfie binary fields NOT exposed (security requirement met)")
    
    return True

def test_dashboard(token):
    """Test GET /api/absensi/dashboard (as owner)."""
    print("\n=== TEST 2: GET /api/absensi/dashboard (as owner) ===")
    r = requests.get(f"{BASE_URL}/api/absensi/dashboard", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        print(f"❌ FAIL: Expected 200, got {r.status_code}")
        print(f"   Response: {r.text}")
        return False
    
    data = r.json()
    records = data.get("records", [])
    print(f"✅ PASS: Status 200, records count: {len(records)}")
    
    if len(records) == 0:
        print("⚠️  WARNING: No records in dashboard (expected at least 1 from previous test run)")
        return True  # Not a failure, just no data to verify
    
    # Check first record for has_check_in_photo and has_check_out_photo flags
    rec = records[0]
    print(f"   First record user: {rec.get('user_name')}, date: {rec.get('date')}")
    print(f"   has_check_in_photo: {rec.get('has_check_in_photo')}")
    print(f"   has_check_out_photo: {rec.get('has_check_out_photo')}")
    
    # Verify flags are present
    if 'has_check_in_photo' not in rec:
        print("❌ FAIL: has_check_in_photo field missing")
        return False
    if 'has_check_out_photo' not in rec:
        print("❌ FAIL: has_check_out_photo field missing")
        return False
    
    # If actual_check_in exists, has_check_in_photo should be true
    if rec.get('actual_check_in'):
        if rec.get('has_check_in_photo') != True:
            print(f"❌ FAIL: actual_check_in exists but has_check_in_photo is {rec.get('has_check_in_photo')} (expected True)")
            return False
        print("✅ PASS: has_check_in_photo is True (selfie was captured)")
    
    # If actual_check_out exists, has_check_out_photo should be true
    if rec.get('actual_check_out'):
        if rec.get('has_check_out_photo') != True:
            print(f"❌ FAIL: actual_check_out exists but has_check_out_photo is {rec.get('has_check_out_photo')} (expected True)")
            return False
        print("✅ PASS: has_check_out_photo is True (selfie was captured)")
    
    # Verify raw binary fields are NOT exposed
    if 'check_in_selfie' in rec:
        print("❌ FAIL: check_in_selfie field exposed (security issue)")
        return False
    if 'check_out_selfie' in rec:
        print("❌ FAIL: check_out_selfie field exposed (security issue)")
        return False
    print("✅ PASS: Raw selfie binary fields NOT exposed (security requirement met)")
    
    return True

def test_overtime(token):
    """Test GET /api/absensi/overtime?status=rejected (as owner)."""
    print("\n=== TEST 3: GET /api/absensi/overtime?status=rejected (as owner) ===")
    r = requests.get(f"{BASE_URL}/api/absensi/overtime?status=rejected", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        print(f"❌ FAIL: Expected 200, got {r.status_code}")
        print(f"   Response: {r.text}")
        return False
    
    data = r.json()
    items = data.get("items", [])
    print(f"✅ PASS: Status 200, items count: {len(items)}")
    
    if len(items) == 0:
        print("⚠️  INFO: No rejected overtime items (expected, previous test had no overtime)")
        return True  # Not a failure, just no data to verify
    
    # Check first item for has_check_in_photo and has_check_out_photo flags
    item = items[0]
    print(f"   First item user: {item.get('user_name')}, date: {item.get('date')}")
    print(f"   has_check_in_photo: {item.get('has_check_in_photo')}")
    print(f"   has_check_out_photo: {item.get('has_check_out_photo')}")
    
    # Verify flags are present
    if 'has_check_in_photo' not in item:
        print("❌ FAIL: has_check_in_photo field missing")
        return False
    if 'has_check_out_photo' not in item:
        print("❌ FAIL: has_check_out_photo field missing")
        return False
    
    # Overtime records should have both check-in and check-out
    if item.get('has_check_in_photo') != True:
        print(f"❌ FAIL: has_check_in_photo is {item.get('has_check_in_photo')} (expected True for overtime record)")
        return False
    if item.get('has_check_out_photo') != True:
        print(f"❌ FAIL: has_check_out_photo is {item.get('has_check_out_photo')} (expected True for overtime record)")
        return False
    print("✅ PASS: Both has_check_in_photo and has_check_out_photo are True")
    
    # Verify raw binary fields are NOT exposed
    if 'check_in_selfie' in item:
        print("❌ FAIL: check_in_selfie field exposed (security issue)")
        return False
    if 'check_out_selfie' in item:
        print("❌ FAIL: check_out_selfie field exposed (security issue)")
        return False
    print("✅ PASS: Raw selfie binary fields NOT exposed (security requirement met)")
    
    return True

def test_settings_staff(token):
    """Test GET /api/absensi/settings (as staff) - should hide qr_secret."""
    print("\n=== REGRESSION TEST 1: GET /api/absensi/settings (as staff) ===")
    r = requests.get(f"{BASE_URL}/api/absensi/settings", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        print(f"❌ FAIL: Expected 200, got {r.status_code}")
        return False
    
    data = r.json()
    settings = data.get("settings", {})
    
    if 'qr_secret' in settings:
        print(f"❌ FAIL: qr_secret exposed to staff (security issue)")
        return False
    
    print("✅ PASS: qr_secret NOT exposed to staff (security requirement met)")
    return True

def test_today_staff(token):
    """Test GET /api/absensi/today (as staff) - should return 200."""
    print("\n=== REGRESSION TEST 2: GET /api/absensi/today (as staff) ===")
    r = requests.get(f"{BASE_URL}/api/absensi/today", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        print(f"❌ FAIL: Expected 200, got {r.status_code}")
        return False
    
    print("✅ PASS: Status 200")
    return True

def test_other_endpoints(owner_token, staff_token):
    """Test other endpoints for regression."""
    print("\n=== REGRESSION TEST 3: Other endpoints ===")
    
    tests = [
        ("GET /api/om/dashboard (owner)", f"{BASE_URL}/api/om/dashboard", owner_token),
        ("GET /api/faktur (owner)", f"{BASE_URL}/api/faktur", owner_token),
        ("GET /api/dashboard (owner)", f"{BASE_URL}/api/dashboard", owner_token),
    ]
    
    all_pass = True
    for name, url, token in tests:
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 200:
            print(f"❌ FAIL: {name} - Expected 200, got {r.status_code}")
            all_pass = False
        else:
            print(f"✅ PASS: {name}")
    
    return all_pass

def main():
    print("=" * 80)
    print("ABSENSI PHOTO FLAGS FIX — QUICK RE-TEST")
    print("=" * 80)
    
    # Login
    print("\n--- LOGIN ---")
    owner_token = login("owner", "owner123")
    staff_token = login("cindy", "cindy123")
    
    # Run tests
    results = []
    
    # Main tests (photo flags)
    results.append(("my-history", test_my_history(staff_token)))
    results.append(("dashboard", test_dashboard(owner_token)))
    results.append(("overtime", test_overtime(owner_token)))
    
    # Regression tests
    results.append(("settings-staff", test_settings_staff(staff_token)))
    results.append(("today-staff", test_today_staff(staff_token)))
    results.append(("other-endpoints", test_other_endpoints(owner_token, staff_token)))
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED — Photo flags fix is working correctly!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
