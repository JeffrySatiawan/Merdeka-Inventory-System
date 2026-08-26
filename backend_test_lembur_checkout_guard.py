#!/usr/bin/env python3
"""
Backend test for Absensi Lembur submission after check-out guard.

Tests the new guard that prevents lembur submission after check-out:
if (rec.actual_check_out) return errRes('Anda sudah absen keluar — pengajuan lembur tidak bisa dibuat');

Test steps:
1. Login as cindy (cindy123). Delete today's absensi_records if exists.
2. Fetch VALID_QR from owner (owner/owner123) via GET /api/absensi/qr.
3. Check-in cindy with any shift.
4. Mutate record via MongoDB to set shift_end_mins so threshold is met.
5. Submit lembur BEFORE check-out → expect 200, overtime_requested=true. (Regression)
6. Reset overtime_requested by MongoDB.
7. Check out cindy.
8. Submit lembur AFTER check-out → expect 400 with error message containing "sudah absen keluar".
9. Regression: verify GET /api/absensi/today still returns settings.
"""

import requests
import sys
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
import os

BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://absensi-foundation.preview.emergentagent.com')
MONGO_URL = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.getenv('DB_NAME', 'cycle_count')

# Small test photo (1x1 webp, ~100 bytes)
TINY_PHOTO = 'data:image/webp;base64,UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAgAAAABDwCEBQAAVlA4IB4AAAAwAQCdASoBAAEAAkA4JZQAA3AA/vv/AAA='

def get_wita_date():
    """Get current date in WITA timezone (UTC+8) as YYYY-MM-DD."""
    wita = datetime.now(timezone.utc) + timedelta(hours=8)
    return wita.strftime('%Y-%m-%d')

def get_wita_mins():
    """Get current time in WITA as minutes since midnight."""
    wita = datetime.now(timezone.utc) + timedelta(hours=8)
    return wita.hour * 60 + wita.minute

def main():
    print("=" * 80)
    print("ABSENSI LEMBUR AFTER CHECK-OUT GUARD TEST")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test date: {get_wita_date()}")
    print(f"Current WITA time: {get_wita_mins()} mins")
    print()

    # Connect to MongoDB
    try:
        mongo_client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        mongo_client.server_info()
        db = mongo_client[DB_NAME]
        print("✅ MongoDB connection successful")
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        return 1

    today = get_wita_date()
    now_mins = get_wita_mins()

    # ========================================================================
    # STEP 1: Login as owner and cindy
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 1: LOGIN AS OWNER AND CINDY")
    print("=" * 80)

    try:
        # Owner login
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"}, timeout=10)
        if r.status_code != 200:
            print(f"❌ Owner login failed: {r.status_code} {r.text}")
            return 1
        owner_token = r.json().get('token')
        print(f"✅ Owner login successful, token: {owner_token[:20]}...")

        # Cindy login
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "cindy", "password": "cindy123"}, timeout=10)
        if r.status_code != 200:
            print(f"❌ Cindy login failed: {r.status_code} {r.text}")
            return 1
        cindy_token = r.json().get('token')
        cindy_user = r.json().get('user')
        cindy_id = cindy_user.get('id')
        print(f"✅ Cindy login successful, token: {cindy_token[:20]}..., id: {cindy_id}")
    except Exception as e:
        print(f"❌ Login failed: {e}")
        return 1

    # ========================================================================
    # STEP 2: Delete today's absensi_records for cindy if exists
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 2: DELETE TODAY'S ABSENSI RECORD FOR CINDY (if exists)")
    print("=" * 80)

    try:
        result = db.absensi_records.delete_one({"user_id": cindy_id, "date": today})
        if result.deleted_count > 0:
            print(f"✅ Deleted existing record for cindy on {today}")
        else:
            print(f"✅ No existing record for cindy on {today}")
    except Exception as e:
        print(f"❌ MongoDB delete failed: {e}")
        return 1

    # ========================================================================
    # STEP 3: Fetch VALID_QR from owner
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 3: FETCH VALID QR FROM OWNER")
    print("=" * 80)

    try:
        r = requests.get(f"{BASE_URL}/api/absensi/qr", headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        if r.status_code != 200:
            print(f"❌ GET /api/absensi/qr failed: {r.status_code} {r.text}")
            return 1
        qr_value = r.json().get('qr_value')
        print(f"✅ QR value: {qr_value}")
    except Exception as e:
        print(f"❌ Fetch QR failed: {e}")
        return 1

    # ========================================================================
    # STEP 4: Get settings for location
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 4: GET SETTINGS FOR LOCATION")
    print("=" * 80)

    try:
        r = requests.get(f"{BASE_URL}/api/absensi/settings", headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        if r.status_code != 200:
            print(f"❌ GET /api/absensi/settings failed: {r.status_code} {r.text}")
            return 1
        settings = r.json()
        location = settings.get('location', {})
        lat = location.get('lat', -8.65)
        lng = location.get('lng', 115.216)
        print(f"✅ Location: lat={lat}, lng={lng}")
        print(f"✅ overtime_request_threshold_min: {settings.get('overtime_request_threshold_min', 15)}")
        print(f"✅ so_mode_enabled: {settings.get('so_mode_enabled', False)}")
    except Exception as e:
        print(f"❌ Get settings failed: {e}")
        return 1

    # ========================================================================
    # STEP 5: Check-in cindy with apotek_pagi shift
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 5: CHECK-IN CINDY WITH APOTEK_PAGI SHIFT")
    print("=" * 80)

    try:
        checkin_body = {
            "qr_value": qr_value,
            "lat": lat,
            "lng": lng,
            "photo_data_url": TINY_PHOTO,
            "shift_key": "apotek_pagi"
        }
        r = requests.post(f"{BASE_URL}/api/absensi/check-in", 
                         json=checkin_body, 
                         headers={"Authorization": f"Bearer {cindy_token}"}, 
                         timeout=10)
        if r.status_code != 200:
            print(f"❌ Check-in failed: {r.status_code} {r.text}")
            return 1
        checkin_resp = r.json()
        record = checkin_resp.get('record', {})
        print(f"✅ Check-in successful")
        print(f"   shift_key: {record.get('shift_key')}")
        print(f"   shift_start_mins: {record.get('shift_start_mins')}")
        print(f"   shift_end_mins: {record.get('shift_end_mins')}")
    except Exception as e:
        print(f"❌ Check-in failed: {e}")
        return 1

    # ========================================================================
    # STEP 6: Mutate record via MongoDB to set shift_end_mins so threshold is met
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 6: MUTATE RECORD VIA MONGODB TO MEET THRESHOLD")
    print("=" * 80)

    try:
        # Set shift_end_mins to now - 20 so threshold (now >= shift_end + 15) is met
        new_shift_end = now_mins - 20
        result = db.absensi_records.update_one(
            {"user_id": cindy_id, "date": today},
            {"$set": {"shift_end_mins": new_shift_end}}
        )
        if result.modified_count > 0:
            print(f"✅ Updated shift_end_mins to {new_shift_end} (now={now_mins}, threshold will be met)")
        else:
            print(f"❌ Failed to update shift_end_mins")
            return 1
    except Exception as e:
        print(f"❌ MongoDB update failed: {e}")
        return 1

    # ========================================================================
    # STEP 7: Submit lembur BEFORE check-out (REGRESSION CHECK)
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 7: SUBMIT LEMBUR BEFORE CHECK-OUT (REGRESSION CHECK)")
    print("=" * 80)

    try:
        lembur_body = {
            "reason": "stock opname sebelum pulang"
        }
        r = requests.post(f"{BASE_URL}/api/absensi/lembur/submit", 
                         json=lembur_body, 
                         headers={"Authorization": f"Bearer {cindy_token}"}, 
                         timeout=10)
        if r.status_code != 200:
            print(f"❌ Lembur submit before check-out failed: {r.status_code} {r.text}")
            return 1
        lembur_resp = r.json()
        record = lembur_resp.get('record', {})
        print(f"✅ Lembur submit before check-out successful")
        print(f"   overtime_requested: {record.get('overtime_requested')}")
        print(f"   overtime_status: {record.get('overtime_status')}")
        print(f"   overtime_reason: {record.get('overtime_reason')}")
        
        # Verify overtime_requested is true
        if not record.get('overtime_requested'):
            print(f"❌ overtime_requested should be true, got: {record.get('overtime_requested')}")
            return 1
        print(f"✅ REGRESSION CHECK PASSED: Lembur submission before check-out works correctly")
    except Exception as e:
        print(f"❌ Lembur submit before check-out failed: {e}")
        return 1

    # ========================================================================
    # STEP 8: Reset overtime_requested by MongoDB
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 8: RESET OVERTIME_REQUESTED VIA MONGODB")
    print("=" * 80)

    try:
        result = db.absensi_records.update_one(
            {"user_id": cindy_id, "date": today},
            {
                "$set": {"overtime_requested": False, "overtime_status": None},
                "$unset": {"overtime_reason": "", "overtime_photo": "", "overtime_requested_at": ""}
            }
        )
        if result.modified_count > 0:
            print(f"✅ Reset overtime_requested to false")
        else:
            print(f"❌ Failed to reset overtime_requested")
            return 1
    except Exception as e:
        print(f"❌ MongoDB update failed: {e}")
        return 1

    # ========================================================================
    # STEP 9: Check out cindy
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 9: CHECK OUT CINDY")
    print("=" * 80)

    try:
        checkout_body = {
            "qr_value": qr_value,
            "lat": lat,
            "lng": lng,
            "photo_data_url": TINY_PHOTO
        }
        r = requests.post(f"{BASE_URL}/api/absensi/check-out", 
                         json=checkout_body, 
                         headers={"Authorization": f"Bearer {cindy_token}"}, 
                         timeout=10)
        if r.status_code != 200:
            print(f"❌ Check-out failed: {r.status_code} {r.text}")
            return 1
        checkout_resp = r.json()
        record = checkout_resp.get('record', {})
        print(f"✅ Check-out successful")
        print(f"   actual_check_out: {record.get('actual_check_out')}")
        print(f"   actual_check_out_wita: {record.get('actual_check_out_wita')}")
        
        # Verify actual_check_out is set
        if not record.get('actual_check_out'):
            print(f"❌ actual_check_out should be set, got: {record.get('actual_check_out')}")
            return 1
    except Exception as e:
        print(f"❌ Check-out failed: {e}")
        return 1

    # ========================================================================
    # STEP 10: Submit lembur AFTER check-out (CRITICAL TEST)
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 10: SUBMIT LEMBUR AFTER CHECK-OUT (CRITICAL TEST)")
    print("=" * 80)

    try:
        lembur_body = {
            "reason": "stock opname setelah pulang"
        }
        r = requests.post(f"{BASE_URL}/api/absensi/lembur/submit", 
                         json=lembur_body, 
                         headers={"Authorization": f"Bearer {cindy_token}"}, 
                         timeout=10)
        
        # EXPECT 400 with error message containing "sudah absen keluar"
        if r.status_code == 400:
            error_msg = r.json().get('error', '')
            print(f"✅ Lembur submit after check-out correctly rejected with 400")
            print(f"   Error message: {error_msg}")
            
            # Verify error message contains expected text
            if "sudah absen keluar" in error_msg.lower() or "tidak bisa dibuat" in error_msg.lower():
                print(f"✅ CRITICAL TEST PASSED: Error message contains expected text")
            else:
                print(f"❌ Error message does not contain expected text ('sudah absen keluar' or 'tidak bisa dibuat')")
                print(f"   Got: {error_msg}")
                return 1
        else:
            print(f"❌ CRITICAL TEST FAILED: Expected 400, got {r.status_code}")
            print(f"   Response: {r.text}")
            return 1
    except Exception as e:
        print(f"❌ Lembur submit after check-out test failed: {e}")
        return 1

    # ========================================================================
    # STEP 11: Regression - verify GET /api/absensi/today still works
    # ========================================================================
    print("\n" + "=" * 80)
    print("STEP 11: REGRESSION - VERIFY GET /api/absensi/today")
    print("=" * 80)

    try:
        r = requests.get(f"{BASE_URL}/api/absensi/today", 
                        headers={"Authorization": f"Bearer {cindy_token}"}, 
                        timeout=10)
        if r.status_code != 200:
            print(f"❌ GET /api/absensi/today failed: {r.status_code} {r.text}")
            return 1
        today_resp = r.json()
        settings_in_today = today_resp.get('settings', {})
        print(f"✅ GET /api/absensi/today successful")
        print(f"   settings.overtime_request_threshold_min: {settings_in_today.get('overtime_request_threshold_min')}")
        print(f"   settings.so_mode_enabled: {settings_in_today.get('so_mode_enabled')}")
        
        # Verify settings fields are present
        if 'overtime_request_threshold_min' not in settings_in_today:
            print(f"❌ settings.overtime_request_threshold_min missing in /api/absensi/today")
            return 1
        if 'so_mode_enabled' not in settings_in_today:
            print(f"❌ settings.so_mode_enabled missing in /api/absensi/today")
            return 1
        print(f"✅ REGRESSION CHECK PASSED: GET /api/absensi/today returns settings correctly")
    except Exception as e:
        print(f"❌ GET /api/absensi/today failed: {e}")
        return 1

    # ========================================================================
    # CLEANUP: Delete test record
    # ========================================================================
    print("\n" + "=" * 80)
    print("CLEANUP: DELETE TEST RECORD")
    print("=" * 80)

    try:
        result = db.absensi_records.delete_one({"user_id": cindy_id, "date": today})
        if result.deleted_count > 0:
            print(f"✅ Deleted test record for cindy on {today}")
        else:
            print(f"⚠️  No record to delete (already cleaned up)")
    except Exception as e:
        print(f"⚠️  Cleanup failed (non-critical): {e}")

    # ========================================================================
    # FINAL SUMMARY
    # ========================================================================
    print("\n" + "=" * 80)
    print("FINAL SUMMARY")
    print("=" * 80)
    print("✅ ALL TESTS PASSED (100%)")
    print()
    print("TEST RESULTS:")
    print("  ✅ Step 1: Login as owner and cindy - PASSED")
    print("  ✅ Step 2: Delete today's record - PASSED")
    print("  ✅ Step 3: Fetch valid QR - PASSED")
    print("  ✅ Step 4: Get settings - PASSED")
    print("  ✅ Step 5: Check-in cindy - PASSED")
    print("  ✅ Step 6: Mutate record to meet threshold - PASSED")
    print("  ✅ Step 7: Submit lembur BEFORE check-out (regression) - PASSED")
    print("  ✅ Step 8: Reset overtime_requested - PASSED")
    print("  ✅ Step 9: Check out cindy - PASSED")
    print("  ✅ Step 10: Submit lembur AFTER check-out (CRITICAL) - PASSED")
    print("  ✅ Step 11: Regression - GET /api/absensi/today - PASSED")
    print()
    print("CRITICAL SUCCESS CRITERIA:")
    print("  ✅ Lembur submission BEFORE check-out works (regression verified)")
    print("  ✅ Lembur submission AFTER check-out correctly rejected with 400")
    print("  ✅ Error message contains expected text ('sudah absen keluar')")
    print("  ✅ GET /api/absensi/today still returns settings correctly")
    print()
    print("CONCLUSION:")
    print("  The new guard preventing lembur submission after check-out is FULLY WORKING.")
    print("  The patch at line 787 in service.js correctly blocks submissions after check-out.")
    print("  Zero regressions detected - existing functionality remains intact.")
    print("=" * 80)

    return 0

if __name__ == '__main__':
    sys.exit(main())
