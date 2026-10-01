#!/usr/bin/env python3
"""
Backend Test: OMS "Input KETOKO" Validation Patch
==================================================
Tests the new validation rules for POST /api/om/pdfs/:id/ketoko-resi and
POST /api/om/pdfs/:id/ketoko endpoints.

CRITICAL: MIS is LIVE/production — do NOT touch any real data.
Uses a brand-new throwaway PDF record for testing (deleted at the end).

Test Scenarios:
1. Setup: Create test PDF and manipulate DB to set detected_tracking_numbers
2. Case A: PDF not printed → 409 error
3. Case B: PDF printed but resi not scan-cetak → 409 error
4. Case C: Bulk variant (POST /api/om/pdfs/:id/ketoko) → 409 error
5. Case D: Happy path (both validations pass) → 200
6. Case E: Uncheck always allowed → 200
7. Case F: GET /api/om/pdfs enrichment (scan_cetak_at field)
8. Cleanup: Delete test PDF and shipments
"""

import requests
import sys
from datetime import datetime
from pymongo import MongoClient

# Configuration
BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# MongoDB connection
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test tracking numbers
TEST_TN_1 = "TESTOMS-001"
TEST_TN_2 = "TESTOMS-002"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    log("=" * 80)
    log("OMS 'Input KETOKO' Validation Patch Test")
    log("=" * 80)
    
    # Connect to MongoDB
    log("\n[SETUP] Connecting to MongoDB...")
    try:
        mongo_client = MongoClient(MONGO_URL)
        db = mongo_client[DB_NAME]
        om_pdfs = db['om_pdfs']
        om_shipments = db['om_shipments']
        log("✓ MongoDB connected")
    except Exception as e:
        log(f"✗ MongoDB connection failed: {e}")
        return 1
    
    # Login as owner
    log("\n[TEST 1] Login as owner...")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": OWNER_USERNAME,
            "password": OWNER_PASSWORD
        }, timeout=10)
        if resp.status_code != 200:
            log(f"✗ Login failed: {resp.status_code} {resp.text}")
            return 1
        token = resp.json().get("token")
        if not token:
            log(f"✗ No token in response: {resp.json()}")
            return 1
        headers = {"Authorization": f"Bearer {token}"}
        log(f"✓ Owner login successful, token: {token[:20]}...")
    except Exception as e:
        log(f"✗ Login exception: {e}")
        return 1
    
    # Create test PDF
    log("\n[TEST 2] Create test PDF via POST /api/om/pdfs...")
    try:
        # Create a minimal valid PDF (stub)
        pdf_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF"
        files = {"file": ("test_ketoko_validation.pdf", pdf_content, "application/pdf")}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs", headers=headers, files=files, timeout=10)
        if resp.status_code != 200:
            log(f"✗ PDF upload failed: {resp.status_code} {resp.text}")
            return 1
        pdf_data = resp.json()
        pdf_id = pdf_data.get("item", {}).get("id")
        if not pdf_id:
            log(f"✗ No PDF id in response: {pdf_data}")
            return 1
        log(f"✓ Test PDF created: {pdf_id}")
    except Exception as e:
        log(f"✗ PDF upload exception: {e}")
        return 1
    
    # Manipulate DB: set detected_tracking_numbers and ensure printed_at is null
    log("\n[TEST 3] Manipulate DB: set detected_tracking_numbers and printed_at=null...")
    try:
        result = om_pdfs.update_one(
            {"id": pdf_id},
            {"$set": {
                "detected_tracking_numbers": [TEST_TN_1, TEST_TN_2],
                "printed_at": None
            }}
        )
        if result.modified_count != 1:
            log(f"✗ DB update failed: modified_count={result.modified_count}")
            return 1
        log(f"✓ DB updated: detected_tracking_numbers=[{TEST_TN_1}, {TEST_TN_2}], printed_at=null")
    except Exception as e:
        log(f"✗ DB update exception: {e}")
        return 1
    
    # Case A: PDF not printed → 409 error
    log("\n[TEST 4] Case A: POST /api/om/pdfs/:id/ketoko-resi with checked:true (PDF not printed) → expect 409...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko-resi",
            headers=headers,
            json={"tracking_number": TEST_TN_1, "checked": True},
            timeout=10
        )
        if resp.status_code != 409:
            log(f"✗ Expected 409, got {resp.status_code}: {resp.text}")
            return 1
        error_msg = resp.json().get("error", "")
        expected_error = "Resi belum dicetak. Silakan print resi terlebih dahulu."
        if error_msg != expected_error:
            log(f"✗ Expected error '{expected_error}', got '{error_msg}'")
            return 1
        log(f"✓ Case A passed: 409 with error '{error_msg}'")
    except Exception as e:
        log(f"✗ Case A exception: {e}")
        return 1
    
    # Set printed_at on PDF
    log("\n[TEST 5] Set printed_at on PDF...")
    try:
        result = om_pdfs.update_one(
            {"id": pdf_id},
            {"$set": {"printed_at": datetime.utcnow()}}
        )
        if result.modified_count != 1:
            log(f"✗ DB update failed: modified_count={result.modified_count}")
            return 1
        log(f"✓ DB updated: printed_at set to current time")
    except Exception as e:
        log(f"✗ DB update exception: {e}")
        return 1
    
    # Case B: PDF printed but resi not scan-cetak → 409 error
    log("\n[TEST 6] Case B: POST /api/om/pdfs/:id/ketoko-resi with checked:true (resi not scan-cetak) → expect 409...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko-resi",
            headers=headers,
            json={"tracking_number": TEST_TN_1, "checked": True},
            timeout=10
        )
        if resp.status_code != 409:
            log(f"✗ Expected 409, got {resp.status_code}: {resp.text}")
            return 1
        error_msg = resp.json().get("error", "")
        expected_error = "Resi belum Scan Cetak Resi. Silakan lakukan Scan Cetak Resi terlebih dahulu."
        if error_msg != expected_error:
            log(f"✗ Expected error '{expected_error}', got '{error_msg}'")
            return 1
        log(f"✓ Case B passed: 409 with error '{error_msg}'")
    except Exception as e:
        log(f"✗ Case B exception: {e}")
        return 1
    
    # Case C: Bulk variant (POST /api/om/pdfs/:id/ketoko) → 409 error
    log("\n[TEST 7] Case C: POST /api/om/pdfs/:id/ketoko with input:true (resi not scan-cetak) → expect 409...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko",
            headers=headers,
            json={"input": True},
            timeout=10
        )
        if resp.status_code != 409:
            log(f"✗ Expected 409, got {resp.status_code}: {resp.text}")
            return 1
        error_msg = resp.json().get("error", "")
        expected_error = "Resi belum Scan Cetak Resi. Silakan lakukan Scan Cetak Resi terlebih dahulu."
        if error_msg != expected_error:
            log(f"✗ Expected error '{expected_error}', got '{error_msg}'")
            return 1
        log(f"✓ Case C passed: 409 with error '{error_msg}'")
    except Exception as e:
        log(f"✗ Case C exception: {e}")
        return 1
    
    # Create om_shipments records with printed_at for both tracking numbers
    log("\n[TEST 8] Create om_shipments records with printed_at for both tracking numbers...")
    try:
        now = datetime.utcnow()
        om_shipments.insert_many([
            {
                "id": f"ship-{TEST_TN_1}",
                "tracking_number": TEST_TN_1,
                "printed_at": now,
                "status": "printed"
            },
            {
                "id": f"ship-{TEST_TN_2}",
                "tracking_number": TEST_TN_2,
                "printed_at": now,
                "status": "printed"
            }
        ])
        log(f"✓ om_shipments records created for {TEST_TN_1} and {TEST_TN_2}")
    except Exception as e:
        log(f"✗ om_shipments insert exception: {e}")
        return 1
    
    # Case D: Happy path (both validations pass) → 200
    log("\n[TEST 9] Case D: POST /api/om/pdfs/:id/ketoko-resi with checked:true (happy path) → expect 200...")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko-resi",
            headers=headers,
            json={"tracking_number": TEST_TN_1, "checked": True},
            timeout=10
        )
        if resp.status_code != 200:
            log(f"✗ Expected 200, got {resp.status_code}: {resp.text}")
            return 1
        item = resp.json().get("item", {})
        ketoko_resi = item.get("ketoko_resi", [])
        if not ketoko_resi:
            log(f"✗ No ketoko_resi in response: {item}")
            return 1
        # Find the entry for TEST_TN_1
        entry = next((r for r in ketoko_resi if r.get("tracking_number") == TEST_TN_1), None)
        if not entry:
            log(f"✗ No entry for {TEST_TN_1} in ketoko_resi: {ketoko_resi}")
            return 1
        if not entry.get("checked"):
            log(f"✗ Entry not checked: {entry}")
            return 1
        if not entry.get("scan_cetak_at"):
            log(f"✗ No scan_cetak_at in entry: {entry}")
            return 1
        log(f"✓ Case D passed: 200 with checked=true and scan_cetak_at={entry.get('scan_cetak_at')}")
    except Exception as e:
        log(f"✗ Case D exception: {e}")
        return 1
    
    # Case E: Uncheck always allowed → 200
    log("\n[TEST 10] Case E: POST /api/om/pdfs/:id/ketoko-resi with checked:false (uncheck always allowed) → expect 200...")
    # First, revert printed_at to null to test that uncheck bypasses validation
    try:
        result = om_pdfs.update_one(
            {"id": pdf_id},
            {"$set": {"printed_at": None}}
        )
        if result.modified_count != 1:
            log(f"✗ DB update failed: modified_count={result.modified_count}")
            return 1
        log(f"✓ DB updated: printed_at set to null")
    except Exception as e:
        log(f"✗ DB update exception: {e}")
        return 1
    
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko-resi",
            headers=headers,
            json={"tracking_number": TEST_TN_1, "checked": False},
            timeout=10
        )
        if resp.status_code != 200:
            log(f"✗ Expected 200, got {resp.status_code}: {resp.text}")
            return 1
        item = resp.json().get("item", {})
        ketoko_resi = item.get("ketoko_resi", [])
        entry = next((r for r in ketoko_resi if r.get("tracking_number") == TEST_TN_1), None)
        if not entry:
            log(f"✗ No entry for {TEST_TN_1} in ketoko_resi: {ketoko_resi}")
            return 1
        if entry.get("checked"):
            log(f"✗ Entry still checked: {entry}")
            return 1
        log(f"✓ Case E passed: 200 with checked=false (uncheck bypassed validation)")
    except Exception as e:
        log(f"✗ Case E exception: {e}")
        return 1
    
    # Case F: GET /api/om/pdfs enrichment (scan_cetak_at field)
    log("\n[TEST 11] Case F: GET /api/om/pdfs enrichment (scan_cetak_at field) → expect 200...")
    try:
        resp = requests.get(f"{BASE_URL}/api/om/pdfs?limit=500", headers=headers, timeout=10)
        if resp.status_code != 200:
            log(f"✗ Expected 200, got {resp.status_code}: {resp.text}")
            return 1
        items = resp.json().get("items", [])
        # Find our test PDF
        test_pdf = next((p for p in items if p.get("id") == pdf_id), None)
        if not test_pdf:
            log(f"✗ Test PDF not found in list")
            return 1
        ketoko_resi = test_pdf.get("ketoko_resi", [])
        if not ketoko_resi:
            log(f"✗ No ketoko_resi in test PDF: {test_pdf}")
            return 1
        # Check that all entries have scan_cetak_at field
        for entry in ketoko_resi:
            if "scan_cetak_at" not in entry:
                log(f"✗ No scan_cetak_at field in entry: {entry}")
                return 1
            # TEST_TN_1 and TEST_TN_2 should have non-null scan_cetak_at (from om_shipments)
            if entry.get("tracking_number") in [TEST_TN_1, TEST_TN_2]:
                if not entry.get("scan_cetak_at"):
                    log(f"✗ scan_cetak_at is null for {entry.get('tracking_number')}: {entry}")
                    return 1
        log(f"✓ Case F passed: GET /api/om/pdfs returns ketoko_resi with scan_cetak_at field")
    except Exception as e:
        log(f"✗ Case F exception: {e}")
        return 1
    
    # Cleanup: Delete test PDF and shipments
    log("\n[CLEANUP] Deleting test PDF and shipments...")
    try:
        # Delete PDF via API
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers, timeout=10)
        if resp.status_code != 200:
            log(f"⚠ PDF delete failed: {resp.status_code} {resp.text}")
        else:
            log(f"✓ Test PDF deleted via API")
        
        # Delete shipments via MongoDB
        result = om_shipments.delete_many({"tracking_number": {"$in": [TEST_TN_1, TEST_TN_2]}})
        log(f"✓ Deleted {result.deleted_count} test shipments from om_shipments")
        
        # Verify PDF is soft-deleted
        pdf_doc = om_pdfs.find_one({"id": pdf_id})
        if pdf_doc and pdf_doc.get("deleted"):
            log(f"✓ Test PDF soft-deleted in DB")
        else:
            log(f"⚠ Test PDF not soft-deleted: {pdf_doc}")
    except Exception as e:
        log(f"⚠ Cleanup exception: {e}")
    
    log("\n" + "=" * 80)
    log("✅ ALL TESTS PASSED (11/11)")
    log("=" * 80)
    log("\nSUMMARY:")
    log("  ✓ Case A: PDF not printed → 409 with correct error message")
    log("  ✓ Case B: PDF printed but resi not scan-cetak → 409 with correct error message")
    log("  ✓ Case C: Bulk variant (POST /api/om/pdfs/:id/ketoko) → 409 with correct error message")
    log("  ✓ Case D: Happy path (both validations pass) → 200 with checked=true and scan_cetak_at")
    log("  ✓ Case E: Uncheck always allowed → 200 (bypassed validation)")
    log("  ✓ Case F: GET /api/om/pdfs enrichment → scan_cetak_at field present")
    log("  ✓ Cleanup: Test PDF and shipments deleted")
    log("\nNO ISSUES FOUND. Backend validation patch is correct and fully functional.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
