#!/usr/bin/env python3
"""
REGRESSION TESTING — iOS Photo Compression Patch (frontend-only fix)

Tests the iOS photo compression bug fix in /app/components/modules/order-management/api.js
which added WebP feature-detect + JPEG fallback + hard-cap safety loop.

Backend was NOT modified. This is a regression test to confirm the photo upload/serve
pipeline still works with both WebP and JPEG payloads.

CONTEXT:
Fixed iOS photo compression bug — added WebP feature-detect + JPEG fallback + hard-cap
safety loop. Backend was NOT modified. This is a regression test to confirm the photo
upload/serve pipeline still works with both WebP and JPEG payloads.

BASE URL: https://pdf-notify-sound.preview.emergentagent.com
CREDENTIALS: owner / owner123
"""

import os
import sys
import requests
import json
import base64
from pymongo import MongoClient

# Base URL and credentials
BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"
USERNAME = "owner"
PASSWORD = "owner123"

# Test tracking numbers
TEST_TRACKING = {
    "webp": "IOSFIX-WEBP-001",
    "jpeg": "IOSFIX-JPEG-001",
    "oversized": "IOSFIX-OVERSIZED-001",
    "png": "IOSFIX-PNG-001",
}

# Minimal valid WebP data URL (~50 bytes)
# This is a 1x1 pixel WebP image
MINIMAL_WEBP_DATA_URL = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"

# Minimal valid JPEG data URL (~50 bytes)
# This is a 1x1 pixel JPEG image
MINIMAL_JPEG_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AH//Z"

# Minimal valid PNG data URL (~50 bytes)
# This is a 1x1 pixel PNG image
MINIMAL_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

# MongoDB connection
def get_db():
    """Get MongoDB database connection"""
    mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
    db_name = os.environ.get('DB_NAME', 'cycle_count')
    client = MongoClient(mongo_url)
    return client[db_name]

def login():
    """Login and return token"""
    print(f"\n🔐 Logging in as {USERNAME}...")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": USERNAME,
        "password": PASSWORD
    })
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        sys.exit(1)
    data = resp.json()
    token = data.get("token")
    print(f"✅ Login successful, token: {token[:20]}...")
    return token

def get_first_expedition(token):
    """Get first available expedition"""
    resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers={
        "Authorization": f"Bearer {token}"
    })
    if resp.status_code != 200:
        print(f"❌ Failed to get expeditions: {resp.status_code}")
        sys.exit(1)
    items = resp.json().get("items", [])
    if not items:
        print("❌ No expeditions found")
        sys.exit(1)
    return items[0]

def print_resi(token, tracking_number, expedition_id):
    """Print a fresh resi"""
    print(f"\n📄 Printing resi: {tracking_number}...")
    resp = requests.post(f"{BASE_URL}/api/om/scan/print", 
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tracking_number": tracking_number,
            "expedition_id": expedition_id
        }
    )
    if resp.status_code != 200:
        print(f"❌ Print failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    print(f"✅ Resi printed: {data.get('message')}")
    return data.get("shipment")

def dokumentasi_with_photo(token, tracking_number, photo_data_url):
    """Dokumentasi with photo"""
    print(f"\n📸 Dokumentasi: {tracking_number} with photo...")
    resp = requests.post(f"{BASE_URL}/api/om/scan/pack",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "tracking_number": tracking_number,
            "photo_data_url": photo_data_url
        }
    )
    return resp

def get_photo(token, shipment_id):
    """Get photo by shipment ID"""
    print(f"\n🖼️  Getting photo for shipment: {shipment_id}...")
    resp = requests.get(f"{BASE_URL}/api/om/photos/{shipment_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    return resp

def create_oversized_jpeg(target_kb=600):
    """Create an oversized JPEG data URL (>500KB)"""
    # Create a large base64 string by repeating a pattern
    # Each character in base64 is ~6 bits, so we need ~target_kb * 1024 * 8 / 6 chars
    # But we'll just repeat a chunk many times to get a big payload
    chunk = MINIMAL_JPEG_DATA_URL.split(',')[1]  # Get the base64 part
    # Repeat the chunk to create a large payload
    large_base64 = chunk * (target_kb * 10)  # Rough multiplier to exceed target
    return f"data:image/jpeg;base64,{large_base64}"

def delete_shipment(token, tracking_number):
    """Delete a shipment by tracking number"""
    print(f"\n🗑️  Deleting shipment: {tracking_number}...")
    resp = requests.delete(f"{BASE_URL}/api/om/shipments/{tracking_number}",
        headers={"Authorization": f"Bearer {token}"}
    )
    if resp.status_code == 200:
        print(f"✅ Shipment deleted: {tracking_number}")
    else:
        print(f"⚠️  Delete failed or not found: {resp.status_code}")
    return resp

# ============================================================================
# TEST SUITE
# ============================================================================

def test_1_webp_upload_path():
    """TEST 1: WEBP UPLOAD PATH (Android/desktop path)"""
    print("\n" + "="*80)
    print("TEST 1: WEBP UPLOAD PATH (Android/desktop path)")
    print("="*80)
    
    token = login()
    expedition = get_first_expedition(token)
    expedition_id = expedition.get("id")
    
    # Step 1: Print fresh resi
    shipment = print_resi(token, TEST_TRACKING["webp"], expedition_id)
    if not shipment:
        print("❌ TEST 1 FAILED: Could not print resi")
        return False
    
    # Step 2: Dokumentasi with WebP photo
    resp = dokumentasi_with_photo(token, TEST_TRACKING["webp"], MINIMAL_WEBP_DATA_URL)
    if resp.status_code != 200:
        print(f"❌ TEST 1 FAILED: Dokumentasi failed with {resp.status_code}: {resp.text}")
        return False
    
    data = resp.json()
    shipment = data.get("shipment", {})
    photo_url = shipment.get("photo_url")
    
    if not photo_url or not photo_url.startswith("/api/om/photos/"):
        print(f"❌ TEST 1 FAILED: photo_url not set correctly: {photo_url}")
        return False
    
    print(f"✅ Dokumentasi successful, photo_url: {photo_url}")
    
    # Step 3: GET photo and verify Content-Type
    shipment_id = shipment.get("id")
    photo_resp = get_photo(token, shipment_id)
    
    if photo_resp.status_code != 200:
        print(f"❌ TEST 1 FAILED: Photo GET failed with {photo_resp.status_code}")
        return False
    
    content_type = photo_resp.headers.get("Content-Type", "")
    if "image/webp" not in content_type:
        print(f"❌ TEST 1 FAILED: Expected Content-Type: image/webp, got: {content_type}")
        return False
    
    print(f"✅ Photo retrieved successfully with Content-Type: {content_type}")
    print("✅ TEST 1 PASSED: WebP upload path working")
    return True

def test_2_jpeg_upload_path():
    """TEST 2: JPEG UPLOAD PATH (iOS fallback path)"""
    print("\n" + "="*80)
    print("TEST 2: JPEG UPLOAD PATH (iOS fallback path)")
    print("="*80)
    
    token = login()
    expedition = get_first_expedition(token)
    expedition_id = expedition.get("id")
    
    # Step 1: Print fresh resi
    shipment = print_resi(token, TEST_TRACKING["jpeg"], expedition_id)
    if not shipment:
        print("❌ TEST 2 FAILED: Could not print resi")
        return False
    
    # Step 2: Dokumentasi with JPEG photo
    resp = dokumentasi_with_photo(token, TEST_TRACKING["jpeg"], MINIMAL_JPEG_DATA_URL)
    if resp.status_code != 200:
        print(f"❌ TEST 2 FAILED: Dokumentasi failed with {resp.status_code}: {resp.text}")
        return False
    
    data = resp.json()
    shipment = data.get("shipment", {})
    photo_url = shipment.get("photo_url")
    
    if not photo_url or not photo_url.startswith("/api/om/photos/"):
        print(f"❌ TEST 2 FAILED: photo_url not set correctly: {photo_url}")
        return False
    
    print(f"✅ Dokumentasi successful, photo_url: {photo_url}")
    
    # Step 3: GET photo and verify Content-Type
    shipment_id = shipment.get("id")
    photo_resp = get_photo(token, shipment_id)
    
    if photo_resp.status_code != 200:
        print(f"❌ TEST 2 FAILED: Photo GET failed with {photo_resp.status_code}")
        return False
    
    content_type = photo_resp.headers.get("Content-Type", "")
    if "image/jpeg" not in content_type:
        print(f"❌ TEST 2 FAILED: Expected Content-Type: image/jpeg, got: {content_type}")
        return False
    
    print(f"✅ Photo retrieved successfully with Content-Type: {content_type}")
    print("✅ TEST 2 PASSED: JPEG upload path working")
    return True

def test_3_photo_size_enforcement():
    """TEST 3: PHOTO SIZE ENFORCEMENT (existing 500KB cap)"""
    print("\n" + "="*80)
    print("TEST 3: PHOTO SIZE ENFORCEMENT (existing 500KB cap)")
    print("="*80)
    
    token = login()
    expedition = get_first_expedition(token)
    expedition_id = expedition.get("id")
    
    # Step 1: Print fresh resi
    shipment = print_resi(token, TEST_TRACKING["oversized"], expedition_id)
    if not shipment:
        print("❌ TEST 3 FAILED: Could not print resi")
        return False
    
    # Step 2: Create oversized photo (>500KB)
    oversized_photo = create_oversized_jpeg(600)
    print(f"📏 Created oversized photo: ~{len(oversized_photo) / 1024:.0f} KB")
    
    # Step 3: Attempt Dokumentasi with oversized photo
    resp = dokumentasi_with_photo(token, TEST_TRACKING["oversized"], oversized_photo)
    
    if resp.status_code != 400:
        print(f"❌ TEST 3 FAILED: Expected 400, got {resp.status_code}")
        return False
    
    data = resp.json()
    error_msg = data.get("error", "")
    
    if "ukuran foto terlalu besar" not in error_msg.lower():
        print(f"❌ TEST 3 FAILED: Expected error 'ukuran foto terlalu besar', got: {error_msg}")
        return False
    
    print(f"✅ Server correctly rejected oversized photo with error: {error_msg}")
    print("✅ TEST 3 PASSED: Photo size enforcement working (>500KB rejected)")
    return True

def test_4_png_upload_path():
    """TEST 4: PNG UPLOAD PATH (still accepted for legacy compat)"""
    print("\n" + "="*80)
    print("TEST 4: PNG UPLOAD PATH (still accepted for legacy compat)")
    print("="*80)
    
    token = login()
    expedition = get_first_expedition(token)
    expedition_id = expedition.get("id")
    
    # Step 1: Print fresh resi
    shipment = print_resi(token, TEST_TRACKING["png"], expedition_id)
    if not shipment:
        print("❌ TEST 4 FAILED: Could not print resi")
        return False
    
    # Step 2: Dokumentasi with PNG photo
    resp = dokumentasi_with_photo(token, TEST_TRACKING["png"], MINIMAL_PNG_DATA_URL)
    if resp.status_code != 200:
        print(f"❌ TEST 4 FAILED: Dokumentasi failed with {resp.status_code}: {resp.text}")
        return False
    
    data = resp.json()
    shipment = data.get("shipment", {})
    photo_url = shipment.get("photo_url")
    
    if not photo_url or not photo_url.startswith("/api/om/photos/"):
        print(f"❌ TEST 4 FAILED: photo_url not set correctly: {photo_url}")
        return False
    
    print(f"✅ Dokumentasi successful, photo_url: {photo_url}")
    
    # Step 3: GET photo and verify Content-Type
    shipment_id = shipment.get("id")
    photo_resp = get_photo(token, shipment_id)
    
    if photo_resp.status_code != 200:
        print(f"❌ TEST 4 FAILED: Photo GET failed with {photo_resp.status_code}")
        return False
    
    content_type = photo_resp.headers.get("Content-Type", "")
    if "image/png" not in content_type:
        print(f"❌ TEST 4 FAILED: Expected Content-Type: image/png, got: {content_type}")
        return False
    
    print(f"✅ Photo retrieved successfully with Content-Type: {content_type}")
    print("✅ TEST 4 PASSED: PNG upload path working")
    return True

def test_5_photo_binary_storage():
    """TEST 5: PHOTO BINARY STORAGE (MongoDB fallback still works)"""
    print("\n" + "="*80)
    print("TEST 5: PHOTO BINARY STORAGE (MongoDB fallback still works)")
    print("="*80)
    
    token = login()
    
    # Use the WebP test shipment from TEST 1
    # First, verify photo_data field is populated in MongoDB
    db = get_db()
    shipment = db.om_shipments.find_one({"tracking_number": TEST_TRACKING["webp"]})
    
    if not shipment:
        print("❌ TEST 5 FAILED: WebP test shipment not found in DB")
        return False
    
    if not shipment.get("photo_data"):
        print("❌ TEST 5 FAILED: photo_data field not populated in MongoDB")
        return False
    
    print(f"✅ photo_data field populated in MongoDB (size: {len(shipment['photo_data'])} bytes)")
    
    # Step 2: Manually delete the disk file
    photo_path = shipment.get("photo_path")
    if photo_path and os.path.exists(photo_path):
        try:
            os.remove(photo_path)
            print(f"✅ Deleted disk file: {photo_path}")
        except Exception as e:
            print(f"⚠️  Could not delete disk file: {e}")
    else:
        print(f"⚠️  Disk file not found or already deleted: {photo_path}")
    
    # Step 3: GET photo - should still work from MongoDB
    shipment_id = shipment.get("id")
    photo_resp = get_photo(token, shipment_id)
    
    if photo_resp.status_code != 200:
        print(f"❌ TEST 5 FAILED: Photo GET failed after disk deletion with {photo_resp.status_code}")
        return False
    
    content_type = photo_resp.headers.get("Content-Type", "")
    print(f"✅ Photo retrieved successfully from MongoDB with Content-Type: {content_type}")
    print("✅ TEST 5 PASSED: Photo binary storage (MongoDB fallback) working")
    return True

def test_6_regression_om_endpoints():
    """TEST 6: REGRESSION — All OM endpoints still work"""
    print("\n" + "="*80)
    print("TEST 6: REGRESSION — All OM endpoints still work")
    print("="*80)
    
    token = login()
    expedition = get_first_expedition(token)
    expedition_id = expedition.get("id")
    
    tests_passed = 0
    tests_total = 8
    
    # Test 1: GET /api/om/dashboard
    print("\n📊 Testing GET /api/om/dashboard...")
    resp = requests.get(f"{BASE_URL}/api/om/dashboard", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200:
        print("✅ Dashboard endpoint working")
        tests_passed += 1
    else:
        print(f"❌ Dashboard endpoint failed: {resp.status_code}")
    
    # Test 2: GET /api/om/shipments
    print("\n📦 Testing GET /api/om/shipments...")
    resp = requests.get(f"{BASE_URL}/api/om/shipments", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200:
        print("✅ Shipments endpoint working")
        tests_passed += 1
    else:
        print(f"❌ Shipments endpoint failed: {resp.status_code}")
    
    # Test 3: GET /api/om/reports
    print("\n📈 Testing GET /api/om/reports...")
    resp = requests.get(f"{BASE_URL}/api/om/reports", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200:
        print("✅ Reports endpoint working")
        tests_passed += 1
    else:
        print(f"❌ Reports endpoint failed: {resp.status_code}")
    
    # Test 4: GET /api/om/pdfs
    print("\n📄 Testing GET /api/om/pdfs...")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200:
        print("✅ PDFs endpoint working")
        tests_passed += 1
    else:
        print(f"❌ PDFs endpoint failed: {resp.status_code}")
    
    # Test 5: POST /api/om/scan/print (new resi)
    print("\n🖨️  Testing POST /api/om/scan/print...")
    test_tracking = f"REGRESSION-TEST-{os.urandom(4).hex().upper()}"
    resp = requests.post(f"{BASE_URL}/api/om/scan/print",
        headers={"Authorization": f"Bearer {token}"},
        json={"tracking_number": test_tracking, "expedition_id": expedition_id}
    )
    if resp.status_code == 200:
        print(f"✅ Print endpoint working (created {test_tracking})")
        tests_passed += 1
        # Clean up
        delete_shipment(token, test_tracking)
    else:
        print(f"❌ Print endpoint failed: {resp.status_code}")
    
    # Test 6: POST /api/om/scan/deliver
    print("\n🚚 Testing POST /api/om/scan/deliver...")
    # First create a shipment to deliver
    test_tracking2 = f"REGRESSION-DELIVER-{os.urandom(4).hex().upper()}"
    print_resp = requests.post(f"{BASE_URL}/api/om/scan/print",
        headers={"Authorization": f"Bearer {token}"},
        json={"tracking_number": test_tracking2, "expedition_id": expedition_id}
    )
    if print_resp.status_code == 200:
        # Pack it first
        pack_resp = requests.post(f"{BASE_URL}/api/om/scan/pack",
            headers={"Authorization": f"Bearer {token}"},
            json={"tracking_number": test_tracking2, "sku_count": 1, "item_count": 1}
        )
        if pack_resp.status_code == 200:
            # Now deliver
            deliver_resp = requests.post(f"{BASE_URL}/api/om/scan/deliver",
                headers={"Authorization": f"Bearer {token}"},
                json={"tracking_number": test_tracking2}
            )
            if deliver_resp.status_code == 200:
                print("✅ Deliver endpoint working")
                tests_passed += 1
            else:
                print(f"❌ Deliver endpoint failed: {deliver_resp.status_code}")
            # Clean up
            delete_shipment(token, test_tracking2)
        else:
            print(f"❌ Pack endpoint failed (needed for deliver test): {pack_resp.status_code}")
    else:
        print(f"❌ Print endpoint failed (needed for deliver test): {print_resp.status_code}")
    
    # Test 7: GET /api/om/packing-productivity
    print("\n📊 Testing GET /api/om/packing-productivity...")
    resp = requests.get(f"{BASE_URL}/api/om/packing-productivity", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200:
        print("✅ Packing productivity endpoint working")
        tests_passed += 1
    else:
        print(f"❌ Packing productivity endpoint failed: {resp.status_code}")
    
    # Test 8: GET /api/om/expeditions
    print("\n🚛 Testing GET /api/om/expeditions...")
    resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 200:
        print("✅ Expeditions endpoint working")
        tests_passed += 1
    else:
        print(f"❌ Expeditions endpoint failed: {resp.status_code}")
    
    print(f"\n📊 Regression tests: {tests_passed}/{tests_total} passed")
    
    if tests_passed == tests_total:
        print("✅ TEST 6 PASSED: All OM endpoints working")
        return True
    else:
        print(f"❌ TEST 6 FAILED: {tests_total - tests_passed} endpoints failed")
        return False

def test_7_cleanup():
    """TEST 7: CLEANUP"""
    print("\n" + "="*80)
    print("TEST 7: CLEANUP")
    print("="*80)
    
    token = login()
    
    # Delete all test shipments
    for name, tracking in TEST_TRACKING.items():
        delete_shipment(token, tracking)
    
    print("\n✅ TEST 7 PASSED: Cleanup complete")
    return True

# ============================================================================
# MAIN
# ============================================================================

def main():
    print("\n" + "="*80)
    print("iOS PHOTO COMPRESSION PATCH — REGRESSION TEST SUITE")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Credentials: {USERNAME} / {PASSWORD}")
    print("="*80)
    
    results = {}
    
    try:
        results["TEST 1: WebP Upload Path"] = test_1_webp_upload_path()
    except Exception as e:
        print(f"\n❌ TEST 1 EXCEPTION: {e}")
        results["TEST 1: WebP Upload Path"] = False
    
    try:
        results["TEST 2: JPEG Upload Path"] = test_2_jpeg_upload_path()
    except Exception as e:
        print(f"\n❌ TEST 2 EXCEPTION: {e}")
        results["TEST 2: JPEG Upload Path"] = False
    
    try:
        results["TEST 3: Photo Size Enforcement"] = test_3_photo_size_enforcement()
    except Exception as e:
        print(f"\n❌ TEST 3 EXCEPTION: {e}")
        results["TEST 3: Photo Size Enforcement"] = False
    
    try:
        results["TEST 4: PNG Upload Path"] = test_4_png_upload_path()
    except Exception as e:
        print(f"\n❌ TEST 4 EXCEPTION: {e}")
        results["TEST 4: PNG Upload Path"] = False
    
    try:
        results["TEST 5: Photo Binary Storage"] = test_5_photo_binary_storage()
    except Exception as e:
        print(f"\n❌ TEST 5 EXCEPTION: {e}")
        results["TEST 5: Photo Binary Storage"] = False
    
    try:
        results["TEST 6: Regression - All OM Endpoints"] = test_6_regression_om_endpoints()
    except Exception as e:
        print(f"\n❌ TEST 6 EXCEPTION: {e}")
        results["TEST 6: Regression - All OM Endpoints"] = False
    
    try:
        results["TEST 7: Cleanup"] = test_7_cleanup()
    except Exception as e:
        print(f"\n❌ TEST 7 EXCEPTION: {e}")
        results["TEST 7: Cleanup"] = False
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = 0
    failed = 0
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print("="*80)
    print(f"TOTAL: {passed} passed, {failed} failed out of {len(results)} tests")
    print("="*80)
    
    if failed == 0:
        print("\n🎉 ALL TESTS PASSED - iOS Photo Compression Patch regression verified!")
        return 0
    else:
        print(f"\n⚠️  {failed} TEST(S) FAILED - Please review failures above")
        return 1

if __name__ == "__main__":
    sys.exit(main())
