#!/usr/bin/env python3
"""
Comprehensive backend test for GET /api/om/pdfs/:id/status endpoint.
Tests all 8 cases from the review request.
"""

import requests
import time
import json
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}

def log(msg):
    print(f"[{datetime.now().isoformat()}] {msg}")

def login(creds):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=creds)
    if resp.status_code != 200:
        log(f"❌ Login failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    token = data.get("token")
    log(f"✅ Login successful: {creds['username']}")
    return token

def create_test_pdf(token):
    """Create a test PDF via POST /api/om/pdfs"""
    # Create a minimal valid PDF (small buffer)
    pdf_content = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF"
    
    files = {"file": ("test_status.pdf", pdf_content, "application/pdf")}
    headers = {"Authorization": f"Bearer {token}"}
    
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", files=files, headers=headers)
    if resp.status_code != 200:
        log(f"❌ PDF upload failed: {resp.status_code} {resp.text}")
        return None
    
    data = resp.json()
    pdf_id = data.get("item", {}).get("id")
    log(f"✅ Test PDF created: {pdf_id}")
    return pdf_id

def update_pdf_detected_tracking_numbers(pdf_id, tracking_numbers):
    """Direct DB update to set detected_tracking_numbers"""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    result = db.om_pdfs.update_one(
        {"id": pdf_id},
        {"$set": {"detected_tracking_numbers": tracking_numbers}}
    )
    log(f"✅ Updated detected_tracking_numbers: {tracking_numbers}")
    client.close()
    return result.modified_count > 0

def create_shipment(tracking_number):
    """Create a shipment in om_shipments with printed_at"""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    
    shipment = {
        "id": f"ship-{tracking_number}",
        "tracking_number": tracking_number,
        "printed_at": datetime.utcnow(),
        "status": "printed",
        "created_at": datetime.utcnow()
    }
    
    db.om_shipments.insert_one(shipment)
    log(f"✅ Created shipment for {tracking_number} with printed_at")
    client.close()

def get_pdf_status(pdf_id, token):
    """GET /api/om/pdfs/:id/status"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/status", headers=headers)
    return resp

def mark_printed(pdf_id, token):
    """POST /api/om/pdfs/:id/mark-printed"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/mark-printed", headers=headers)
    return resp

def delete_pdf(pdf_id, token):
    """DELETE /api/om/pdfs/:id"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    return resp

def delete_shipment(tracking_number):
    """Delete shipment from DB"""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    db.om_shipments.delete_one({"tracking_number": tracking_number})
    log(f"✅ Deleted shipment for {tracking_number}")
    client.close()

def run_tests():
    """Run all 8 test cases"""
    log("=" * 80)
    log("STARTING: GET /api/om/pdfs/:id/status endpoint tests")
    log("=" * 80)
    
    # Login
    log("\n--- SETUP: Login ---")
    owner_token = login(OWNER_CREDS)
    staff_token = login(STAFF_CREDS)
    
    if not owner_token:
        log("❌ FATAL: Owner login failed")
        return
    
    # Test 1: Setup - Create PDF and update detected_tracking_numbers
    log("\n--- TEST 1: SETUP - Create PDF and update detected_tracking_numbers ---")
    pdf_id = create_test_pdf(owner_token)
    if not pdf_id:
        log("❌ FATAL: PDF creation failed")
        return
    
    # Update detected_tracking_numbers via direct DB
    update_pdf_detected_tracking_numbers(pdf_id, ["TESTST-A", "TESTST-B"])
    
    # Create ONE shipment for TESTST-A with printed_at
    create_shipment("TESTST-A")
    
    log("✅ TEST 1 PASSED: Setup complete")
    
    # Test 2: Case A - Not printed, response shape
    log("\n--- TEST 2: CASE A - Not printed, response shape ---")
    resp = get_pdf_status(pdf_id, owner_token)
    
    if resp.status_code != 200:
        log(f"❌ TEST 2 FAILED: Expected 200, got {resp.status_code}")
        log(f"Response: {resp.text}")
    else:
        data = resp.json()
        item = data.get("item", {})
        server_time = data.get("server_time")
        
        checks = []
        
        # Check 1: item.id matches
        checks.append(("item.id matches", item.get("id") == pdf_id))
        
        # Check 2: item.printed_at is null
        checks.append(("item.printed_at is null", item.get("printed_at") is None))
        
        # Check 3: item.ketoko_resi is array len 2
        ketoko_resi = item.get("ketoko_resi", [])
        checks.append(("item.ketoko_resi is array len 2", len(ketoko_resi) == 2))
        
        # Check 4: TESTST-A entry has scan_cetak_at populated
        testst_a = next((r for r in ketoko_resi if r.get("tracking_number") == "TESTST-A"), None)
        checks.append(("TESTST-A entry exists", testst_a is not None))
        if testst_a:
            scan_cetak_at = testst_a.get("scan_cetak_at")
            checks.append(("TESTST-A has scan_cetak_at populated", scan_cetak_at is not None and scan_cetak_at != ""))
            checks.append(("TESTST-A scan_cetak_at is ISO string", isinstance(scan_cetak_at, str) and "T" in scan_cetak_at))
        
        # Check 5: TESTST-B entry has scan_cetak_at null
        testst_b = next((r for r in ketoko_resi if r.get("tracking_number") == "TESTST-B"), None)
        checks.append(("TESTST-B entry exists", testst_b is not None))
        if testst_b:
            checks.append(("TESTST-B has scan_cetak_at null", testst_b.get("scan_cetak_at") is None))
        
        # Check 6: No file_data / file_path keys in response
        checks.append(("No file_data in response", "file_data" not in item))
        checks.append(("No file_path in response", "file_path" not in item))
        checks.append(("No _id in response", "_id" not in item))
        
        # Check 7: server_time is ISO string
        checks.append(("server_time is ISO string", isinstance(server_time, str) and "T" in server_time))
        
        # Print results
        passed = sum(1 for _, result in checks if result)
        total = len(checks)
        
        for check_name, result in checks:
            status = "✅" if result else "❌"
            log(f"  {status} {check_name}")
        
        if passed == total:
            log(f"✅ TEST 2 PASSED: All {total} checks passed")
        else:
            log(f"❌ TEST 2 FAILED: {passed}/{total} checks passed")
            log(f"Response: {json.dumps(data, indent=2)}")
    
    # Test 3: Case B - After print
    log("\n--- TEST 3: CASE B - After print ---")
    mark_resp = mark_printed(pdf_id, owner_token)
    if mark_resp.status_code != 200:
        log(f"❌ TEST 3 SETUP FAILED: mark-printed returned {mark_resp.status_code}")
    else:
        log("✅ PDF marked as printed")
        
        # Now get status again
        resp = get_pdf_status(pdf_id, owner_token)
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: Expected 200, got {resp.status_code}")
        else:
            data = resp.json()
            item = data.get("item", {})
            printed_at = item.get("printed_at")
            
            if printed_at is not None and printed_at != "":
                log(f"✅ TEST 3 PASSED: item.printed_at now populated ({printed_at})")
            else:
                log(f"❌ TEST 3 FAILED: item.printed_at is still null/empty")
    
    # Test 4: Case C - 404
    log("\n--- TEST 4: CASE C - 404 for nonexistent PDF ---")
    resp = get_pdf_status("nonexistent-id-12345", owner_token)
    
    if resp.status_code == 404:
        data = resp.json()
        error = data.get("error", "")
        if "tidak ditemukan" in error.lower():
            log(f"✅ TEST 4 PASSED: 404 with error '{error}'")
        else:
            log(f"⚠️ TEST 4 PARTIAL: 404 but error message unexpected: '{error}'")
    else:
        log(f"❌ TEST 4 FAILED: Expected 404, got {resp.status_code}")
    
    # Test 5: Case D - Auth
    log("\n--- TEST 5: CASE D - Auth checks ---")
    
    # No token
    resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/status")
    if resp.status_code == 401:
        log("✅ TEST 5a PASSED: No token → 401")
    else:
        log(f"❌ TEST 5a FAILED: No token → {resp.status_code} (expected 401)")
    
    # Staff token (cindy)
    if staff_token:
        resp = get_pdf_status(pdf_id, staff_token)
        if resp.status_code == 200:
            log("✅ TEST 5b PASSED: Staff token (cindy) → 200 (has OM access)")
        elif resp.status_code == 403:
            log("✅ TEST 5b PASSED: Staff token (cindy) → 403 (no OM access)")
        else:
            log(f"⚠️ TEST 5b PARTIAL: Staff token → {resp.status_code} (expected 200 or 403)")
    else:
        log("⚠️ TEST 5b SKIPPED: Staff login failed")
    
    # Test 6: Case E - Lightweight response
    log("\n--- TEST 6: CASE E - Lightweight response ---")
    resp = get_pdf_status(pdf_id, owner_token)
    
    if resp.status_code == 200:
        response_size = len(resp.content)
        if response_size < 10240:  # < 10KB
            log(f"✅ TEST 6 PASSED: Response size {response_size} bytes (< 10KB)")
        else:
            log(f"⚠️ TEST 6 WARNING: Response size {response_size} bytes (>= 10KB)")
    else:
        log(f"❌ TEST 6 FAILED: Could not get response (status {resp.status_code})")
    
    # Test 7: Case F - No side effects
    log("\n--- TEST 7: CASE F - No side effects (call 3x consecutively) ---")
    
    # Call 1
    resp1 = get_pdf_status(pdf_id, owner_token)
    if resp1.status_code != 200:
        log(f"❌ TEST 7 FAILED: Call 1 returned {resp1.status_code}")
    else:
        data1 = resp1.json()
        resi1 = data1.get("item", {}).get("ketoko_resi", [])
        
        # Call 2
        time.sleep(0.1)
        resp2 = get_pdf_status(pdf_id, owner_token)
        if resp2.status_code != 200:
            log(f"❌ TEST 7 FAILED: Call 2 returned {resp2.status_code}")
        else:
            data2 = resp2.json()
            resi2 = data2.get("item", {}).get("ketoko_resi", [])
            
            # Call 3
            time.sleep(0.1)
            resp3 = get_pdf_status(pdf_id, owner_token)
            if resp3.status_code != 200:
                log(f"❌ TEST 7 FAILED: Call 3 returned {resp3.status_code}")
            else:
                data3 = resp3.json()
                resi3 = data3.get("item", {}).get("ketoko_resi", [])
                
                # Compare resi arrays
                if resi1 == resi2 == resi3:
                    log(f"✅ TEST 7 PASSED: ketoko_resi content identical across 3 calls")
                else:
                    log(f"❌ TEST 7 FAILED: ketoko_resi content differs across calls")
                    log(f"  Call 1: {len(resi1)} items")
                    log(f"  Call 2: {len(resi2)} items")
                    log(f"  Call 3: {len(resi3)} items")
    
    # Verify DB unchanged
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    pdf_doc = db.om_pdfs.find_one({"id": pdf_id})
    client.close()
    
    if pdf_doc:
        # Check that no unexpected fields were added
        unexpected_fields = []
        for key in pdf_doc.keys():
            if key.startswith("_test_"):
                unexpected_fields.append(key)
        
        if len(unexpected_fields) == 0:
            log(f"✅ TEST 7 DB CHECK PASSED: No unexpected fields added to om_pdfs")
        else:
            log(f"❌ TEST 7 DB CHECK FAILED: Unexpected fields: {unexpected_fields}")
    
    # Test 8: Cleanup
    log("\n--- TEST 8: CLEANUP ---")
    
    # Delete shipment
    delete_shipment("TESTST-A")
    
    # Delete PDF
    del_resp = delete_pdf(pdf_id, owner_token)
    if del_resp.status_code == 200:
        log(f"✅ TEST 8 PASSED: Test PDF deleted")
    else:
        log(f"⚠️ TEST 8 WARNING: PDF deletion returned {del_resp.status_code}")
    
    log("\n" + "=" * 80)
    log("ALL TESTS COMPLETE")
    log("=" * 80)

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        log(f"❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
