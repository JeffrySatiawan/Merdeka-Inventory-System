#!/usr/bin/env python3
"""
Backend Test: PDF Resi Print Protection Patch
==============================================
Tests the enforcement of one-time print restriction for karyawan (non-owner staff).

PATCH SUMMARY:
- Modified endpoint POST /api/om/pdfs/{id}/mark-printed to enforce:
  * Karyawan (user.role !== 'owner'): can print each PDF only ONCE (403 on second attempt)
  * Owner: unlimited (unchanged)

BASE URL: https://absensi-foundation.preview.emergentagent.com
CREDENTIALS: owner/owner123, cindy/cindy123

TEST PLAN:
1. Owner unlimited print (3 prints on same PDF → all 200)
2. Staff first print allowed (200)
3. Staff second print blocked (403) — CRITICAL
4. Staff blocked when different user already printed (403)
5. Owner can still print after staff printed (200)
6. Regression tests (all other endpoints)
7. 404 for nonexistent PDF
8. Auth checks (401, 403)
9. Cleanup
"""

import requests
import time
import sys
from io import BytesIO

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test counters
tests_passed = 0
tests_failed = 0

def log(msg):
    print(f"[TEST] {msg}")

def pass_test(msg):
    global tests_passed
    tests_passed += 1
    print(f"✅ PASS: {msg}")

def fail_test(msg):
    global tests_failed
    tests_failed += 1
    print(f"❌ FAIL: {msg}")

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{API_BASE}/auth/login", json={"username": username, "password": password})
    if resp.status_code != 200:
        fail_test(f"Login failed for {username}: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    token = data.get("token")
    if not token:
        fail_test(f"No token in login response for {username}")
        return None
    pass_test(f"Login successful for {username}")
    return token

def upload_pdf(token, filename="test.pdf"):
    """Upload a minimal valid PDF and return the PDF id"""
    # Minimal valid PDF (1 page, empty)
    pdf_bytes = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
190
%%EOF
"""
    files = {"file": (filename, BytesIO(pdf_bytes), "application/pdf")}
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{API_BASE}/om/pdfs", files=files, headers=headers)
    if resp.status_code != 200:
        fail_test(f"PDF upload failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    pdf_id = data.get("item", {}).get("id")
    if not pdf_id:
        fail_test("No PDF id in upload response")
        return None
    pass_test(f"PDF uploaded: {pdf_id}")
    return pdf_id

def mark_printed(token, pdf_id):
    """Mark PDF as printed. Returns (status_code, response_json)"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{API_BASE}/om/pdfs/{pdf_id}/mark-printed", headers=headers)
    try:
        data = resp.json()
    except:
        data = {}
    return resp.status_code, data

def get_pdf_list(token):
    """Get PDF list"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/om/pdfs", headers=headers)
    if resp.status_code != 200:
        return None
    return resp.json().get("items", [])

def delete_pdf(token, pdf_id):
    """Delete PDF"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.delete(f"{API_BASE}/om/pdfs/{pdf_id}", headers=headers)
    return resp.status_code == 200

def grant_om_module(owner_token, employee_id):
    """Grant order_management module to employee"""
    headers = {"Authorization": f"Bearer {owner_token}"}
    resp = requests.put(
        f"{API_BASE}/employees/{employee_id}",
        json={"modules": ["cycle_count", "order_management"]},
        headers=headers
    )
    return resp.status_code == 200

def get_employee_id(token, username):
    """Get employee id by username"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/employees", headers=headers)
    if resp.status_code != 200:
        return None
    employees = resp.json().get("items", [])
    for emp in employees:
        if emp.get("username") == username:
            return emp.get("id")
    return None

def main():
    log("=" * 80)
    log("PDF RESI PRINT PROTECTION PATCH — FULL BACKEND REGRESSION TEST")
    log("=" * 80)
    
    # Login
    log("\n=== AUTHENTICATION ===")
    owner_token = login("owner", "owner123")
    cindy_token = login("cindy", "cindy123")
    
    if not owner_token or not cindy_token:
        fail_test("Authentication failed, cannot continue")
        sys.exit(1)
    
    # Get Cindy's employee ID
    cindy_id = get_employee_id(owner_token, "cindy")
    if not cindy_id:
        fail_test("Could not find Cindy's employee ID")
        sys.exit(1)
    pass_test(f"Found Cindy's employee ID: {cindy_id}")
    
    # Grant OM module to Cindy
    log("\n=== GRANT OM MODULE TO CINDY ===")
    if grant_om_module(owner_token, cindy_id):
        pass_test("Granted order_management module to Cindy")
    else:
        fail_test("Failed to grant OM module to Cindy")
        sys.exit(1)
    
    # Re-login Cindy to get updated modules
    cindy_token = login("cindy", "cindy123")
    if not cindy_token:
        fail_test("Cindy re-login failed")
        sys.exit(1)
    
    # Track test PDFs for cleanup
    test_pdfs = []
    
    # ========================================================================
    # TEST 1: OWNER UNLIMITED PRINT
    # ========================================================================
    log("\n=== TEST 1: OWNER UNLIMITED PRINT ===")
    log("Upload PDF as owner, print 3 times → all should succeed (200)")
    
    pdf1_id = upload_pdf(owner_token, "owner-unlimited.pdf")
    if not pdf1_id:
        fail_test("TEST 1 FAILED: Could not upload PDF")
    else:
        test_pdfs.append(pdf1_id)
        
        # Print 1
        status1, data1 = mark_printed(owner_token, pdf1_id)
        if status1 == 200:
            pass_test("TEST 1.1: Owner first print → 200")
            printed_at_1 = data1.get("item", {}).get("printed_at")
            if printed_at_1:
                pass_test(f"TEST 1.1a: printed_at set: {printed_at_1}")
            else:
                fail_test("TEST 1.1a: printed_at not set")
        else:
            fail_test(f"TEST 1.1: Owner first print failed: {status1} {data1}")
        
        time.sleep(0.5)
        
        # Print 2
        status2, data2 = mark_printed(owner_token, pdf1_id)
        if status2 == 200:
            pass_test("TEST 1.2: Owner second print → 200 (unlimited)")
            printed_at_2 = data2.get("item", {}).get("printed_at")
            if printed_at_2 and printed_at_2 != printed_at_1:
                pass_test(f"TEST 1.2a: printed_at updated: {printed_at_2}")
            else:
                fail_test("TEST 1.2a: printed_at not updated")
        else:
            fail_test(f"TEST 1.2: Owner second print failed: {status2} {data2}")
        
        time.sleep(0.5)
        
        # Print 3
        status3, data3 = mark_printed(owner_token, pdf1_id)
        if status3 == 200:
            pass_test("TEST 1.3: Owner third print → 200 (unlimited)")
        else:
            fail_test(f"TEST 1.3: Owner third print failed: {status3} {data3}")
    
    # ========================================================================
    # TEST 2: STAFF FIRST PRINT ALLOWED
    # ========================================================================
    log("\n=== TEST 2: STAFF FIRST PRINT ALLOWED ===")
    log("Upload new PDF as owner, Cindy prints → should succeed (200)")
    
    pdf2_id = upload_pdf(owner_token, "staff-first-print.pdf")
    if not pdf2_id:
        fail_test("TEST 2 FAILED: Could not upload PDF")
    else:
        test_pdfs.append(pdf2_id)
        
        status, data = mark_printed(cindy_token, pdf2_id)
        if status == 200:
            pass_test("TEST 2.1: Staff first print → 200")
            printed_by = data.get("item", {}).get("printed_by_name")
            if printed_by == "Cindy":
                pass_test(f"TEST 2.1a: printed_by_name = 'Cindy'")
            else:
                fail_test(f"TEST 2.1a: printed_by_name = '{printed_by}' (expected 'Cindy')")
        else:
            fail_test(f"TEST 2.1: Staff first print failed: {status} {data}")
    
    # ========================================================================
    # TEST 3: STAFF SECOND PRINT BLOCKED (CRITICAL)
    # ========================================================================
    log("\n=== TEST 3: STAFF SECOND PRINT BLOCKED (CRITICAL) ===")
    log("Same PDF as TEST 2, Cindy tries to print again → should be blocked (403)")
    
    if pdf2_id:
        status, data = mark_printed(cindy_token, pdf2_id)
        if status == 403:
            pass_test("TEST 3.1: Staff second print → 403 (BLOCKED)")
            error_msg = data.get("error", "")
            if "sudah pernah dicetak" in error_msg.lower():
                pass_test(f"TEST 3.1a: Error message contains 'sudah pernah dicetak': {error_msg}")
            else:
                fail_test(f"TEST 3.1a: Error message missing expected text: {error_msg}")
            
            already_printed = data.get("already_printed")
            if already_printed:
                pass_test(f"TEST 3.1b: Response has 'already_printed' field: {already_printed}")
                if already_printed.get("printed_by_name") == "Cindy":
                    pass_test("TEST 3.1c: already_printed.printed_by_name = 'Cindy'")
                else:
                    fail_test(f"TEST 3.1c: already_printed.printed_by_name = '{already_printed.get('printed_by_name')}'")
            else:
                fail_test("TEST 3.1b: Response missing 'already_printed' field")
        else:
            fail_test(f"TEST 3.1: Staff second print should be 403, got {status}: {data}")
    
    # ========================================================================
    # TEST 4: STAFF BLOCKED WHEN DIFFERENT USER ALREADY PRINTED
    # ========================================================================
    log("\n=== TEST 4: STAFF BLOCKED WHEN DIFFERENT USER ALREADY PRINTED ===")
    log("Upload new PDF as owner, owner prints, Cindy tries to print → should be blocked (403)")
    
    pdf3_id = upload_pdf(owner_token, "owner-printed-first.pdf")
    if not pdf3_id:
        fail_test("TEST 4 FAILED: Could not upload PDF")
    else:
        test_pdfs.append(pdf3_id)
        
        # Owner prints first
        status_owner, _ = mark_printed(owner_token, pdf3_id)
        if status_owner == 200:
            pass_test("TEST 4.1: Owner printed first → 200")
        else:
            fail_test(f"TEST 4.1: Owner print failed: {status_owner}")
        
        # Cindy tries to print
        status_cindy, data_cindy = mark_printed(cindy_token, pdf3_id)
        if status_cindy == 403:
            pass_test("TEST 4.2: Staff print after owner → 403 (BLOCKED)")
            error_msg = data_cindy.get("error", "")
            if "sudah pernah dicetak" in error_msg.lower():
                pass_test(f"TEST 4.2a: Error message correct: {error_msg}")
            else:
                fail_test(f"TEST 4.2a: Error message unexpected: {error_msg}")
        else:
            fail_test(f"TEST 4.2: Staff print should be 403, got {status_cindy}: {data_cindy}")
    
    # ========================================================================
    # TEST 5: OWNER CAN STILL PRINT AFTER STAFF PRINTED
    # ========================================================================
    log("\n=== TEST 5: OWNER CAN STILL PRINT AFTER STAFF PRINTED ===")
    log("Upload new PDF, Cindy prints, owner prints same PDF → owner should succeed (200)")
    
    pdf4_id = upload_pdf(owner_token, "staff-printed-first.pdf")
    if not pdf4_id:
        fail_test("TEST 5 FAILED: Could not upload PDF")
    else:
        test_pdfs.append(pdf4_id)
        
        # Cindy prints first
        status_cindy, _ = mark_printed(cindy_token, pdf4_id)
        if status_cindy == 200:
            pass_test("TEST 5.1: Staff printed first → 200")
        else:
            fail_test(f"TEST 5.1: Staff print failed: {status_cindy}")
        
        # Owner prints same PDF
        status_owner, data_owner = mark_printed(owner_token, pdf4_id)
        if status_owner == 200:
            pass_test("TEST 5.2: Owner print after staff → 200 (owner unrestricted)")
        else:
            fail_test(f"TEST 5.2: Owner print should be 200, got {status_owner}: {data_owner}")
    
    # ========================================================================
    # TEST 6: REGRESSION TESTS
    # ========================================================================
    log("\n=== TEST 6: REGRESSION TESTS ===")
    log("Verify all other OM PDF endpoints still work correctly")
    
    # GET /api/om/pdfs
    pdfs = get_pdf_list(owner_token)
    if pdfs is not None:
        pass_test(f"TEST 6.1: GET /api/om/pdfs → 200 ({len(pdfs)} PDFs)")
    else:
        fail_test("TEST 6.1: GET /api/om/pdfs failed")
    
    # POST /api/om/pdfs/{id}/open
    if pdf1_id:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{API_BASE}/om/pdfs/{pdf1_id}/open", headers=headers)
        if resp.status_code == 200:
            pass_test("TEST 6.2: POST /api/om/pdfs/{id}/open → 200")
        else:
            fail_test(f"TEST 6.2: POST /api/om/pdfs/{{id}}/open failed: {resp.status_code}")
    
    # POST /api/om/pdfs/{id}/scan-result
    if pdf1_id:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(
            f"{API_BASE}/om/pdfs/{pdf1_id}/scan-result",
            json={"tracking_numbers": ["TEST123", "TEST456"], "pages_count": 1},
            headers=headers
        )
        if resp.status_code == 200:
            pass_test("TEST 6.3: POST /api/om/pdfs/{id}/scan-result → 200")
        else:
            fail_test(f"TEST 6.3: POST /api/om/pdfs/{{id}}/scan-result failed: {resp.status_code}")
    
    # GET /api/om/pdfs/{id}/file
    if pdf1_id:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.get(f"{API_BASE}/om/pdfs/{pdf1_id}/file", headers=headers)
        if resp.status_code == 200 and resp.headers.get("content-type") == "application/pdf":
            pass_test("TEST 6.4: GET /api/om/pdfs/{id}/file → 200 (PDF)")
        else:
            fail_test(f"TEST 6.4: GET /api/om/pdfs/{{id}}/file failed: {resp.status_code}")
    
    # POST /api/om/pdfs/{id}/ketoko
    if pdf1_id:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(
            f"{API_BASE}/om/pdfs/{pdf1_id}/ketoko",
            json={"input": True},
            headers=headers
        )
        if resp.status_code == 200:
            pass_test("TEST 6.5: POST /api/om/pdfs/{id}/ketoko → 200")
        else:
            fail_test(f"TEST 6.5: POST /api/om/pdfs/{{id}}/ketoko failed: {resp.status_code}")
    
    # POST /api/om/pdfs/{id}/ketoko-resi
    if pdf1_id:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(
            f"{API_BASE}/om/pdfs/{pdf1_id}/ketoko-resi",
            json={"tracking_number": "TEST123", "checked": True},
            headers=headers
        )
        if resp.status_code == 200:
            pass_test("TEST 6.6: POST /api/om/pdfs/{id}/ketoko-resi → 200")
        else:
            fail_test(f"TEST 6.6: POST /api/om/pdfs/{{id}}/ketoko-resi failed: {resp.status_code}")
    
    # ========================================================================
    # TEST 7: 404 FOR NONEXISTENT PDF
    # ========================================================================
    log("\n=== TEST 7: 404 FOR NONEXISTENT PDF ===")
    
    status, data = mark_printed(owner_token, "nonexistent-pdf-id-12345")
    if status == 404:
        pass_test("TEST 7.1: POST /api/om/pdfs/nonexistent-id/mark-printed → 404")
        error_msg = data.get("error", "")
        if "tidak ditemukan" in error_msg.lower():
            pass_test(f"TEST 7.1a: Error message correct: {error_msg}")
        else:
            fail_test(f"TEST 7.1a: Error message unexpected: {error_msg}")
    else:
        fail_test(f"TEST 7.1: Should be 404, got {status}: {data}")
    
    # ========================================================================
    # TEST 8: AUTH CHECKS
    # ========================================================================
    log("\n=== TEST 8: AUTH CHECKS ===")
    
    # No token → 401
    if pdf1_id:
        resp = requests.post(f"{API_BASE}/om/pdfs/{pdf1_id}/mark-printed")
        if resp.status_code == 401:
            pass_test("TEST 8.1: POST without token → 401")
        else:
            fail_test(f"TEST 8.1: Should be 401, got {resp.status_code}")
    
    # Staff without OM module → 403
    # First, remove OM module from Cindy
    headers = {"Authorization": f"Bearer {owner_token}"}
    resp = requests.put(
        f"{API_BASE}/employees/{cindy_id}",
        json={"modules": ["cycle_count"]},
        headers=headers
    )
    if resp.status_code == 200:
        pass_test("TEST 8.2a: Removed OM module from Cindy")
        
        # Re-login Cindy
        cindy_token_no_om = login("cindy", "cindy123")
        if cindy_token_no_om and pdf1_id:
            headers_no_om = {"Authorization": f"Bearer {cindy_token_no_om}"}
            resp = requests.post(f"{API_BASE}/om/pdfs/{pdf1_id}/mark-printed", headers=headers_no_om)
            if resp.status_code == 403:
                pass_test("TEST 8.2: Staff without OM module → 403")
                error_msg = resp.json().get("error", "")
                if "order management" in error_msg.lower():
                    pass_test(f"TEST 8.2b: Error message correct: {error_msg}")
                else:
                    fail_test(f"TEST 8.2b: Error message unexpected: {error_msg}")
            else:
                fail_test(f"TEST 8.2: Should be 403, got {resp.status_code}")
    else:
        fail_test("TEST 8.2a: Failed to remove OM module from Cindy")
    
    # ========================================================================
    # TEST 9: CLEANUP
    # ========================================================================
    log("\n=== TEST 9: CLEANUP ===")
    log(f"Deleting {len(test_pdfs)} test PDFs...")
    
    deleted_count = 0
    for pdf_id in test_pdfs:
        if delete_pdf(owner_token, pdf_id):
            deleted_count += 1
    
    if deleted_count == len(test_pdfs):
        pass_test(f"TEST 9.1: Deleted all {deleted_count} test PDFs")
    else:
        fail_test(f"TEST 9.1: Deleted {deleted_count}/{len(test_pdfs)} test PDFs")
    
    # Restore Cindy's modules
    if grant_om_module(owner_token, cindy_id):
        pass_test("TEST 9.2: Restored Cindy's modules to ['cycle_count', 'order_management']")
    else:
        fail_test("TEST 9.2: Failed to restore Cindy's modules")
    
    # ========================================================================
    # FINAL SUMMARY
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    log(f"✅ PASSED: {tests_passed}")
    log(f"❌ FAILED: {tests_failed}")
    log(f"TOTAL: {tests_passed + tests_failed}")
    
    if tests_failed == 0:
        log("\n🎉 ALL TESTS PASSED! PDF Print Protection patch is FULLY WORKING.")
        sys.exit(0)
    else:
        log(f"\n⚠️  {tests_failed} TEST(S) FAILED. Please review the output above.")
        sys.exit(1)

if __name__ == "__main__":
    main()
