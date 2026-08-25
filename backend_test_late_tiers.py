#!/usr/bin/env python3
"""
Backend regression test for Absensi dynamic late-tier ladder (2026-02).
Tests all 9 cases from test_result.md.
"""
import os
import sys
import requests
import json
from datetime import datetime, timedelta
from pymongo import MongoClient

# Configuration
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://absensi-foundation.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"
MONGO_URL = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.getenv('DB_NAME', 'cycle_count')

# Test credentials
OWNER_USERNAME = 'owner'
OWNER_PASSWORD = 'owner123'

# Test results
test_results = []

def log_test(test_num, description, passed, details=""):
    """Log test result"""
    status = "✅ PASSED" if passed else "❌ FAILED"
    result = f"TEST {test_num}: {description} - {status}"
    if details:
        result += f"\n  Details: {details}"
    print(result)
    test_results.append({
        'test': test_num,
        'description': description,
        'passed': passed,
        'details': details
    })
    return passed

def login(username, password):
    """Login and return token"""
    try:
        resp = requests.post(f"{API_BASE}/auth/login", json={
            'username': username,
            'password': password
        }, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data.get('token')
        else:
            print(f"Login failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"Login error: {e}")
        return None

def get_settings(token):
    """GET /api/absensi/points/settings"""
    try:
        resp = requests.get(f"{API_BASE}/absensi/points/settings", 
                           headers={'Authorization': f'Bearer {token}'}, 
                           timeout=10)
        if resp.status_code == 200:
            return resp.json()
        else:
            print(f"GET settings failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"GET settings error: {e}")
        return None

def put_settings(token, body):
    """PUT /api/absensi/points/settings"""
    try:
        resp = requests.put(f"{API_BASE}/absensi/points/settings", 
                           headers={'Authorization': f'Bearer {token}'}, 
                           json=body,
                           timeout=10)
        return resp
    except Exception as e:
        print(f"PUT settings error: {e}")
        return None

def get_wita_date():
    """Get current WITA date in YYYY-MM-DD format"""
    # WITA is UTC+8
    utc_now = datetime.utcnow()
    wita_now = utc_now + timedelta(hours=8)
    return wita_now.strftime('%Y-%m-%d')

def get_current_period():
    """Get current period key (YYYY-MM)"""
    wita_date = get_wita_date()
    year, month, day = map(int, wita_date.split('-'))
    if day >= 26:
        month += 1
        if month > 12:
            month = 1
            year += 1
    return f"{year}-{str(month).zfill(2)}"

def main():
    print("=" * 80)
    print("ABSENSI DYNAMIC LATE-TIERS BACKEND REGRESSION TEST")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"API Base: {API_BASE}")
    print(f"MongoDB: {MONGO_URL}/{DB_NAME}")
    print(f"Test Date: {datetime.utcnow().isoformat()}Z")
    print("=" * 80)
    print()

    # Login as owner
    print("🔐 Logging in as owner...")
    owner_token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not owner_token:
        print("❌ CRITICAL: Cannot login as owner. Aborting all tests.")
        sys.exit(1)
    print(f"✅ Owner login successful")
    print()

    # ========================================================================
    # TEST 1: GET settings → late_tiers exists, is array ≥1, last is null
    # ========================================================================
    print("TEST 1: GET /api/absensi/points/settings → late_tiers structure")
    try:
        data = get_settings(owner_token)
        if not data:
            log_test(1, "GET settings returns data", False, "No data returned")
        else:
            settings = data.get('settings', {})
            late_tiers = settings.get('late_tiers')
            
            checks = []
            checks.append(('late_tiers exists', late_tiers is not None))
            checks.append(('late_tiers is array', isinstance(late_tiers, list)))
            checks.append(('late_tiers has ≥1 row', len(late_tiers) >= 1 if isinstance(late_tiers, list) else False))
            
            if isinstance(late_tiers, list) and len(late_tiers) >= 1:
                last_tier = late_tiers[-1]
                checks.append(('last tier max_late_minutes is null', last_tier.get('max_late_minutes') is None))
            else:
                checks.append(('last tier max_late_minutes is null', False))
            
            all_passed = all(c[1] for c in checks)
            details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
            log_test(1, "GET settings late_tiers structure", all_passed, details)
            
            if all_passed:
                print(f"  late_tiers: {json.dumps(late_tiers, indent=2)}")
    except Exception as e:
        log_test(1, "GET settings late_tiers structure", False, f"Exception: {e}")
    print()

    # ========================================================================
    # TEST 2: PUT 5-row ladder → GET returns same 5 rows sorted
    # ========================================================================
    print("TEST 2: PUT 5-row ladder → GET returns same 5 rows sorted")
    try:
        five_row_ladder = [
            { 'max_late_minutes': 0, 'points': 12, 'label': 'Tepat waktu' },
            { 'max_late_minutes': 5, 'points': 9, 'label': 'Terlambat <=5m' },
            { 'max_late_minutes': 20, 'points': 4, 'label': 'Terlambat 6-20m' },
            { 'max_late_minutes': 60, 'points': -3, 'label': 'Terlambat 21-60m' },
            { 'max_late_minutes': None, 'points': -10, 'label': 'Terlambat berat' },
        ]
        
        resp = put_settings(owner_token, {'late_tiers': five_row_ladder})
        if resp.status_code != 200:
            log_test(2, "PUT 5-row ladder", False, f"PUT failed: {resp.status_code} - {resp.text}")
        else:
            # GET and verify
            data = get_settings(owner_token)
            if not data:
                log_test(2, "PUT 5-row ladder", False, "GET after PUT failed")
            else:
                returned_tiers = data.get('settings', {}).get('late_tiers', [])
                
                checks = []
                checks.append(('returned 5 rows', len(returned_tiers) == 5))
                checks.append(('sorted ascending', all(
                    returned_tiers[i].get('max_late_minutes') is None or 
                    returned_tiers[i+1].get('max_late_minutes') is None or
                    returned_tiers[i].get('max_late_minutes') <= returned_tiers[i+1].get('max_late_minutes')
                    for i in range(len(returned_tiers)-1)
                )))
                checks.append(('last is null', returned_tiers[-1].get('max_late_minutes') is None))
                
                # Check exact values
                if len(returned_tiers) == 5:
                    checks.append(('row 0: max=0, pts=12', 
                                 returned_tiers[0].get('max_late_minutes') == 0 and 
                                 returned_tiers[0].get('points') == 12))
                    checks.append(('row 1: max=5, pts=9', 
                                 returned_tiers[1].get('max_late_minutes') == 5 and 
                                 returned_tiers[1].get('points') == 9))
                    checks.append(('row 2: max=20, pts=4', 
                                 returned_tiers[2].get('max_late_minutes') == 20 and 
                                 returned_tiers[2].get('points') == 4))
                    checks.append(('row 3: max=60, pts=-3', 
                                 returned_tiers[3].get('max_late_minutes') == 60 and 
                                 returned_tiers[3].get('points') == -3))
                    checks.append(('row 4: max=null, pts=-10', 
                                 returned_tiers[4].get('max_late_minutes') is None and 
                                 returned_tiers[4].get('points') == -10))
                
                all_passed = all(c[1] for c in checks)
                details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
                log_test(2, "PUT 5-row ladder", all_passed, details)
                
                if all_passed:
                    print(f"  ✅ 5-row ladder stored and retrieved correctly")
    except Exception as e:
        log_test(2, "PUT 5-row ladder", False, f"Exception: {e}")
    print()

    # ========================================================================
    # TEST 3: PUT unsorted rows → server sorts ascending, null last
    # ========================================================================
    print("TEST 3: PUT unsorted rows → server sorts ascending, null last")
    try:
        unsorted_ladder = [
            { 'max_late_minutes': 100, 'points': 0, 'label': 'X' },
            { 'max_late_minutes': 5, 'points': 5, 'label': 'Y' },
            { 'max_late_minutes': None, 'points': -5, 'label': 'Z' },
        ]
        
        resp = put_settings(owner_token, {'late_tiers': unsorted_ladder})
        if resp.status_code != 200:
            log_test(3, "PUT unsorted rows", False, f"PUT failed: {resp.status_code} - {resp.text}")
        else:
            data = get_settings(owner_token)
            if not data:
                log_test(3, "PUT unsorted rows", False, "GET after PUT failed")
            else:
                returned_tiers = data.get('settings', {}).get('late_tiers', [])
                
                checks = []
                checks.append(('returned 3 rows', len(returned_tiers) == 3))
                
                if len(returned_tiers) == 3:
                    # Should be sorted: 5, 100, null
                    checks.append(('row 0: max=5', returned_tiers[0].get('max_late_minutes') == 5))
                    checks.append(('row 1: max=100', returned_tiers[1].get('max_late_minutes') == 100))
                    checks.append(('row 2: max=null (catch-all)', returned_tiers[2].get('max_late_minutes') is None))
                    checks.append(('sorted ascending', 
                                 returned_tiers[0].get('max_late_minutes') < returned_tiers[1].get('max_late_minutes')))
                
                all_passed = all(c[1] for c in checks)
                details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
                log_test(3, "PUT unsorted rows", all_passed, details)
                
                if all_passed:
                    print(f"  ✅ Server correctly sorted: {[t.get('max_late_minutes') for t in returned_tiers]}")
    except Exception as e:
        log_test(3, "PUT unsorted rows", False, f"Exception: {e}")
    print()

    # ========================================================================
    # TEST 4: PUT empty array → 400 error
    # ========================================================================
    print("TEST 4: PUT empty array → 400 error")
    try:
        resp = put_settings(owner_token, {'late_tiers': []})
        
        checks = []
        checks.append(('status is 400', resp.status_code == 400))
        
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            checks.append(('error contains "minimal satu baris"', 'minimal satu baris' in error_msg.lower()))
        
        all_passed = all(c[1] for c in checks)
        details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
        log_test(4, "PUT empty array → 400", all_passed, details)
        
        if all_passed:
            print(f"  ✅ Server correctly rejected empty array with 400")
    except Exception as e:
        log_test(4, "PUT empty array → 400", False, f"Exception: {e}")
    print()

    # ========================================================================
    # TEST 5: PUT with points: 'abc' → stored as 0 (no error)
    # ========================================================================
    print("TEST 5: PUT with points: 'abc' → stored as 0 (no error)")
    try:
        invalid_points_ladder = [
            { 'max_late_minutes': 0, 'points': 'abc', 'label': 'Test invalid' },
            { 'max_late_minutes': None, 'points': 5, 'label': 'Catch-all' },
        ]
        
        resp = put_settings(owner_token, {'late_tiers': invalid_points_ladder})
        
        checks = []
        checks.append(('status is 200', resp.status_code == 200))
        
        if resp.status_code == 200:
            data = get_settings(owner_token)
            if data:
                returned_tiers = data.get('settings', {}).get('late_tiers', [])
                if len(returned_tiers) >= 1:
                    first_row_points = returned_tiers[0].get('points')
                    checks.append(('first row points is 0', first_row_points == 0))
                    print(f"  First row points: {first_row_points} (expected 0)")
        
        all_passed = all(c[1] for c in checks)
        details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
        log_test(5, "PUT invalid points 'abc' → 0", all_passed, details)
        
        if all_passed:
            print(f"  ✅ Server coerced 'abc' to 0 without error")
    except Exception as e:
        log_test(5, "PUT invalid points 'abc' → 0", False, f"Exception: {e}")
    print()

    # ========================================================================
    # TEST 6: PUT with interior null → null bubbles to last
    # ========================================================================
    print("TEST 6: PUT with interior null → null bubbles to last")
    try:
        interior_null_ladder = [
            { 'max_late_minutes': None, 'points': 1, 'label': 'A' },
            { 'max_late_minutes': 5, 'points': 2, 'label': 'B' },
        ]
        
        resp = put_settings(owner_token, {'late_tiers': interior_null_ladder})
        
        checks = []
        checks.append(('status is 200', resp.status_code == 200))
        
        if resp.status_code == 200:
            data = get_settings(owner_token)
            if data:
                returned_tiers = data.get('settings', {}).get('late_tiers', [])
                checks.append(('returned 2 rows', len(returned_tiers) == 2))
                
                if len(returned_tiers) == 2:
                    # After normalization: [5, null]
                    checks.append(('row 0: max=5', returned_tiers[0].get('max_late_minutes') == 5))
                    checks.append(('row 1: max=null', returned_tiers[1].get('max_late_minutes') is None))
                    checks.append(('last row is catch-all', returned_tiers[-1].get('max_late_minutes') is None))
                    print(f"  Sorted order: {[t.get('max_late_minutes') for t in returned_tiers]}")
        
        all_passed = all(c[1] for c in checks)
        details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
        log_test(6, "PUT interior null → bubbles to last", all_passed, details)
        
        if all_passed:
            print(f"  ✅ Server correctly moved null to last position")
    except Exception as e:
        log_test(6, "PUT interior null → bubbles to last", False, f"Exception: {e}")
    print()

    # ========================================================================
    # TEST 7: Behavior test (needs MongoDB access)
    # ========================================================================
    print("TEST 7: Behavior test — ledger reflects new ladder")
    try:
        # Try to connect to MongoDB
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
        
        # Test connection
        db.command('ping')
        print("  ✅ MongoDB connection successful")
        
        # 7a. Set the 5-row ladder from test 2
        five_row_ladder = [
            { 'max_late_minutes': 0, 'points': 12, 'label': 'Tepat waktu' },
            { 'max_late_minutes': 5, 'points': 9, 'label': 'Terlambat <=5m' },
            { 'max_late_minutes': 20, 'points': 4, 'label': 'Terlambat 6-20m' },
            { 'max_late_minutes': 60, 'points': -3, 'label': 'Terlambat 21-60m' },
            { 'max_late_minutes': None, 'points': -10, 'label': 'Terlambat berat' },
        ]
        resp = put_settings(owner_token, {'late_tiers': five_row_ladder})
        if resp.status_code != 200:
            log_test(7, "Behavior test", False, f"Failed to set 5-row ladder: {resp.status_code}")
            print()
            return
        print("  ✅ Set 5-row ladder")
        
        # 7b. Get a staff user_id
        employees = db['employees'].find({'role': 'staff'}).limit(1)
        staff_user = None
        for emp in employees:
            staff_user = emp
            break
        
        if not staff_user:
            log_test(7, "Behavior test", False, "No staff user found in DB")
            print()
            return
        
        staff_user_id = staff_user.get('id')
        staff_user_name = staff_user.get('name', 'Test Staff')
        print(f"  Using staff: {staff_user_name} (ID: {staff_user_id})")
        
        # 7c. Insert fake absensi_records row
        wita_date = get_wita_date()
        fake_record_id = 'FAKE-TIER-TEST-1'
        
        # Delete any existing test record
        db['absensi_records'].delete_one({'id': fake_record_id})
        db['absensi_point_ledger'].delete_one({'source_id': fake_record_id})
        
        fake_record = {
            'id': fake_record_id,
            'user_id': staff_user_id,
            'user_name': staff_user_name,
            'date': wita_date,
            'late_minutes': 15,  # Should match tier 2: 6-20m → 4 points
            'actual_check_in': datetime.utcnow(),
            'shift_key': 'apotek_pagi',
            'shift_name': 'Apotek — Pagi',
            'shift_start': '07:00',
            'createdAt': datetime.utcnow(),
        }
        db['absensi_records'].insert_one(fake_record)
        print(f"  ✅ Inserted fake record: late_minutes=15 (should match tier 'Terlambat 6-20m' → 4 points)")
        
        # 7d. Trigger recompute
        current_period = get_current_period()
        print(f"  Triggering recompute for period: {current_period}")
        
        resp = requests.post(
            f"{API_BASE}/absensi/points/recompute?period={current_period}",
            headers={'Authorization': f'Bearer {owner_token}'},
            timeout=30
        )
        
        if resp.status_code != 200:
            log_test(7, "Behavior test", False, f"Recompute failed: {resp.status_code} - {resp.text}")
            # Cleanup
            db['absensi_records'].delete_one({'id': fake_record_id})
            db['absensi_point_ledger'].delete_one({'source_id': fake_record_id})
            print()
            return
        
        print(f"  ✅ Recompute successful")
        
        # 7e. Query ledger
        ledger_entry = db['absensi_point_ledger'].find_one({
            'source_id': fake_record_id,
            'event_type': 'checkin'
        })
        
        checks = []
        checks.append(('ledger entry exists', ledger_entry is not None))
        
        if ledger_entry:
            points = ledger_entry.get('points')
            reason = ledger_entry.get('reason', '')
            
            checks.append(('points is 4', points == 4))
            checks.append(('reason contains tier label', 'Terlambat 6-20m' in reason or '6-20' in reason))
            
            print(f"  Ledger entry: points={points}, reason='{reason}'")
        
        # Cleanup
        db['absensi_records'].delete_one({'id': fake_record_id})
        db['absensi_point_ledger'].delete_one({'source_id': fake_record_id})
        print(f"  ✅ Cleanup: deleted test records")
        
        all_passed = all(c[1] for c in checks)
        details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
        log_test(7, "Behavior test", all_passed, details)
        
        if all_passed:
            print(f"  ✅ Ledger correctly reflects new ladder (15 min late → 4 points)")
        
    except Exception as e:
        log_test(7, "Behavior test", False, f"Exception or MongoDB unavailable: {e}")
    print()

    # ========================================================================
    # TEST 8: Legacy fallback (needs MongoDB access)
    # ========================================================================
    print("TEST 8: Legacy fallback — missing late_tiers returns default")
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
        db.command('ping')
        
        # 8a. Remove late_tiers from settings
        result = db['absensi_point_settings'].update_one(
            {'id': 'default'},
            {'$unset': {'late_tiers': ''}}
        )
        print(f"  ✅ Removed late_tiers from settings (matched: {result.matched_count})")
        
        # 8b. GET settings → should return default 4-row ladder
        data = get_settings(owner_token)
        if not data:
            log_test(8, "Legacy fallback", False, "GET settings failed")
        else:
            returned_tiers = data.get('settings', {}).get('late_tiers', [])
            
            checks = []
            checks.append(('late_tiers exists', returned_tiers is not None))
            checks.append(('has 4 rows', len(returned_tiers) == 4))
            
            if len(returned_tiers) == 4:
                # Check default values
                checks.append(('row 0: max=0, pts=10', 
                             returned_tiers[0].get('max_late_minutes') == 0 and 
                             returned_tiers[0].get('points') == 10))
                checks.append(('row 1: max=10, pts=7', 
                             returned_tiers[1].get('max_late_minutes') == 10 and 
                             returned_tiers[1].get('points') == 7))
                checks.append(('row 2: max=30, pts=5', 
                             returned_tiers[2].get('max_late_minutes') == 30 and 
                             returned_tiers[2].get('points') == 5))
                checks.append(('row 3: max=null, pts=0', 
                             returned_tiers[3].get('max_late_minutes') is None and 
                             returned_tiers[3].get('points') == 0))
                
                print(f"  Default ladder: {json.dumps(returned_tiers, indent=2)}")
            
            all_passed = all(c[1] for c in checks)
            details = "; ".join([f"{c[0]}: {c[1]}" for c in checks])
            log_test(8, "Legacy fallback", all_passed, details)
            
            if all_passed:
                print(f"  ✅ Server returned default 4-row ladder when late_tiers missing")
            
            # 8c. Restore via PUT
            default_ladder = [
                { 'max_late_minutes': 0, 'points': 10, 'label': 'Tepat waktu' },
                { 'max_late_minutes': 10, 'points': 7, 'label': 'Terlambat <10 menit' },
                { 'max_late_minutes': 30, 'points': 5, 'label': 'Terlambat 10–30 menit' },
                { 'max_late_minutes': None, 'points': 0, 'label': 'Terlambat >30 menit' },
            ]
            resp = put_settings(owner_token, {'late_tiers': default_ladder})
            if resp.status_code == 200:
                print(f"  ✅ Restored default ladder via PUT")
            
    except Exception as e:
        log_test(8, "Legacy fallback", False, f"Exception or MongoDB unavailable: {e}")
    print()

    # ========================================================================
    # TEST 9: Regression — other endpoints still work
    # ========================================================================
    print("TEST 9: Regression — other endpoints still work")
    try:
        endpoints = [
            ('GET /api/absensi/points/leaderboard', f"{API_BASE}/absensi/points/leaderboard"),
            ('GET /api/absensi/points/history (owner)', f"{API_BASE}/absensi/points/history"),
            ('GET /api/om/dashboard', f"{API_BASE}/om/dashboard"),
            ('GET /api/faktur', f"{API_BASE}/faktur"),
            ('GET /api/dashboard', f"{API_BASE}/dashboard"),
        ]
        
        checks = []
        for name, url in endpoints:
            try:
                resp = requests.get(url, headers={'Authorization': f'Bearer {owner_token}'}, timeout=10)
                passed = resp.status_code == 200
                checks.append((name, passed))
                status_icon = "✅" if passed else "❌"
                print(f"  {status_icon} {name}: {resp.status_code}")
            except Exception as e:
                checks.append((name, False))
                print(f"  ❌ {name}: Exception - {e}")
        
        # Test as staff user (get staff token)
        try:
            # Find a staff user with absensi module
            client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
            db = client[DB_NAME]
            staff = db['employees'].find_one({'role': 'staff', 'modules': 'absensi'})
            
            if staff:
                staff_username = staff.get('username')
                staff_password = staff_username + '123'  # Convention: username123
                staff_token = login(staff_username, staff_password)
                
                if staff_token:
                    resp = requests.get(f"{API_BASE}/absensi/points/history", 
                                      headers={'Authorization': f'Bearer {staff_token}'}, 
                                      timeout=10)
                    passed = resp.status_code == 200
                    checks.append(('GET /api/absensi/points/history (staff)', passed))
                    status_icon = "✅" if passed else "❌"
                    print(f"  {status_icon} GET /api/absensi/points/history (staff): {resp.status_code}")
        except:
            pass  # Skip staff test if not available
        
        all_passed = all(c[1] for c in checks)
        details = f"{sum(c[1] for c in checks)}/{len(checks)} endpoints returned 200"
        log_test(9, "Regression tests", all_passed, details)
        
        if all_passed:
            print(f"  ✅ All regression endpoints working")
    except Exception as e:
        log_test(9, "Regression tests", False, f"Exception: {e}")
    print()

    # ========================================================================
    # CLEANUP: Restore default 4-row ladder
    # ========================================================================
    print("CLEANUP: Restoring default 4-row ladder")
    try:
        default_ladder = [
            { 'max_late_minutes': 0, 'points': 10, 'label': 'Tepat waktu' },
            { 'max_late_minutes': 10, 'points': 7, 'label': 'Terlambat <10 menit' },
            { 'max_late_minutes': 30, 'points': 5, 'label': 'Terlambat 10–30 menit' },
            { 'max_late_minutes': None, 'points': 0, 'label': 'Terlambat >30 menit' },
        ]
        resp = put_settings(owner_token, {'late_tiers': default_ladder})
        if resp.status_code == 200:
            print("  ✅ Default ladder restored")
        else:
            print(f"  ⚠️  Failed to restore default ladder: {resp.status_code}")
    except Exception as e:
        print(f"  ⚠️  Cleanup exception: {e}")
    print()

    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    total_tests = len(test_results)
    passed_tests = sum(1 for t in test_results if t['passed'])
    failed_tests = total_tests - passed_tests
    
    for result in test_results:
        status = "✅ PASSED" if result['passed'] else "❌ FAILED"
        print(f"TEST {result['test']}: {result['description']} - {status}")
        if result['details']:
            print(f"  {result['details']}")
    
    print()
    print(f"TOTAL: {passed_tests}/{total_tests} tests passed ({failed_tests} failed)")
    print("=" * 80)
    
    if passed_tests == total_tests:
        print("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print(f"❌ {failed_tests} TEST(S) FAILED")
        sys.exit(1)

if __name__ == '__main__':
    main()
