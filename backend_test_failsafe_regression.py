#!/usr/bin/env python3
"""
QUICK REGRESSION TEST — Failsafe force-fit loop patch (frontend-only, backend UNTOUCHED)

CONTEXT:
Added additional failsafe force-fit loop in `/app/components/modules/order-management/api.js` 
after the existing JPEG fallback. New loop is bounded (40 iters + 120px floor) and only 
executes when `bytes > HARD_CAP_BYTES`. Backend is UNCHANGED — this is frontend-only.

BASE URL: https://absensi-foundation.preview.emergentagent.com
CREDENTIALS: owner / owner123

QUICK REGRESSION (run all 5 tests, DO NOT stop early):

TEST 1: WebP upload → 200
TEST 2: JPEG upload → 200
TEST 3: PNG upload → 200
TEST 4: >500KB rejected → 400 (backend cap intact)
TEST 5: Zero regression in OM endpoints

CRITICAL SUCCESS CRITERIA:
✅ Photo upload (all 3 formats) → 200
✅ >500KB → 400 (backend cap intact)
✅ Zero regression in OM endpoints
"""

import requests
import base64
import sys

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# Minimal valid image data URLs for testing (tiny images, <1KB each)
WEBP_DATA_URL = "data:image/webp;base64,UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAgAAAABDwCEBQAAVlA4IB4AAAAwAQCdASoBAAEAAkA4JZQAA3AA/vv/AAA="
JPEG_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k="
PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

# Oversized JPEG (>500KB) - create a large base64 string
# We'll create a ~2.2MB base64 string (which decodes to ~1.6MB binary)
OVERSIZED_JPEG_DATA_URL = "data:image/jpeg;base64," + ("A" * 3000000)

def test_all():
    """Run all 5 regression tests"""
    print("=" * 80)
    print("FAILSAFE FORCE-FIT LOOP REGRESSION TEST")
    print("=" * 80)
    print()
    
    # Login
    print("🔐 Logging in as owner...")
    login_resp = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": OWNER_USERNAME, "password": OWNER_PASSWORD}
    )
    if login_resp.status_code != 200:
        print(f"❌ LOGIN FAILED: {login_resp.status_code}")
        print(login_resp.text)
        sys.exit(1)
    
    token = login_resp.json().get("token")
    if not token:
        print("❌ No token in login response")
        sys.exit(1)
    
    print(f"✅ Login successful, token: {token[:20]}...")
    headers = {"Authorization": f"Bearer {token}"}
    print()
    
    # Get expeditions for testing
    print("📦 Getting expeditions...")
    exp_resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers=headers)
    if exp_resp.status_code != 200:
        print(f"❌ Failed to get expeditions: {exp_resp.status_code}")
        sys.exit(1)
    
    expeditions = exp_resp.json().get("items", [])
    if not expeditions:
        print("❌ No expeditions found")
        sys.exit(1)
    
    expedition_id = expeditions[0]["id"]
    print(f"✅ Using expedition: {expeditions[0]['name']} (id: {expedition_id})")
    print()
    
    # Track test results
    test_results = []
    
    # TEST 1: WebP upload → 200
    print("=" * 80)
    print("TEST 1: WebP upload → 200")
    print("=" * 80)
    try:
        tracking_webp = "FF-WEBP-001"
        
        # Print resi
        print(f"  Step 1: Print resi {tracking_webp}...")
        print_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking_webp, "expedition_id": expedition_id}
        )
        if print_resp.status_code != 200:
            print(f"  ❌ Print failed: {print_resp.status_code}")
            print(f"     {print_resp.text}")
            test_results.append(("TEST 1: WebP upload", "FAIL", f"Print failed: {print_resp.status_code}"))
        else:
            print(f"  ✅ Print successful")
            
            # Pack with WebP photo
            print(f"  Step 2: Pack with WebP photo...")
            pack_resp = requests.post(
                f"{BASE_URL}/api/om/scan/pack",
                headers=headers,
                json={
                    "tracking_number": tracking_webp,
                    "photo_data_url": WEBP_DATA_URL
                }
            )
            if pack_resp.status_code != 200:
                print(f"  ❌ Pack failed: {pack_resp.status_code}")
                print(f"     {pack_resp.text}")
                test_results.append(("TEST 1: WebP upload", "FAIL", f"Pack failed: {pack_resp.status_code}"))
            else:
                pack_data = pack_resp.json()
                shipment = pack_data.get("shipment", {})
                photo_url = shipment.get("photo_url")
                
                if not photo_url:
                    print(f"  ❌ No photo_url in response")
                    test_results.append(("TEST 1: WebP upload", "FAIL", "No photo_url"))
                else:
                    print(f"  ✅ Pack successful, photo_url: {photo_url}")
                    
                    # Get photo
                    print(f"  Step 3: GET {photo_url}...")
                    photo_resp = requests.get(f"{BASE_URL}{photo_url}", headers=headers)
                    if photo_resp.status_code != 200:
                        print(f"  ❌ Photo GET failed: {photo_resp.status_code}")
                        test_results.append(("TEST 1: WebP upload", "FAIL", f"Photo GET failed: {photo_resp.status_code}"))
                    else:
                        content_type = photo_resp.headers.get("Content-Type", "")
                        print(f"  ✅ Photo GET successful, Content-Type: {content_type}")
                        
                        if "image/webp" in content_type.lower():
                            print(f"  ✅ TEST 1 PASSED: WebP upload → 200")
                            test_results.append(("TEST 1: WebP upload", "PASS", ""))
                        else:
                            print(f"  ⚠️  Content-Type is {content_type}, expected image/webp")
                            test_results.append(("TEST 1: WebP upload", "PASS", f"Content-Type: {content_type}"))
    except Exception as e:
        print(f"  ❌ TEST 1 EXCEPTION: {e}")
        test_results.append(("TEST 1: WebP upload", "FAIL", str(e)))
    
    print()
    
    # TEST 2: JPEG upload → 200
    print("=" * 80)
    print("TEST 2: JPEG upload → 200")
    print("=" * 80)
    try:
        tracking_jpeg = "FF-JPEG-001"
        
        # Print resi
        print(f"  Step 1: Print resi {tracking_jpeg}...")
        print_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking_jpeg, "expedition_id": expedition_id}
        )
        if print_resp.status_code != 200:
            print(f"  ❌ Print failed: {print_resp.status_code}")
            test_results.append(("TEST 2: JPEG upload", "FAIL", f"Print failed: {print_resp.status_code}"))
        else:
            print(f"  ✅ Print successful")
            
            # Pack with JPEG photo
            print(f"  Step 2: Pack with JPEG photo...")
            pack_resp = requests.post(
                f"{BASE_URL}/api/om/scan/pack",
                headers=headers,
                json={
                    "tracking_number": tracking_jpeg,
                    "photo_data_url": JPEG_DATA_URL
                }
            )
            if pack_resp.status_code != 200:
                print(f"  ❌ Pack failed: {pack_resp.status_code}")
                print(f"     {pack_resp.text}")
                test_results.append(("TEST 2: JPEG upload", "FAIL", f"Pack failed: {pack_resp.status_code}"))
            else:
                pack_data = pack_resp.json()
                shipment = pack_data.get("shipment", {})
                photo_url = shipment.get("photo_url")
                
                if not photo_url:
                    print(f"  ❌ No photo_url in response")
                    test_results.append(("TEST 2: JPEG upload", "FAIL", "No photo_url"))
                else:
                    print(f"  ✅ Pack successful, photo_url: {photo_url}")
                    
                    # Get photo
                    print(f"  Step 3: GET {photo_url}...")
                    photo_resp = requests.get(f"{BASE_URL}{photo_url}", headers=headers)
                    if photo_resp.status_code != 200:
                        print(f"  ❌ Photo GET failed: {photo_resp.status_code}")
                        test_results.append(("TEST 2: JPEG upload", "FAIL", f"Photo GET failed: {photo_resp.status_code}"))
                    else:
                        content_type = photo_resp.headers.get("Content-Type", "")
                        print(f"  ✅ Photo GET successful, Content-Type: {content_type}")
                        
                        if "image/jpeg" in content_type.lower():
                            print(f"  ✅ TEST 2 PASSED: JPEG upload → 200")
                            test_results.append(("TEST 2: JPEG upload", "PASS", ""))
                        else:
                            print(f"  ⚠️  Content-Type is {content_type}, expected image/jpeg")
                            test_results.append(("TEST 2: JPEG upload", "PASS", f"Content-Type: {content_type}"))
    except Exception as e:
        print(f"  ❌ TEST 2 EXCEPTION: {e}")
        test_results.append(("TEST 2: JPEG upload", "FAIL", str(e)))
    
    print()
    
    # TEST 3: PNG upload → 200
    print("=" * 80)
    print("TEST 3: PNG upload → 200")
    print("=" * 80)
    try:
        tracking_png = "FF-PNG-001"
        
        # Print resi
        print(f"  Step 1: Print resi {tracking_png}...")
        print_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking_png, "expedition_id": expedition_id}
        )
        if print_resp.status_code != 200:
            print(f"  ❌ Print failed: {print_resp.status_code}")
            test_results.append(("TEST 3: PNG upload", "FAIL", f"Print failed: {print_resp.status_code}"))
        else:
            print(f"  ✅ Print successful")
            
            # Pack with PNG photo
            print(f"  Step 2: Pack with PNG photo...")
            pack_resp = requests.post(
                f"{BASE_URL}/api/om/scan/pack",
                headers=headers,
                json={
                    "tracking_number": tracking_png,
                    "photo_data_url": PNG_DATA_URL
                }
            )
            if pack_resp.status_code != 200:
                print(f"  ❌ Pack failed: {pack_resp.status_code}")
                print(f"     {pack_resp.text}")
                test_results.append(("TEST 3: PNG upload", "FAIL", f"Pack failed: {pack_resp.status_code}"))
            else:
                pack_data = pack_resp.json()
                shipment = pack_data.get("shipment", {})
                photo_url = shipment.get("photo_url")
                
                if not photo_url:
                    print(f"  ❌ No photo_url in response")
                    test_results.append(("TEST 3: PNG upload", "FAIL", "No photo_url"))
                else:
                    print(f"  ✅ Pack successful, photo_url: {photo_url}")
                    
                    # Get photo
                    print(f"  Step 3: GET {photo_url}...")
                    photo_resp = requests.get(f"{BASE_URL}{photo_url}", headers=headers)
                    if photo_resp.status_code != 200:
                        print(f"  ❌ Photo GET failed: {photo_resp.status_code}")
                        test_results.append(("TEST 3: PNG upload", "FAIL", f"Photo GET failed: {photo_resp.status_code}"))
                    else:
                        content_type = photo_resp.headers.get("Content-Type", "")
                        print(f"  ✅ Photo GET successful, Content-Type: {content_type}")
                        print(f"  ✅ TEST 3 PASSED: PNG upload → 200")
                        test_results.append(("TEST 3: PNG upload", "PASS", ""))
    except Exception as e:
        print(f"  ❌ TEST 3 EXCEPTION: {e}")
        test_results.append(("TEST 3: PNG upload", "FAIL", str(e)))
    
    print()
    
    # TEST 4: >500KB rejected → 400 (backend cap intact)
    print("=" * 80)
    print("TEST 4: >500KB rejected → 400 (backend cap intact)")
    print("=" * 80)
    try:
        tracking_oversized = "FF-OVERSIZED-001"
        
        # Print resi
        print(f"  Step 1: Print resi {tracking_oversized}...")
        print_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking_oversized, "expedition_id": expedition_id}
        )
        if print_resp.status_code != 200:
            print(f"  ❌ Print failed: {print_resp.status_code}")
            test_results.append(("TEST 4: >500KB rejected", "FAIL", f"Print failed: {print_resp.status_code}"))
        else:
            print(f"  ✅ Print successful")
            
            # Try to pack with oversized photo
            print(f"  Step 2: Pack with oversized photo (>500KB)...")
            pack_resp = requests.post(
                f"{BASE_URL}/api/om/scan/pack",
                headers=headers,
                json={
                    "tracking_number": tracking_oversized,
                    "photo_data_url": OVERSIZED_JPEG_DATA_URL
                }
            )
            if pack_resp.status_code == 400:
                error_msg = pack_resp.json().get("error", "")
                print(f"  ✅ Pack correctly rejected with 400")
                print(f"     Error message: {error_msg}")
                
                if "ukuran foto terlalu besar" in error_msg.lower() or ">500kb" in error_msg.lower():
                    print(f"  ✅ TEST 4 PASSED: >500KB → 400 (backend cap intact)")
                    test_results.append(("TEST 4: >500KB rejected", "PASS", ""))
                else:
                    print(f"  ⚠️  Error message doesn't mention size limit")
                    test_results.append(("TEST 4: >500KB rejected", "PASS", f"Error: {error_msg}"))
            else:
                print(f"  ❌ Expected 400, got {pack_resp.status_code}")
                print(f"     {pack_resp.text}")
                test_results.append(("TEST 4: >500KB rejected", "FAIL", f"Expected 400, got {pack_resp.status_code}"))
    except Exception as e:
        print(f"  ❌ TEST 4 EXCEPTION: {e}")
        test_results.append(("TEST 4: >500KB rejected", "FAIL", str(e)))
    
    print()
    
    # TEST 5: Zero regression in OM endpoints
    print("=" * 80)
    print("TEST 5: Zero regression in OM endpoints")
    print("=" * 80)
    try:
        endpoints_to_test = [
            ("GET /api/om/dashboard", f"{BASE_URL}/api/om/dashboard"),
            ("GET /api/om/shipments", f"{BASE_URL}/api/om/shipments"),
            ("GET /api/om/pdfs", f"{BASE_URL}/api/om/pdfs"),
            ("GET /api/om/packing-productivity", f"{BASE_URL}/api/om/packing-productivity"),
        ]
        
        all_passed = True
        for name, url in endpoints_to_test:
            print(f"  Testing {name}...")
            resp = requests.get(url, headers=headers)
            if resp.status_code == 200:
                print(f"  ✅ {name} → 200")
            else:
                print(f"  ❌ {name} → {resp.status_code}")
                all_passed = False
        
        if all_passed:
            print(f"  ✅ TEST 5 PASSED: Zero regression in OM endpoints")
            test_results.append(("TEST 5: Zero regression", "PASS", ""))
        else:
            print(f"  ❌ TEST 5 FAILED: Some endpoints returned non-200")
            test_results.append(("TEST 5: Zero regression", "FAIL", "Some endpoints failed"))
    except Exception as e:
        print(f"  ❌ TEST 5 EXCEPTION: {e}")
        test_results.append(("TEST 5: Zero regression", "FAIL", str(e)))
    
    print()
    
    # Cleanup
    print("=" * 80)
    print("CLEANUP")
    print("=" * 80)
    print("Test shipments will be cleaned by daily retention routine.")
    print("Test tracking numbers: FF-WEBP-001, FF-JPEG-001, FF-PNG-001, FF-OVERSIZED-001")
    print()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(1 for _, status, _ in test_results if status == "PASS")
    failed = sum(1 for _, status, _ in test_results if status == "FAIL")
    
    for test_name, status, note in test_results:
        icon = "✅" if status == "PASS" else "❌"
        note_str = f" ({note})" if note else ""
        print(f"{icon} {test_name}: {status}{note_str}")
    
    print()
    print(f"TOTAL: {passed}/{len(test_results)} PASSED, {failed}/{len(test_results)} FAILED")
    print()
    
    if failed == 0:
        print("🎉 ALL TESTS PASSED (100%)")
        print()
        print("CRITICAL SUCCESS CRITERIA (ALL MET):")
        print("✅ Photo upload (all 3 formats) → 200")
        print("✅ >500KB → 400 (backend cap intact)")
        print("✅ Zero regression in OM endpoints")
        return 0
    else:
        print("❌ SOME TESTS FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(test_all())
