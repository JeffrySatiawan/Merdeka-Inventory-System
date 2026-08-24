#!/usr/bin/env python3
"""
Backend Regression Test for Barcode Pass 2 Parser Frontend Patch
=================================================================
Frontend-only change: strengthened barcode parser in OMPdfsView.js scanQrFromPdfDoc()
NO backend code changed.

This test confirms ZERO backend regression by verifying all PDF Resi + KETOKO endpoints
still work correctly after the frontend patch.

Test Plan (from review request):
1. Login owner → token
2. POST /api/om/pdfs upload a valid PDF. Capture id.
3. POST /api/om/pdfs/{id}/scan-result with barcode data — assert 200, response.item.detected_via === "barcode", detected_tracking_numbers === ["BC-STRONG-1"]
4. GET /api/om/pdfs → item has ketoko_resi hydrated with 1 entry, ketoko_total_count === 1
5. POST /api/om/pdfs/{id}/ketoko-resi with checked:true — assert 200, response.item.ketoko_checked_count === 1, ketoko_input_at is set
6. GET /api/om/shipments — should still work (200), summary.ketoko_progress present
7. POST /api/om/pdfs upload another PDF, then POST scan-result with multiple tracking numbers — assert 200. GET /api/om/pdfs → item.ketoko_resi has 3 entries, all checked=false
8. All previously-fixed URL-token & Bearer auth paths still 200/401/403 correctly
9. Cleanup — DELETE every test PDF

Expected: 100% PASS. Report any regression as CRITICAL.
"""

import requests
import sys
import io
from datetime import datetime

# Base URL from /app/.env
BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test credentials
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# Minimal valid PDF (7 bytes - smallest valid PDF structure)
MINIMAL_PDF = b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n210\n%%EOF"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login():
    """TEST 1: Owner login"""
    log("TEST 1: Owner login")
    resp = requests.post(f"{API_BASE}/auth/login", json={
        "username": OWNER_USERNAME,
        "password": OWNER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "token" in data, "No token in login response"
    assert "user" in data, "No user in login response"
    assert data["user"]["role"] == "owner", f"Expected owner role, got {data['user']['role']}"
    log(f"✅ Owner login successful, token: {data['token'][:20]}...")
    return data["token"]

def test_upload_pdf(token):
    """TEST 2: Upload a valid PDF"""
    log("TEST 2: Upload PDF via POST /api/om/pdfs")
    headers = {"Authorization": f"Bearer {token}"}
    files = {"file": ("test-barcode-1.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")}
    resp = requests.post(f"{API_BASE}/om/pdfs", headers=headers, files=files)
    assert resp.status_code == 200, f"Upload failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "item" in data, "No item in upload response"
    assert "id" in data["item"], "No id in uploaded item"
    pdf_id = data["item"]["id"]
    log(f"✅ PDF uploaded successfully, id: {pdf_id}")
    return pdf_id

def test_scan_result_barcode(token, pdf_id):
    """TEST 3: POST scan-result with barcode data"""
    log(f"TEST 3: POST /api/om/pdfs/{pdf_id}/scan-result with barcode data")
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "tracking_numbers": ["BC-STRONG-1"],
        "pages_count": 1,
        "detected_via": "barcode"
    }
    resp = requests.post(f"{API_BASE}/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    assert resp.status_code == 200, f"Scan-result failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "item" in data, "No item in scan-result response"
    item = data["item"]
    
    # Verify detected_via
    assert item.get("detected_via") == "barcode", f"Expected detected_via='barcode', got {item.get('detected_via')}"
    
    # Verify detected_tracking_numbers
    assert item.get("detected_tracking_numbers") == ["BC-STRONG-1"], \
        f"Expected detected_tracking_numbers=['BC-STRONG-1'], got {item.get('detected_tracking_numbers')}"
    
    # Verify pages_count
    assert item.get("pages_count") == 1, f"Expected pages_count=1, got {item.get('pages_count')}"
    
    log(f"✅ Scan-result saved: detected_via={item['detected_via']}, tracking_numbers={item['detected_tracking_numbers']}")
    return item

def test_list_pdfs_ketoko_hydration(token, pdf_id):
    """TEST 4: GET /api/om/pdfs → verify ketoko_resi hydrated"""
    log(f"TEST 4: GET /api/om/pdfs → verify ketoko_resi hydrated for {pdf_id}")
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/om/pdfs", headers=headers)
    assert resp.status_code == 200, f"List PDFs failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "items" in data, "No items in list response"
    
    # Find our PDF
    pdf = next((p for p in data["items"] if p["id"] == pdf_id), None)
    assert pdf is not None, f"PDF {pdf_id} not found in list"
    
    # Verify ketoko_resi hydrated
    assert "ketoko_resi" in pdf, "ketoko_resi not present"
    assert isinstance(pdf["ketoko_resi"], list), "ketoko_resi is not a list"
    assert len(pdf["ketoko_resi"]) == 1, f"Expected 1 ketoko_resi entry, got {len(pdf['ketoko_resi'])}"
    
    resi = pdf["ketoko_resi"][0]
    assert resi["tracking_number"] == "BC-STRONG-1", f"Expected tracking_number='BC-STRONG-1', got {resi['tracking_number']}"
    assert resi["checked"] == False, f"Expected checked=False initially, got {resi['checked']}"
    
    # Verify rollup counts
    assert pdf.get("ketoko_total_count") == 1, f"Expected ketoko_total_count=1, got {pdf.get('ketoko_total_count')}"
    assert pdf.get("ketoko_checked_count") == 0, f"Expected ketoko_checked_count=0, got {pdf.get('ketoko_checked_count')}"
    
    log(f"✅ ketoko_resi hydrated correctly: 1 entry (BC-STRONG-1), checked=False, total_count=1")
    return pdf

def test_ketoko_resi_check(token, pdf_id):
    """TEST 5: POST /api/om/pdfs/{id}/ketoko-resi with checked:true"""
    log(f"TEST 5: POST /api/om/pdfs/{pdf_id}/ketoko-resi with checked:true")
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "tracking_number": "BC-STRONG-1",
        "checked": True
    }
    resp = requests.post(f"{API_BASE}/om/pdfs/{pdf_id}/ketoko-resi", headers=headers, json=body)
    assert resp.status_code == 200, f"ketoko-resi check failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "item" in data, "No item in ketoko-resi response"
    item = data["item"]
    
    # Verify ketoko_checked_count
    assert item.get("ketoko_checked_count") == 1, \
        f"Expected ketoko_checked_count=1, got {item.get('ketoko_checked_count')}"
    
    # Verify ketoko_input_at is set (overall flag when all checked)
    assert item.get("ketoko_input_at") is not None, "ketoko_input_at should be set when all resi checked"
    
    # Verify the resi entry itself
    assert "resi" in data, "No resi in response"
    resi = data["resi"]
    assert resi["checked"] == True, f"Expected resi.checked=True, got {resi['checked']}"
    assert resi["checked_at"] is not None, "checked_at should be set"
    assert resi["checked_by_id"] is not None, "checked_by_id should be set"
    assert resi["checked_by_name"] is not None, "checked_by_name should be set"
    
    log(f"✅ ketoko-resi checked: ketoko_checked_count=1, ketoko_input_at={item['ketoko_input_at']}")
    return item

def test_shipments_endpoint(token):
    """TEST 6: GET /api/om/shipments → verify summary.ketoko_progress present"""
    log("TEST 6: GET /api/om/shipments → verify summary.ketoko_progress present")
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/om/shipments", headers=headers)
    assert resp.status_code == 200, f"Shipments endpoint failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "summary" in data, "No summary in shipments response"
    summary = data["summary"]
    
    # Verify ketoko_progress field exists
    assert "ketoko_progress" in summary, "ketoko_progress not in summary"
    assert isinstance(summary["ketoko_progress"], str), "ketoko_progress should be a string"
    
    log(f"✅ Shipments endpoint working: summary.ketoko_progress={summary['ketoko_progress']}")
    return summary

def test_multi_tracking_pdf(token):
    """TEST 7: Upload another PDF with multiple tracking numbers"""
    log("TEST 7: Upload PDF with multiple tracking numbers")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Upload second PDF
    files = {"file": ("test-barcode-2.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")}
    resp = requests.post(f"{API_BASE}/om/pdfs", headers=headers, files=files)
    assert resp.status_code == 200, f"Upload failed: {resp.status_code} {resp.text}"
    pdf_id = resp.json()["item"]["id"]
    log(f"✅ Second PDF uploaded, id: {pdf_id}")
    
    # POST scan-result with 3 tracking numbers
    body = {
        "tracking_numbers": ["MULTI-1", "MULTI-2", "MULTI-3"],
        "pages_count": 2,
        "detected_via": "barcode"
    }
    resp = requests.post(f"{API_BASE}/om/pdfs/{pdf_id}/scan-result", headers=headers, json=body)
    assert resp.status_code == 200, f"Scan-result failed: {resp.status_code} {resp.text}"
    item = resp.json()["item"]
    assert item["detected_via"] == "barcode", f"Expected detected_via='barcode', got {item['detected_via']}"
    assert len(item["detected_tracking_numbers"]) == 3, \
        f"Expected 3 tracking numbers, got {len(item['detected_tracking_numbers'])}"
    log(f"✅ Scan-result saved with 3 tracking numbers: {item['detected_tracking_numbers']}")
    
    # GET /api/om/pdfs → verify ketoko_resi has 3 entries, all checked=false
    resp = requests.get(f"{API_BASE}/om/pdfs", headers=headers)
    assert resp.status_code == 200, f"List PDFs failed: {resp.status_code} {resp.text}"
    pdf = next((p for p in resp.json()["items"] if p["id"] == pdf_id), None)
    assert pdf is not None, f"PDF {pdf_id} not found in list"
    
    assert len(pdf["ketoko_resi"]) == 3, f"Expected 3 ketoko_resi entries, got {len(pdf['ketoko_resi'])}"
    for resi in pdf["ketoko_resi"]:
        assert resi["checked"] == False, f"Expected all resi checked=False, got {resi['checked']} for {resi['tracking_number']}"
    
    assert pdf["ketoko_total_count"] == 3, f"Expected ketoko_total_count=3, got {pdf['ketoko_total_count']}"
    assert pdf["ketoko_checked_count"] == 0, f"Expected ketoko_checked_count=0, got {pdf['ketoko_checked_count']}"
    
    log(f"✅ Multi-tracking PDF verified: 3 entries in ketoko_resi, all checked=False")
    return pdf_id

def test_auth_regression(token):
    """TEST 8: Verify URL-token & Bearer auth paths still work correctly"""
    log("TEST 8: Auth regression tests (URL-token & Bearer)")
    
    # 8a. Bearer auth on /api/om/pdfs → 200
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{API_BASE}/om/pdfs", headers=headers)
    assert resp.status_code == 200, f"Bearer auth failed on /api/om/pdfs: {resp.status_code}"
    log("✅ 8a. Bearer auth on /api/om/pdfs → 200")
    
    # 8b. No auth on /api/om/pdfs → 401
    resp = requests.get(f"{API_BASE}/om/pdfs")
    assert resp.status_code == 401, f"Expected 401 without auth, got {resp.status_code}"
    log("✅ 8b. No auth on /api/om/pdfs → 401")
    
    # 8c. URL-token on /api/auth/me → 200
    resp = requests.get(f"{API_BASE}/auth/me?token={token}")
    assert resp.status_code == 200, f"URL-token auth failed on /api/auth/me: {resp.status_code}"
    data = resp.json()
    assert "user" in data, "No user in /api/auth/me response"
    log("✅ 8c. URL-token on /api/auth/me → 200")
    
    # 8d. Bearer auth on /api/om/notif-settings → 200
    resp = requests.get(f"{API_BASE}/om/notif-settings", headers=headers)
    assert resp.status_code == 200, f"Bearer auth failed on /api/om/notif-settings: {resp.status_code}"
    log("✅ 8d. Bearer auth on /api/om/notif-settings → 200")
    
    # 8e. URL-token on /api/om/notif-settings → 200
    resp = requests.get(f"{API_BASE}/om/notif-settings?token={token}")
    assert resp.status_code == 200, f"URL-token auth failed on /api/om/notif-settings: {resp.status_code}"
    log("✅ 8e. URL-token on /api/om/notif-settings → 200")
    
    # 8f. Invalid token → 401
    resp = requests.get(f"{API_BASE}/om/pdfs?token=invalid-token-xyz")
    assert resp.status_code == 401, f"Expected 401 with invalid token, got {resp.status_code}"
    log("✅ 8f. Invalid token → 401")
    
    log("✅ All auth regression tests passed")

def test_cleanup(token, pdf_ids):
    """TEST 9: Cleanup - DELETE all test PDFs"""
    log(f"TEST 9: Cleanup - DELETE {len(pdf_ids)} test PDFs")
    headers = {"Authorization": f"Bearer {token}"}
    deleted_count = 0
    for pdf_id in pdf_ids:
        resp = requests.delete(f"{API_BASE}/om/pdfs/{pdf_id}", headers=headers)
        if resp.status_code == 200:
            deleted_count += 1
            log(f"✅ Deleted PDF {pdf_id}")
        else:
            log(f"⚠️ Failed to delete PDF {pdf_id}: {resp.status_code} {resp.text}")
    
    assert deleted_count == len(pdf_ids), f"Expected to delete {len(pdf_ids)} PDFs, deleted {deleted_count}"
    log(f"✅ Cleanup complete: {deleted_count} PDFs deleted")

def main():
    print("=" * 80)
    print("BACKEND REGRESSION TEST: Barcode Pass 2 Parser Frontend Patch")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Owner: {OWNER_USERNAME}")
    print("=" * 80)
    
    pdf_ids = []
    
    try:
        # TEST 1: Login
        token = test_login()
        
        # TEST 2: Upload PDF
        pdf_id_1 = test_upload_pdf(token)
        pdf_ids.append(pdf_id_1)
        
        # TEST 3: Scan-result with barcode
        test_scan_result_barcode(token, pdf_id_1)
        
        # TEST 4: List PDFs → verify ketoko_resi hydration
        test_list_pdfs_ketoko_hydration(token, pdf_id_1)
        
        # TEST 5: Check ketoko-resi
        test_ketoko_resi_check(token, pdf_id_1)
        
        # TEST 6: Shipments endpoint
        test_shipments_endpoint(token)
        
        # TEST 7: Multi-tracking PDF
        pdf_id_2 = test_multi_tracking_pdf(token)
        pdf_ids.append(pdf_id_2)
        
        # TEST 8: Auth regression
        test_auth_regression(token)
        
        # TEST 9: Cleanup
        test_cleanup(token, pdf_ids)
        
        print("=" * 80)
        print("✅ ALL TESTS PASSED (100%)")
        print("=" * 80)
        print("RESULT: ZERO BACKEND REGRESSION DETECTED")
        print("Frontend barcode parser patch did not break any backend functionality.")
        print("=" * 80)
        return 0
        
    except AssertionError as e:
        print("=" * 80)
        print(f"❌ TEST FAILED: {e}")
        print("=" * 80)
        print("RESULT: CRITICAL REGRESSION DETECTED")
        print("=" * 80)
        return 1
    except Exception as e:
        print("=" * 80)
        print(f"❌ UNEXPECTED ERROR: {e}")
        print("=" * 80)
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
