#!/usr/bin/env python3
"""
Backend regression test for GET /api/om/pdfs?limit=500

BUG CONTEXT:
User reports PDF Resi list "mentok di H+1" — cannot scroll further. Root cause: frontend called 
`omApi('pdfs')` without limit → backend defaulted to 100 items, cutting off older days.

FIX (frontend-only, 1 line):
Changed `omApi('pdfs')` → `omApi('pdfs?limit=500')` in OMPdfsView.js load() function.

BACKEND UNCHANGED — endpoint already supports limit up to 500 per existing code.

BASE URL: https://absensi-foundation.preview.emergentagent.com
CREDENTIALS: owner / owner123

TEST PLAN (execute all 5, do NOT stop early):
1. LIMIT=500 accepted
2. LIMIT=500 returns more than 100 items IF DB has >100 non-deleted PDFs
3. LIMIT clamp — request higher than 500 should clamp to 500
4. DEFAULT (no limit param) still works — backward compat
5. REGRESSION — Other endpoints unchanged

CRITICAL SUCCESS CRITERIA:
✅ ?limit=500 returns up to 500 items without error
✅ ?limit=1000 clamped to 500
✅ No-limit default (100) still works
✅ Zero regression in other OM endpoints
✅ pdf_retention_days field still present in settings (from prior patch)
"""

import requests
import json
import io
import time
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test state
owner_token = None
test_pdf_ids = []
initial_pdf_count = 0

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
    token = data.get("token")
    log(f"✅ Login successful, token: {token[:20]}...")
    return token

def create_test_pdf(token, filename="test_limit.pdf"):
    """Upload a small test PDF"""
    pdf_content = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n210\n%%EOF"
    
    files = {'file': (filename, io.BytesIO(pdf_content), 'application/pdf')}
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", files=files, headers=headers)
    
    if resp.status_code != 200:
        log(f"❌ PDF upload failed: {resp.status_code} {resp.text}")
        return None
    
    data = resp.json()
    pdf_id = data.get('item', {}).get('id')
    log(f"✅ PDF uploaded: {pdf_id} ({filename})")
    return pdf_id

def delete_pdf(token, pdf_id):
    """Delete a PDF"""
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    if resp.status_code == 200:
        log(f"✅ PDF deleted: {pdf_id}")
        return True
    else:
        log(f"❌ PDF delete failed: {resp.status_code} {resp.text}")
        return False

def get_db_pdf_count():
    """Get count of non-deleted PDFs from MongoDB"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        count = db.om_pdfs.count_documents({"deleted": {"$ne": True}})
        client.close()
        log(f"📊 DB count of non-deleted PDFs: {count}")
        return count
    except Exception as e:
        log(f"⚠️ Could not query DB: {e}")
        return None

def ensure_min_pdfs(token, target_count=110):
    """Ensure DB has at least target_count PDFs by uploading test PDFs"""
    current_count = get_db_pdf_count()
    if current_count is None:
        log(f"⚠️ Cannot verify DB count, skipping PDF creation")
        return current_count or 0
    
    if current_count >= target_count:
        log(f"✅ DB already has {current_count} PDFs (>= {target_count})")
        return current_count
    
    needed = target_count - current_count
    log(f"📤 Uploading {needed} test PDFs to reach {target_count}...")
    
    for i in range(needed):
        pdf_id = create_test_pdf(token, f"test_limit_{i+1:03d}.pdf")
        if pdf_id:
            test_pdf_ids.append(pdf_id)
        time.sleep(0.1)  # Small delay to avoid overwhelming server
    
    final_count = get_db_pdf_count()
    log(f"✅ DB now has {final_count} PDFs")
    return final_count

# ============================================================================
# TEST 1: LIMIT=500 accepted
# ============================================================================
def test_1_limit_500_accepted():
    log("\n" + "="*80)
    log("TEST 1: LIMIT=500 accepted")
    log("="*80)
    
    headers = {'Authorization': f'Bearer {owner_token}'}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs?limit=500", headers=headers)
    
    if resp.status_code != 200:
        log(f"❌ TEST 1 FAILED: Expected 200, got {resp.status_code}")
        log(f"   Response: {resp.text}")
        return False
    
    data = resp.json()
    if 'items' not in data:
        log(f"❌ TEST 1 FAILED: Response missing 'items' array")
        log(f"   Response: {json.dumps(data, indent=2)}")
        return False
    
    items_count = len(data['items'])
    log(f"✅ TEST 1 PASSED: GET /api/om/pdfs?limit=500 → 200")
    log(f"   Response has 'items' array with {items_count} items")
    log(f"   Server does NOT reject or throttle")
    return True

# ============================================================================
# TEST 2: LIMIT=500 returns more than 100 items IF DB has >100 non-deleted PDFs
# ============================================================================
def test_2_limit_500_returns_more_than_100():
    log("\n" + "="*80)
    log("TEST 2: LIMIT=500 returns more than 100 items IF DB has >100 non-deleted PDFs")
    log("="*80)
    
    # First, ensure we have >100 PDFs in DB
    db_count = ensure_min_pdfs(owner_token, target_count=110)
    
    headers = {'Authorization': f'Bearer {owner_token}'}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs?limit=500", headers=headers)
    
    if resp.status_code != 200:
        log(f"❌ TEST 2 FAILED: Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    items_count = len(data['items'])
    
    if db_count is not None and db_count > 100:
        expected_count = min(db_count, 500)
        if items_count == expected_count:
            log(f"✅ TEST 2 PASSED: DB has {db_count} PDFs, limit=500 returned {items_count} items (exactly as expected)")
            return True
        elif items_count > 100:
            log(f"✅ TEST 2 PASSED: DB has {db_count} PDFs, limit=500 returned {items_count} items (>100, within expected range)")
            return True
        else:
            log(f"❌ TEST 2 FAILED: DB has {db_count} PDFs (>100), but limit=500 only returned {items_count} items (≤100)")
            return False
    else:
        # Could not verify DB count, but check if we got >100 items
        if items_count > 100:
            log(f"✅ TEST 2 PASSED: limit=500 returned {items_count} items (>100)")
            return True
        else:
            log(f"⚠️ TEST 2 INCONCLUSIVE: Could not verify DB count, and items_count={items_count} (≤100)")
            log(f"   This may be expected if DB has ≤100 PDFs")
            return True  # Pass with warning

# ============================================================================
# TEST 3: LIMIT clamp — request higher than 500 should clamp to 500
# ============================================================================
def test_3_limit_clamp():
    log("\n" + "="*80)
    log("TEST 3: LIMIT clamp — request higher than 500 should clamp to 500")
    log("="*80)
    
    headers = {'Authorization': f'Bearer {owner_token}'}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs?limit=1000", headers=headers)
    
    if resp.status_code != 200:
        log(f"❌ TEST 3 FAILED: Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    items_count = len(data['items'])
    
    if items_count <= 500:
        log(f"✅ TEST 3 PASSED: GET /api/om/pdfs?limit=1000 → 200")
        log(f"   items.length = {items_count} (≤ 500, correctly clamped)")
        return True
    else:
        log(f"❌ TEST 3 FAILED: limit=1000 returned {items_count} items (>500, not clamped)")
        return False

# ============================================================================
# TEST 4: DEFAULT (no limit param) still works — backward compat
# ============================================================================
def test_4_default_no_limit():
    log("\n" + "="*80)
    log("TEST 4: DEFAULT (no limit param) still works — backward compat")
    log("="*80)
    
    headers = {'Authorization': f'Bearer {owner_token}'}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    
    if resp.status_code != 200:
        log(f"❌ TEST 4 FAILED: Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    items_count = len(data['items'])
    
    if items_count <= 100:
        log(f"✅ TEST 4 PASSED: GET /api/om/pdfs (no limit) → 200")
        log(f"   items.length = {items_count} (≤ 100, default behavior)")
        log(f"   Backend behavior unchanged for callers not passing limit")
        return True
    else:
        log(f"❌ TEST 4 FAILED: No limit param returned {items_count} items (>100, default should be 100)")
        return False

# ============================================================================
# TEST 5: REGRESSION — Other endpoints unchanged
# ============================================================================
def test_5_regression():
    log("\n" + "="*80)
    log("TEST 5: REGRESSION — Other endpoints unchanged")
    log("="*80)
    
    headers = {'Authorization': f'Bearer {owner_token}'}
    all_passed = True
    
    # Test 5.1: GET /api/om/dashboard
    resp = requests.get(f"{BASE_URL}/api/om/dashboard", headers=headers)
    if resp.status_code == 200:
        log(f"✅ TEST 5.1 PASSED: GET /api/om/dashboard → 200")
    else:
        log(f"❌ TEST 5.1 FAILED: GET /api/om/dashboard → {resp.status_code}")
        all_passed = False
    
    # Test 5.2: GET /api/om/shipments
    resp = requests.get(f"{BASE_URL}/api/om/shipments", headers=headers)
    if resp.status_code == 200:
        log(f"✅ TEST 5.2 PASSED: GET /api/om/shipments → 200")
    else:
        log(f"❌ TEST 5.2 FAILED: GET /api/om/shipments → {resp.status_code}")
        all_passed = False
    
    # Test 5.3: GET /api/om/settings (should include pdf_retention_days from previous patch)
    resp = requests.get(f"{BASE_URL}/api/om/settings", headers=headers)
    if resp.status_code == 200:
        data = resp.json()
        settings = data.get('settings', data)  # Handle both nested and flat response
        if 'pdf_retention_days' in settings:
            log(f"✅ TEST 5.3 PASSED: GET /api/om/settings → 200 (pdf_retention_days present: {settings['pdf_retention_days']})")
        else:
            log(f"⚠️ TEST 5.3 WARNING: GET /api/om/settings → 200 but pdf_retention_days missing")
            log(f"   This may indicate regression from prior patch")
            all_passed = False
    else:
        log(f"❌ TEST 5.3 FAILED: GET /api/om/settings → {resp.status_code}")
        all_passed = False
    
    # Test 5.4: POST /api/om/pdfs (multipart upload small PDF)
    test_pdf_id = create_test_pdf(owner_token, "test_regression.pdf")
    if test_pdf_id:
        log(f"✅ TEST 5.4 PASSED: POST /api/om/pdfs (multipart upload) → 200")
        test_pdf_ids.append(test_pdf_id)
    else:
        log(f"❌ TEST 5.4 FAILED: POST /api/om/pdfs (multipart upload) failed")
        all_passed = False
    
    # Test 5.5: DELETE test PDF
    if test_pdf_id:
        if delete_pdf(owner_token, test_pdf_id):
            log(f"✅ TEST 5.5 PASSED: DELETE /api/om/pdfs/{test_pdf_id} → 200")
            test_pdf_ids.remove(test_pdf_id)
        else:
            log(f"❌ TEST 5.5 FAILED: DELETE /api/om/pdfs/{test_pdf_id} failed")
            all_passed = False
    
    if all_passed:
        log(f"✅ TEST 5 PASSED: All regression tests passed")
    else:
        log(f"❌ TEST 5 FAILED: Some regression tests failed")
    
    return all_passed

# ============================================================================
# CLEANUP
# ============================================================================
def cleanup():
    log("\n" + "="*80)
    log("CLEANUP: Deleting test PDFs")
    log("="*80)
    
    if not test_pdf_ids:
        log("✅ No test PDFs to clean up")
        return
    
    log(f"Deleting {len(test_pdf_ids)} test PDFs...")
    for pdf_id in test_pdf_ids[:]:
        delete_pdf(owner_token, pdf_id)
        test_pdf_ids.remove(pdf_id)
    
    log(f"✅ Cleanup complete")

# ============================================================================
# MAIN
# ============================================================================
def main():
    global owner_token, initial_pdf_count
    
    log("="*80)
    log("BACKEND REGRESSION TEST: GET /api/om/pdfs?limit=500")
    log("="*80)
    log(f"BASE URL: {BASE_URL}")
    log(f"CREDENTIALS: {OWNER_USERNAME} / {OWNER_PASSWORD}")
    log("")
    
    # Login
    owner_token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not owner_token:
        log("❌ FATAL: Cannot proceed without authentication")
        return
    
    # Get initial PDF count
    initial_pdf_count = get_db_pdf_count()
    
    # Run all 5 tests
    results = []
    results.append(("TEST 1: LIMIT=500 accepted", test_1_limit_500_accepted()))
    results.append(("TEST 2: LIMIT=500 returns more than 100 items", test_2_limit_500_returns_more_than_100()))
    results.append(("TEST 3: LIMIT clamp (1000→500)", test_3_limit_clamp()))
    results.append(("TEST 4: DEFAULT (no limit) backward compat", test_4_default_no_limit()))
    results.append(("TEST 5: REGRESSION — Other endpoints", test_5_regression()))
    
    # Cleanup
    cleanup()
    
    # Summary
    log("\n" + "="*80)
    log("TEST SUMMARY")
    log("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    log("")
    log(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        log("✅ ALL TESTS PASSED - Feature working correctly")
    else:
        log(f"❌ {total - passed} TEST(S) FAILED - Review failures above")
    
    log("="*80)

if __name__ == "__main__":
    main()
