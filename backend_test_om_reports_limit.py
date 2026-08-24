#!/usr/bin/env python3
"""
Backend regression test for OMS Reports historical data limit fix.
This is a FRONTEND-ONLY change; backend was NOT modified.
We verify the existing endpoint still works correctly with limit=2000.
"""

import requests
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com/api"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

def login(username, password):
    """Login and return Bearer token"""
    try:
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "username": username,
            "password": password
        }, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            print(f"✅ Login successful: {username}")
            return token
        else:
            print(f"❌ Login failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_shipments_limit_2000(token):
    """TEST 1: GET /api/om/shipments?limit=2000 → 200, items ≤ 2000"""
    print("\n" + "="*80)
    print("TEST 1: GET /api/om/shipments?limit=2000")
    print("="*80)
    
    try:
        resp = requests.get(
            f"{BASE_URL}/om/shipments?limit=2000",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        
        # Check response structure
        if "items" not in data:
            print(f"❌ Response missing 'items' key")
            print(f"Keys: {list(data.keys())}")
            return False
        
        if "summary" not in data:
            print(f"❌ Response missing 'summary' key")
            print(f"Keys: {list(data.keys())}")
            return False
        
        items = data["items"]
        summary = data["summary"]
        
        print(f"✅ Response has 'items' and 'summary' keys")
        print(f"Items count: {len(items)}")
        print(f"Summary: {summary}")
        
        # Verify items count ≤ 2000
        if len(items) > 2000:
            print(f"❌ Items count {len(items)} exceeds limit 2000")
            return False
        
        print(f"✅ Items count {len(items)} ≤ 2000 (within limit)")
        
        # Verify summary consistency
        if summary.get("total") != len(items):
            print(f"❌ Summary total {summary.get('total')} != items length {len(items)}")
            return False
        
        print(f"✅ Summary total {summary.get('total')} === items length {len(items)}")
        
        # Verify packed === total
        if summary.get("packed") != summary.get("total"):
            print(f"❌ Summary packed {summary.get('packed')} != total {summary.get('total')}")
            return False
        
        print(f"✅ Summary packed {summary.get('packed')} === total {summary.get('total')}")
        
        # Verify delivered count
        delivered_count = sum(1 for item in items if item.get("status") == "delivered")
        if summary.get("delivered") != delivered_count:
            print(f"❌ Summary delivered {summary.get('delivered')} != actual count {delivered_count}")
            return False
        
        print(f"✅ Summary delivered {summary.get('delivered')} === actual count {delivered_count}")
        
        # Verify success_rate
        expected_rate = round((delivered_count / len(items)) * 100) if len(items) > 0 else 0
        if summary.get("success_rate") != expected_rate:
            print(f"❌ Summary success_rate {summary.get('success_rate')} != expected {expected_rate}")
            return False
        
        print(f"✅ Summary success_rate {summary.get('success_rate')} === expected {expected_rate}")
        
        print("✅ TEST 1 PASSED")
        return True
        
    except Exception as e:
        print(f"❌ TEST 1 FAILED: {e}")
        return False

def test_shipments_limit_5000_clamped(token):
    """TEST 2: GET /api/om/shipments?limit=5000 → 200, clamped to ≤ 2000"""
    print("\n" + "="*80)
    print("TEST 2: GET /api/om/shipments?limit=5000 (should clamp to 2000)")
    print("="*80)
    
    try:
        resp = requests.get(
            f"{BASE_URL}/om/shipments?limit=5000",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        
        print(f"Items count: {len(items)}")
        
        if len(items) > 2000:
            print(f"❌ Items count {len(items)} exceeds max 2000 (clamp failed)")
            return False
        
        print(f"✅ Items count {len(items)} ≤ 2000 (clamp working)")
        print("✅ TEST 2 PASSED")
        return True
        
    except Exception as e:
        print(f"❌ TEST 2 FAILED: {e}")
        return False

def test_shipments_no_limit_default(token):
    """TEST 3: GET /api/om/shipments (no limit) → 200, ≤ 500 (default preserved)"""
    print("\n" + "="*80)
    print("TEST 3: GET /api/om/shipments (no limit param, should default to 500)")
    print("="*80)
    
    try:
        resp = requests.get(
            f"{BASE_URL}/om/shipments",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        
        print(f"Items count: {len(items)}")
        
        if len(items) > 500:
            print(f"❌ Items count {len(items)} exceeds default 500 (regression detected)")
            return False
        
        print(f"✅ Items count {len(items)} ≤ 500 (default preserved, no regression)")
        print("✅ TEST 3 PASSED")
        return True
        
    except Exception as e:
        print(f"❌ TEST 3 FAILED: {e}")
        return False

def test_shipments_with_date_filter(token):
    """TEST 4: GET /api/om/shipments?limit=2000&date_from=2026-01-01&date_to=2026-02-28"""
    print("\n" + "="*80)
    print("TEST 4: GET /api/om/shipments?limit=2000&date_from=2026-01-01&date_to=2026-02-28")
    print("="*80)
    
    try:
        resp = requests.get(
            f"{BASE_URL}/om/shipments?limit=2000&date_from=2026-01-01&date_to=2026-02-28",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        
        print(f"Items count: {len(items)}")
        print(f"✅ Filtered query returned successfully")
        
        # If items present, verify dates fall within range
        if len(items) > 0:
            print(f"Verifying date range for {len(items)} items...")
            
            for i, item in enumerate(items[:5]):  # Check first 5 items
                packed_date = item.get("packed_wita_date")
                if packed_date:
                    # Check if date is within range (basic check)
                    if packed_date < "2026-01-01" or packed_date > "2026-02-28":
                        print(f"❌ Item {i} has packed_wita_date {packed_date} outside range")
                        return False
            
            print(f"✅ Sample items have dates within range")
        else:
            print(f"⚠️  No items in date range (may be expected if no data)")
        
        print("✅ TEST 4 PASSED")
        return True
        
    except Exception as e:
        print(f"❌ TEST 4 FAILED: {e}")
        return False

def test_summary_consistency(token):
    """TEST 5: Verify summary consistency for various queries"""
    print("\n" + "="*80)
    print("TEST 5: Summary consistency checks")
    print("="*80)
    
    test_cases = [
        ("?limit=2000", "limit=2000"),
        ("?limit=100", "limit=100"),
        ("", "no limit (default 500)")
    ]
    
    all_passed = True
    
    for query, desc in test_cases:
        print(f"\nChecking summary for: {desc}")
        
        try:
            resp = requests.get(
                f"{BASE_URL}/om/shipments{query}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30
            )
            
            if resp.status_code != 200:
                print(f"❌ Request failed: {resp.status_code}")
                all_passed = False
                continue
            
            data = resp.json()
            items = data.get("items", [])
            summary = data.get("summary", {})
            
            # Check total === items.length
            if summary.get("total") != len(items):
                print(f"❌ total {summary.get('total')} != items.length {len(items)}")
                all_passed = False
                continue
            
            # Check packed === total
            if summary.get("packed") != summary.get("total"):
                print(f"❌ packed {summary.get('packed')} != total {summary.get('total')}")
                all_passed = False
                continue
            
            # Check delivered count
            delivered_count = sum(1 for item in items if item.get("status") == "delivered")
            if summary.get("delivered") != delivered_count:
                print(f"❌ delivered {summary.get('delivered')} != actual {delivered_count}")
                all_passed = False
                continue
            
            # Check success_rate
            expected_rate = round((delivered_count / len(items)) * 100) if len(items) > 0 else 0
            if summary.get("success_rate") != expected_rate:
                print(f"❌ success_rate {summary.get('success_rate')} != expected {expected_rate}")
                all_passed = False
                continue
            
            print(f"✅ Summary consistent: total={summary.get('total')}, packed={summary.get('packed')}, delivered={summary.get('delivered')}, success_rate={summary.get('success_rate')}%")
            
        except Exception as e:
            print(f"❌ Error: {e}")
            all_passed = False
    
    if all_passed:
        print("\n✅ TEST 5 PASSED")
    else:
        print("\n❌ TEST 5 FAILED")
    
    return all_passed

def test_regression_other_endpoints(token):
    """TEST 6: Regression checks on other OM endpoints"""
    print("\n" + "="*80)
    print("TEST 6: Regression checks on other OM endpoints")
    print("="*80)
    
    endpoints = [
        "/om/dashboard",
        "/om/pdfs",
        "/om/tab/selesai",
        "/om/packing-productivity?period=today",
        "/om/settings"
    ]
    
    all_passed = True
    
    for endpoint in endpoints:
        try:
            resp = requests.get(
                f"{BASE_URL}{endpoint}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            
            if resp.status_code == 200:
                print(f"✅ GET {endpoint} → 200")
            else:
                print(f"❌ GET {endpoint} → {resp.status_code}")
                all_passed = False
                
        except Exception as e:
            print(f"❌ GET {endpoint} → Error: {e}")
            all_passed = False
    
    if all_passed:
        print("\n✅ TEST 6 PASSED - All regression endpoints working")
    else:
        print("\n❌ TEST 6 FAILED - Some endpoints broken")
    
    return all_passed

def main():
    print("="*80)
    print("OMS REPORTS HISTORICAL DATA LIMIT FIX - BACKEND REGRESSION TEST")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test date: {datetime.utcnow().isoformat()}Z")
    print()
    
    # Login
    token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not token:
        print("\n❌ FATAL: Cannot proceed without authentication")
        sys.exit(1)
    
    # Run all tests
    results = []
    
    results.append(("TEST 1: limit=2000", test_shipments_limit_2000(token)))
    results.append(("TEST 2: limit=5000 clamped", test_shipments_limit_5000_clamped(token)))
    results.append(("TEST 3: no limit default", test_shipments_no_limit_default(token)))
    results.append(("TEST 4: date filter", test_shipments_with_date_filter(token)))
    results.append(("TEST 5: summary consistency", test_summary_consistency(token)))
    results.append(("TEST 6: regression checks", test_regression_other_endpoints(token)))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({round(passed/total*100)}%)")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - Backend regression test complete")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
