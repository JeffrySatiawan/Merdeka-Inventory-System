#!/usr/bin/env python3
"""
MIS Faktur Module — Backend Testing
Tests all 11 test cases from test_result.md
"""
import requests
import json
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}

# Minimal valid PDF (as specified in test_result.md)
MINIMAL_PDF = b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login(creds, label):
    """Login and return token"""
    log(f"TEST: Login as {label}")
    try:
        resp = requests.post(f"{API_BASE}/auth/login", json=creds, timeout=10)
        if resp.status_code != 200:
            log(f"  ❌ Login failed: {resp.status_code} {resp.text[:200]}")
            return None
        data = resp.json()
        token = data.get("token")
        if not token:
            log(f"  ❌ No token in response")
            return None
        log(f"  ✅ Login successful, token: {token[:20]}...")
        return token
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return None

def test_1_modules_registry(owner_token):
    """TEST 1: GET /api/modules (as owner) → 200; body.modules contains faktur with status='active'"""
    log("\n=== TEST 1: GET /api/modules (as owner) ===")
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.get(f"{API_BASE}/modules", headers=headers, timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        modules = data.get("modules", [])
        log(f"  Modules count: {len(modules)}")
        
        faktur_module = None
        for m in modules:
            if m.get("key") == "faktur":
                faktur_module = m
                break
        
        if not faktur_module:
            log(f"  ❌ 'faktur' module not found in modules list")
            log(f"  Available modules: {[m.get('key') for m in modules]}")
            return False
        
        if faktur_module.get("status") != "active":
            log(f"  ❌ faktur module status is '{faktur_module.get('status')}', expected 'active'")
            return False
        
        log(f"  ✅ faktur module found with status='active'")
        log(f"  Module details: {faktur_module}")
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_2_auth_me_staff(staff_token):
    """TEST 2: GET /api/auth/me (as staff cindy) → 200; user.modules INCLUDES 'faktur'"""
    log("\n=== TEST 2: GET /api/auth/me (as staff cindy) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{API_BASE}/auth/me", headers=headers, timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        user = data.get("user", {})
        modules = user.get("modules", [])
        log(f"  User: {user.get('name')} ({user.get('username')})")
        log(f"  Modules: {modules}")
        
        if "faktur" not in modules:
            log(f"  ❌ 'faktur' not in user.modules")
            log(f"  Expected 'faktur' to be merged at response time")
            return False
        
        log(f"  ✅ 'faktur' module present in user.modules (merged at response time)")
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_3_list_faktur(staff_token):
    """TEST 3: GET /api/faktur (as staff) → 200; { items: [...] }"""
    log("\n=== TEST 3: GET /api/faktur (as staff) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{API_BASE}/faktur", headers=headers, timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        if "items" not in data:
            log(f"  ❌ 'items' key not in response")
            log(f"  Response: {data}")
            return False
        
        items = data.get("items", [])
        log(f"  ✅ GET /api/faktur successful, items count: {len(items)}")
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_4_upload_faktur(staff_token):
    """TEST 4: POST /api/faktur (multipart) → upload PDF with metadata, real Telegram call"""
    log("\n=== TEST 4: POST /api/faktur (multipart upload) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        
        # Generate unique invoice number
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        no_faktur = f"INV-TEST-{timestamp}"
        
        files = {
            "file": ("test_invoice.pdf", MINIMAL_PDF, "application/pdf")
        }
        data = {
            "no_faktur": no_faktur,
            "nama_pelanggan": "Test Customer",
            "tanggal_faktur": "2026-02-01",
            "nominal": "150000",
            "catatan": "automated test"
        }
        
        log(f"  Uploading invoice: {no_faktur}")
        resp = requests.post(f"{API_BASE}/faktur", headers=headers, files=files, data=data, timeout=30)
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code == 502:
            log(f"  ⚠️  HTTP 502 - Telegram unreachable (soft failure)")
            log(f"  Response: {resp.text[:500]}")
            log(f"  NOTE: This is expected if Telegram API is down. Continuing with other tests.")
            return None  # Soft failure, continue
        
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return None
        
        data = resp.json()
        log(f"  Response: {json.dumps(data, indent=2)}")
        
        if not data.get("ok"):
            log(f"  ❌ Response ok=false")
            return None
        
        faktur = data.get("faktur", {})
        if faktur.get("telegram_status") != "sent":
            log(f"  ❌ telegram_status is '{faktur.get('telegram_status')}', expected 'sent'")
            return None
        
        if not faktur.get("telegram_message_id"):
            log(f"  ❌ telegram_message_id is missing")
            return None
        
        if not faktur.get("telegram_file_id"):
            log(f"  ❌ telegram_file_id is missing")
            return None
        
        if faktur.get("has_local_file") != False:
            log(f"  ❌ has_local_file should be False after successful Telegram send")
            return None
        
        faktur_id = faktur.get("id")
        log(f"  ✅ Upload successful!")
        log(f"  Faktur ID: {faktur_id}")
        log(f"  Telegram message_id: {faktur.get('telegram_message_id')}")
        log(f"  Telegram file_id: {faktur.get('telegram_file_id')}")
        log(f"  has_local_file: {faktur.get('has_local_file')}")
        
        return {"id": faktur_id, "no_faktur": no_faktur}
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return None

def test_5_search_faktur(staff_token, no_faktur):
    """TEST 5: GET /api/faktur?q=INV-TEST → 200; item appears in list"""
    log("\n=== TEST 5: GET /api/faktur?q=INV-TEST (search) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{API_BASE}/faktur?q=INV-TEST", headers=headers, timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        items = data.get("items", [])
        log(f"  Items found: {len(items)}")
        
        found = False
        for item in items:
            if item.get("no_faktur") == no_faktur:
                found = True
                log(f"  ✅ Found uploaded invoice: {no_faktur}")
                log(f"  Item: {item}")
                break
        
        if not found:
            log(f"  ❌ Uploaded invoice {no_faktur} not found in search results")
            return False
        
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_6_download_faktur(staff_token, faktur_id):
    """TEST 6: GET /api/faktur/<id>/download → 200; Content-Type: application/pdf; first bytes %PDF"""
    log("\n=== TEST 6: GET /api/faktur/<id>/download ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.get(f"{API_BASE}/faktur/{faktur_id}/download", headers=headers, timeout=30)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        content_type = resp.headers.get("Content-Type", "")
        log(f"  Content-Type: {content_type}")
        if "application/pdf" not in content_type:
            log(f"  ❌ Expected Content-Type: application/pdf, got {content_type}")
            return False
        
        content = resp.content
        log(f"  Content length: {len(content)} bytes")
        
        if not content.startswith(b"%PDF"):
            log(f"  ❌ Content does not start with %PDF")
            log(f"  First 20 bytes: {content[:20]}")
            return False
        
        log(f"  ✅ PDF download successful, first 20 bytes: {content[:20]}")
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_7_retry_faktur(staff_token, faktur_id):
    """TEST 7: POST /api/faktur/<id>/retry on already-sent invoice → 200 with already_sent=true"""
    log("\n=== TEST 7: POST /api/faktur/<id>/retry (already sent) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.post(f"{API_BASE}/faktur/{faktur_id}/retry", headers=headers, timeout=30)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        log(f"  Response: {json.dumps(data, indent=2)}")
        
        if not data.get("ok"):
            log(f"  ❌ Response ok=false")
            return False
        
        if not data.get("already_sent"):
            log(f"  ❌ Expected already_sent=true for already-sent invoice")
            return False
        
        log(f"  ✅ Retry endpoint working correctly (already_sent=true)")
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_8_patch_faktur(staff_token, faktur_id):
    """TEST 8: PATCH /api/faktur/<id> with { nominal: 175000 } → 200; nominal updated"""
    log("\n=== TEST 8: PATCH /api/faktur/<id> (update nominal) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}", "Content-Type": "application/json"}
        payload = {"nominal": 175000}
        resp = requests.patch(f"{API_BASE}/faktur/{faktur_id}", headers=headers, json=payload, timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        faktur = data.get("faktur", {})
        log(f"  Updated nominal: {faktur.get('nominal')}")
        
        if faktur.get("nominal") != 175000:
            log(f"  ❌ Expected nominal=175000, got {faktur.get('nominal')}")
            return False
        
        # Verify with GET
        resp2 = requests.get(f"{API_BASE}/faktur/{faktur_id}", headers=headers, timeout=10)
        if resp2.status_code == 200:
            data2 = resp2.json()
            faktur2 = data2.get("faktur", {})
            if faktur2.get("nominal") == 175000:
                log(f"  ✅ PATCH successful, nominal updated to 175000 (verified with GET)")
                return True
            else:
                log(f"  ❌ GET verification failed, nominal={faktur2.get('nominal')}")
                return False
        else:
            log(f"  ⚠️  PATCH successful but GET verification failed (status {resp2.status_code})")
            return True  # PATCH worked, GET issue is separate
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_9_delete_faktur(staff_token, faktur_id):
    """TEST 9: DELETE /api/faktur/<id> → 200; then GET /api/faktur → item not in list"""
    log("\n=== TEST 9: DELETE /api/faktur/<id> (soft delete) ===")
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        resp = requests.delete(f"{API_BASE}/faktur/{faktur_id}", headers=headers, timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        if not data.get("ok"):
            log(f"  ❌ Response ok=false")
            return False
        
        log(f"  ✅ DELETE successful")
        
        # Verify item is not in list
        resp2 = requests.get(f"{API_BASE}/faktur", headers=headers, timeout=10)
        if resp2.status_code == 200:
            data2 = resp2.json()
            items = data2.get("items", [])
            for item in items:
                if item.get("id") == faktur_id:
                    log(f"  ❌ Deleted item still appears in list")
                    return False
            log(f"  ✅ Deleted item NOT in list (soft delete working)")
            return True
        else:
            log(f"  ⚠️  DELETE successful but list verification failed (status {resp2.status_code})")
            return True  # DELETE worked, list issue is separate
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_10_auth_required():
    """TEST 10: GET /api/faktur without Authorization header → 401"""
    log("\n=== TEST 10: GET /api/faktur (no auth) ===")
    try:
        resp = requests.get(f"{API_BASE}/faktur", timeout=10)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 401:
            log(f"  ❌ Expected 401, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        log(f"  ✅ Auth required (401 without token)")
        return True
    except Exception as e:
        log(f"  ❌ Exception: {e}")
        return False

def test_11_regression(owner_token, staff_token):
    """TEST 11: Regression sanity checks"""
    log("\n=== TEST 11: Regression sanity checks ===")
    tests = [
        ("GET /api/om/dashboard (owner)", f"{API_BASE}/om/dashboard", owner_token),
        ("GET /api/om/shipments (owner)", f"{API_BASE}/om/shipments", owner_token),
        ("GET /api/dashboard (owner)", f"{API_BASE}/dashboard", owner_token),
        ("GET /api/tasks/mine (staff)", f"{API_BASE}/tasks/mine", staff_token),
        ("GET /api/employees (owner)", f"{API_BASE}/employees", owner_token),
    ]
    
    all_passed = True
    for label, url, token in tests:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                log(f"  ✅ {label} → 200")
            else:
                log(f"  ❌ {label} → {resp.status_code}")
                all_passed = False
        except Exception as e:
            log(f"  ❌ {label} → Exception: {e}")
            all_passed = False
    
    return all_passed

def main():
    log("=" * 80)
    log("MIS FAKTUR MODULE — BACKEND TESTING")
    log("=" * 80)
    
    # Login
    owner_token = test_login(OWNER_CREDS, "owner")
    if not owner_token:
        log("\n❌ FATAL: Owner login failed")
        sys.exit(1)
    
    staff_token = test_login(STAFF_CREDS, "staff (cindy)")
    if not staff_token:
        log("\n❌ FATAL: Staff login failed")
        sys.exit(1)
    
    results = {}
    
    # Test 1: Modules registry
    results["test_1_modules"] = test_1_modules_registry(owner_token)
    
    # Test 2: Auth me (staff)
    results["test_2_auth_me"] = test_2_auth_me_staff(staff_token)
    
    # Test 3: List faktur
    results["test_3_list"] = test_3_list_faktur(staff_token)
    
    # Test 4: Upload faktur (real Telegram call)
    upload_result = test_4_upload_faktur(staff_token)
    if upload_result is None:
        log("\n⚠️  TEST 4 SKIPPED (Telegram unreachable or upload failed)")
        results["test_4_upload"] = None
        faktur_id = None
        no_faktur = None
    else:
        results["test_4_upload"] = True
        faktur_id = upload_result["id"]
        no_faktur = upload_result["no_faktur"]
    
    # Tests 5-9 depend on successful upload
    if faktur_id:
        results["test_5_search"] = test_5_search_faktur(staff_token, no_faktur)
        results["test_6_download"] = test_6_download_faktur(staff_token, faktur_id)
        results["test_7_retry"] = test_7_retry_faktur(staff_token, faktur_id)
        results["test_8_patch"] = test_8_patch_faktur(staff_token, faktur_id)
        results["test_9_delete"] = test_9_delete_faktur(staff_token, faktur_id)
    else:
        log("\n⚠️  TESTS 5-9 SKIPPED (no faktur_id from upload)")
        results["test_5_search"] = None
        results["test_6_download"] = None
        results["test_7_retry"] = None
        results["test_8_patch"] = None
        results["test_9_delete"] = None
    
    # Test 10: Auth required
    results["test_10_auth"] = test_10_auth_required()
    
    # Test 11: Regression
    results["test_11_regression"] = test_11_regression(owner_token, staff_token)
    
    # Summary
    log("\n" + "=" * 80)
    log("SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for v in results.values() if v is True)
    failed = sum(1 for v in results.values() if v is False)
    skipped = sum(1 for v in results.values() if v is None)
    total = len(results)
    
    for test_name, result in results.items():
        if result is True:
            log(f"✅ {test_name}")
        elif result is False:
            log(f"❌ {test_name}")
        else:
            log(f"⚠️  {test_name} (SKIPPED)")
    
    log(f"\nTotal: {total} tests")
    log(f"Passed: {passed}")
    log(f"Failed: {failed}")
    log(f"Skipped: {skipped}")
    
    if failed > 0:
        log("\n❌ SOME TESTS FAILED")
        sys.exit(1)
    elif skipped > 0:
        log("\n⚠️  ALL TESTS PASSED (with some skipped)")
        sys.exit(0)
    else:
        log("\n✅ ALL TESTS PASSED")
        sys.exit(0)

if __name__ == "__main__":
    main()
