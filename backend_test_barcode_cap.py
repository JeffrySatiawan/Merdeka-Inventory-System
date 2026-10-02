#!/usr/bin/env python3
"""
Backend test for OM PDF Resi barcode cap feature (1 label = max 1 barcode).

Tests the server-side cap at POST /api/om/pdfs/<id>/scan-result that limits
detected_tracking_numbers to pages_count when detected_via !== 'qr'.

Test scenarios:
1. Cap applied when barcode path sends >pages (pages_count=1, 2 TNs → expect 1 TN)
2. No-cap when within pages (pages_count=2, 2 TNs → expect 2 TNs)
3. No-cap for QR path (pages_count=1, 3 TNs with detected_via='qr' → expect 3 TNs)
4. No-cap when pages_count missing/0 (pages_count=0 or missing, 2 TNs → expect 2 TNs)
5. Dedup still works (3 TNs with 1 dup, pages_count=5 → expect 2 TNs)
6. Idempotency/Persistence (GET after test 1 should still show 1 TN)
7. Null detected_via (no detected_via, pages_count=1, 2 TNs → expect 1 TN)
8. Cleanup (DELETE test PDF)
"""

import requests
import sys
import io
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    log("=" * 80)
    log("BACKEND TEST: OM PDF Resi Barcode Cap (1 label = max 1 barcode)")
    log("=" * 80)
    
    # Login as owner
    log("\n[SETUP] Logging in as owner...")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"})
    if r.status_code != 200:
        log(f"❌ Login failed: {r.status_code} {r.text}")
        return 1
    token = r.json().get("token")
    if not token:
        log(f"❌ No token in login response: {r.json()}")
        return 1
    log(f"✅ Login successful, token: {token[:20]}...")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a throwaway test PDF
    log("\n[SETUP] Creating throwaway test PDF...")
    # Minimal valid PDF (1 page, empty content)
    pdf_content = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
203
%%EOF"""
    
    files = {"file": ("test_barcode_cap.pdf", io.BytesIO(pdf_content), "application/pdf")}
    r = requests.post(f"{BASE_URL}/api/om/pdfs", headers=headers, files=files)
    if r.status_code != 200:
        log(f"❌ PDF upload failed: {r.status_code} {r.text}")
        return 1
    pdf_id = r.json().get("item", {}).get("id")
    if not pdf_id:
        log(f"❌ No PDF id in upload response: {r.json()}")
        return 1
    log(f"✅ Test PDF created with id: {pdf_id}")
    
    test_results = []
    
    # TEST 1: Cap applied when barcode path sends >pages
    log("\n" + "=" * 80)
    log("TEST 1: Cap applied when barcode path sends >pages_count")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['261002HCA8T564','CM75550944558'], pages_count=1, detected_via='barcode'")
    log("Expected: detected_tracking_numbers length === 1, value === ['261002HCA8T564'] (first wins)")
    
    body = {
        "tracking_numbers": ["261002HCA8T564", "CM75550944558"],
        "pages_count": 1,
        "detected_via": "barcode"
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 1 FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 1", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        pages_count = item.get("pages_count")
        detected_via = item.get("detected_via")
        
        log(f"Response: detected_tracking_numbers={detected}, pages_count={pages_count}, detected_via={detected_via}")
        
        if len(detected) == 1 and detected == ["261002HCA8T564"] and pages_count == 1 and detected_via == "barcode":
            log("✅ TEST 1 PASSED: Cap applied correctly (2 TNs → 1 TN, first wins)")
            test_results.append(("TEST 1", True, "Cap applied correctly"))
        else:
            log(f"❌ TEST 1 FAILED: Expected length=1, value=['261002HCA8T564'], got length={len(detected)}, value={detected}")
            test_results.append(("TEST 1", False, f"Expected 1 TN, got {len(detected)}"))
    
    # TEST 2: No-cap when within pages
    log("\n" + "=" * 80)
    log("TEST 2: No-cap when within pages_count")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['AAA111','BBB222'], pages_count=2, detected_via='barcode'")
    log("Expected: detected_tracking_numbers length === 2 (both preserved)")
    
    body = {
        "tracking_numbers": ["AAA111", "BBB222"],
        "pages_count": 2,
        "detected_via": "barcode"
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 2 FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 2", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        
        log(f"Response: detected_tracking_numbers={detected}")
        
        if len(detected) == 2 and set(detected) == {"AAA111", "BBB222"}:
            log("✅ TEST 2 PASSED: No cap applied (2 TNs within pages_count=2)")
            test_results.append(("TEST 2", True, "No cap applied"))
        else:
            log(f"❌ TEST 2 FAILED: Expected length=2, got length={len(detected)}, value={detected}")
            test_results.append(("TEST 2", False, f"Expected 2 TNs, got {len(detected)}"))
    
    # TEST 3: No-cap for QR path
    log("\n" + "=" * 80)
    log("TEST 3: No-cap for QR path (detected_via='qr')")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['QRA','QRB','QRC'], pages_count=1, detected_via='qr'")
    log("Expected: detected_tracking_numbers length === 3 (QR not capped)")
    
    body = {
        "tracking_numbers": ["QRA", "QRB", "QRC"],
        "pages_count": 1,
        "detected_via": "qr"
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 3 FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 3", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        detected_via = item.get("detected_via")
        
        log(f"Response: detected_tracking_numbers={detected}, detected_via={detected_via}")
        
        if len(detected) == 3 and set(detected) == {"QRA", "QRB", "QRC"} and detected_via == "qr":
            log("✅ TEST 3 PASSED: QR path not capped (3 TNs with pages_count=1)")
            test_results.append(("TEST 3", True, "QR path not capped"))
        else:
            log(f"❌ TEST 3 FAILED: Expected length=3, detected_via='qr', got length={len(detected)}, detected_via={detected_via}")
            test_results.append(("TEST 3", False, f"Expected 3 TNs, got {len(detected)}"))
    
    # TEST 4a: No-cap when pages_count=0
    log("\n" + "=" * 80)
    log("TEST 4a: No-cap when pages_count=0")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['X','Y'], pages_count=0, detected_via='barcode'")
    log("Expected: detected_tracking_numbers length === 2 (cap only applies when pages_count > 0)")
    
    body = {
        "tracking_numbers": ["X", "Y"],
        "pages_count": 0,
        "detected_via": "barcode"
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 4a FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 4a", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        
        log(f"Response: detected_tracking_numbers={detected}")
        
        if len(detected) == 2 and set(detected) == {"X", "Y"}:
            log("✅ TEST 4a PASSED: No cap when pages_count=0")
            test_results.append(("TEST 4a", True, "No cap when pages_count=0"))
        else:
            log(f"❌ TEST 4a FAILED: Expected length=2, got length={len(detected)}, value={detected}")
            test_results.append(("TEST 4a", False, f"Expected 2 TNs, got {len(detected)}"))
    
    # TEST 4b: No-cap when pages_count missing
    log("\n" + "=" * 80)
    log("TEST 4b: No-cap when pages_count missing")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['Z1','Z2'], detected_via='barcode' (no pages_count key)")
    log("Expected: detected_tracking_numbers length === 2")
    
    body = {
        "tracking_numbers": ["Z1", "Z2"],
        "detected_via": "barcode"
        # pages_count intentionally omitted
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 4b FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 4b", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        
        log(f"Response: detected_tracking_numbers={detected}")
        
        if len(detected) == 2 and set(detected) == {"Z1", "Z2"}:
            log("✅ TEST 4b PASSED: No cap when pages_count missing")
            test_results.append(("TEST 4b", True, "No cap when pages_count missing"))
        else:
            log(f"❌ TEST 4b FAILED: Expected length=2, got length={len(detected)}, value={detected}")
            test_results.append(("TEST 4b", False, f"Expected 2 TNs, got {len(detected)}"))
    
    # TEST 5: Dedup still works
    log("\n" + "=" * 80)
    log("TEST 5: Dedup still works")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['DUPX','DUPX','OTHR'], pages_count=5, detected_via='barcode'")
    log("Expected: detected_tracking_numbers length === 2, order ['DUPX','OTHR']")
    
    body = {
        "tracking_numbers": ["DUPX", "DUPX", "OTHR"],
        "pages_count": 5,
        "detected_via": "barcode"
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 5 FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 5", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        
        log(f"Response: detected_tracking_numbers={detected}")
        
        if len(detected) == 2 and detected == ["DUPX", "OTHR"]:
            log("✅ TEST 5 PASSED: Dedup working (3 TNs with 1 dup → 2 unique TNs)")
            test_results.append(("TEST 5", True, "Dedup working"))
        else:
            log(f"❌ TEST 5 FAILED: Expected length=2, value=['DUPX','OTHR'], got length={len(detected)}, value={detected}")
            test_results.append(("TEST 5", False, f"Expected 2 TNs, got {len(detected)}"))
    
    # TEST 6: Idempotency/Persistence - re-run TEST 1 scenario and verify via GET
    log("\n" + "=" * 80)
    log("TEST 6: Idempotency/Persistence")
    log("=" * 80)
    log("Re-run TEST 1 scenario, then GET /api/om/pdfs to verify persistence")
    
    body = {
        "tracking_numbers": ["261002HCA8T564", "CM75550944558"],
        "pages_count": 1,
        "detected_via": "barcode"
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 6 FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 6", False, f"HTTP {r.status_code}"))
    else:
        log("✅ scan-result POST successful")
        
        # Now GET the PDF list and find our test PDF
        r = requests.get(f"{BASE_URL}/api/om/pdfs?limit=500", headers=headers)
        if r.status_code != 200:
            log(f"❌ TEST 6 FAILED: GET /api/om/pdfs returned {r.status_code} {r.text}")
            test_results.append(("TEST 6", False, f"GET failed: HTTP {r.status_code}"))
        else:
            items = r.json().get("items", [])
            test_pdf = next((item for item in items if item.get("id") == pdf_id), None)
            
            if not test_pdf:
                log(f"❌ TEST 6 FAILED: Test PDF not found in list")
                test_results.append(("TEST 6", False, "PDF not found in list"))
            else:
                detected = test_pdf.get("detected_tracking_numbers", [])
                log(f"GET response: detected_tracking_numbers={detected}")
                
                if len(detected) == 1 and detected == ["261002HCA8T564"]:
                    log("✅ TEST 6 PASSED: Persistence verified (GET returns capped value)")
                    test_results.append(("TEST 6", True, "Persistence verified"))
                else:
                    log(f"❌ TEST 6 FAILED: Expected length=1, value=['261002HCA8T564'], got length={len(detected)}, value={detected}")
                    test_results.append(("TEST 6", False, f"Expected 1 TN, got {len(detected)}"))
    
    # TEST 7: Null detected_via (treated as non-qr, cap applied)
    log("\n" + "=" * 80)
    log("TEST 7: Null detected_via (no detected_via key)")
    log("=" * 80)
    log("POST scan-result with tracking_numbers=['Z1','Z2'], pages_count=1 (no detected_via)")
    log("Expected: treated as non-qr → cap applied → length === 1")
    
    body = {
        "tracking_numbers": ["Z1", "Z2"],
        "pages_count": 1
        # detected_via intentionally omitted
    }
    r = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    if r.status_code != 200:
        log(f"❌ TEST 7 FAILED: scan-result returned {r.status_code} {r.text}")
        test_results.append(("TEST 7", False, f"HTTP {r.status_code}"))
    else:
        item = r.json().get("item", {})
        detected = item.get("detected_tracking_numbers", [])
        
        log(f"Response: detected_tracking_numbers={detected}")
        
        if len(detected) == 1 and detected[0] in ["Z1", "Z2"]:
            log("✅ TEST 7 PASSED: Cap applied when detected_via missing (treated as non-qr)")
            test_results.append(("TEST 7", True, "Cap applied when detected_via missing"))
        else:
            log(f"❌ TEST 7 FAILED: Expected length=1, got length={len(detected)}, value={detected}")
            test_results.append(("TEST 7", False, f"Expected 1 TN, got {len(detected)}"))
    
    # TEST 8: Cleanup
    log("\n" + "=" * 80)
    log("TEST 8: Cleanup")
    log("=" * 80)
    log(f"DELETE /api/om/pdfs/{pdf_id}")
    
    r = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    if r.status_code != 200:
        log(f"❌ TEST 8 FAILED: DELETE returned {r.status_code} {r.text}")
        test_results.append(("TEST 8", False, f"HTTP {r.status_code}"))
    else:
        log("✅ TEST 8 PASSED: Test PDF deleted successfully")
        test_results.append(("TEST 8", True, "Cleanup successful"))
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for _, result, _ in test_results if result)
    total = len(test_results)
    
    for test_name, result, details in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {test_name} - {details}")
    
    log("\n" + "=" * 80)
    log(f"FINAL RESULT: {passed}/{total} tests passed ({100*passed//total}%)")
    log("=" * 80)
    
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
