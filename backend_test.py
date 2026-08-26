#!/usr/bin/env python3
"""
Backend test for Absensi Check-Out QR Validation
Tests the new QR gate on POST /api/absensi/check-out endpoint.
"""

import requests
import json
from datetime import datetime
from pymongo import MongoClient
import os

# Configuration
BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "cycle_count")

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}

# Valid small WebP data URL for testing (< 500KB)
VALID_PHOTO = "data:image/webp;base64,UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAEAcQERGIiP4HAA=="

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(passed, msg):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {msg}")

def login(creds):
    """Login and return token"""
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            print(f"✅ Login successful: {creds['username']}")
            return token
        else:
            print(f"❌ Login failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return None

def get_qr_value(owner_token):
    """Fetch QR value as owner"""
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.get(f"{BASE_URL}/api/absensi/qr", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            qr_value = data.get("qr_value")
            print(f"✅ QR value fetched: {qr_value}")
            return qr_value
        else:
            print(f"❌ Failed to fetch QR: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ QR fetch exception: {e}")
        return None

def get_settings(staff_token):
    """Get absensi settings to fetch location"""
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{BASE_URL}/api/absensi/settings", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            settings = data.get("settings", {})
            location = settings.get("location", {})
            print(f"✅ Settings fetched: location={location}")
            return settings
        else:
            print(f"❌ Failed to fetch settings: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Settings fetch exception: {e}")
        return None

def get_today_status(staff_token):
    """Get today's attendance status"""
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{BASE_URL}/api/absensi/today", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            record = data.get("record")
            suggested_shift = data.get("suggested_shift_key")
            print(f"✅ Today status: record={record is not None}, suggested_shift={suggested_shift}")
            return data
        else:
            print(f"❌ Failed to fetch today status: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Today status exception: {e}")
        return None

def check_in(staff_token, qr_value, lat, lng, shift_key):
    """Perform check-in"""
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        body = {
            "qr_value": qr_value,
            "lat": lat,
            "lng": lng,
            "shift_key": shift_key,
            "photo_data_url": VALID_PHOTO
        }
        resp = requests.post(f"{BASE_URL}/api/absensi/check-in", headers=headers, json=body, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            print(f"✅ Check-in successful: {data.get('record', {}).get('actual_check_in_wita')}")
            return data
        else:
            print(f"❌ Check-in failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Check-in exception: {e}")
        return None

def check_out(staff_token, qr_value, lat, lng):
    """Perform check-out"""
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        body = {
            "lat": lat,
            "lng": lng,
            "photo_data_url": VALID_PHOTO
        }
        if qr_value is not None:
            body["qr_value"] = qr_value
        
        print(f"DEBUG: Calling POST /api/absensi/check-out with body keys: {list(body.keys())}")
        resp = requests.post(f"{BASE_URL}/api/absensi/check-out", headers=headers, json=body, timeout=10)
        print(f"DEBUG: Response status: {resp.status_code}")
        return resp
    except Exception as e:
        print(f"DEBUG: Exception in check_out: {type(e).__name__}: {e}")
        raise

def delete_today_record(user_id):
    """Delete today's attendance record for a user via MongoDB"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Get today's date in WITA format (YYYY-MM-DD)
        from datetime import datetime
        import pytz
        wita = pytz.timezone('Asia/Makassar')
        today = datetime.now(wita).strftime('%Y-%m-%d')
        
        result = db.absensi_records.delete_many({"user_id": user_id, "date": today})
        print(f"✅ Deleted {result.deleted_count} record(s) for user {user_id} on {today}")
        client.close()
        return True
    except Exception as e:
        print(f"❌ MongoDB delete exception: {e}")
        return False

def get_user_id(staff_token):
    """Get current user ID"""
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            user_id = data.get("user", {}).get("id")
            print(f"✅ User ID: {user_id}")
            return user_id
        else:
            print(f"❌ Failed to get user: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Get user exception: {e}")
        return None

def ensure_cindy_has_absensi_module(owner_token):
    """Ensure cindy has absensi module"""
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        # Get all employees
        resp = requests.get(f"{BASE_URL}/api/employees", headers=headers, timeout=10)
        if resp.status_code != 200:
            print(f"❌ Failed to get employees: {resp.status_code}")
            return False
        
        employees = resp.json().get("items", [])
        cindy = next((e for e in employees if e.get("username") == "cindy"), None)
        
        if not cindy:
            print(f"❌ Cindy not found in employees")
            return False
        
        modules = cindy.get("modules", [])
        if "absensi" in modules:
            print(f"✅ Cindy already has absensi module")
            return True
        
        # Add absensi module
        modules.append("absensi")
        resp = requests.put(
            f"{BASE_URL}/api/employees/{cindy['id']}", 
            headers=headers, 
            json={"modules": modules},
            timeout=10
        )
        
        if resp.status_code == 200:
            print(f"✅ Added absensi module to Cindy")
            return True
        else:
            print(f"❌ Failed to add module: {resp.status_code} - {resp.text}")
            return False
            
    except Exception as e:
        print(f"❌ Module update exception: {e}")
        return False

def main():
    print("\n" + "="*80)
    print("ABSENSI CHECK-OUT QR VALIDATION TEST")
    print("="*80)
    
    test_results = []
    
    # Step 1: Login as owner and fetch QR value
    print_test("STEP 1: Fetch QR value as owner")
    owner_token = login(OWNER_CREDS)
    if not owner_token:
        print("❌ CRITICAL: Cannot login as owner. Aborting.")
        return
    test_results.append(("Owner login", True))
    
    # Ensure cindy has absensi module
    if not ensure_cindy_has_absensi_module(owner_token):
        print("❌ CRITICAL: Cannot ensure cindy has absensi module. Aborting.")
        return
    
    qr_value = get_qr_value(owner_token)
    if not qr_value:
        print("❌ CRITICAL: Cannot fetch QR value. Aborting.")
        return
    test_results.append(("Fetch QR value", True))
    
    # Step 2: Login as staff (cindy)
    print_test("STEP 2: Login as staff (cindy)")
    staff_token = login(STAFF_CREDS)
    if not staff_token:
        print("❌ CRITICAL: Cannot login as cindy. Aborting.")
        return
    test_results.append(("Staff login", True))
    
    # Get user ID
    user_id = get_user_id(staff_token)
    if not user_id:
        print("❌ CRITICAL: Cannot get user ID. Aborting.")
        return
    
    # Get settings for location
    settings = get_settings(staff_token)
    if not settings:
        print("❌ CRITICAL: Cannot fetch settings. Aborting.")
        return
    
    location = settings.get("location", {})
    lat = location.get("lat", 0)
    lng = location.get("lng", 0)
    
    if lat == 0 and lng == 0:
        print("⚠️  WARNING: Location is 0,0. Setting test location.")
        lat = -8.65
        lng = 115.216
    
    # Step 3: Ensure cindy has an open check-in today
    print_test("STEP 3: Ensure cindy has open check-in today")
    today_data = get_today_status(staff_token)
    if not today_data:
        print("❌ CRITICAL: Cannot fetch today status. Aborting.")
        return
    
    record = today_data.get("record")
    suggested_shift = today_data.get("suggested_shift_key")
    
    # If already checked out today, reset by deleting record
    if record and record.get("actual_check_out"):
        print("⚠️  Already checked out today. Deleting record to reset...")
        if not delete_today_record(user_id):
            print("❌ CRITICAL: Cannot delete today's record. Aborting.")
            return
        record = None
    
    # If not checked in, perform check-in
    if not record or not record.get("actual_check_in"):
        print("⚠️  Not checked in today. Performing check-in...")
        if not suggested_shift:
            suggested_shift = "apotek_pagi"  # Default shift
        
        check_in_result = check_in(staff_token, qr_value, lat, lng, suggested_shift)
        if not check_in_result:
            print("❌ CRITICAL: Cannot check-in. Aborting.")
            return
        test_results.append(("Check-in setup", True))
    else:
        print("✅ Already checked in today")
        test_results.append(("Check-in already exists", True))
    
    # Step 4: Negative test A - missing qr_value
    print_test("STEP 4: Negative Test A - Missing qr_value")
    try:
        resp = check_out(staff_token, None, lat, lng)
        print(f"DEBUG: resp is None: {resp is None}, resp type: {type(resp)}")
        if resp is not None:
            print(f"DEBUG: resp.status_code: {resp.status_code}")
            print(f"DEBUG: resp.text: {resp.text[:200]}")
            if resp.status_code == 400:
                error_msg = resp.json().get("error", "")
                if "QR belum discan" in error_msg:
                    print_result(True, f"Missing qr_value correctly rejected: {error_msg}")
                    test_results.append(("Negative A: missing qr_value", True))
                else:
                    print_result(False, f"Wrong error message: {error_msg}")
                    test_results.append(("Negative A: missing qr_value", False))
            else:
                print_result(False, f"Expected 400, got {resp.status_code}: {resp.text}")
                test_results.append(("Negative A: missing qr_value", False))
        else:
            print_result(False, f"Response is None")
            test_results.append(("Negative A: missing qr_value", False))
    except Exception as e:
        import traceback
        print(f"DEBUG: Exception traceback:")
        traceback.print_exc()
        print_result(False, f"Exception: {e}")
        test_results.append(("Negative A: missing qr_value", False))
    
    # Step 5: Negative test B - invalid qr_value
    print_test("STEP 5: Negative Test B - Invalid qr_value")
    try:
        invalid_qr = "MIS-ABSENSI:wrong-uuid-12345"
        resp = check_out(staff_token, invalid_qr, lat, lng)
        if resp is not None:
            if resp.status_code == 400:
                error_msg = resp.json().get("error", "")
                if "QR tidak valid" in error_msg:
                    print_result(True, f"Invalid qr_value correctly rejected: {error_msg}")
                    test_results.append(("Negative B: invalid qr_value", True))
                else:
                    print_result(False, f"Wrong error message: {error_msg}")
                    test_results.append(("Negative B: invalid qr_value", False))
            else:
                print_result(False, f"Expected 400, got {resp.status_code}: {resp.text}")
                test_results.append(("Negative B: invalid qr_value", False))
        else:
            print_result(False, f"Response is None")
            test_results.append(("Negative B: invalid qr_value", False))
    except Exception as e:
        import traceback
        print(f"DEBUG: Exception traceback:")
        traceback.print_exc()
        print_result(False, f"Exception: {e}")
        test_results.append(("Negative B: invalid qr_value", False))
    
    # Step 6: Positive test - valid qr_value
    print_test("STEP 6: Positive Test - Valid qr_value")
    resp = check_out(staff_token, qr_value, lat, lng)
    if resp and resp.status_code == 200:
        data = resp.json()
        record = data.get("record", {})
        actual_check_out = record.get("actual_check_out")
        actual_check_out_wita = record.get("actual_check_out_wita")
        
        if actual_check_out and actual_check_out_wita:
            print_result(True, f"Valid check-out successful: {actual_check_out_wita}")
            test_results.append(("Positive: valid qr_value", True))
        else:
            print_result(False, f"Check-out succeeded but actual_check_out not set")
            test_results.append(("Positive: valid qr_value", False))
    else:
        error_msg = resp.json().get("error", "") if resp else "No response"
        print_result(False, f"Expected 200, got {resp.status_code if resp else 'None'}: {error_msg}")
        test_results.append(("Positive: valid qr_value", False))
    
    # Step 7: Regression check - check-in still works
    print_test("STEP 7: Regression Check - Check-in QR validation")
    
    # Delete today's record to test check-in again
    print("⚠️  Deleting today's record to test check-in regression...")
    if not delete_today_record(user_id):
        print("❌ Cannot delete record for regression test")
        test_results.append(("Regression: check-in", False))
    else:
        # Test check-in without qr_value
        print("\n7a. Check-in WITHOUT qr_value (should fail)")
        headers = {"Authorization": f"Bearer {staff_token}"}
        body = {
            "lat": lat,
            "lng": lng,
            "shift_key": suggested_shift or "apotek_pagi",
            "photo_data_url": VALID_PHOTO
        }
        resp = requests.post(f"{BASE_URL}/api/absensi/check-in", headers=headers, json=body, timeout=10)
        if resp.status_code == 400 and "QR belum discan" in resp.json().get("error", ""):
            print_result(True, "Check-in without QR correctly rejected")
            test_results.append(("Regression 7a: check-in no QR", True))
        else:
            print_result(False, f"Expected 400 'QR belum discan', got {resp.status_code}")
            test_results.append(("Regression 7a: check-in no QR", False))
        
        # Test check-in with invalid qr_value
        print("\n7b. Check-in with INVALID qr_value (should fail)")
        body["qr_value"] = "MIS-ABSENSI:wrong"
        resp = requests.post(f"{BASE_URL}/api/absensi/check-in", headers=headers, json=body, timeout=10)
        if resp.status_code == 400 and "QR tidak valid" in resp.json().get("error", ""):
            print_result(True, "Check-in with invalid QR correctly rejected")
            test_results.append(("Regression 7b: check-in invalid QR", True))
        else:
            print_result(False, f"Expected 400 'QR tidak valid', got {resp.status_code}")
            test_results.append(("Regression 7b: check-in invalid QR", False))
        
        # Test check-in with valid qr_value
        print("\n7c. Check-in with VALID qr_value (should succeed)")
        body["qr_value"] = qr_value
        resp = requests.post(f"{BASE_URL}/api/absensi/check-in", headers=headers, json=body, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("record", {}).get("actual_check_in"):
                print_result(True, "Check-in with valid QR successful")
                test_results.append(("Regression 7c: check-in valid QR", True))
            else:
                print_result(False, "Check-in succeeded but actual_check_in not set")
                test_results.append(("Regression 7c: check-in valid QR", False))
        else:
            print_result(False, f"Expected 200, got {resp.status_code}")
            test_results.append(("Regression 7c: check-in valid QR", False))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print("\n" + "="*80)
    print(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    print("="*80)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED! Absensi Check-Out QR Validation is WORKING.")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Review the output above.")

if __name__ == "__main__":
    main()
