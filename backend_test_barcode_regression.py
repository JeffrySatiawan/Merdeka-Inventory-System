#!/usr/bin/env python3
"""
REGRESSION TEST for OM Parser — Barcode 1D fallback patch.
NO backend code was modified. This test verifies all backend endpoints still work.
"""
import requests
import json
import time
from datetime import datetime

BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"

# Test credentials
OWNER_USER = "owner"
OWNER_PASS = "owner123"
CINDY_USER = "cindy"
CINDY_PASS = "cindy123"

# Global state
owner_token = None
cindy_token = None
test_pdf_ids = []

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    log(f"Logging in as {username}...")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code != 200:
        log(f"❌ Login failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    log(f"✅ Login successful: {data['user']['name']} (role={data['user']['role']})")
    return data['token']

def create_minimal_pdf():
    """Create a minimal valid PDF (smallest possible)"""
    # Minimal PDF structure (681 bytes)
    pdf_content = b"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF
"""
    return pdf_content

def test_1_scan_result_contract():
    """TEST 1 — POST /api/om/pdfs/{id}/scan-result contract"""
    log("\n=== TEST 1: POST /api/om/pdfs/{id}/scan-result contract ===")
    
    # 1. Login owner
    global owner_token
    owner_token = login(OWNER_USER, OWNER_PASS)
    if not owner_token:
        return False
    
    headers = {"Authorization": f"Bearer {owner_token}"}
    
    # 2. Upload a PDF
    log("Uploading test PDF...")
    pdf_bytes = create_minimal_pdf()
    files = {"file": ("test_scan_result.pdf", pdf_bytes, "application/pdf")}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", headers=headers, files=files)
    if resp.status_code != 200:
        log(f"❌ PDF upload failed: {resp.status_code} {resp.text}")
        return False
    pdf_id = resp.json()["item"]["id"]
    test_pdf_ids.append(pdf_id)
    log(f"✅ PDF uploaded: {pdf_id}")
    
    # 3. POST scan-result with tracking numbers
    log("Posting scan-result with tracking numbers...")
    scan_data = {"tracking_numbers": ["ABC123", "DEF456"], "pages_count": 2}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=scan_data)
    if resp.status_code != 200:
        log(f"❌ scan-result POST failed: {resp.status_code} {resp.text}")
        return False
    log("✅ scan-result POST successful")
    
    # 4. GET /api/om/pdfs and verify
    log("Verifying scan-result in PDF list...")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    if resp.status_code != 200:
        log(f"❌ GET /api/om/pdfs failed: {resp.status_code}")
        return False
    items = resp.json()["items"]
    pdf_item = next((p for p in items if p["id"] == pdf_id), None)
    if not pdf_item:
        log(f"❌ PDF {pdf_id} not found in list")
        return False
    
    if pdf_item["detected_tracking_numbers"] != ["ABC123", "DEF456"]:
        log(f"❌ detected_tracking_numbers mismatch: {pdf_item['detected_tracking_numbers']}")
        return False
    if pdf_item["pages_count"] != 2:
        log(f"❌ pages_count mismatch: {pdf_item['pages_count']}")
        return False
    if not pdf_item["scanned_at"]:
        log(f"❌ scanned_at is null")
        return False
    log(f"✅ Verified: detected_tracking_numbers={pdf_item['detected_tracking_numbers']}, pages_count={pdf_item['pages_count']}, scanned_at={pdf_item['scanned_at']}")
    
    # 5. POST scan-result with empty tracking_numbers
    log("Posting scan-result with empty tracking_numbers...")
    scan_data = {"tracking_numbers": [], "pages_count": 2}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=scan_data)
    if resp.status_code != 200:
        log(f"❌ scan-result POST (empty) failed: {resp.status_code} {resp.text}")
        return False
    log("✅ scan-result POST (empty) successful")
    
    # 6. GET /api/om/pdfs and verify empty
    log("Verifying empty scan-result...")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    if resp.status_code != 200:
        log(f"❌ GET /api/om/pdfs failed: {resp.status_code}")
        return False
    items = resp.json()["items"]
    pdf_item = next((p for p in items if p["id"] == pdf_id), None)
    if not pdf_item:
        log(f"❌ PDF {pdf_id} not found in list")
        return False
    
    if pdf_item["detected_tracking_numbers"] != []:
        log(f"❌ detected_tracking_numbers should be empty: {pdf_item['detected_tracking_numbers']}")
        return False
    log(f"✅ Verified: detected_tracking_numbers is empty")
    
    log("✅ TEST 1 PASSED")
    return True

def test_2_empty_to_nonempty_hydration():
    """TEST 2 — Empty→Non-empty scan-result triggers hydration"""
    log("\n=== TEST 2: Empty→Non-empty scan-result triggers hydration ===")
    
    headers = {"Authorization": f"Bearer {owner_token}"}
    
    # 1. Upload a new PDF
    log("Uploading test PDF...")
    pdf_bytes = create_minimal_pdf()
    files = {"file": ("test_hydration.pdf", pdf_bytes, "application/pdf")}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", headers=headers, files=files)
    if resp.status_code != 200:
        log(f"❌ PDF upload failed: {resp.status_code} {resp.text}")
        return False
    pdf_id = resp.json()["item"]["id"]
    test_pdf_ids.append(pdf_id)
    log(f"✅ PDF uploaded: {pdf_id}")
    
    # 2. POST scan-result with empty tracking_numbers
    log("Posting scan-result with empty tracking_numbers...")
    scan_data = {"tracking_numbers": [], "pages_count": 1}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=scan_data)
    if resp.status_code != 200:
        log(f"❌ scan-result POST failed: {resp.status_code} {resp.text}")
        return False
    log("✅ scan-result POST (empty) successful")
    
    # GET and verify ketoko_resi is empty
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    if resp.status_code != 200:
        log(f"❌ GET /api/om/pdfs failed: {resp.status_code}")
        return False
    items = resp.json()["items"]
    pdf_item = next((p for p in items if p["id"] == pdf_id), None)
    if not pdf_item:
        log(f"❌ PDF {pdf_id} not found in list")
        return False
    
    if pdf_item.get("ketoko_resi", []) != []:
        log(f"❌ ketoko_resi should be empty: {pdf_item.get('ketoko_resi')}")
        return False
    if pdf_item.get("ketoko_total_count", 0) != 0:
        log(f"❌ ketoko_total_count should be 0: {pdf_item.get('ketoko_total_count')}")
        return False
    if pdf_item.get("ketoko_checked_count", 0) != 0:
        log(f"❌ ketoko_checked_count should be 0: {pdf_item.get('ketoko_checked_count')}")
        return False
    log(f"✅ Verified: ketoko_resi=[], ketoko_total_count=0, ketoko_checked_count=0")
    
    # 3. POST scan-result with tracking_numbers
    log("Posting scan-result with tracking_numbers (simulating barcode fallback)...")
    scan_data = {"tracking_numbers": ["TN-A", "TN-B"], "pages_count": 1}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=scan_data)
    if resp.status_code != 200:
        log(f"❌ scan-result POST failed: {resp.status_code} {resp.text}")
        return False
    log("✅ scan-result POST (with tracking) successful")
    
    # 4. GET and verify ketoko_resi has 2 entries
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    if resp.status_code != 200:
        log(f"❌ GET /api/om/pdfs failed: {resp.status_code}")
        return False
    items = resp.json()["items"]
    pdf_item = next((p for p in items if p["id"] == pdf_id), None)
    if not pdf_item:
        log(f"❌ PDF {pdf_id} not found in list")
        return False
    
    ketoko_resi = pdf_item.get("ketoko_resi", [])
    if len(ketoko_resi) != 2:
        log(f"❌ ketoko_resi should have 2 entries: {ketoko_resi}")
        return False
    
    # Verify all unchecked, no notes
    for resi in ketoko_resi:
        if resi["checked"]:
            log(f"❌ resi {resi['tracking_number']} should be unchecked")
            return False
        if resi["note_type"] is not None:
            log(f"❌ resi {resi['tracking_number']} should have no note_type")
            return False
    
    if pdf_item.get("ketoko_total_count", 0) != 2:
        log(f"❌ ketoko_total_count should be 2: {pdf_item.get('ketoko_total_count')}")
        return False
    if pdf_item.get("ketoko_checked_count", 0) != 0:
        log(f"❌ ketoko_checked_count should be 0: {pdf_item.get('ketoko_checked_count')}")
        return False
    
    log(f"✅ Verified: ketoko_resi has 2 entries (all unchecked, no notes), ketoko_total_count=2")
    
    log("✅ TEST 2 PASSED")
    return True

def test_3_full_om_regression():
    """TEST 3 — Full OM endpoint regression"""
    log("\n=== TEST 3: Full OM endpoint regression ===")
    
    headers_owner = {"Authorization": f"Bearer {owner_token}"}
    
    # Login cindy
    global cindy_token
    cindy_token = login(CINDY_USER, CINDY_PASS)
    if not cindy_token:
        return False
    headers_cindy = {"Authorization": f"Bearer {cindy_token}"}
    
    tests_passed = 0
    tests_total = 0
    
    # POST /api/auth/login (owner + cindy)
    tests_total += 1
    log("Testing POST /api/auth/login (owner)...")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": OWNER_USER, "password": OWNER_PASS})
    if resp.status_code == 200:
        log("✅ Owner login: 200")
        tests_passed += 1
    else:
        log(f"❌ Owner login failed: {resp.status_code}")
    
    tests_total += 1
    log("Testing POST /api/auth/login (cindy)...")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": CINDY_USER, "password": CINDY_PASS})
    if resp.status_code == 200:
        log("✅ Cindy login: 200")
        tests_passed += 1
    else:
        log(f"❌ Cindy login failed: {resp.status_code}")
    
    # GET /api/auth/me (Bearer + ?token=)
    tests_total += 1
    log("Testing GET /api/auth/me (Bearer)...")
    resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers_owner)
    if resp.status_code == 200:
        log("✅ GET /api/auth/me (Bearer): 200")
        tests_passed += 1
    else:
        log(f"❌ GET /api/auth/me (Bearer) failed: {resp.status_code}")
    
    tests_total += 1
    log("Testing GET /api/auth/me (?token=)...")
    resp = requests.get(f"{BASE_URL}/api/auth/me?token={owner_token}")
    if resp.status_code == 200:
        log("✅ GET /api/auth/me (?token=): 200")
        tests_passed += 1
    else:
        log(f"❌ GET /api/auth/me (?token=) failed: {resp.status_code}")
    
    # GET /api/dashboard
    tests_total += 1
    log("Testing GET /api/dashboard...")
    resp = requests.get(f"{BASE_URL}/api/dashboard", headers=headers_owner)
    if resp.status_code == 200:
        log("✅ GET /api/dashboard: 200")
        tests_passed += 1
    else:
        log(f"❌ GET /api/dashboard failed: {resp.status_code}")
    
    # GET /api/om/dashboard
    tests_total += 1
    log("Testing GET /api/om/dashboard...")
    resp = requests.get(f"{BASE_URL}/api/om/dashboard", headers=headers_owner)
    if resp.status_code == 200:
        log("✅ GET /api/om/dashboard: 200")
        tests_passed += 1
    else:
        log(f"❌ GET /api/om/dashboard failed: {resp.status_code}")
    
    # POST /api/om/pdfs (upload PDF)
    tests_total += 1
    log("Testing POST /api/om/pdfs (upload)...")
    pdf_bytes = create_minimal_pdf()
    files = {"file": ("test_regression.pdf", pdf_bytes, "application/pdf")}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", headers=headers_owner, files=files)
    if resp.status_code == 200:
        pdf_id = resp.json()["item"]["id"]
        test_pdf_ids.append(pdf_id)
        log(f"✅ POST /api/om/pdfs: 200 (id={pdf_id})")
        tests_passed += 1
    else:
        log(f"❌ POST /api/om/pdfs failed: {resp.status_code}")
        pdf_id = None
    
    # POST /api/om/pdfs/auto (Merdeka Share)
    tests_total += 1
    log("Testing POST /api/om/pdfs/auto (Merdeka Share)...")
    pdf_bytes = create_minimal_pdf()
    files = {"file": ("test_auto.pdf", pdf_bytes, "application/pdf")}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", headers=headers_owner, files=files)
    if resp.status_code == 200:
        auto_pdf_id = resp.json()["item"]["id"]
        test_pdf_ids.append(auto_pdf_id)
        log(f"✅ POST /api/om/pdfs/auto: 200 (id={auto_pdf_id})")
        tests_passed += 1
    else:
        log(f"❌ POST /api/om/pdfs/auto failed: {resp.status_code}")
        auto_pdf_id = None
    
    # GET /api/om/pdfs
    tests_total += 1
    log("Testing GET /api/om/pdfs...")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers_owner)
    if resp.status_code == 200:
        data = resp.json()
        if "items" in data and "server_time" in data:
            log(f"✅ GET /api/om/pdfs: 200 (items={len(data['items'])}, server_time={data['server_time']})")
            tests_passed += 1
        else:
            log(f"❌ GET /api/om/pdfs missing fields: {data.keys()}")
    else:
        log(f"❌ GET /api/om/pdfs failed: {resp.status_code}")
    
    # GET /api/om/pdfs/{id}/file?token=<owner>
    if pdf_id:
        tests_total += 1
        log("Testing GET /api/om/pdfs/{id}/file?token=...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/file?token={owner_token}")
        if resp.status_code == 200 and resp.headers.get("Content-Type") == "application/pdf":
            log(f"✅ GET /api/om/pdfs/{pdf_id}/file?token=: 200 application/pdf")
            tests_passed += 1
        else:
            log(f"❌ GET /api/om/pdfs/{pdf_id}/file?token= failed: {resp.status_code}")
    
    # GET /api/om/pdfs/{id}/file with Bearer header
    if pdf_id:
        tests_total += 1
        log("Testing GET /api/om/pdfs/{id}/file (Bearer)...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/file", headers=headers_owner)
        if resp.status_code == 200 and resp.headers.get("Content-Type") == "application/pdf":
            log(f"✅ GET /api/om/pdfs/{pdf_id}/file (Bearer): 200 application/pdf")
            tests_passed += 1
        else:
            log(f"❌ GET /api/om/pdfs/{pdf_id}/file (Bearer) failed: {resp.status_code}")
    
    # POST /api/om/pdfs/{id}/mark-printed
    if pdf_id:
        tests_total += 1
        log("Testing POST /api/om/pdfs/{id}/mark-printed...")
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/mark-printed", headers=headers_owner)
        if resp.status_code == 200:
            log(f"✅ POST /api/om/pdfs/{pdf_id}/mark-printed: 200")
            tests_passed += 1
        else:
            log(f"❌ POST /api/om/pdfs/{pdf_id}/mark-printed failed: {resp.status_code}")
    
    # POST /api/om/pdfs/{id}/ketoko (legacy bulk)
    if pdf_id:
        tests_total += 1
        log("Testing POST /api/om/pdfs/{id}/ketoko (legacy bulk)...")
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko", headers=headers_owner, json={"input": True})
        if resp.status_code == 200:
            log(f"✅ POST /api/om/pdfs/{pdf_id}/ketoko: 200")
            tests_passed += 1
        else:
            log(f"❌ POST /api/om/pdfs/{pdf_id}/ketoko failed: {resp.status_code}")
    
    # POST /api/om/pdfs/{id}/ketoko-resi (new per-resi)
    if auto_pdf_id:
        # First, add some tracking numbers
        scan_data = {"tracking_numbers": ["TN-TEST"], "pages_count": 1}
        requests.post(f"{BASE_URL}/api/om/pdfs/{auto_pdf_id}/scan-result", headers=headers_owner, json=scan_data)
        
        tests_total += 1
        log("Testing POST /api/om/pdfs/{id}/ketoko-resi (per-resi)...")
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{auto_pdf_id}/ketoko-resi", headers=headers_owner, json={"tracking_number": "TN-TEST", "checked": True})
        if resp.status_code == 200:
            log(f"✅ POST /api/om/pdfs/{auto_pdf_id}/ketoko-resi: 200")
            tests_passed += 1
        else:
            log(f"❌ POST /api/om/pdfs/{auto_pdf_id}/ketoko-resi failed: {resp.status_code}")
    
    # GET /api/om/shipments
    tests_total += 1
    log("Testing GET /api/om/shipments...")
    resp = requests.get(f"{BASE_URL}/api/om/shipments", headers=headers_owner)
    if resp.status_code == 200:
        data = resp.json()
        if "summary" in data and "ketoko_progress" in data["summary"]:
            log(f"✅ GET /api/om/shipments: 200 (summary.ketoko_progress={data['summary']['ketoko_progress']})")
            tests_passed += 1
        else:
            log(f"❌ GET /api/om/shipments missing summary.ketoko_progress")
    else:
        log(f"❌ GET /api/om/shipments failed: {resp.status_code}")
    
    # GET /api/om/notif-settings
    tests_total += 1
    log("Testing GET /api/om/notif-settings...")
    resp = requests.get(f"{BASE_URL}/api/om/notif-settings", headers=headers_owner)
    if resp.status_code == 200:
        log(f"✅ GET /api/om/notif-settings: 200")
        tests_passed += 1
    else:
        log(f"❌ GET /api/om/notif-settings failed: {resp.status_code}")
    
    # PUT /api/om/notif-settings as cindy (should be 403)
    tests_total += 1
    log("Testing PUT /api/om/notif-settings as cindy (should be 403)...")
    resp = requests.put(f"{BASE_URL}/api/om/notif-settings", headers=headers_cindy, json={"popup": False})
    if resp.status_code == 403:
        log(f"✅ PUT /api/om/notif-settings as cindy: 403 (correctly denied)")
        tests_passed += 1
    else:
        log(f"❌ PUT /api/om/notif-settings as cindy should be 403, got: {resp.status_code}")
    
    # DELETE /api/om/pdfs/{id} as owner
    if pdf_id:
        tests_total += 1
        log("Testing DELETE /api/om/pdfs/{id} as owner...")
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers_owner)
        if resp.status_code == 200:
            log(f"✅ DELETE /api/om/pdfs/{pdf_id}: 200")
            tests_passed += 1
            test_pdf_ids.remove(pdf_id)
        else:
            log(f"❌ DELETE /api/om/pdfs/{pdf_id} failed: {resp.status_code}")
    
    log(f"\n✅ TEST 3: {tests_passed}/{tests_total} endpoint tests passed")
    return tests_passed == tests_total

def test_4_auth_regression():
    """TEST 4 — Auth regression"""
    log("\n=== TEST 4: Auth regression ===")
    
    headers_owner = {"Authorization": f"Bearer {owner_token}"}
    headers_cindy = {"Authorization": f"Bearer {cindy_token}"}
    
    tests_passed = 0
    tests_total = 0
    
    # URL-token still works for /pdfs/{id}/file
    if test_pdf_ids:
        pdf_id = test_pdf_ids[0]
        tests_total += 1
        log(f"Testing URL-token for /pdfs/{pdf_id}/file...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/file?token={owner_token}")
        if resp.status_code == 200:
            log(f"✅ URL-token works for /pdfs/{pdf_id}/file: 200")
            tests_passed += 1
        else:
            log(f"❌ URL-token failed for /pdfs/{pdf_id}/file: {resp.status_code}")
    
    # Fake token still 401
    tests_total += 1
    log("Testing fake token (should be 401)...")
    fake_headers = {"Authorization": "Bearer fake-token-12345"}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=fake_headers)
    if resp.status_code == 401:
        log(f"✅ Fake token correctly returns 401")
        tests_passed += 1
    else:
        log(f"❌ Fake token should return 401, got: {resp.status_code}")
    
    # No token + no header still 401
    tests_total += 1
    log("Testing no token (should be 401)...")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs")
    if resp.status_code == 401:
        log(f"✅ No token correctly returns 401")
        tests_passed += 1
    else:
        log(f"❌ No token should return 401, got: {resp.status_code}")
    
    # Cindy still 403 on all /api/om/* endpoints
    tests_total += 1
    log("Testing cindy access to /api/om/pdfs (should be 403)...")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers_cindy)
    if resp.status_code == 403:
        log(f"✅ Cindy correctly denied with 403")
        tests_passed += 1
    else:
        log(f"❌ Cindy should be denied with 403, got: {resp.status_code}")
    
    tests_total += 1
    log("Testing cindy access to /api/om/dashboard (should be 403)...")
    resp = requests.get(f"{BASE_URL}/api/om/dashboard", headers=headers_cindy)
    if resp.status_code == 403:
        log(f"✅ Cindy correctly denied with 403")
        tests_passed += 1
    else:
        log(f"❌ Cindy should be denied with 403, got: {resp.status_code}")
    
    log(f"\n✅ TEST 4: {tests_passed}/{tests_total} auth tests passed")
    return tests_passed == tests_total

def cleanup():
    """Delete all test PDFs"""
    log("\n=== CLEANUP ===")
    if not owner_token:
        log("⚠️ No owner token, skipping cleanup")
        return
    
    headers = {"Authorization": f"Bearer {owner_token}"}
    for pdf_id in test_pdf_ids:
        log(f"Deleting test PDF {pdf_id}...")
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
        if resp.status_code == 200:
            log(f"✅ Deleted {pdf_id}")
        else:
            log(f"⚠️ Failed to delete {pdf_id}: {resp.status_code}")
    
    log("✅ Cleanup complete")

def main():
    log("=" * 80)
    log("REGRESSION TEST: OM Parser — Barcode 1D fallback patch")
    log("NO backend code was modified. Testing all backend endpoints.")
    log("=" * 80)
    
    results = []
    
    # Run tests
    results.append(("TEST 1: scan-result contract", test_1_scan_result_contract()))
    results.append(("TEST 2: Empty→Non-empty hydration", test_2_empty_to_nonempty_hydration()))
    results.append(("TEST 3: Full OM regression", test_3_full_om_regression()))
    results.append(("TEST 4: Auth regression", test_4_auth_regression()))
    
    # Cleanup
    cleanup()
    
    # Summary
    log("\n" + "=" * 80)
    log("SUMMARY")
    log("=" * 80)
    passed = sum(1 for _, result in results if result)
    total = len(results)
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status} - {name}")
    
    log("=" * 80)
    if passed == total:
        log(f"✅ ALL TESTS PASSED ({passed}/{total})")
        log("✅ NO REGRESSIONS DETECTED - Backend is stable after client-side patch")
    else:
        log(f"❌ SOME TESTS FAILED ({passed}/{total})")
        log("❌ CRITICAL: Backend regression detected!")
    log("=" * 80)
    
    return passed == total

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
