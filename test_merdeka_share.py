#!/usr/bin/env python3
"""
Focused backend tests for Merdeka Share PWA feature
Tests POST /api/om/pdfs/auto endpoint with auto-rename functionality
"""

import requests
import os
import io
from datetime import datetime

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://pdf-notify-sound.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CYCLE_COUNT_ONLY = {"username": "cindy", "password": "cindy123"}  # Has cycle_count module only

# Global tokens and test data
owner_token = None
staff_token = None
staff_with_om_token = None
staff_with_om_id = None
uploaded_pdf_ids = []

def print_test(name):
    print(f"\n{'='*80}")
    print(f"TEST: {name}")
    print('='*80)

def print_success(msg):
    print(f"✅ {msg}")

def print_error(msg):
    print(f"❌ {msg}")

def print_info(msg):
    print(f"ℹ️  {msg}")

# ============================================================================
# HELPER: Create a minimal valid PDF
# ============================================================================
def create_test_pdf():
    """Create a minimal valid PDF (about 200 bytes)"""
    # Minimal PDF structure
    pdf_content = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
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
<< /Size 5 /Root 1 0 R >>
startxref
410
%%EOF
"""
    return pdf_content

# ============================================================================
# 1. AUTH & SETUP
# ============================================================================

def test_auth_login():
    """Login as owner and staff"""
    global owner_token, staff_token
    print_test("Auth: Login owner and staff")
    
    try:
        # Login owner
        response = requests.post(f"{API_BASE}/auth/login", json=OWNER_CREDS)
        if response.status_code == 200:
            owner_token = response.json()['token']
            print_success(f"Owner login successful")
        else:
            print_error(f"Owner login failed: {response.text}")
            return False
        
        # Login staff (Cindy - cycle_count only)
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF_CYCLE_COUNT_ONLY)
        if response.status_code == 200:
            staff_token = response.json()['token']
            print_success(f"Staff (Cindy) login successful")
        else:
            print_error(f"Staff login failed: {response.text}")
            return False
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_create_staff_with_om_module():
    """Create a staff with order_management module for testing"""
    global staff_with_om_token, staff_with_om_id
    print_test("Setup: Create staff with order_management module")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        # Create staff with order_management module
        new_staff = {
            "name": "Test Staff OM",
            "username": "testom",
            "password": "testom123",
            "weight": 50,
            "status": "active",
            "modules": ["order_management"]
        }
        
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=new_staff)
        if response.status_code == 200:
            employee = response.json().get('employee', {})
            staff_with_om_id = employee.get('id')
            print_success(f"Created staff with OM module: {employee.get('name')} (modules: {employee.get('modules')})")
            
            # Login as this staff
            response = requests.post(f"{API_BASE}/auth/login", json={"username": "testom", "password": "testom123"})
            if response.status_code == 200:
                staff_with_om_token = response.json()['token']
                print_success(f"Logged in as staff with OM module")
                return True
            else:
                print_error(f"Failed to login as staff with OM: {response.text}")
                return False
        else:
            print_error(f"Failed to create staff with OM: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 2. OWNER-ONLY GUARD TESTS
# ============================================================================

def test_auto_endpoint_staff_without_om():
    """Test POST /api/om/pdfs/auto with staff without order_management module → 403"""
    print_test("POST /api/om/pdfs/auto - Staff without OM module → 403")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        
        pdf_content = create_test_pdf()
        files = {'file': ('test.pdf', io.BytesIO(pdf_content), 'application/pdf')}
        
        response = requests.post(f"{API_BASE}/om/pdfs/auto", headers=headers, files=files)
        print_info(f"Status: {response.status_code}")
        print_info(f"Response: {response.text}")
        
        if response.status_code == 403:
            print_success("Staff without OM module correctly denied with 403")
            return True
        else:
            print_error(f"Expected 403, got {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auto_endpoint_staff_with_om():
    """Test POST /api/om/pdfs/auto with staff WITH order_management module → 403 (owner-only)"""
    print_test("POST /api/om/pdfs/auto - Staff WITH OM module → 403 (owner-only)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_with_om_token}"}
        
        pdf_content = create_test_pdf()
        files = {'file': ('test.pdf', io.BytesIO(pdf_content), 'application/pdf')}
        
        response = requests.post(f"{API_BASE}/om/pdfs/auto", headers=headers, files=files)
        print_info(f"Status: {response.status_code}")
        print_info(f"Response: {response.text}")
        
        if response.status_code == 403:
            error_msg = response.json().get('error', '')
            if 'owner' in error_msg.lower() or 'admin' in error_msg.lower():
                print_success(f"Staff with OM module correctly denied with 403 and owner-only message: '{error_msg}'")
                return True
            else:
                print_error(f"Got 403 but message doesn't mention owner-only: '{error_msg}'")
                return False
        else:
            print_error(f"Expected 403, got {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auto_endpoint_owner_success():
    """Test POST /api/om/pdfs/auto as owner → 200 with auto-renamed file"""
    global uploaded_pdf_ids
    print_test("POST /api/om/pdfs/auto - Owner → 200 with auto-rename")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        pdf_content = create_test_pdf()
        files = {'file': ('original_name.pdf', io.BytesIO(pdf_content), 'application/pdf')}
        
        response = requests.post(f"{API_BASE}/om/pdfs/auto", headers=headers, files=files)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            item = data.get('item', {})
            
            print_info(f"Response: {data}")
            
            # Verify filename pattern DDMMYY-N.pdf
            filename = item.get('filename', '')
            import re
            pattern = r'^\d{6}-\d+\.pdf$'
            if re.match(pattern, filename):
                print_success(f"✅ Filename matches pattern DDMMYY-N.pdf: {filename}")
            else:
                print_error(f"Filename doesn't match pattern: {filename}")
                return False
            
            # Verify uploaded_via
            uploaded_via = item.get('uploaded_via', '')
            if uploaded_via == 'merdeka_share':
                print_success(f"✅ uploaded_via = 'merdeka_share'")
            else:
                print_error(f"uploaded_via incorrect: {uploaded_via}")
                return False
            
            # Verify uploaded_wita_date is today
            uploaded_wita_date = item.get('uploaded_wita_date', '')
            today = datetime.now().strftime('%Y-%m-%d')  # Approximate check
            if uploaded_wita_date:
                print_success(f"✅ uploaded_wita_date present: {uploaded_wita_date}")
            else:
                print_error(f"uploaded_wita_date missing")
                return False
            
            # Store ID for cleanup
            uploaded_pdf_ids.append(item.get('id'))
            
            return True
        else:
            print_error(f"Upload failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 3. AUTO-RENAME & INCREMENT TESTS
# ============================================================================

def test_auto_rename_increment():
    """Upload 2 more PDFs and verify N increments"""
    global uploaded_pdf_ids
    print_test("POST /api/om/pdfs/auto - Verify N increments (upload 2 more)")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        filenames = []
        for i in range(2):
            pdf_content = create_test_pdf()
            files = {'file': (f'test_{i}.pdf', io.BytesIO(pdf_content), 'application/pdf')}
            
            response = requests.post(f"{API_BASE}/om/pdfs/auto", headers=headers, files=files)
            if response.status_code == 200:
                item = response.json().get('item', {})
                filename = item.get('filename', '')
                filenames.append(filename)
                uploaded_pdf_ids.append(item.get('id'))
                print_info(f"Uploaded: {filename}")
            else:
                print_error(f"Upload {i+1} failed: {response.text}")
                return False
        
        # Verify all 3 filenames have incrementing N
        print_info(f"All uploaded filenames: {filenames}")
        
        # Extract N from each filename
        import re
        numbers = []
        for fname in filenames:
            m = re.search(r'-(\d+)\.pdf$', fname)
            if m:
                numbers.append(int(m.group(1)))
        
        if len(numbers) == 2:
            if numbers[1] == numbers[0] + 1:
                print_success(f"✅ N increments correctly: {numbers[0]} → {numbers[1]}")
                return True
            else:
                print_error(f"N doesn't increment correctly: {numbers}")
                return False
        else:
            print_error(f"Failed to extract N from filenames")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 4. REGRESSION TESTS
# ============================================================================

def test_regular_pdfs_endpoint_owner_only():
    """Test regular POST /api/om/pdfs is still owner-only"""
    print_test("Regression: POST /api/om/pdfs - Staff → 403, Owner → 200")
    
    try:
        # Test staff
        headers_staff = {"Authorization": f"Bearer {staff_with_om_token}"}
        pdf_content = create_test_pdf()
        files = {'file': ('regular.pdf', io.BytesIO(pdf_content), 'application/pdf')}
        
        response = requests.post(f"{API_BASE}/om/pdfs", headers=headers_staff, files=files)
        print_info(f"Staff attempt status: {response.status_code}")
        
        if response.status_code != 403:
            print_error(f"Staff should get 403, got {response.status_code}")
            return False
        
        print_success("✅ Staff correctly denied with 403")
        
        # Test owner
        headers_owner = {"Authorization": f"Bearer {owner_token}"}
        files = {'file': ('regular.pdf', io.BytesIO(pdf_content), 'application/pdf')}
        
        response = requests.post(f"{API_BASE}/om/pdfs", headers=headers_owner, files=files)
        print_info(f"Owner attempt status: {response.status_code}")
        
        if response.status_code == 200:
            item = response.json().get('item', {})
            uploaded_pdf_ids.append(item.get('id'))  # For cleanup
            print_success(f"✅ Owner can upload: {item.get('filename')}")
            return True
        else:
            print_error(f"Owner upload failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_list_endpoint_regression():
    """Test GET /api/om/pdfs returns items including uploaded_via='merdeka_share'"""
    print_test("Regression: GET /api/om/pdfs - List includes merdeka_share items")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        response = requests.get(f"{API_BASE}/om/pdfs", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            
            print_info(f"Total PDFs: {len(items)}")
            
            # Find items with uploaded_via='merdeka_share'
            merdeka_items = [item for item in items if item.get('uploaded_via') == 'merdeka_share']
            
            if len(merdeka_items) >= 3:  # We uploaded 3 via auto endpoint
                print_success(f"✅ Found {len(merdeka_items)} items with uploaded_via='merdeka_share'")
                
                # Show some details
                for item in merdeka_items[:3]:
                    print_info(f"  - {item.get('filename')} (uploaded_via: {item.get('uploaded_via')})")
                
                return True
            else:
                print_error(f"Expected at least 3 merdeka_share items, found {len(merdeka_items)}")
                return False
        else:
            print_error(f"List failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 5. CLEANUP
# ============================================================================

def test_cleanup_delete_pdfs():
    """Delete all test PDFs (owner-only)"""
    print_test("Cleanup: Delete test PDFs")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        deleted_count = 0
        for pdf_id in uploaded_pdf_ids:
            response = requests.delete(f"{API_BASE}/om/pdfs/{pdf_id}", headers=headers)
            if response.status_code == 200:
                deleted_count += 1
            else:
                print_error(f"Failed to delete {pdf_id}: {response.text}")
        
        print_success(f"✅ Deleted {deleted_count}/{len(uploaded_pdf_ids)} test PDFs")
        
        # Verify they're gone
        response = requests.get(f"{API_BASE}/om/pdfs", headers=headers)
        if response.status_code == 200:
            items = response.json().get('items', [])
            remaining = [item for item in items if item.get('id') in uploaded_pdf_ids]
            
            if len(remaining) == 0:
                print_success("✅ All test PDFs removed from list")
                return True
            else:
                print_error(f"Still found {len(remaining)} test PDFs in list")
                return False
        else:
            print_error("Failed to verify cleanup")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_cleanup_delete_test_staff():
    """Delete the test staff with OM module"""
    print_test("Cleanup: Delete test staff")
    
    try:
        if not staff_with_om_id:
            print_info("No test staff to delete")
            return True
        
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.delete(f"{API_BASE}/employees/{staff_with_om_id}", headers=headers)
        
        if response.status_code == 200:
            print_success("✅ Test staff deleted")
            return True
        else:
            print_error(f"Failed to delete test staff: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_all_tests():
    """Run all Merdeka Share PWA tests"""
    print("\n" + "="*80)
    print("MERDEKA SHARE PWA - BACKEND TESTS")
    print("="*80)
    print(f"API Base URL: {API_BASE}")
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    results = {}
    
    # 1. Auth & Setup
    results['auth_login'] = test_auth_login()
    if not results['auth_login']:
        print_error("Auth failed, cannot continue")
        return False
    
    results['create_staff_with_om'] = test_create_staff_with_om_module()
    
    # 2. Owner-only guard tests
    results['auto_staff_without_om'] = test_auto_endpoint_staff_without_om()
    results['auto_staff_with_om'] = test_auto_endpoint_staff_with_om()
    results['auto_owner_success'] = test_auto_endpoint_owner_success()
    
    # 3. Auto-rename & increment
    results['auto_rename_increment'] = test_auto_rename_increment()
    
    # 4. Regression tests
    results['regular_pdfs_owner_only'] = test_regular_pdfs_endpoint_owner_only()
    results['list_endpoint_regression'] = test_list_endpoint_regression()
    
    # 5. Cleanup
    results['cleanup_delete_pdfs'] = test_cleanup_delete_pdfs()
    results['cleanup_delete_staff'] = test_cleanup_delete_test_staff()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print("="*80)
    print(f"TOTAL: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
    print("="*80)
    
    return passed == total

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
