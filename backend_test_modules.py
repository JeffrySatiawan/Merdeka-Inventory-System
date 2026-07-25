#!/usr/bin/env python3
"""
Backend API tests for Module-based Permission System Refactor
Tests new module functionality + regression tests for existing Cycle Count system
"""

import requests
import json
import os
from datetime import datetime

# Base URL from review request
BASE_URL = "https://lanjut-next.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test credentials (seeded)
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}
STAFF2_CREDS = {"username": "hayu", "password": "hayu123"}

# Global tokens
owner_token = None
staff_token = None
cindy_id = None
test_employee_ids = []

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
# SETUP: LOGIN
# ============================================================================

def setup_login():
    """Login as owner and staff to get tokens"""
    global owner_token, staff_token, cindy_id
    print_test("SETUP: Login")
    
    try:
        # Owner login
        response = requests.post(f"{API_BASE}/auth/login", json=OWNER_CREDS)
        if response.status_code == 200:
            owner_token = response.json()['token']
            print_success(f"Owner logged in: {owner_token[:20]}...")
        else:
            print_error(f"Owner login failed: {response.text}")
            return False
        
        # Staff login
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF_CREDS)
        if response.status_code == 200:
            data = response.json()
            staff_token = data['token']
            cindy_id = data['user'].get('id')
            print_success(f"Staff (Cindy) logged in: {staff_token[:20]}...")
            print_info(f"Cindy ID: {cindy_id}")
        else:
            print_error(f"Staff login failed: {response.text}")
            return False
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# NEW FUNCTIONALITY TESTS
# ============================================================================

def test_modules_endpoint_with_auth():
    """Test GET /api/modules with owner Bearer token"""
    print_test("NEW: GET /api/modules (with auth)")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/modules", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            modules = data.get('modules', [])
            print_info(f"Modules returned: {len(modules)}")
            
            if len(modules) == 2:
                print_success("✅ Returns 2 modules")
                
                # Check cycle_count module
                cycle_count = next((m for m in modules if m.get('key') == 'cycle_count'), None)
                if cycle_count and cycle_count.get('status') == 'active':
                    print_success(f"✅ cycle_count module: status='active', name='{cycle_count.get('name')}'")
                else:
                    print_error(f"cycle_count module incorrect: {cycle_count}")
                    return False
                
                # Check order_management module
                order_mgmt = next((m for m in modules if m.get('key') == 'order_management'), None)
                if order_mgmt and order_mgmt.get('status') == 'coming_soon':
                    print_success(f"✅ order_management module: status='coming_soon', name='{order_mgmt.get('name')}'")
                else:
                    print_error(f"order_management module incorrect: {order_mgmt}")
                    return False
                
                return True
            else:
                print_error(f"Expected 2 modules, got {len(modules)}: {modules}")
                return False
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_modules_endpoint_no_auth():
    """Test GET /api/modules without token returns 401"""
    print_test("NEW: GET /api/modules (no auth)")
    
    try:
        response = requests.get(f"{API_BASE}/modules")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print_success("✅ Returns 401 without token")
            return True
        else:
            print_error(f"Expected 401, got {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_create_employee_with_supervisor_role():
    """Test POST /api/employees with role='supervisor' and modules"""
    print_test("NEW: Create employee with role='supervisor' and modules")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        payload = {
            "name": "Test Supervisor",
            "username": "testsup1",
            "password": "test123",
            "role": "supervisor",
            "modules": ["cycle_count", "order_management"]
        }
        
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            employee = data.get('employee', {})
            
            if employee.get('role') == 'supervisor':
                print_success(f"✅ Employee created with role='supervisor'")
            else:
                print_error(f"Role incorrect: {employee.get('role')}")
                return False
            
            modules = employee.get('modules', [])
            if 'cycle_count' in modules and 'order_management' in modules:
                print_success(f"✅ Modules contain both 'cycle_count' and 'order_management': {modules}")
            else:
                print_error(f"Modules incorrect: {modules}")
                return False
            
            # Store ID for cleanup
            test_employee_ids.append(employee.get('id'))
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_create_employee_owner_blocked():
    """Test POST /api/employees with role='owner' is blocked (becomes 'staff')"""
    print_test("NEW: Create employee with role='owner' (should be blocked)")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        payload = {
            "name": "Test Owner",
            "username": "testown1",
            "password": "test123",
            "role": "owner"
        }
        
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            employee = data.get('employee', {})
            
            if employee.get('role') == 'staff':
                print_success(f"✅ Owner assignment blocked, role set to 'staff'")
                test_employee_ids.append(employee.get('id'))
                return True
            else:
                print_error(f"Role should be 'staff', got: {employee.get('role')}")
                return False
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_create_employee_invalid_modules_filtered():
    """Test POST /api/employees with invalid modules (filtered and deduped)"""
    print_test("NEW: Create employee with invalid/duplicate modules")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        payload = {
            "name": "Test Filter",
            "username": "testfil1",
            "password": "test123",
            "modules": ["unknown_module", "cycle_count", "cycle_count", "order_management"]
        }
        
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            employee = data.get('employee', {})
            modules = employee.get('modules', [])
            
            print_info(f"Modules returned: {modules}")
            
            # Should contain only cycle_count and order_management (no unknown_module, no duplicates)
            if set(modules) == {'cycle_count', 'order_management'}:
                print_success(f"✅ Invalid modules filtered, duplicates removed: {modules}")
                test_employee_ids.append(employee.get('id'))
                return True
            else:
                print_error(f"Modules should be ['cycle_count', 'order_management'], got: {modules}")
                return False
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_update_employee_remove_modules():
    """Test PUT /api/employees/:id to remove all modules"""
    print_test("NEW: Update employee to remove all modules")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        # Update Cindy to have empty modules
        payload = {"modules": []}
        response = requests.put(f"{API_BASE}/employees/{cindy_id}", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            # Verify by getting employees list
            response = requests.get(f"{API_BASE}/employees", headers=headers)
            if response.status_code == 200:
                employees = response.json().get('items', [])
                cindy = next((e for e in employees if e.get('id') == cindy_id), None)
                
                if cindy and cindy.get('modules') == []:
                    print_success(f"✅ Cindy's modules set to empty array: {cindy.get('modules')}")
                    return True
                else:
                    print_error(f"Cindy's modules not empty: {cindy.get('modules') if cindy else 'NOT FOUND'}")
                    return False
            else:
                print_error("Failed to verify update")
                return False
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_staff_login_without_modules():
    """Test staff can still login even with empty modules"""
    print_test("NEW: Staff login still works with empty modules")
    
    try:
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF_CREDS)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            print_success("✅ Cindy can still login with empty modules")
            return True
        else:
            print_error(f"Login failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_tasks_mine_without_module():
    """Test GET /api/tasks/mine returns 403 when user lacks cycle_count module"""
    print_test("NEW: GET /api/tasks/mine without cycle_count module (403)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 403:
            error_msg = response.json().get('error', '')
            print_info(f"Error message: {error_msg}")
            
            # Check if error message is in Indonesian and mentions Cycle Count or akses
            if 'Cycle Count' in error_msg or 'akses' in error_msg.lower():
                print_success(f"✅ Returns 403 with Indonesian error message: '{error_msg}'")
                return True
            else:
                print_error(f"Error message doesn't mention Cycle Count or akses: {error_msg}")
                return False
        else:
            print_error(f"Expected 403, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_task_complete_without_module():
    """Test POST /api/tasks/:id/complete returns 403 before task lookup"""
    print_test("NEW: POST /api/tasks/:id/complete without module (403)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        # Use any dummy task ID
        response = requests.post(f"{API_BASE}/tasks/dummy-id-12345/complete", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 403:
            error_msg = response.json().get('error', '')
            print_info(f"Error message: {error_msg}")
            
            if 'Cycle Count' in error_msg or 'akses' in error_msg.lower():
                print_success(f"✅ Returns 403 before task lookup: '{error_msg}'")
                return True
            else:
                print_error(f"Error message incorrect: {error_msg}")
                return False
        else:
            print_error(f"Expected 403, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_update_employee_restore_modules():
    """Test PUT /api/employees/:id to restore cycle_count module"""
    print_test("NEW: Restore cycle_count module to Cindy")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        payload = {"modules": ["cycle_count"]}
        response = requests.put(f"{API_BASE}/employees/{cindy_id}", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            # Verify
            response = requests.get(f"{API_BASE}/employees", headers=headers)
            if response.status_code == 200:
                employees = response.json().get('items', [])
                cindy = next((e for e in employees if e.get('id') == cindy_id), None)
                
                if cindy and cindy.get('modules') == ['cycle_count']:
                    print_success(f"✅ Cindy's modules restored: {cindy.get('modules')}")
                    return True
                else:
                    print_error(f"Cindy's modules not restored: {cindy.get('modules') if cindy else 'NOT FOUND'}")
                    return False
            else:
                print_error("Failed to verify restore")
                return False
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_tasks_mine_with_module():
    """Test GET /api/tasks/mine works after restoring cycle_count module"""
    print_test("NEW: GET /api/tasks/mine works with cycle_count module")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            tasks = data.get('tasks', [])
            print_success(f"✅ Returns 200 with {len(tasks)} tasks (or empty array)")
            return True
        else:
            print_error(f"Expected 200, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_update_owner_role_blocked():
    """Test PUT /api/employees/:id cannot change owner role"""
    print_test("NEW: Cannot modify owner role")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        # Get owner ID
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        if response.status_code == 200:
            employees = response.json().get('items', [])
            owner = next((e for e in employees if e.get('role') == 'owner'), None)
            
            if not owner:
                print_error("Owner not found")
                return False
            
            owner_id = owner.get('id')
            print_info(f"Owner ID: {owner_id}")
            
            # Try to change owner role to staff
            payload = {"role": "staff"}
            response = requests.put(f"{API_BASE}/employees/{owner_id}", headers=headers, json=payload)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 403:
                error_msg = response.json().get('error', '')
                if 'owner' in error_msg.lower():
                    print_success(f"✅ Returns 403 with error: '{error_msg}'")
                    return True
                else:
                    print_error(f"Error message doesn't mention owner: {error_msg}")
                    return False
            else:
                print_error(f"Expected 403, got {response.status_code}: {response.text}")
                return False
        else:
            print_error("Failed to get employees")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auto_migration_verification():
    """Test all employees have modules array field"""
    print_test("NEW: Auto-migration - all employees have modules field")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            employees = response.json().get('items', [])
            print_info(f"Total employees: {len(employees)}")
            
            all_have_modules = True
            owner_modules = None
            staff_modules_sample = []
            
            for emp in employees:
                modules = emp.get('modules')
                if modules is None or not isinstance(modules, list):
                    print_error(f"Employee {emp.get('name')} missing modules field or not array: {modules}")
                    all_have_modules = False
                else:
                    if emp.get('role') == 'owner':
                        owner_modules = modules
                        print_info(f"Owner modules: {modules}")
                    elif emp.get('role') == 'staff' and emp.get('username') in ['cindy', 'hayu', 'desak']:
                        staff_modules_sample.append((emp.get('name'), modules))
            
            if all_have_modules:
                print_success("✅ All employees have modules array field")
            else:
                return False
            
            # Check owner has both modules
            if owner_modules and set(owner_modules) >= {'cycle_count', 'order_management'}:
                print_success(f"✅ Owner has both modules: {owner_modules}")
            else:
                print_error(f"Owner modules incorrect: {owner_modules}")
                return False
            
            # Check staff have cycle_count by default
            print_info(f"Sample staff modules: {staff_modules_sample}")
            for name, modules in staff_modules_sample:
                if 'cycle_count' in modules:
                    print_success(f"✅ {name} has cycle_count module: {modules}")
                else:
                    print_error(f"{name} missing cycle_count: {modules}")
            
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auth_me_returns_modules():
    """Test GET /api/auth/me returns modules field"""
    print_test("NEW: GET /api/auth/me returns modules")
    
    try:
        # Test as owner
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/auth/me", headers=headers)
        print_info(f"Owner /auth/me status: {response.status_code}")
        
        if response.status_code == 200:
            user = response.json().get('user', {})
            modules = user.get('modules', [])
            
            if set(modules) >= {'cycle_count', 'order_management'}:
                print_success(f"✅ Owner /auth/me returns both modules: {modules}")
            else:
                print_error(f"Owner modules incorrect: {modules}")
                return False
        else:
            print_error(f"Owner /auth/me failed: {response.text}")
            return False
        
        # Test as staff (Cindy with cycle_count)
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/auth/me", headers=headers)
        print_info(f"Cindy /auth/me status: {response.status_code}")
        
        if response.status_code == 200:
            user = response.json().get('user', {})
            modules = user.get('modules', [])
            
            if modules == ['cycle_count']:
                print_success(f"✅ Cindy /auth/me returns cycle_count: {modules}")
                return True
            else:
                print_error(f"Cindy modules incorrect: {modules}")
                return False
        else:
            print_error(f"Cindy /auth/me failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# REGRESSION TESTS
# ============================================================================

def test_regression_auth_login():
    """REGRESSION: POST /api/auth/login still works"""
    print_test("REGRESSION: Auth login")
    
    try:
        # Owner login
        response = requests.post(f"{API_BASE}/auth/login", json=OWNER_CREDS)
        if response.status_code != 200:
            print_error(f"Owner login failed: {response.text}")
            return False
        print_success("✅ Owner login works")
        
        # Staff login
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF_CREDS)
        if response.status_code != 200:
            print_error(f"Staff login failed: {response.text}")
            return False
        print_success("✅ Staff login works")
        
        # Invalid password
        response = requests.post(f"{API_BASE}/auth/login", json={"username": "owner", "password": "wrong"})
        if response.status_code != 401:
            print_error(f"Invalid password should return 401, got {response.status_code}")
            return False
        print_success("✅ Invalid password returns 401")
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_dashboard():
    """REGRESSION: GET /api/dashboard still works"""
    print_test("REGRESSION: Dashboard")
    
    try:
        response = requests.get(f"{API_BASE}/dashboard")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            totals = data.get('totals', {})
            today = data.get('today', {})
            employees = data.get('employees', [])
            
            if totals.get('totalSku') > 0 and len(employees) > 0:
                print_success(f"✅ Dashboard returns data: {totals.get('totalSku')} SKUs, {len(employees)} employees")
                return True
            else:
                print_error(f"Dashboard data incomplete: {data}")
                return False
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_products_search():
    """REGRESSION: GET /api/products?search=paracetamol"""
    print_test("REGRESSION: Products search")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/products?search=paracetamol", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            print_success(f"✅ Products search works: {len(items)} items found")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_products_import():
    """REGRESSION: POST /api/products/import"""
    print_test("REGRESSION: Products import")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        payload = {
            "items": [
                {"sku_code": "REGRESS01", "product_name": "Regression Test Product", "category": "FAST"}
            ]
        }
        
        response = requests.post(f"{API_BASE}/products/import", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_success(f"✅ Products import works: {data}")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_sku_history():
    """REGRESSION: GET /api/products/:sku/history"""
    print_test("REGRESSION: SKU history")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/products/PRD00001/history", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            product = data.get('product', {})
            print_success(f"✅ SKU history works: {product.get('sku_code')}")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_lookup():
    """REGRESSION: GET /api/lookup?q=para"""
    print_test("REGRESSION: Lookup")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/lookup?q=para", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            print_success(f"✅ Lookup works: {len(items)} items")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_employees_crud():
    """REGRESSION: Employee CRUD operations"""
    print_test("REGRESSION: Employee CRUD")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        # GET employees
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        if response.status_code != 200:
            print_error(f"GET employees failed: {response.text}")
            return False
        print_success("✅ GET employees works")
        
        # POST employee (already tested in new functionality, just verify it still works)
        payload = {
            "name": "Regression Test Staff",
            "username": "regtest1",
            "password": "test123",
            "weight": 100
        }
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=payload)
        if response.status_code != 200:
            print_error(f"POST employee failed: {response.text}")
            return False
        
        emp_id = response.json().get('employee', {}).get('id')
        print_success(f"✅ POST employee works: {emp_id}")
        
        # PUT employee
        response = requests.put(f"{API_BASE}/employees/{emp_id}", headers=headers, json={"weight": 110})
        if response.status_code != 200:
            print_error(f"PUT employee failed: {response.text}")
            return False
        print_success("✅ PUT employee works")
        
        # DELETE employee
        response = requests.delete(f"{API_BASE}/employees/{emp_id}", headers=headers)
        if response.status_code != 200:
            print_error(f"DELETE employee failed: {response.text}")
            return False
        print_success("✅ DELETE employee works")
        
        # DELETE owner blocked
        employees = requests.get(f"{API_BASE}/employees", headers=headers).json().get('items', [])
        owner = next((e for e in employees if e.get('role') == 'owner'), None)
        if owner:
            response = requests.delete(f"{API_BASE}/employees/{owner.get('id')}", headers=headers)
            if response.status_code != 403:
                print_error(f"DELETE owner should return 403, got {response.status_code}")
                return False
            print_success("✅ DELETE owner blocked")
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_settings():
    """REGRESSION: GET/PUT /api/settings"""
    print_test("REGRESSION: Settings")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        # GET settings
        response = requests.get(f"{API_BASE}/settings")
        if response.status_code != 200:
            print_error(f"GET settings failed: {response.text}")
            return False
        
        data = response.json()
        settings = data.get('settings', {})
        breakdown = data.get('breakdown', {})
        print_success(f"✅ GET settings works: breakdown daily_total={breakdown.get('daily_total')}")
        
        # PUT settings
        response = requests.put(f"{API_BASE}/settings", headers=headers, json={"fast_interval_days": 7})
        if response.status_code != 200:
            print_error(f"PUT settings failed: {response.text}")
            return False
        print_success("✅ PUT settings works")
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_tasks_generate():
    """REGRESSION: POST /api/tasks/generate"""
    print_test("REGRESSION: Task generation")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        response = requests.post(f"{API_BASE}/tasks/generate", headers=headers, json={"force": True})
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_success(f"✅ Task generation works: {data}")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_tasks_mine():
    """REGRESSION: GET /api/tasks/mine (staff with cycle_count module)"""
    print_test("REGRESSION: GET /api/tasks/mine")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            tasks = data.get('tasks', [])
            print_success(f"✅ GET /api/tasks/mine works: {len(tasks)} tasks")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_task_complete():
    """REGRESSION: POST /api/tasks/:id/complete (staff for own task)"""
    print_test("REGRESSION: Task complete/uncomplete")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        
        # Get tasks
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        if response.status_code != 200:
            print_error("Failed to get tasks")
            return False
        
        tasks = response.json().get('tasks', [])
        if len(tasks) == 0:
            print_info("No tasks available for testing complete/uncomplete")
            return True
        
        # Find incomplete task
        incomplete = next((t for t in tasks if not t.get('completed')), None)
        if incomplete:
            task_id = incomplete.get('id')
            sku_code = incomplete.get('sku_code')
            
            # Complete task
            response = requests.post(f"{API_BASE}/tasks/{task_id}/complete", headers=headers)
            if response.status_code != 200:
                print_error(f"Task complete failed: {response.text}")
                return False
            print_success(f"✅ Task complete works: {sku_code}")
            
            # Verify product.last_counted_at updated
            owner_headers = {"Authorization": f"Bearer {owner_token}"}
            response = requests.get(f"{API_BASE}/products/{sku_code}/history", headers=owner_headers)
            if response.status_code == 200:
                product = response.json().get('product', {})
                history = response.json().get('history', [])
                if product.get('last_counted_at') and len(history) > 0:
                    print_success(f"✅ Product last_counted_at updated, history entry created")
                else:
                    print_error("Product not updated or history not created")
            
            # Uncomplete task
            response = requests.post(f"{API_BASE}/tasks/{task_id}/uncomplete", headers=headers)
            if response.status_code != 200:
                print_error(f"Task uncomplete failed: {response.text}")
                return False
            print_success("✅ Task uncomplete works")
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_task_complete_other():
    """REGRESSION: POST /api/tasks/:id/complete for another employee's task returns 403"""
    print_test("REGRESSION: Cannot complete other's task")
    
    try:
        # Login as Hayu
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF2_CREDS)
        if response.status_code != 200:
            print_error("Hayu login failed")
            return False
        
        hayu_token = response.json()['token']
        
        # Get Hayu's tasks
        headers = {"Authorization": f"Bearer {hayu_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        if response.status_code != 200:
            print_error("Failed to get Hayu's tasks")
            return False
        
        hayu_tasks = response.json().get('tasks', [])
        if len(hayu_tasks) == 0:
            print_info("No tasks for Hayu, skipping cross-employee test")
            return True
        
        hayu_task_id = hayu_tasks[0].get('id')
        
        # Try to complete Hayu's task as Cindy
        cindy_headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.post(f"{API_BASE}/tasks/{hayu_task_id}/complete", headers=cindy_headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 403:
            print_success("✅ Cross-employee task completion blocked with 403")
            return True
        else:
            print_error(f"Expected 403, got {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_monitor():
    """REGRESSION: GET /api/monitor (public, no auth)"""
    print_test("REGRESSION: Monitor endpoint")
    
    try:
        response = requests.get(f"{API_BASE}/monitor")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            today = data.get('today', {})
            print_success(f"✅ Monitor endpoint works: {today.get('target')} tasks today")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_regression_time():
    """REGRESSION: GET /api/time (no auth)"""
    print_test("REGRESSION: Time endpoint")
    
    try:
        response = requests.get(f"{API_BASE}/time")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_success(f"✅ Time endpoint works: {data.get('date')} {data.get('time')}")
            return True
        else:
            print_error(f"Failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# CLEANUP
# ============================================================================

def cleanup_test_employees():
    """Delete test employees created during tests"""
    print_test("CLEANUP: Delete test employees")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        for emp_id in test_employee_ids:
            response = requests.delete(f"{API_BASE}/employees/{emp_id}", headers=headers)
            if response.status_code == 200:
                print_info(f"Deleted test employee: {emp_id}")
            else:
                print_error(f"Failed to delete {emp_id}: {response.text}")
        
        print_success(f"✅ Cleanup complete: {len(test_employee_ids)} test employees deleted")
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_all_tests():
    """Run all module refactor tests"""
    print("\n" + "="*80)
    print("MODULE-BASED PERMISSION SYSTEM - BACKEND API TESTS")
    print("="*80)
    print(f"API Base URL: {API_BASE}")
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    results = {}
    
    # Setup
    if not setup_login():
        print_error("FATAL: Login setup failed, cannot continue")
        return False
    
    # NEW FUNCTIONALITY TESTS
    print("\n" + "="*80)
    print("NEW FUNCTIONALITY TESTS")
    print("="*80)
    
    results['modules_endpoint_with_auth'] = test_modules_endpoint_with_auth()
    results['modules_endpoint_no_auth'] = test_modules_endpoint_no_auth()
    results['create_employee_supervisor'] = test_create_employee_with_supervisor_role()
    results['create_employee_owner_blocked'] = test_create_employee_owner_blocked()
    results['create_employee_invalid_modules'] = test_create_employee_invalid_modules_filtered()
    results['update_employee_remove_modules'] = test_update_employee_remove_modules()
    results['staff_login_without_modules'] = test_staff_login_without_modules()
    results['tasks_mine_without_module'] = test_tasks_mine_without_module()
    results['task_complete_without_module'] = test_task_complete_without_module()
    results['update_employee_restore_modules'] = test_update_employee_restore_modules()
    results['tasks_mine_with_module'] = test_tasks_mine_with_module()
    results['update_owner_role_blocked'] = test_update_owner_role_blocked()
    results['auto_migration_verification'] = test_auto_migration_verification()
    results['auth_me_returns_modules'] = test_auth_me_returns_modules()
    
    # REGRESSION TESTS
    print("\n" + "="*80)
    print("REGRESSION TESTS")
    print("="*80)
    
    results['regression_auth_login'] = test_regression_auth_login()
    results['regression_dashboard'] = test_regression_dashboard()
    results['regression_products_search'] = test_regression_products_search()
    results['regression_products_import'] = test_regression_products_import()
    results['regression_sku_history'] = test_regression_sku_history()
    results['regression_lookup'] = test_regression_lookup()
    results['regression_employees_crud'] = test_regression_employees_crud()
    results['regression_settings'] = test_regression_settings()
    results['regression_tasks_generate'] = test_regression_tasks_generate()
    results['regression_tasks_mine'] = test_regression_tasks_mine()
    results['regression_task_complete'] = test_regression_task_complete()
    results['regression_task_complete_other'] = test_regression_task_complete_other()
    results['regression_monitor'] = test_regression_monitor()
    results['regression_time'] = test_regression_time()
    
    # Cleanup
    cleanup_test_employees()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    print("\nNEW FUNCTIONALITY:")
    for test_name, result in list(results.items())[:14]:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print("\nREGRESSION TESTS:")
    for test_name, result in list(results.items())[14:]:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    print("="*80)
    print(f"TOTAL: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
    print("="*80)
    
    # Detailed failure report
    failures = [name for name, result in results.items() if not result]
    if failures:
        print("\n❌ FAILED TESTS:")
        for name in failures:
            print(f"  - {name}")
    
    return passed == total

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
