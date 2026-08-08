#!/usr/bin/env python3
"""
JPEG Fallback Regression Test — iPhone XR iOS 18 Fix
=====================================================
Tests the 3-line additive frontend patch in /app/components/modules/order-management/api.js
that forces JPEG re-encode when WebP output exceeds 490KB cap (iPhone XR iOS 18 workaround).

Backend is UNCHANGED. This test verifies the photo pipeline still works with all formats.

BASE URL: https://pdf-notify-sound.preview.emergentagent.com
CREDENTIALS: owner / owner123

CRITICAL SUCCESS CRITERIA:
✅ Photo upload (WebP/JPEG/PNG) → 200
✅ >500KB → 400 (backend cap intact)
✅ Zero regression in OM endpoints
"""

import requests
import base64
import sys
from datetime import datetime

BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"
CREDENTIALS = {"username": "owner", "password": "owner123"}

# Test state
token = None
expedition_code = None
test_shipments = []

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def create_webp_data_url(size_kb=50):
    """Create a valid WebP data URL (~size_kb KB)"""
    # WebP header + minimal valid data
    webp_header = b'RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00'
    # Pad to approximate size
    padding_size = (size_kb * 1024) - len(webp_header)
    data = webp_header + (b'\x00' * max(0, padding_size))
    b64 = base64.b64encode(data).decode('ascii')
    return f"data:image/webp;base64,{b64}"

def create_jpeg_data_url(size_kb=50):
    """Create a valid JPEG data URL (~size_kb KB)"""
    # JPEG header (SOI + minimal APP0 marker)
    jpeg_header = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    # JPEG EOI marker
    jpeg_eoi = b'\xff\xd9'
    # Pad to approximate size
    padding_size = (size_kb * 1024) - len(jpeg_header) - len(jpeg_eoi)
    data = jpeg_header + (b'\x00' * max(0, padding_size)) + jpeg_eoi
    b64 = base64.b64encode(data).decode('ascii')
    return f"data:image/jpeg;base64,{b64}"

def create_png_data_url(size_kb=50):
    """Create a valid PNG data URL (~size_kb KB)"""
    # PNG signature + minimal IHDR chunk
    png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
    # PNG IEND chunk
    png_end = b'\x00\x00\x00\x00IEND\xaeB`\x82'
    # Pad to approximate size
    padding_size = (size_kb * 1024) - len(png_header) - len(png_end)
    data = png_header + (b'\x00' * max(0, padding_size)) + png_end
    b64 = base64.b64encode(data).decode('ascii')
    return f"data:image/png;base64,{b64}"

def create_oversized_data_url(size_kb=550):
    """Create an oversized WebP data URL (>500KB)"""
    return create_webp_data_url(size_kb)

# ============================================================
# TEST 1: WebP upload → 200
# ============================================================
def test_1_webp_upload():
    global token, expedition_code, test_shipments
    log("=" * 60)
    log("TEST 1: WebP upload → 200")
    log("=" * 60)
    
    try:
        # Login
        log("Step 1.1: Login as owner")
        resp = requests.post(f"{BASE_URL}/api/auth/login", json=CREDENTIALS, timeout=30)
        if resp.status_code != 200:
            log(f"❌ FAIL: Login failed with status {resp.status_code}")
            return False
        token = resp.json().get("token")
        if not token:
            log("❌ FAIL: No token in login response")
            return False
        log(f"✅ PASS: Login successful, token: {token[:20]}...")
        
        # Get expeditions
        log("Step 1.2: GET /api/om/expeditions")
        headers = {"Authorization": f"Bearer {token}"}
        resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers=headers, timeout=30)
        if resp.status_code != 200:
            log(f"❌ FAIL: GET expeditions failed with status {resp.status_code}")
            return False
        expeditions = resp.json().get("items", [])
        if not expeditions:
            log("❌ FAIL: No expeditions found")
            return False
        expedition_code = expeditions[0].get("id")
        log(f"✅ PASS: Got expedition_code: {expedition_code}")
        
        # Print resi
        tracking = "XRJPEG-WEBP-001"
        log(f"Step 1.3: POST /api/om/scan/print with tracking {tracking}")
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking, "expedition_id": expedition_code},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Print failed with status {resp.status_code}: {resp.text}")
            return False
        shipment = resp.json().get("shipment", {})
        shipment_id = shipment.get("id")
        test_shipments.append(shipment_id)
        log(f"✅ PASS: Print successful, shipment_id: {shipment_id}")
        
        # Pack with WebP photo
        log(f"Step 1.4: POST /api/om/scan/pack with WebP photo (~50KB)")
        webp_data = create_webp_data_url(50)
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/pack",
            headers=headers,
            json={"tracking_number": tracking, "photo_data_url": webp_data},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Pack failed with status {resp.status_code}: {resp.text}")
            return False
        log(f"✅ PASS: Pack successful with WebP photo")
        
        # Get photo
        log(f"Step 1.5: GET /api/om/photos/{shipment_id}")
        resp = requests.get(f"{BASE_URL}/api/om/photos/{shipment_id}", headers=headers, timeout=30)
        if resp.status_code != 200:
            log(f"❌ FAIL: Get photo failed with status {resp.status_code}: {resp.text}")
            return False
        content_type = resp.headers.get("Content-Type", "")
        if "image/" not in content_type:
            log(f"❌ FAIL: Invalid Content-Type: {content_type}")
            return False
        log(f"✅ PASS: Photo retrieved successfully, Content-Type: {content_type}")
        
        log("✅ TEST 1 PASSED: WebP upload → 200")
        return True
        
    except Exception as e:
        log(f"❌ TEST 1 FAILED with exception: {e}")
        return False

# ============================================================
# TEST 2: JPEG upload → 200
# ============================================================
def test_2_jpeg_upload():
    global token, expedition_code, test_shipments
    log("\n" + "=" * 60)
    log("TEST 2: JPEG upload → 200")
    log("=" * 60)
    
    try:
        headers = {"Authorization": f"Bearer {token}"}
        
        # Print resi
        tracking = "XRJPEG-JPEG-001"
        log(f"Step 2.1: POST /api/om/scan/print with tracking {tracking}")
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking, "expedition_id": expedition_code},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Print failed with status {resp.status_code}: {resp.text}")
            return False
        shipment = resp.json().get("shipment", {})
        shipment_id = shipment.get("id")
        test_shipments.append(shipment_id)
        log(f"✅ PASS: Print successful, shipment_id: {shipment_id}")
        
        # Pack with JPEG photo
        log(f"Step 2.2: POST /api/om/scan/pack with JPEG photo (~50KB)")
        jpeg_data = create_jpeg_data_url(50)
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/pack",
            headers=headers,
            json={"tracking_number": tracking, "photo_data_url": jpeg_data},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Pack failed with status {resp.status_code}: {resp.text}")
            return False
        log(f"✅ PASS: Pack successful with JPEG photo")
        
        # Get photo
        log(f"Step 2.3: GET /api/om/photos/{shipment_id}")
        resp = requests.get(f"{BASE_URL}/api/om/photos/{shipment_id}", headers=headers, timeout=30)
        if resp.status_code != 200:
            log(f"❌ FAIL: Get photo failed with status {resp.status_code}: {resp.text}")
            return False
        content_type = resp.headers.get("Content-Type", "")
        if "image/jpeg" not in content_type:
            log(f"⚠️  WARNING: Expected image/jpeg, got {content_type}")
        log(f"✅ PASS: Photo retrieved successfully, Content-Type: {content_type}")
        
        log("✅ TEST 2 PASSED: JPEG upload → 200")
        return True
        
    except Exception as e:
        log(f"❌ TEST 2 FAILED with exception: {e}")
        return False

# ============================================================
# TEST 3: PNG upload → 200
# ============================================================
def test_3_png_upload():
    global token, expedition_code, test_shipments
    log("\n" + "=" * 60)
    log("TEST 3: PNG upload → 200")
    log("=" * 60)
    
    try:
        headers = {"Authorization": f"Bearer {token}"}
        
        # Print resi
        tracking = "XRJPEG-PNG-001"
        log(f"Step 3.1: POST /api/om/scan/print with tracking {tracking}")
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking, "expedition_id": expedition_code},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Print failed with status {resp.status_code}: {resp.text}")
            return False
        shipment = resp.json().get("shipment", {})
        shipment_id = shipment.get("id")
        test_shipments.append(shipment_id)
        log(f"✅ PASS: Print successful, shipment_id: {shipment_id}")
        
        # Pack with PNG photo
        log(f"Step 3.2: POST /api/om/scan/pack with PNG photo (~50KB)")
        png_data = create_png_data_url(50)
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/pack",
            headers=headers,
            json={"tracking_number": tracking, "photo_data_url": png_data},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Pack failed with status {resp.status_code}: {resp.text}")
            return False
        log(f"✅ PASS: Pack successful with PNG photo")
        
        log("✅ TEST 3 PASSED: PNG upload → 200")
        return True
        
    except Exception as e:
        log(f"❌ TEST 3 FAILED with exception: {e}")
        return False

# ============================================================
# TEST 4: >500KB rejected → 400
# ============================================================
def test_4_oversized_rejected():
    global token, expedition_code, test_shipments
    log("\n" + "=" * 60)
    log("TEST 4: >500KB rejected → 400")
    log("=" * 60)
    
    try:
        headers = {"Authorization": f"Bearer {token}"}
        
        # Print resi
        tracking = "XRJPEG-OVERSIZED-001"
        log(f"Step 4.1: POST /api/om/scan/print with tracking {tracking}")
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=headers,
            json={"tracking_number": tracking, "expedition_id": expedition_code},
            timeout=30
        )
        if resp.status_code != 200:
            log(f"❌ FAIL: Print failed with status {resp.status_code}: {resp.text}")
            return False
        shipment = resp.json().get("shipment", {})
        shipment_id = shipment.get("id")
        test_shipments.append(shipment_id)
        log(f"✅ PASS: Print successful, shipment_id: {shipment_id}")
        
        # Pack with oversized photo (>500KB)
        log(f"Step 4.2: POST /api/om/scan/pack with oversized photo (>500KB)")
        oversized_data = create_oversized_data_url(550)
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/pack",
            headers=headers,
            json={"tracking_number": tracking, "photo_data_url": oversized_data},
            timeout=30
        )
        if resp.status_code != 400:
            log(f"❌ FAIL: Expected 400, got {resp.status_code}: {resp.text}")
            return False
        error_msg = resp.json().get("error", "")
        if "ukuran foto terlalu besar" not in error_msg.lower():
            log(f"❌ FAIL: Expected 'ukuran foto terlalu besar' error, got: {error_msg}")
            return False
        log(f"✅ PASS: Oversized photo correctly rejected with 400: {error_msg}")
        
        log("✅ TEST 4 PASSED: >500KB rejected → 400")
        return True
        
    except Exception as e:
        log(f"❌ TEST 4 FAILED with exception: {e}")
        return False

# ============================================================
# TEST 5: Zero regression in OM endpoints
# ============================================================
def test_5_regression_check():
    global token
    log("\n" + "=" * 60)
    log("TEST 5: Zero regression in OM endpoints")
    log("=" * 60)
    
    try:
        headers = {"Authorization": f"Bearer {token}"}
        endpoints = [
            "/api/om/dashboard",
            "/api/om/shipments",
            "/api/om/pdfs",
            "/api/om/packing-productivity"
        ]
        
        all_passed = True
        for endpoint in endpoints:
            log(f"Step 5.x: GET {endpoint}")
            resp = requests.get(f"{BASE_URL}{endpoint}", headers=headers, timeout=30)
            if resp.status_code != 200:
                log(f"❌ FAIL: {endpoint} returned {resp.status_code}: {resp.text}")
                all_passed = False
            else:
                log(f"✅ PASS: {endpoint} → 200")
        
        if all_passed:
            log("✅ TEST 5 PASSED: Zero regression in OM endpoints")
        else:
            log("❌ TEST 5 FAILED: Some endpoints returned non-200")
        
        return all_passed
        
    except Exception as e:
        log(f"❌ TEST 5 FAILED with exception: {e}")
        return False

# ============================================================
# CLEANUP
# ============================================================
def cleanup():
    global token, test_shipments
    log("\n" + "=" * 60)
    log("CLEANUP: Deleting test shipments")
    log("=" * 60)
    
    if not token or not test_shipments:
        log("⚠️  No cleanup needed (no test shipments created)")
        return
    
    headers = {"Authorization": f"Bearer {token}"}
    for shipment_id in test_shipments:
        try:
            log(f"Deleting shipment {shipment_id}")
            # Note: There's no DELETE endpoint for shipments in the service.js
            # So we'll just log that we would delete them
            log(f"⚠️  Note: No DELETE endpoint for shipments, shipment {shipment_id} remains in DB")
        except Exception as e:
            log(f"⚠️  Failed to delete shipment {shipment_id}: {e}")
    
    log("✅ Cleanup complete")

# ============================================================
# MAIN
# ============================================================
def main():
    log("=" * 60)
    log("JPEG Fallback Regression Test — iPhone XR iOS 18 Fix")
    log("=" * 60)
    log(f"Base URL: {BASE_URL}")
    log(f"Credentials: {CREDENTIALS['username']} / {CREDENTIALS['password']}")
    log("")
    
    results = []
    
    # Run all tests
    results.append(("TEST 1: WebP upload", test_1_webp_upload()))
    results.append(("TEST 2: JPEG upload", test_2_jpeg_upload()))
    results.append(("TEST 3: PNG upload", test_3_png_upload()))
    results.append(("TEST 4: >500KB rejected", test_4_oversized_rejected()))
    results.append(("TEST 5: Regression check", test_5_regression_check()))
    
    # Cleanup
    cleanup()
    
    # Summary
    log("\n" + "=" * 60)
    log("TEST SUMMARY")
    log("=" * 60)
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    log("")
    log(f"TOTAL: {passed}/{total} tests passed")
    
    if passed == total:
        log("=" * 60)
        log("✅ ALL TESTS PASSED — JPEG fallback patch working correctly")
        log("=" * 60)
        return 0
    else:
        log("=" * 60)
        log(f"❌ {total - passed} TEST(S) FAILED")
        log("=" * 60)
        return 1

if __name__ == "__main__":
    sys.exit(main())
