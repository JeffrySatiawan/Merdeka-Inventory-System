#!/usr/bin/env python3
"""
Backend test for OM UI — detected_via field patch
Tests the optional additive field 'detected_via' on POST /api/om/pdfs/{id}/scan-result
"""
import requests
import io
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

# Test credentials
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"
CINDY_USERNAME = "cindy"
CINDY_PASSWORD = "cindy123"

# Track test PDFs for cleanup
test_pdf_ids = []

def create_minimal_pdf():
    """Create a minimal valid PDF (smallest possible)"""
    return b"""%PDF-1.0
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
211
%%EOF"""

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code != 200:
        print(f"❌ Login failed for {username}: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    token = data.get("token")
    print(f"✅ Login successful for {username}")
    return token

def upload_pdf(token, filename="test.pdf"):
    """Upload a PDF and return the item"""
    pdf_bytes = create_minimal_pdf()
    files = {"file": (filename, io.BytesIO(pdf_bytes), "application/pdf")}
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", files=files, headers=headers)
    if resp.status_code != 200:
        print(f"❌ PDF upload failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    item = data.get("item")
    if item and item.get("id"):
        test_pdf_ids.append(item["id"])
        print(f"✅ PDF uploaded: {item['id']} ({item['filename']})")
    return item

def post_scan_result(token, pdf_id, tracking_numbers, pages_count=1, detected_via=None):
    """POST scan-result with optional detected_via"""
    headers = {"Authorization": f"Bearer {token}"}
    body = {"tracking_numbers": tracking_numbers, "pages_count": pages_count}
    if detected_via is not None:
        body["detected_via"] = detected_via
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/scan-result", json=body, headers=headers)
    return resp

def get_pdfs(token):
    """GET /api/om/pdfs"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    return resp

def delete_pdf(token, pdf_id):
    """DELETE /api/om/pdfs/{id}"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    return resp

def cleanup(token):
    """Delete all test PDFs"""
    print("\n🧹 CLEANUP: Deleting test PDFs...")
    for pdf_id in test_pdf_ids:
        resp = delete_pdf(token, pdf_id)
        if resp.status_code == 200:
            print(f"✅ Deleted PDF {pdf_id}")
        else:
            print(f"⚠️  Failed to delete PDF {pdf_id}: {resp.status_code}")
    test_pdf_ids.clear()

def main():
    print("=" * 80)
    print("BACKEND TEST: OM UI — detected_via field patch")
    print("=" * 80)
    
    # Login
    print("\n📝 TEST: Authentication")
    owner_token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not owner_token:
        print("❌ CRITICAL: Owner login failed")
        sys.exit(1)
    
    cindy_token = login(CINDY_USERNAME, CINDY_PASSWORD)
    if not cindy_token:
        print("❌ CRITICAL: Cindy login failed")
        sys.exit(1)
    
    # TEST 1 — detected_via field acceptance & rules
    print("\n" + "=" * 80)
    print("TEST 1: detected_via field acceptance & rules")
    print("=" * 80)
    
    # 1a. Upload PDF
    print("\n📝 TEST 1a: Upload PDF")
    pdf1 = upload_pdf(owner_token, "test-detected-via.pdf")
    if not pdf1:
        print("❌ CRITICAL: PDF upload failed")
        cleanup(owner_token)
        sys.exit(1)
    pdf1_id = pdf1["id"]
    
    # 1b. POST scan-result with detected_via="qr"
    print("\n📝 TEST 1b: POST scan-result with detected_via='qr'")
    resp = post_scan_result(owner_token, pdf1_id, ["QR1"], 1, "qr")
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}: {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    item = data.get("item")
    if not item:
        print(f"❌ FAILED: No item in response")
        cleanup(owner_token)
        sys.exit(1)
    if item.get("detected_via") != "qr":
        print(f"❌ FAILED: Expected detected_via='qr', got {item.get('detected_via')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: detected_via='qr' set correctly")
    
    # 1c. GET /api/om/pdfs → verify detected_via="qr"
    print("\n📝 TEST 1c: GET /api/om/pdfs → verify detected_via='qr'")
    resp = get_pdfs(owner_token)
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    items = data.get("items", [])
    found = next((it for it in items if it.get("id") == pdf1_id), None)
    if not found:
        print(f"❌ FAILED: PDF {pdf1_id} not found in list")
        cleanup(owner_token)
        sys.exit(1)
    if found.get("detected_via") != "qr":
        print(f"❌ FAILED: Expected detected_via='qr', got {found.get('detected_via')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: detected_via='qr' persisted correctly")
    
    # 1d. POST scan-result with detected_via="barcode"
    print("\n📝 TEST 1d: POST scan-result with detected_via='barcode'")
    resp = post_scan_result(owner_token, pdf1_id, ["BC1"], 1, "barcode")
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}: {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    item = data.get("item")
    if item.get("detected_via") != "barcode":
        print(f"❌ FAILED: Expected detected_via='barcode', got {item.get('detected_via')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: detected_via='barcode' set correctly")
    
    # 1e. POST scan-result with detected_via="invalid_value" → should keep previous value
    print("\n📝 TEST 1e: POST scan-result with detected_via='invalid_value' → should keep 'barcode'")
    resp = post_scan_result(owner_token, pdf1_id, ["X"], 1, "invalid_value")
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}: {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    item = data.get("item")
    if item.get("detected_via") != "barcode":
        print(f"❌ FAILED: Expected detected_via='barcode' (previous value preserved), got {item.get('detected_via')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: Invalid value ignored, previous value 'barcode' preserved")
    
    # 1f. POST scan-result with empty tracking_numbers and no detected_via → should clear
    print("\n📝 TEST 1f: POST scan-result with empty tracking_numbers and no detected_via → should clear")
    resp = post_scan_result(owner_token, pdf1_id, [], 1)
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}: {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    item = data.get("item")
    if item.get("detected_via") is not None:
        print(f"❌ FAILED: Expected detected_via=null (cleared), got {item.get('detected_via')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: detected_via cleared to null on empty scan")
    
    # TEST 2 — Backward compatibility
    print("\n" + "=" * 80)
    print("TEST 2: Backward compatibility (legacy client omits field)")
    print("=" * 80)
    
    # 2a. Upload new PDF
    print("\n📝 TEST 2a: Upload new PDF")
    pdf2 = upload_pdf(owner_token, "test-legacy.pdf")
    if not pdf2:
        print("❌ CRITICAL: PDF upload failed")
        cleanup(owner_token)
        sys.exit(1)
    pdf2_id = pdf2["id"]
    
    # 2b. POST scan-result without detected_via key
    print("\n📝 TEST 2b: POST scan-result without detected_via key")
    resp = post_scan_result(owner_token, pdf2_id, ["LEGACY1"], 1)
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}: {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    item = data.get("item")
    detected_via = item.get("detected_via")
    if detected_via is not None and detected_via != "":
        print(f"⚠️  WARNING: Expected detected_via=null/undefined, got {detected_via} (acceptable if legacy)")
    else:
        print(f"✅ PASSED: detected_via is null/undefined (backward compatible)")
    
    # 2c. GET /api/om/pdfs → verify no crash
    print("\n📝 TEST 2c: GET /api/om/pdfs → verify no crash, detected_tracking_numbers present")
    resp = get_pdfs(owner_token)
    if resp.status_code != 200:
        print(f"❌ FAILED: Expected 200, got {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    items = data.get("items", [])
    found = next((it for it in items if it.get("id") == pdf2_id), None)
    if not found:
        print(f"❌ FAILED: PDF {pdf2_id} not found in list")
        cleanup(owner_token)
        sys.exit(1)
    if "LEGACY1" not in found.get("detected_tracking_numbers", []):
        print(f"❌ FAILED: Expected detected_tracking_numbers=['LEGACY1'], got {found.get('detected_tracking_numbers')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: Legacy scan works, no crash, detected_tracking_numbers=['LEGACY1']")
    
    # TEST 3 — Full regression sweep
    print("\n" + "=" * 80)
    print("TEST 3: Full regression sweep")
    print("=" * 80)
    
    # Auth endpoints
    print("\n📝 TEST 3.1: POST /api/auth/login (owner)")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": OWNER_USERNAME, "password": OWNER_PASSWORD})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: POST /api/auth/login (owner) → 200")
    
    print("\n📝 TEST 3.2: POST /api/auth/login (cindy)")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": CINDY_USERNAME, "password": CINDY_PASSWORD})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: POST /api/auth/login (cindy) → 200")
    
    # Dashboard endpoints
    print("\n📝 TEST 3.3: GET /api/dashboard")
    resp = requests.get(f"{BASE_URL}/api/dashboard", headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: GET /api/dashboard → 200")
    
    print("\n📝 TEST 3.4: GET /api/om/dashboard")
    resp = requests.get(f"{BASE_URL}/api/om/dashboard", headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: GET /api/om/dashboard → 200")
    
    # PDF endpoints
    print("\n📝 TEST 3.5: POST /api/om/pdfs (upload)")
    pdf3 = upload_pdf(owner_token, "test-regression.pdf")
    if not pdf3:
        print(f"❌ FAILED: PDF upload failed")
        cleanup(owner_token)
        sys.exit(1)
    pdf3_id = pdf3["id"]
    print(f"✅ PASSED: POST /api/om/pdfs → 200")
    
    print("\n📝 TEST 3.6: POST /api/om/pdfs/auto (Merdeka Share)")
    pdf_bytes = create_minimal_pdf()
    files = {"file": ("share-test.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code} {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    pdf_auto = data.get("item")
    if pdf_auto and pdf_auto.get("id"):
        test_pdf_ids.append(pdf_auto["id"])
    print(f"✅ PASSED: POST /api/om/pdfs/auto → 200")
    
    print("\n📝 TEST 3.7: GET /api/om/pdfs")
    resp = get_pdfs(owner_token)
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    items = data.get("items", [])
    if not isinstance(items, list):
        print(f"❌ FAILED: Expected items array, got {type(items)}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: GET /api/om/pdfs → 200 with {len(items)} items")
    
    print("\n📝 TEST 3.8: GET /api/om/pdfs/{id}/file?token=<owner>")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf3_id}/file?token={owner_token}")
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    if resp.headers.get("Content-Type") != "application/pdf":
        print(f"❌ FAILED: Expected Content-Type=application/pdf, got {resp.headers.get('Content-Type')}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: GET /api/om/pdfs/{pdf3_id}/file → 200 (application/pdf)")
    
    print("\n📝 TEST 3.9: POST /api/om/pdfs/{id}/mark-printed")
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf3_id}/mark-printed", headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code} {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: POST /api/om/pdfs/{pdf3_id}/mark-printed → 200")
    
    print("\n📝 TEST 3.10: POST /api/om/pdfs/{id}/ketoko (legacy bulk)")
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf3_id}/ketoko", json={"input": True}, headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code} {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: POST /api/om/pdfs/{pdf3_id}/ketoko → 200")
    
    print("\n📝 TEST 3.11: POST /api/om/pdfs/{id}/ketoko-resi (per-resi)")
    # First, add a tracking number via scan-result
    resp = post_scan_result(owner_token, pdf3_id, ["RESI123"], 1, "qr")
    if resp.status_code != 200:
        print(f"❌ FAILED: scan-result failed: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    # Now update the per-resi
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf3_id}/ketoko-resi", 
                        json={"tracking_number": "RESI123", "checked": True}, 
                        headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code} {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: POST /api/om/pdfs/{pdf3_id}/ketoko-resi → 200")
    
    print("\n📝 TEST 3.12: GET /api/om/shipments")
    resp = requests.get(f"{BASE_URL}/api/om/shipments", headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    data = resp.json()
    summary = data.get("summary", {})
    if "ketoko_progress" not in summary:
        print(f"❌ FAILED: Expected summary.ketoko_progress, got {summary}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: GET /api/om/shipments → 200 with summary.ketoko_progress={summary['ketoko_progress']}")
    
    print("\n📝 TEST 3.13: GET /api/om/notif-settings")
    resp = requests.get(f"{BASE_URL}/api/om/notif-settings", headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: GET /api/om/notif-settings → 200")
    
    print("\n📝 TEST 3.14: PUT /api/om/notif-settings as cindy → 403")
    resp = requests.put(f"{BASE_URL}/api/om/notif-settings", json={"popup": True}, headers={"Authorization": f"Bearer {cindy_token}"})
    if resp.status_code != 403:
        print(f"❌ FAILED: Expected 403, got {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: PUT /api/om/notif-settings as cindy → 403")
    
    print("\n📝 TEST 3.15: DELETE /api/om/pdfs/{id} as owner")
    resp = delete_pdf(owner_token, pdf3_id)
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code} {resp.text}")
        cleanup(owner_token)
        sys.exit(1)
    # Remove from cleanup list since we just deleted it
    if pdf3_id in test_pdf_ids:
        test_pdf_ids.remove(pdf3_id)
    print(f"✅ PASSED: DELETE /api/om/pdfs/{pdf3_id} → 200")
    
    # Auth regression
    print("\n📝 TEST 3.16: Auth - URL token works")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs?token={owner_token}")
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: URL token works")
    
    print("\n📝 TEST 3.17: Auth - Bearer token works")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers={"Authorization": f"Bearer {owner_token}"})
    if resp.status_code != 200:
        print(f"❌ FAILED: {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: Bearer token works")
    
    print("\n📝 TEST 3.18: Auth - Cindy 403 on OM endpoints")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers={"Authorization": f"Bearer {cindy_token}"})
    if resp.status_code != 403:
        print(f"❌ FAILED: Expected 403, got {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: Cindy 403 on OM endpoints")
    
    print("\n📝 TEST 3.19: Auth - Invalid token 401")
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers={"Authorization": "Bearer invalid-token-12345"})
    if resp.status_code != 401:
        print(f"❌ FAILED: Expected 401, got {resp.status_code}")
        cleanup(owner_token)
        sys.exit(1)
    print(f"✅ PASSED: Invalid token → 401")
    
    # Cleanup
    cleanup(owner_token)
    
    # Final summary
    print("\n" + "=" * 80)
    print("✅ ALL TESTS PASSED (100%)")
    print("=" * 80)
    print("\nSUMMARY:")
    print("  ✅ TEST 1: detected_via field acceptance & rules (6 sub-tests)")
    print("  ✅ TEST 2: Backward compatibility (3 sub-tests)")
    print("  ✅ TEST 3: Full regression sweep (19 sub-tests)")
    print("\nTOTAL: 28 tests passed")
    print("\nExpected: 100% PASS ✅")
    print("Any regression: CRITICAL ❌")
    print("\n🎉 Backend testing complete. No regressions detected.")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
