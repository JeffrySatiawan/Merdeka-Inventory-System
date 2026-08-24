#!/usr/bin/env python3
"""
Backend test for OM PDF open tracking endpoint (POST /api/om/pdfs/[id]/open)

Tests:
1. Login as owner → save token
2. Upload a small PDF via POST /api/om/pdfs/auto → save item id
3. GET /api/om/pdfs → verify new fields present and initialized correctly
4. First POST /api/om/pdfs/[id]/open → verify open_count=1, first_open_* set
5. Second POST /api/om/pdfs/[id]/open → verify open_count=2, first_open_* unchanged, last_open_* updated
6. Third POST /api/om/pdfs/[id]/open → verify open_count=3
7. POST /api/om/pdfs/nonexistent-id/open → 404
8. Login as Cindy (cycle_count only) → POST /api/om/pdfs/[id]/open → 403
9. REGRESSION checks (ketoko, mark-printed, regular upload, list)
10. CLEANUP
"""

import requests
import time
from datetime import datetime, timedelta

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

# Minimal valid PDF (about 500 bytes)
MINIMAL_PDF = b"""%PDF-1.4
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

def test_pdf_open_tracking():
    print("=" * 80)
    print("BACKEND TEST: OM PDF Open Tracking Endpoint")
    print("=" * 80)
    
    # TEST 1: Login as owner
    print("\n[TEST 1] Login as owner (owner/owner123)")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"}, timeout=10)
        assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
        data = resp.json()
        owner_token = data.get("token")
        owner_user = data.get("user")
        assert owner_token, "No token in login response"
        assert owner_user, "No user in login response"
        owner_id = owner_user.get("id")
        owner_name = owner_user.get("name")
        print(f"✅ Owner login successful. Token: {owner_token[:20]}..., User ID: {owner_id}, Name: {owner_name}")
    except Exception as e:
        print(f"❌ TEST 1 FAILED: {e}")
        return
    
    # TEST 2: Upload a small PDF via POST /api/om/pdfs/auto
    print("\n[TEST 2] Upload PDF via POST /api/om/pdfs/auto")
    try:
        files = {"file": ("test_open_tracking.pdf", MINIMAL_PDF, "application/pdf")}
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers, timeout=15)
        assert resp.status_code == 200, f"Upload failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in upload response"
        pdf_id = item.get("id")
        pdf_filename = item.get("filename")
        assert pdf_id, "No id in uploaded item"
        print(f"✅ PDF uploaded successfully. ID: {pdf_id}, Filename: {pdf_filename}")
    except Exception as e:
        print(f"❌ TEST 2 FAILED: {e}")
        return
    
    # TEST 3: GET /api/om/pdfs → verify new fields present
    print("\n[TEST 3] GET /api/om/pdfs → verify new fields initialized correctly")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers, timeout=10)
        assert resp.status_code == 200, f"List PDFs failed: {resp.status_code} {resp.text}"
        data = resp.json()
        items = data.get("items", [])
        uploaded_item = next((x for x in items if x.get("id") == pdf_id), None)
        assert uploaded_item, f"Uploaded PDF {pdf_id} not found in list"
        
        # Verify all new fields present and initialized correctly
        assert "first_open_at" in uploaded_item, "first_open_at field missing"
        assert "first_open_by_id" in uploaded_item, "first_open_by_id field missing"
        assert "first_open_by_name" in uploaded_item, "first_open_by_name field missing"
        assert "last_open_at" in uploaded_item, "last_open_at field missing"
        assert "last_open_by_id" in uploaded_item, "last_open_by_id field missing"
        assert "last_open_by_name" in uploaded_item, "last_open_by_name field missing"
        assert "open_count" in uploaded_item, "open_count field missing"
        
        assert uploaded_item["first_open_at"] is None, f"first_open_at should be null, got {uploaded_item['first_open_at']}"
        assert uploaded_item["first_open_by_id"] is None, f"first_open_by_id should be null, got {uploaded_item['first_open_by_id']}"
        assert uploaded_item["first_open_by_name"] is None, f"first_open_by_name should be null, got {uploaded_item['first_open_by_name']}"
        assert uploaded_item["last_open_at"] is None, f"last_open_at should be null, got {uploaded_item['last_open_at']}"
        assert uploaded_item["last_open_by_id"] is None, f"last_open_by_id should be null, got {uploaded_item['last_open_by_id']}"
        assert uploaded_item["last_open_by_name"] is None, f"last_open_by_name should be null, got {uploaded_item['last_open_by_name']}"
        assert uploaded_item["open_count"] == 0, f"open_count should be 0, got {uploaded_item['open_count']}"
        
        print("✅ All new fields present and initialized correctly:")
        print(f"   - first_open_at: {uploaded_item['first_open_at']}")
        print(f"   - first_open_by_id: {uploaded_item['first_open_by_id']}")
        print(f"   - first_open_by_name: {uploaded_item['first_open_by_name']}")
        print(f"   - last_open_at: {uploaded_item['last_open_at']}")
        print(f"   - last_open_by_id: {uploaded_item['last_open_by_id']}")
        print(f"   - last_open_by_name: {uploaded_item['last_open_by_name']}")
        print(f"   - open_count: {uploaded_item['open_count']}")
    except Exception as e:
        print(f"❌ TEST 3 FAILED: {e}")
        return
    
    # TEST 4: First POST /api/om/pdfs/[id]/open
    print("\n[TEST 4] First POST /api/om/pdfs/[id]/open → verify open_count=1, first_open_* set")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        before_time = datetime.utcnow()
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/open", json={}, headers=headers, timeout=10)
        after_time = datetime.utcnow()
        assert resp.status_code == 200, f"First open failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in response"
        
        # Verify open_count incremented
        assert item["open_count"] == 1, f"open_count should be 1, got {item['open_count']}"
        
        # Verify first_open_* fields set
        assert item["first_open_at"] is not None, "first_open_at should be set"
        assert item["first_open_by_id"] == owner_id, f"first_open_by_id should be {owner_id}, got {item['first_open_by_id']}"
        assert item["first_open_by_name"] == owner_name, f"first_open_by_name should be {owner_name}, got {item['first_open_by_name']}"
        
        # Verify last_open_* fields set
        assert item["last_open_at"] is not None, "last_open_at should be set"
        assert item["last_open_by_id"] == owner_id, f"last_open_by_id should be {owner_id}, got {item['last_open_by_id']}"
        assert item["last_open_by_name"] == owner_name, f"last_open_by_name should be {owner_name}, got {item['last_open_by_name']}"
        
        # Verify first_open_at is a valid ISO date (recent, within last 10 seconds)
        first_open_at_str_raw = item["first_open_at"]
        # Handle both Z and +00:00 formats
        if first_open_at_str_raw.endswith("Z"):
            first_open_at = datetime.fromisoformat(first_open_at_str_raw.replace("Z", "+00:00"))
        else:
            first_open_at = datetime.fromisoformat(first_open_at_str_raw)
        # Make before_time and after_time timezone-aware
        from datetime import timezone
        before_time_aware = before_time.replace(tzinfo=timezone.utc)
        after_time_aware = after_time.replace(tzinfo=timezone.utc)
        assert before_time_aware - timedelta(seconds=10) <= first_open_at <= after_time_aware + timedelta(seconds=10), \
            f"first_open_at {first_open_at} not within expected time range"
        
        # Verify last_open_at === first_open_at (same timestamp on first call)
        last_open_at_str_raw = item["last_open_at"]
        if last_open_at_str_raw.endswith("Z"):
            last_open_at = datetime.fromisoformat(last_open_at_str_raw.replace("Z", "+00:00"))
        else:
            last_open_at = datetime.fromisoformat(last_open_at_str_raw)
        assert first_open_at == last_open_at, f"last_open_at should equal first_open_at on first call"
        
        # Save for next test
        first_open_at_str = item["first_open_at"]
        
        print("✅ First open successful:")
        print(f"   - open_count: {item['open_count']}")
        print(f"   - first_open_at: {item['first_open_at']}")
        print(f"   - first_open_by_id: {item['first_open_by_id']}")
        print(f"   - first_open_by_name: {item['first_open_by_name']}")
        print(f"   - last_open_at: {item['last_open_at']}")
        print(f"   - last_open_by_id: {item['last_open_by_id']}")
        print(f"   - last_open_by_name: {item['last_open_by_name']}")
    except Exception as e:
        print(f"❌ TEST 4 FAILED: {e}")
        return
    
    # TEST 5: Wait ~2 seconds, then second POST /api/om/pdfs/[id]/open
    print("\n[TEST 5] Wait 2s, then second POST /api/om/pdfs/[id]/open → verify open_count=2, first_open_* unchanged, last_open_* updated")
    try:
        time.sleep(2)
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/open", json={}, headers=headers, timeout=10)
        assert resp.status_code == 200, f"Second open failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in response"
        
        # Verify open_count incremented
        assert item["open_count"] == 2, f"open_count should be 2, got {item['open_count']}"
        
        # Verify first_open_at UNCHANGED
        assert item["first_open_at"] == first_open_at_str, \
            f"first_open_at should be unchanged ({first_open_at_str}), got {item['first_open_at']}"
        
        # Verify last_open_at UPDATED (newer than first_open_at)
        last_open_at_2_str = item["last_open_at"]
        if last_open_at_2_str.endswith("Z"):
            last_open_at_2 = datetime.fromisoformat(last_open_at_2_str.replace("Z", "+00:00"))
        else:
            last_open_at_2 = datetime.fromisoformat(last_open_at_2_str)
        if first_open_at_str.endswith("Z"):
            first_open_at_dt = datetime.fromisoformat(first_open_at_str.replace("Z", "+00:00"))
        else:
            first_open_at_dt = datetime.fromisoformat(first_open_at_str)
        assert last_open_at_2 > first_open_at_dt, \
            f"last_open_at should be newer than first_open_at"
        
        print("✅ Second open successful:")
        print(f"   - open_count: {item['open_count']}")
        print(f"   - first_open_at: {item['first_open_at']} (UNCHANGED ✓)")
        print(f"   - last_open_at: {item['last_open_at']} (UPDATED ✓)")
    except Exception as e:
        print(f"❌ TEST 5 FAILED: {e}")
        return
    
    # TEST 6: Third POST /api/om/pdfs/[id]/open
    print("\n[TEST 6] Third POST /api/om/pdfs/[id]/open → verify open_count=3")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/open", json={}, headers=headers, timeout=10)
        assert resp.status_code == 200, f"Third open failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in response"
        
        # Verify open_count incremented
        assert item["open_count"] == 3, f"open_count should be 3, got {item['open_count']}"
        
        print("✅ Third open successful:")
        print(f"   - open_count: {item['open_count']}")
    except Exception as e:
        print(f"❌ TEST 6 FAILED: {e}")
        return
    
    # TEST 7: POST /api/om/pdfs/nonexistent-id/open → 404
    print("\n[TEST 7] POST /api/om/pdfs/nonexistent-id-12345/open → 404")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/nonexistent-id-12345/open", json={}, headers=headers, timeout=10)
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        data = resp.json()
        error = data.get("error", "")
        assert "PDF tidak ditemukan" in error, f"Expected error 'PDF tidak ditemukan', got '{error}'"
        print(f"✅ Nonexistent PDF correctly returns 404 with error: {error}")
    except Exception as e:
        print(f"❌ TEST 7 FAILED: {e}")
        return
    
    # TEST 8: Login as Cindy (cycle_count only) → POST /api/om/pdfs/[id]/open → 403
    print("\n[TEST 8] Login as Cindy (cindy/cindy123) → POST /api/om/pdfs/[id]/open → 403")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "cindy", "password": "cindy123"}, timeout=10)
        assert resp.status_code == 200, f"Cindy login failed: {resp.status_code} {resp.text}"
        data = resp.json()
        cindy_token = data.get("token")
        cindy_user = data.get("user")
        assert cindy_token, "No token in Cindy login response"
        cindy_modules = cindy_user.get("modules", [])
        print(f"   Cindy modules: {cindy_modules}")
        assert "cycle_count" in cindy_modules, "Cindy should have cycle_count module"
        assert "order_management" not in cindy_modules, "Cindy should NOT have order_management module"
        
        # Try to open PDF as Cindy
        headers = {"Authorization": f"Bearer {cindy_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/open", json={}, headers=headers, timeout=10)
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
        data = resp.json()
        error = data.get("error", "")
        assert "module" in error.lower() or "akses" in error.lower(), \
            f"Expected module access error, got '{error}'"
        print(f"✅ Cindy (no OM module) correctly denied with 403: {error}")
    except Exception as e:
        print(f"❌ TEST 8 FAILED: {e}")
        return
    
    # TEST 9: REGRESSION checks
    print("\n[TEST 9] REGRESSION checks")
    
    # 9a: POST /api/om/pdfs/[id]/ketoko
    print("   [9a] POST /api/om/pdfs/[id]/ketoko {input: true} → 200")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko", json={"input": True}, headers=headers, timeout=10)
        assert resp.status_code == 200, f"Ketoko endpoint failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in ketoko response"
        assert item.get("ketoko_input_at") is not None, "ketoko_input_at should be set"
        print(f"   ✅ Ketoko endpoint still works (ketoko_input_at: {item.get('ketoko_input_at')})")
    except Exception as e:
        print(f"   ❌ TEST 9a FAILED: {e}")
        return
    
    # 9b: POST /api/om/pdfs/[id]/mark-printed
    print("   [9b] POST /api/om/pdfs/[id]/mark-printed → 200")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/{pdf_id}/mark-printed", json={}, headers=headers, timeout=10)
        assert resp.status_code == 200, f"Mark-printed endpoint failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in mark-printed response"
        assert item.get("printed_at") is not None, "printed_at should be set"
        print(f"   ✅ Mark-printed endpoint still works (printed_at: {item.get('printed_at')})")
    except Exception as e:
        print(f"   ❌ TEST 9b FAILED: {e}")
        return
    
    # 9c: POST /api/om/pdfs (multipart with a small PDF)
    print("   [9c] POST /api/om/pdfs (multipart) → 200, response item has all NEW fields")
    try:
        files = {"file": ("test_regular_upload.pdf", MINIMAL_PDF, "application/pdf")}
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs", files=files, headers=headers, timeout=15)
        assert resp.status_code == 200, f"Regular upload failed: {resp.status_code} {resp.text}"
        data = resp.json()
        item = data.get("item")
        assert item, "No item in regular upload response"
        regular_pdf_id = item.get("id")
        
        # Verify all new fields present and initialized
        assert item.get("open_count") == 0, f"open_count should be 0, got {item.get('open_count')}"
        assert item.get("first_open_at") is None, f"first_open_at should be null, got {item.get('first_open_at')}"
        assert item.get("last_open_at") is None, f"last_open_at should be null, got {item.get('last_open_at')}"
        print(f"   ✅ Regular upload still works, new fields initialized correctly (open_count=0, first_open_at=null, last_open_at=null)")
    except Exception as e:
        print(f"   ❌ TEST 9c FAILED: {e}")
        return
    
    # 9d: GET /api/om/pdfs
    print("   [9d] GET /api/om/pdfs → items still returned correctly with all expected fields")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers, timeout=10)
        assert resp.status_code == 200, f"List PDFs failed: {resp.status_code} {resp.text}"
        data = resp.json()
        items = data.get("items", [])
        assert len(items) >= 2, f"Expected at least 2 PDFs, got {len(items)}"
        
        # Verify our newly uploaded PDFs have the new fields (old PDFs may not have them)
        our_pdfs = [x for x in items if x.get("id") in [pdf_id, regular_pdf_id]]
        assert len(our_pdfs) == 2, f"Expected to find our 2 test PDFs, found {len(our_pdfs)}"
        
        for item in our_pdfs:
            assert "open_count" in item, f"Item {item.get('id')} missing open_count"
            assert "first_open_at" in item, f"Item {item.get('id')} missing first_open_at"
            assert "last_open_at" in item, f"Item {item.get('id')} missing last_open_at"
        
        print(f"   ✅ GET /api/om/pdfs still works, our test PDFs have new fields (found {len(items)} total PDFs, verified 2 test PDFs)")
    except Exception as e:
        print(f"   ❌ TEST 9d FAILED: {e}")
        return
    
    # TEST 10: CLEANUP
    print("\n[TEST 10] CLEANUP: Delete test PDFs")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        # Delete first test PDF
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers, timeout=10)
        assert resp.status_code == 200, f"Delete first PDF failed: {resp.status_code} {resp.text}"
        print(f"   ✅ Deleted first test PDF: {pdf_id}")
        
        # Delete second test PDF
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{regular_pdf_id}", headers=headers, timeout=10)
        assert resp.status_code == 200, f"Delete second PDF failed: {resp.status_code} {resp.text}"
        print(f"   ✅ Deleted second test PDF: {regular_pdf_id}")
        
        print("   ✅ Cleanup complete")
    except Exception as e:
        print(f"   ❌ TEST 10 FAILED: {e}")
        return
    
    print("\n" + "=" * 80)
    print("✅ ALL TESTS PASSED (10/10)")
    print("=" * 80)
    print("\nSUMMARY:")
    print("✅ Owner login working")
    print("✅ PDF upload via /api/om/pdfs/auto working")
    print("✅ New fields (first_open_*, last_open_*, open_count) initialized correctly")
    print("✅ First open: open_count=1, first_open_* and last_open_* set correctly")
    print("✅ Second open: open_count=2, first_open_* unchanged, last_open_* updated")
    print("✅ Third open: open_count=3")
    print("✅ Nonexistent PDF returns 404 with correct error")
    print("✅ Staff without OM module correctly denied with 403")
    print("✅ REGRESSION: ketoko endpoint still works")
    print("✅ REGRESSION: mark-printed endpoint still works")
    print("✅ REGRESSION: regular upload still works with new fields")
    print("✅ REGRESSION: list endpoint still works with new fields")
    print("✅ Cleanup successful")

if __name__ == "__main__":
    test_pdf_open_tracking()
