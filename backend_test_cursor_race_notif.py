#!/usr/bin/env python3
"""
Backend test for Merdeka Inventory System - Cursor Race Fix & Notification Settings
Tests three main areas:
1. TEST 1: Merdeka Share PDF cursor race fix (10 iterations)
2. TEST 2: Role-Based Global Notification Settings (owner-only)
3. TEST 3: Regression checks
"""

import requests
import time
import io
from datetime import datetime, timezone

# Base URL from .env
BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}

# Minimal valid PDF (543 bytes)
MINIMAL_PDF = b"""%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
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

def login(creds):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=creds)
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    token = data.get("token")
    print(f"✅ Login successful: {creds['username']}")
    return token

def get_auth_me(token):
    """Get current user info"""
    resp = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    if resp.status_code != 200:
        print(f"❌ GET /api/auth/me failed: {resp.status_code}")
        return None
    return resp.json()

def upload_pdf_auto(token, pdf_bytes=MINIMAL_PDF):
    """Upload PDF via POST /api/om/pdfs/auto"""
    files = {"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    resp = requests.post(
        f"{BASE_URL}/api/om/pdfs/auto",
        headers={"Authorization": f"Bearer {token}"},
        files=files
    )
    return resp

def get_pdfs(token, since=None):
    """GET /api/om/pdfs with optional since parameter"""
    url = f"{BASE_URL}/api/om/pdfs"
    if since:
        url += f"?since={since}"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"}
    )
    return resp

def delete_pdf(token, pdf_id):
    """DELETE /api/om/pdfs/[id]"""
    resp = requests.delete(
        f"{BASE_URL}/api/om/pdfs/{pdf_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    return resp

def get_notif_settings(token):
    """GET /api/om/notif-settings"""
    resp = requests.get(
        f"{BASE_URL}/api/om/notif-settings",
        headers={"Authorization": f"Bearer {token}"}
    )
    return resp

def put_notif_settings(token, settings):
    """PUT /api/om/notif-settings"""
    resp = requests.put(
        f"{BASE_URL}/api/om/notif-settings",
        headers={"Authorization": f"Bearer {token}"},
        json=settings
    )
    return resp

def create_temp_staff_with_om(owner_token):
    """Create temporary staff with order_management module"""
    resp = requests.post(
        f"{BASE_URL}/api/employees",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "username": f"test_om_staff_{int(time.time())}",
            "password": "test123",
            "name": "Test OM Staff",
            "role": "staff",
            "weight": 50,
            "modules": ["cycle_count", "order_management"]
        }
    )
    return resp

def delete_employee(owner_token, emp_id):
    """DELETE /api/employees/[id]"""
    resp = requests.delete(
        f"{BASE_URL}/api/employees/{emp_id}",
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    return resp

# ============================================================
# TEST 1: Merdeka Share PDF cursor race fix (HIGHEST PRIORITY)
# ============================================================
def test_cursor_race_fix():
    """
    Test the cursor race fix by repeating 10 times:
    1. GET /api/om/pdfs → capture server_time as cursor
    2. Immediately POST /api/om/pdfs/auto → upload PDF
    3. Immediately GET /api/om/pdfs?since=cursor → verify new PDF appears
    4. Assert: server_time <= new PDF's uploaded_at
    5. DELETE the test PDF
    """
    print("\n" + "="*80)
    print("TEST 1: CURSOR RACE FIX (10 iterations)")
    print("="*80)
    
    owner_token = login(OWNER_CREDS)
    if not owner_token:
        print("❌ TEST 1 FAILED: Cannot login as owner")
        return False
    
    test_pdfs = []
    passed = 0
    failed = 0
    
    for i in range(1, 11):
        print(f"\n--- Iteration {i}/10 ---")
        
        try:
            # Step 1: GET /api/om/pdfs → capture cursor
            resp1 = get_pdfs(owner_token)
            if resp1.status_code != 200:
                print(f"❌ Iteration {i}: GET /api/om/pdfs failed: {resp1.status_code}")
                failed += 1
                continue
            
            data1 = resp1.json()
            cursor = data1.get("server_time")
            if not cursor:
                print(f"❌ Iteration {i}: No server_time in response")
                failed += 1
                continue
            
            print(f"  ✓ Captured cursor: {cursor}")
            
            # Step 2: Immediately upload PDF
            resp2 = upload_pdf_auto(owner_token)
            if resp2.status_code != 200:
                print(f"❌ Iteration {i}: Upload failed: {resp2.status_code} {resp2.text}")
                failed += 1
                continue
            
            new_item = resp2.json().get("item")
            if not new_item:
                print(f"❌ Iteration {i}: No item in upload response")
                failed += 1
                continue
            
            pdf_id = new_item.get("id")
            uploaded_at = new_item.get("uploaded_at")
            filename = new_item.get("filename")
            test_pdfs.append(pdf_id)
            
            print(f"  ✓ Uploaded PDF: {filename} (id={pdf_id[:8]}..., uploaded_at={uploaded_at})")
            
            # Step 3: Immediately poll with cursor
            resp3 = get_pdfs(owner_token, since=cursor)
            if resp3.status_code != 200:
                print(f"❌ Iteration {i}: Poll failed: {resp3.status_code}")
                failed += 1
                continue
            
            data3 = resp3.json()
            items = data3.get("items", [])
            item_ids = [item.get("id") for item in items]
            
            # Step 4: Verify new PDF appears in poll result
            if pdf_id not in item_ids:
                print(f"❌ Iteration {i}: NEW PDF NOT FOUND IN POLL RESULT!")
                print(f"   Expected PDF id: {pdf_id}")
                print(f"   Found {len(items)} items: {item_ids[:3]}...")
                failed += 1
                continue
            
            print(f"  ✅ New PDF found in poll result (among {len(items)} items)")
            
            # Step 5: Verify cursor was captured before upload
            cursor_dt = datetime.fromisoformat(cursor.replace('Z', '+00:00'))
            uploaded_dt = datetime.fromisoformat(uploaded_at.replace('Z', '+00:00'))
            
            if cursor_dt > uploaded_dt:
                print(f"❌ Iteration {i}: CURSOR CAPTURED AFTER UPLOAD!")
                print(f"   cursor: {cursor}")
                print(f"   uploaded_at: {uploaded_at}")
                print(f"   Difference: {(cursor_dt - uploaded_dt).total_seconds():.3f}s")
                failed += 1
                continue
            
            time_diff = (uploaded_dt - cursor_dt).total_seconds()
            print(f"  ✅ Cursor captured before upload (diff: {time_diff:.3f}s)")
            
            passed += 1
            
        except Exception as e:
            print(f"❌ Iteration {i}: Exception: {e}")
            failed += 1
    
    # Cleanup: delete all test PDFs
    print(f"\n--- Cleanup: Deleting {len(test_pdfs)} test PDFs ---")
    for pdf_id in test_pdfs:
        resp = delete_pdf(owner_token, pdf_id)
        if resp.status_code == 200:
            print(f"  ✓ Deleted {pdf_id[:8]}...")
        else:
            print(f"  ⚠ Failed to delete {pdf_id[:8]}: {resp.status_code}")
    
    # Summary
    print(f"\n{'='*80}")
    print(f"TEST 1 SUMMARY: {passed}/10 iterations passed, {failed}/10 failed")
    print(f"{'='*80}")
    
    if passed == 10:
        print("✅ TEST 1 PASSED: Cursor race fix working perfectly (10/10)")
        return True
    else:
        print(f"❌ TEST 1 FAILED: Only {passed}/10 iterations passed")
        return False

# ============================================================
# TEST 2: Role-Based Global Notification Settings (owner-only)
# ============================================================
def test_notif_settings():
    """
    Test notification settings endpoints:
    A. GET /api/om/notif-settings
       - As owner → 200 with settings
       - As staff (no OM module) → 403
       - Without auth → 401
       - As temp staff WITH OM module → 200 (can read)
    B. PUT /api/om/notif-settings
       - As owner → 200, settings updated
       - As temp staff WITH OM module → 403 (owner-only)
       - As staff (no OM module) → 403
       - Without auth → 401
    """
    print("\n" + "="*80)
    print("TEST 2: ROLE-BASED GLOBAL NOTIFICATION SETTINGS")
    print("="*80)
    
    owner_token = login(OWNER_CREDS)
    staff_token = login(STAFF_CREDS)
    
    if not owner_token or not staff_token:
        print("❌ TEST 2 FAILED: Cannot login")
        return False
    
    # Get staff info to verify modules
    staff_info = get_auth_me(staff_token)
    if staff_info:
        print(f"  Staff (cindy) modules: {staff_info.get('user', {}).get('modules', [])}")
    
    test_results = []
    temp_staff_id = None
    temp_staff_token = None
    
    # TEST 2A: GET /api/om/notif-settings
    print("\n--- TEST 2A: GET /api/om/notif-settings ---")
    
    # 2A.1: As owner → 200
    print("\n2A.1: GET as owner")
    resp = get_notif_settings(owner_token)
    if resp.status_code == 200:
        data = resp.json()
        settings = data.get("settings", {})
        print(f"  ✅ Owner GET → 200")
        print(f"     Settings: popup={settings.get('popup')}, sound={settings.get('sound')}, browser={settings.get('browser')}")
        test_results.append(True)
    else:
        print(f"  ❌ Owner GET → {resp.status_code} (expected 200)")
        test_results.append(False)
    
    # 2A.2: As staff (no OM module) → 403
    print("\n2A.2: GET as staff (cindy, no OM module)")
    resp = get_notif_settings(staff_token)
    if resp.status_code == 403:
        error = resp.json().get("error", "")
        print(f"  ✅ Staff (no OM) GET → 403")
        print(f"     Error: {error}")
        test_results.append(True)
    else:
        print(f"  ❌ Staff (no OM) GET → {resp.status_code} (expected 403)")
        test_results.append(False)
    
    # 2A.3: Without auth → 401
    print("\n2A.3: GET without auth")
    resp = requests.get(f"{BASE_URL}/api/om/notif-settings")
    if resp.status_code == 401:
        print(f"  ✅ No auth GET → 401")
        test_results.append(True)
    else:
        print(f"  ❌ No auth GET → {resp.status_code} (expected 401)")
        test_results.append(False)
    
    # 2A.4: Create temp staff WITH OM module
    print("\n2A.4: Create temp staff WITH order_management module")
    resp = create_temp_staff_with_om(owner_token)
    if resp.status_code == 200:
        temp_staff = resp.json().get("employee", {})
        temp_staff_id = temp_staff.get("id")
        temp_username = temp_staff.get("username")
        temp_modules = temp_staff.get("modules", [])
        print(f"  ✅ Created temp staff: {temp_username}")
        print(f"     Modules: {temp_modules}")
        
        # Login as temp staff
        temp_creds = {"username": temp_username, "password": "test123"}
        temp_staff_token = login(temp_creds)
        
        if temp_staff_token:
            # GET as temp staff WITH OM module → 200
            print(f"\n2A.5: GET as temp staff WITH OM module")
            resp = get_notif_settings(temp_staff_token)
            if resp.status_code == 200:
                print(f"  ✅ Temp staff (WITH OM) GET → 200 (can read)")
                test_results.append(True)
            else:
                print(f"  ❌ Temp staff (WITH OM) GET → {resp.status_code} (expected 200)")
                test_results.append(False)
        else:
            print(f"  ❌ Failed to login as temp staff")
            test_results.append(False)
    else:
        print(f"  ❌ Failed to create temp staff: {resp.status_code}")
        test_results.append(False)
    
    # TEST 2B: PUT /api/om/notif-settings
    print("\n--- TEST 2B: PUT /api/om/notif-settings ---")
    
    # 2B.1: As owner with {sound: false} → 200
    print("\n2B.1: PUT as owner with {sound: false}")
    resp = put_notif_settings(owner_token, {"sound": False})
    if resp.status_code == 200:
        data = resp.json()
        settings = data.get("settings", {})
        if settings.get("sound") == False:
            print(f"  ✅ Owner PUT → 200, sound=false")
            test_results.append(True)
        else:
            print(f"  ❌ Owner PUT → 200 but sound={settings.get('sound')} (expected false)")
            test_results.append(False)
    else:
        print(f"  ❌ Owner PUT → {resp.status_code} (expected 200)")
        test_results.append(False)
    
    # 2B.2: Verify persistence (GET back)
    print("\n2B.2: GET to verify persistence")
    resp = get_notif_settings(owner_token)
    if resp.status_code == 200:
        data = resp.json()
        settings = data.get("settings", {})
        if settings.get("sound") == False:
            print(f"  ✅ GET confirms sound=false (persisted)")
            test_results.append(True)
        else:
            print(f"  ❌ GET shows sound={settings.get('sound')} (expected false)")
            test_results.append(False)
    else:
        print(f"  ❌ GET failed: {resp.status_code}")
        test_results.append(False)
    
    # 2B.3: As owner with {popup: false, browser: false} → 200
    print("\n2B.3: PUT as owner with {popup: false, browser: false}")
    resp = put_notif_settings(owner_token, {"popup": False, "browser": False})
    if resp.status_code == 200:
        data = resp.json()
        settings = data.get("settings", {})
        if settings.get("popup") == False and settings.get("browser") == False:
            print(f"  ✅ Owner PUT → 200, popup=false, browser=false")
            test_results.append(True)
        else:
            print(f"  ❌ Owner PUT → 200 but popup={settings.get('popup')}, browser={settings.get('browser')}")
            test_results.append(False)
    else:
        print(f"  ❌ Owner PUT → {resp.status_code} (expected 200)")
        test_results.append(False)
    
    # 2B.4: As temp staff WITH OM module → 403 (owner-only)
    if temp_staff_token:
        print("\n2B.4: PUT as temp staff WITH OM module (should be 403)")
        resp = put_notif_settings(temp_staff_token, {"sound": True})
        if resp.status_code == 403:
            error = resp.json().get("error", "")
            print(f"  ✅ Temp staff (WITH OM) PUT → 403 (owner-only enforced)")
            print(f"     Error: {error}")
            test_results.append(True)
        else:
            print(f"  ❌ Temp staff (WITH OM) PUT → {resp.status_code} (expected 403)")
            test_results.append(False)
    
    # 2B.5: As staff (no OM module) → 403
    print("\n2B.5: PUT as staff (cindy, no OM module)")
    resp = put_notif_settings(staff_token, {"sound": True})
    if resp.status_code == 403:
        print(f"  ✅ Staff (no OM) PUT → 403")
        test_results.append(True)
    else:
        print(f"  ❌ Staff (no OM) PUT → {resp.status_code} (expected 403)")
        test_results.append(False)
    
    # 2B.6: Without auth → 401
    print("\n2B.6: PUT without auth")
    resp = requests.put(f"{BASE_URL}/api/om/notif-settings", json={"sound": True})
    if resp.status_code == 401:
        print(f"  ✅ No auth PUT → 401")
        test_results.append(True)
    else:
        print(f"  ❌ No auth PUT → {resp.status_code} (expected 401)")
        test_results.append(False)
    
    # 2B.7: Body validation (coercion)
    print("\n2B.7: PUT with non-boolean value (should coerce)")
    resp = put_notif_settings(owner_token, {"popup": "not-bool"})
    if resp.status_code == 200:
        data = resp.json()
        settings = data.get("settings", {})
        # "not-bool" is truthy, so !!body.popup should be true
        print(f"  ✅ Owner PUT with non-bool → 200, popup={settings.get('popup')} (coerced)")
        test_results.append(True)
    else:
        print(f"  ❌ Owner PUT with non-bool → {resp.status_code}")
        test_results.append(False)
    
    # CLEANUP: Restore defaults
    print("\n--- Cleanup: Restore default settings ---")
    resp = put_notif_settings(owner_token, {"popup": True, "sound": True, "browser": True})
    if resp.status_code == 200:
        print(f"  ✓ Restored defaults: popup=true, sound=true, browser=true")
    else:
        print(f"  ⚠ Failed to restore defaults: {resp.status_code}")
    
    # Delete temp staff
    if temp_staff_id:
        print(f"\n--- Cleanup: Delete temp staff ---")
        resp = delete_employee(owner_token, temp_staff_id)
        if resp.status_code == 200:
            print(f"  ✓ Deleted temp staff")
        else:
            print(f"  ⚠ Failed to delete temp staff: {resp.status_code}")
    
    # Summary
    passed = sum(test_results)
    total = len(test_results)
    print(f"\n{'='*80}")
    print(f"TEST 2 SUMMARY: {passed}/{total} tests passed")
    print(f"{'='*80}")
    
    if passed == total:
        print("✅ TEST 2 PASSED: All notification settings tests passed")
        return True
    else:
        print(f"❌ TEST 2 FAILED: {total - passed}/{total} tests failed")
        return False

# ============================================================
# TEST 3: Regression checks
# ============================================================
def test_regression():
    """
    Verify no existing endpoints were broken:
    - POST /api/auth/login (owner and cindy)
    - GET /api/auth/me
    - GET /api/dashboard
    - GET /api/om/pdfs
    - POST /api/om/pdfs (multipart)
    - POST /api/om/pdfs/auto
    - POST /api/om/pdfs/[id]/open
    - POST /api/om/pdfs/[id]/ketoko
    - DELETE /api/om/pdfs/[id] (owner-only)
    """
    print("\n" + "="*80)
    print("TEST 3: REGRESSION CHECKS")
    print("="*80)
    
    test_results = []
    test_pdf_ids = []
    
    # 3.1: POST /api/auth/login (owner)
    print("\n3.1: POST /api/auth/login (owner)")
    owner_token = login(OWNER_CREDS)
    if owner_token:
        print(f"  ✅ Owner login → 200")
        test_results.append(True)
    else:
        print(f"  ❌ Owner login failed")
        test_results.append(False)
        return False  # Cannot continue without token
    
    # 3.2: POST /api/auth/login (staff)
    print("\n3.2: POST /api/auth/login (staff)")
    staff_token = login(STAFF_CREDS)
    if staff_token:
        print(f"  ✅ Staff login → 200")
        test_results.append(True)
    else:
        print(f"  ❌ Staff login failed")
        test_results.append(False)
    
    # 3.3: GET /api/auth/me (owner)
    print("\n3.3: GET /api/auth/me (owner)")
    resp = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    if resp.status_code == 200:
        user = resp.json().get("user", {})
        role = user.get("role")
        modules = user.get("modules", [])
        if role == "owner" and "order_management" in modules:
            print(f"  ✅ GET /api/auth/me → 200, role=owner, modules={modules}")
            test_results.append(True)
        else:
            print(f"  ❌ GET /api/auth/me → 200 but role={role}, modules={modules}")
            test_results.append(False)
    else:
        print(f"  ❌ GET /api/auth/me → {resp.status_code}")
        test_results.append(False)
    
    # 3.4: GET /api/dashboard
    print("\n3.4: GET /api/dashboard")
    resp = requests.get(
        f"{BASE_URL}/api/dashboard",
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    if resp.status_code == 200:
        print(f"  ✅ GET /api/dashboard → 200")
        test_results.append(True)
    else:
        print(f"  ❌ GET /api/dashboard → {resp.status_code}")
        test_results.append(False)
    
    # 3.5: GET /api/om/pdfs (no cursor)
    print("\n3.5: GET /api/om/pdfs (no cursor)")
    resp = get_pdfs(owner_token)
    if resp.status_code == 200:
        data = resp.json()
        items = data.get("items", [])
        server_time = data.get("server_time")
        print(f"  ✅ GET /api/om/pdfs → 200, {len(items)} items, server_time={server_time}")
        test_results.append(True)
    else:
        print(f"  ❌ GET /api/om/pdfs → {resp.status_code}")
        test_results.append(False)
    
    # 3.6: POST /api/om/pdfs (multipart, regular upload)
    print("\n3.6: POST /api/om/pdfs (multipart, regular upload)")
    files = {"file": ("test_regular.pdf", io.BytesIO(MINIMAL_PDF), "application/pdf")}
    resp = requests.post(
        f"{BASE_URL}/api/om/pdfs",
        headers={"Authorization": f"Bearer {owner_token}"},
        files=files
    )
    if resp.status_code == 200:
        item = resp.json().get("item", {})
        pdf_id = item.get("id")
        filename = item.get("filename")
        test_pdf_ids.append(pdf_id)
        print(f"  ✅ POST /api/om/pdfs → 200, filename={filename}")
        test_results.append(True)
    else:
        print(f"  ❌ POST /api/om/pdfs → {resp.status_code}")
        test_results.append(False)
    
    # 3.7: POST /api/om/pdfs/auto
    print("\n3.7: POST /api/om/pdfs/auto")
    resp = upload_pdf_auto(owner_token)
    if resp.status_code == 200:
        item = resp.json().get("item", {})
        pdf_id = item.get("id")
        filename = item.get("filename")
        uploaded_via = item.get("uploaded_via")
        open_count = item.get("open_count")
        test_pdf_ids.append(pdf_id)
        
        # Verify filename matches DDMMYY-N.pdf pattern
        import re
        if re.match(r'^\d{6}-\d+\.pdf$', filename):
            print(f"  ✅ POST /api/om/pdfs/auto → 200, filename={filename} (pattern OK)")
            print(f"     uploaded_via={uploaded_via}, open_count={open_count}")
            test_results.append(True)
        else:
            print(f"  ❌ POST /api/om/pdfs/auto → 200 but filename={filename} (pattern mismatch)")
            test_results.append(False)
    else:
        print(f"  ❌ POST /api/om/pdfs/auto → {resp.status_code}")
        test_results.append(False)
    
    # 3.8: POST /api/om/pdfs/[id]/open
    if test_pdf_ids:
        print("\n3.8: POST /api/om/pdfs/[id]/open")
        pdf_id = test_pdf_ids[-1]
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/open",
            headers={"Authorization": f"Bearer {owner_token}"}
        )
        if resp.status_code == 200:
            item = resp.json().get("item", {})
            open_count = item.get("open_count")
            print(f"  ✅ POST /api/om/pdfs/[id]/open → 200, open_count={open_count}")
            test_results.append(True)
        else:
            print(f"  ❌ POST /api/om/pdfs/[id]/open → {resp.status_code}")
            test_results.append(False)
    
    # 3.9: POST /api/om/pdfs/[id]/ketoko
    if test_pdf_ids:
        print("\n3.9: POST /api/om/pdfs/[id]/ketoko {input: true}")
        pdf_id = test_pdf_ids[-1]
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{pdf_id}/ketoko",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"input": True}
        )
        if resp.status_code == 200:
            item = resp.json().get("item", {})
            ketoko_input_at = item.get("ketoko_input_at")
            print(f"  ✅ POST /api/om/pdfs/[id]/ketoko → 200, ketoko_input_at={ketoko_input_at}")
            test_results.append(True)
        else:
            print(f"  ❌ POST /api/om/pdfs/[id]/ketoko → {resp.status_code}")
            test_results.append(False)
    
    # 3.10: DELETE /api/om/pdfs/[id] as staff → 403 (owner-only)
    if test_pdf_ids and staff_token:
        print("\n3.10: DELETE /api/om/pdfs/[id] as staff (should be 403)")
        pdf_id = test_pdf_ids[0]
        resp = delete_pdf(staff_token, pdf_id)
        if resp.status_code == 403:
            print(f"  ✅ Staff DELETE → 403 (owner-only enforced)")
            test_results.append(True)
        else:
            print(f"  ❌ Staff DELETE → {resp.status_code} (expected 403)")
            test_results.append(False)
    
    # 3.11: DELETE /api/om/pdfs/[id] as owner → 200
    print("\n3.11: DELETE /api/om/pdfs/[id] as owner")
    deleted_count = 0
    for pdf_id in test_pdf_ids:
        resp = delete_pdf(owner_token, pdf_id)
        if resp.status_code == 200:
            deleted_count += 1
        else:
            print(f"  ⚠ Failed to delete {pdf_id[:8]}: {resp.status_code}")
    
    if deleted_count == len(test_pdf_ids):
        print(f"  ✅ Deleted all {deleted_count} test PDFs")
        test_results.append(True)
    else:
        print(f"  ❌ Only deleted {deleted_count}/{len(test_pdf_ids)} test PDFs")
        test_results.append(False)
    
    # Summary
    passed = sum(test_results)
    total = len(test_results)
    print(f"\n{'='*80}")
    print(f"TEST 3 SUMMARY: {passed}/{total} tests passed")
    print(f"{'='*80}")
    
    if passed == total:
        print("✅ TEST 3 PASSED: All regression tests passed")
        return True
    else:
        print(f"❌ TEST 3 FAILED: {total - passed}/{total} tests failed")
        return False

# ============================================================
# MAIN
# ============================================================
def main():
    print("="*80)
    print("BACKEND TESTING: Cursor Race Fix & Notification Settings")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test credentials: owner/owner123, cindy/cindy123")
    print("="*80)
    
    results = {}
    
    # Run all tests
    try:
        results["test1_cursor_race"] = test_cursor_race_fix()
    except Exception as e:
        print(f"\n❌ TEST 1 EXCEPTION: {e}")
        results["test1_cursor_race"] = False
    
    try:
        results["test2_notif_settings"] = test_notif_settings()
    except Exception as e:
        print(f"\n❌ TEST 2 EXCEPTION: {e}")
        results["test2_notif_settings"] = False
    
    try:
        results["test3_regression"] = test_regression()
    except Exception as e:
        print(f"\n❌ TEST 3 EXCEPTION: {e}")
        results["test3_regression"] = False
    
    # Final summary
    print("\n" + "="*80)
    print("FINAL SUMMARY")
    print("="*80)
    print(f"TEST 1 (Cursor Race Fix):        {'✅ PASSED' if results.get('test1_cursor_race') else '❌ FAILED'}")
    print(f"TEST 2 (Notification Settings):  {'✅ PASSED' if results.get('test2_notif_settings') else '❌ FAILED'}")
    print(f"TEST 3 (Regression):              {'✅ PASSED' if results.get('test3_regression') else '❌ FAILED'}")
    print("="*80)
    
    all_passed = all(results.values())
    if all_passed:
        print("\n🎉 ALL TESTS PASSED 🎉")
        return 0
    else:
        print("\n❌ SOME TESTS FAILED")
        return 1

if __name__ == "__main__":
    exit(main())
