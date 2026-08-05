#!/usr/bin/env python3
"""
Backend test for "Scan Mulai Packing" split flow patch
Tests POST /api/om/scan/pack endpoint with optional sku_count/item_count

Test scenarios:
1. Flow 1 (Serah Terima Barang): tracking_number + sku_count + item_count (no photo)
2. Flow 2 (Dokumentasi Packing): tracking_number + photo_path (no SKU/Item)
3. Backward compatibility (Legacy): All fields provided
4. Error case: Missing tracking_number
5. Error case: All optional fields missing
6. Regression: GET /api/om/shipments
7. Auth check: Staff without OM module
8. Cleanup
"""

import requests
import json
import base64
from datetime import datetime

BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}  # cycle_count only, no OM

# Minimal valid 1x1 PNG (68 bytes) for photo testing
MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

def create_photo_data_url():
    """Create a minimal valid photo data URL for testing"""
    return f"data:image/png;base64,{MINIMAL_PNG_BASE64}"

def login(creds):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=creds)
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    return data.get("token")

def get_first_expedition_id(token):
    """Get the first available expedition ID"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers=headers)
    if resp.status_code == 200:
        data = resp.json()
        items = data.get("items", [])
        if items:
            return items[0].get("id")
    return None

def create_test_shipment(token, tracking_number, expedition_id):
    """Create a test shipment in 'printed' state via POST /api/om/scan/print"""
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "tracking_number": tracking_number,
        "expedition_id": expedition_id
    }
    resp = requests.post(f"{BASE_URL}/api/om/scan/print", json=body, headers=headers)
    if resp.status_code != 200:
        print(f"❌ Failed to create test shipment {tracking_number}: {resp.status_code} {resp.text}")
        return None
    return resp.json()

def test_scan_pack(token, body, expected_status, test_name):
    """Test POST /api/om/scan/pack endpoint"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/api/om/scan/pack", json=body, headers=headers)
    
    print(f"\n{'='*80}")
    print(f"TEST: {test_name}")
    print(f"{'='*80}")
    print(f"Request body: {json.dumps(body, indent=2)}")
    print(f"Response status: {resp.status_code}")
    print(f"Response body: {resp.text[:500]}")
    
    if resp.status_code != expected_status:
        print(f"❌ FAILED: Expected {expected_status}, got {resp.status_code}")
        return False, None
    
    if resp.status_code == 200:
        data = resp.json()
        return True, data
    else:
        return True, resp.json()

def main():
    print("="*80)
    print("BACKEND TEST: Scan Mulai Packing Split Flow")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test time: {datetime.now().isoformat()}")
    print("="*80)
    
    test_results = []
    test_shipments = []
    
    # ========== TEST 0: Authentication ==========
    print("\n" + "="*80)
    print("TEST 0: AUTHENTICATION")
    print("="*80)
    
    owner_token = login(OWNER_CREDS)
    if not owner_token:
        print("❌ CRITICAL: Owner login failed")
        return
    print(f"✅ Owner login successful, token: {owner_token[:20]}...")
    test_results.append(("Owner login", True))
    
    staff_token = login(STAFF_CREDS)
    if not staff_token:
        print("❌ CRITICAL: Staff login failed")
        return
    print(f"✅ Staff (Cindy) login successful, token: {staff_token[:20]}...")
    test_results.append(("Staff login", True))
    
    # Get first expedition ID
    expedition_id = get_first_expedition_id(owner_token)
    if not expedition_id:
        print("❌ CRITICAL: Could not get expedition ID")
        return
    print(f"✅ Using expedition ID: {expedition_id}")
    
    # ========== TEST 1: FLOW 1 (Serah Terima Barang) - SKU/Item only ==========
    tracking_flow1 = f"FLOW1-TEST-{int(datetime.now().timestamp())}"
    print(f"\n{'='*80}")
    print(f"TEST 1: FLOW 1 (Serah Terima Barang) - SKU/Item only")
    print(f"{'='*80}")
    
    # Create shipment in 'printed' state
    shipment = create_test_shipment(owner_token, tracking_flow1, expedition_id)
    if not shipment:
        print("❌ FAILED: Could not create test shipment for Flow 1")
        test_results.append(("Flow 1 - Create shipment", False))
    else:
        print(f"✅ Test shipment created: {tracking_flow1}")
        test_shipments.append(tracking_flow1)
        test_results.append(("Flow 1 - Create shipment", True))
        
        # Test Flow 1: SKU + Item only (no photo)
        body = {
            "tracking_number": tracking_flow1,
            "sku_count": 5,
            "item_count": 10
        }
        success, data = test_scan_pack(owner_token, body, 200, "Flow 1 - SKU/Item only")
        
        if success and data:
            shipment_data = data.get("shipment", {})
            sku_count = shipment_data.get("sku_count")
            item_count = shipment_data.get("item_count")
            photo_url = shipment_data.get("photo_url")
            
            if sku_count == 5 and item_count == 10:
                print(f"✅ Flow 1 PASSED: sku_count={sku_count}, item_count={item_count}")
                test_results.append(("Flow 1 - SKU/Item values", True))
            else:
                print(f"❌ Flow 1 FAILED: Expected sku_count=5, item_count=10, got sku_count={sku_count}, item_count={item_count}")
                test_results.append(("Flow 1 - SKU/Item values", False))
            
            if photo_url is None:
                print(f"✅ Flow 1 PASSED: photo_url is null (as expected)")
                test_results.append(("Flow 1 - No photo", True))
            else:
                print(f"❌ Flow 1 FAILED: Expected photo_url=null, got {photo_url}")
                test_results.append(("Flow 1 - No photo", False))
        else:
            test_results.append(("Flow 1 - SKU/Item only", False))
    
    # ========== TEST 2: FLOW 2 (Dokumentasi Packing) - Photo only ==========
    tracking_flow2 = f"FLOW2-TEST-{int(datetime.now().timestamp())}"
    print(f"\n{'='*80}")
    print(f"TEST 2: FLOW 2 (Dokumentasi Packing) - Photo only")
    print(f"{'='*80}")
    
    # Create shipment in 'printed' state
    shipment = create_test_shipment(owner_token, tracking_flow2, expedition_id)
    if not shipment:
        print("❌ FAILED: Could not create test shipment for Flow 2")
        test_results.append(("Flow 2 - Create shipment", False))
    else:
        print(f"✅ Test shipment created: {tracking_flow2}")
        test_shipments.append(tracking_flow2)
        test_results.append(("Flow 2 - Create shipment", True))
        
        # Test Flow 2: Photo only (no SKU/Item)
        body = {
            "tracking_number": tracking_flow2,
            "photo_data_url": create_photo_data_url()
        }
        success, data = test_scan_pack(owner_token, body, 200, "Flow 2 - Photo only")
        
        if success and data:
            shipment_data = data.get("shipment", {})
            sku_count = shipment_data.get("sku_count")
            item_count = shipment_data.get("item_count")
            photo_url = shipment_data.get("photo_url")
            
            if sku_count is None and item_count is None:
                print(f"✅ Flow 2 PASSED: sku_count=null, item_count=null (as expected)")
                test_results.append(("Flow 2 - No SKU/Item", True))
            else:
                print(f"❌ Flow 2 FAILED: Expected sku_count=null, item_count=null, got sku_count={sku_count}, item_count={item_count}")
                test_results.append(("Flow 2 - No SKU/Item", False))
            
            if photo_url is not None and photo_url.startswith("/api/om/photos/"):
                print(f"✅ Flow 2 PASSED: photo_url is set: {photo_url}")
                test_results.append(("Flow 2 - Photo present", True))
            else:
                print(f"❌ Flow 2 FAILED: Expected photo_url to be set, got {photo_url}")
                test_results.append(("Flow 2 - Photo present", False))
        else:
            test_results.append(("Flow 2 - Photo only", False))
    
    # ========== TEST 3: BACKWARD COMPATIBILITY (Legacy mode) - All fields ==========
    tracking_legacy = f"LEGACY-TEST-{int(datetime.now().timestamp())}"
    print(f"\n{'='*80}")
    print(f"TEST 3: BACKWARD COMPATIBILITY (Legacy mode) - All fields")
    print(f"{'='*80}")
    
    # Create shipment in 'printed' state
    shipment = create_test_shipment(owner_token, tracking_legacy, expedition_id)
    if not shipment:
        print("❌ FAILED: Could not create test shipment for Legacy")
        test_results.append(("Legacy - Create shipment", False))
    else:
        print(f"✅ Test shipment created: {tracking_legacy}")
        test_shipments.append(tracking_legacy)
        test_results.append(("Legacy - Create shipment", True))
        
        # Test Legacy: All fields provided
        body = {
            "tracking_number": tracking_legacy,
            "sku_count": 3,
            "item_count": 8,
            "photo_data_url": create_photo_data_url()
        }
        success, data = test_scan_pack(owner_token, body, 200, "Legacy - All fields")
        
        if success and data:
            shipment_data = data.get("shipment", {})
            sku_count = shipment_data.get("sku_count")
            item_count = shipment_data.get("item_count")
            photo_url = shipment_data.get("photo_url")
            
            if sku_count == 3 and item_count == 8 and photo_url is not None:
                print(f"✅ Legacy PASSED: sku_count={sku_count}, item_count={item_count}, photo_url={photo_url}")
                test_results.append(("Legacy - All fields populated", True))
            else:
                print(f"❌ Legacy FAILED: Expected all fields populated, got sku_count={sku_count}, item_count={item_count}, photo_url={photo_url}")
                test_results.append(("Legacy - All fields populated", False))
        else:
            test_results.append(("Legacy - All fields", False))
    
    # ========== TEST 4: ERROR CASE - Missing tracking_number ==========
    print(f"\n{'='*80}")
    print(f"TEST 4: ERROR CASE - Missing tracking_number")
    print(f"{'='*80}")
    
    body = {
        "sku_count": 5,
        "item_count": 10
    }
    success, data = test_scan_pack(owner_token, body, 400, "Error - Missing tracking_number")
    
    if success:
        error = data.get("error", "")
        if "tracking_number" in error.lower() or "wajib" in error.lower():
            print(f"✅ Error case PASSED: Got expected validation error: {error}")
            test_results.append(("Error - Missing tracking_number", True))
        else:
            print(f"❌ Error case FAILED: Expected tracking_number validation error, got: {error}")
            test_results.append(("Error - Missing tracking_number", False))
    else:
        test_results.append(("Error - Missing tracking_number", False))
    
    # ========== TEST 5: ERROR CASE - All optional fields missing ==========
    tracking_error = f"ERROR-TEST-{int(datetime.now().timestamp())}"
    print(f"\n{'='*80}")
    print(f"TEST 5: ERROR CASE - All optional fields missing")
    print(f"{'='*80}")
    
    # Create shipment in 'printed' state
    shipment = create_test_shipment(owner_token, tracking_error, expedition_id)
    if not shipment:
        print("❌ FAILED: Could not create test shipment for error case")
        test_results.append(("Error - Create shipment", False))
    else:
        print(f"✅ Test shipment created: {tracking_error}")
        test_shipments.append(tracking_error)
        test_results.append(("Error - Create shipment", True))
        
        # Test error case: Only tracking_number, no SKU/Item/Photo
        body = {
            "tracking_number": tracking_error
        }
        success, data = test_scan_pack(owner_token, body, 400, "Error - All optional fields missing")
        
        if success:
            error = data.get("error", "")
            if "minimal" in error.lower() or "sku" in error.lower() or "foto" in error.lower():
                print(f"✅ Error case PASSED: Got expected validation error: {error}")
                test_results.append(("Error - All optional missing", True))
            else:
                print(f"❌ Error case FAILED: Expected validation error about missing fields, got: {error}")
                test_results.append(("Error - All optional missing", False))
        else:
            test_results.append(("Error - All optional missing", False))
    
    # ========== TEST 6: REGRESSION - GET /api/om/shipments ==========
    print(f"\n{'='*80}")
    print(f"TEST 6: REGRESSION - GET /api/om/shipments")
    print(f"{'='*80}")
    
    headers = {"Authorization": f"Bearer {owner_token}"}
    resp = requests.get(f"{BASE_URL}/api/om/shipments", headers=headers)
    
    if resp.status_code == 200:
        data = resp.json()
        items = data.get("items", [])
        print(f"✅ GET /api/om/shipments PASSED: {resp.status_code}, returned {len(items)} shipments")
        test_results.append(("Regression - GET shipments", True))
        
        # Verify our test shipments are in the list
        tracking_numbers = [item.get("tracking_number") for item in items]
        for test_tracking in test_shipments:
            if test_tracking in tracking_numbers:
                print(f"✅ Test shipment {test_tracking} found in shipments list")
            else:
                print(f"⚠️ Test shipment {test_tracking} NOT found in shipments list (may have been filtered)")
    else:
        print(f"❌ GET /api/om/shipments FAILED: {resp.status_code} {resp.text}")
        test_results.append(("Regression - GET shipments", False))
    
    # ========== TEST 7: AUTH CHECK - Staff without OM module ==========
    tracking_auth = f"AUTH-TEST-{int(datetime.now().timestamp())}"
    print(f"\n{'='*80}")
    print(f"TEST 7: AUTH CHECK - Staff without order_management module")
    print(f"{'='*80}")
    
    # Create shipment as owner first
    shipment = create_test_shipment(owner_token, tracking_auth, expedition_id)
    if not shipment:
        print("❌ FAILED: Could not create test shipment for auth check")
        test_results.append(("Auth - Create shipment", False))
    else:
        print(f"✅ Test shipment created: {tracking_auth}")
        test_shipments.append(tracking_auth)
        test_results.append(("Auth - Create shipment", True))
        
        # Try to pack as staff without OM module
        body = {
            "tracking_number": tracking_auth,
            "sku_count": 1,
            "item_count": 1
        }
        success, data = test_scan_pack(staff_token, body, 403, "Auth - Staff without OM module")
        
        if success:
            error = data.get("error", "")
            if "order management" in error.lower() or "akses" in error.lower():
                print(f"✅ Auth check PASSED: Staff correctly denied with 403: {error}")
                test_results.append(("Auth - Staff denied", True))
            else:
                print(f"❌ Auth check FAILED: Expected module access error, got: {error}")
                test_results.append(("Auth - Staff denied", False))
        else:
            test_results.append(("Auth - Staff denied", False))
    
    # ========== TEST 8: CLEANUP ==========
    print(f"\n{'='*80}")
    print(f"TEST 8: CLEANUP")
    print(f"{'='*80}")
    
    print(f"Note: Test shipments created: {test_shipments}")
    print(f"These will be cleaned up by the daily retention routine.")
    print(f"No direct DELETE endpoint available for shipments.")
    test_results.append(("Cleanup", True))
    
    # ========== SUMMARY ==========
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    print(f"\nTotal tests: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {total - passed}")
    print(f"Success rate: {passed/total*100:.1f}%")
    
    print("\nDetailed results:")
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}: {test_name}")
    
    if passed == total:
        print("\n" + "="*80)
        print("🎉 ALL TESTS PASSED!")
        print("="*80)
    else:
        print("\n" + "="*80)
        print("⚠️ SOME TESTS FAILED")
        print("="*80)
    
    return passed == total

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
