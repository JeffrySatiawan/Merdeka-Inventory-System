#!/usr/bin/env python3
"""
Comprehensive backend API tests for Cycle Count Management System
Tests all endpoints under /api/
"""

import requests
import json
import os
from datetime import datetime

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://priview-staging.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}
STAFF2_CREDS = {"username": "hayu", "password": "hayu123"}

# Global tokens
owner_token = None
staff_token = None
staff2_token = None

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
# 1. AUTH TESTS
# ============================================================================

def test_auth_login_owner():
    """Test owner login with valid credentials"""
    global owner_token
    print_test("Auth: Owner Login")
    
    try:
        response = requests.post(f"{API_BASE}/auth/login", json=OWNER_CREDS)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if 'token' in data and 'user' in data:
                owner_token = data['token']
                user = data['user']
                if user.get('role') == 'owner' and user.get('username') == 'owner':
                    print_success(f"Owner login successful. Token: {owner_token[:20]}...")
                    print_info(f"User: {user.get('name')} (role: {user.get('role')})")
                    return True
                else:
                    print_error(f"User data incorrect: {user}")
                    return False
            else:
                print_error(f"Missing token or user in response: {data}")
                return False
        else:
            print_error(f"Login failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auth_login_staff():
    """Test staff login with valid credentials"""
    global staff_token, staff2_token
    print_test("Auth: Staff Login (Cindy)")
    
    try:
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF_CREDS)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if 'token' in data and 'user' in data:
                staff_token = data['token']
                user = data['user']
                if user.get('role') == 'staff' and user.get('username') == 'cindy':
                    print_success(f"Staff login successful. Token: {staff_token[:20]}...")
                    print_info(f"User: {user.get('name')} (weight: {user.get('weight')})")
                    
                    # Also login staff2 for later tests
                    response2 = requests.post(f"{API_BASE}/auth/login", json=STAFF2_CREDS)
                    if response2.status_code == 200:
                        staff2_token = response2.json()['token']
                        print_info(f"Also logged in Hayu for cross-employee tests")
                    
                    return True
                else:
                    print_error(f"User data incorrect: {user}")
                    return False
            else:
                print_error(f"Missing token or user in response: {data}")
                return False
        else:
            print_error(f"Login failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auth_invalid_password():
    """Test login with invalid password returns 401"""
    print_test("Auth: Invalid Password")
    
    try:
        response = requests.post(f"{API_BASE}/auth/login", 
                                json={"username": "owner", "password": "wrongpassword"})
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print_success("Invalid password correctly returns 401")
            return True
        else:
            print_error(f"Expected 401, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auth_me():
    """Test GET /api/auth/me with Bearer token"""
    print_test("Auth: GET /api/auth/me")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/auth/me", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if 'user' in data:
                user = data['user']
                if user.get('username') == 'owner':
                    print_success(f"Auth/me successful: {user.get('name')} ({user.get('role')})")
                    return True
                else:
                    print_error(f"Wrong user returned: {user}")
                    return False
            else:
                print_error(f"No user in response: {data}")
                return False
        else:
            print_error(f"Auth/me failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_auth_me_no_token():
    """Test GET /api/auth/me without token returns 401"""
    print_test("Auth: GET /api/auth/me without token")
    
    try:
        response = requests.get(f"{API_BASE}/auth/me")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print_success("No token correctly returns 401")
            return True
        else:
            print_error(f"Expected 401, got {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 2. AUTO-SEED & DASHBOARD TESTS
# ============================================================================

def test_dashboard_and_seed():
    """Test dashboard endpoint and verify auto-seed (50 SKUs, 7 users, settings)"""
    print_test("Dashboard & Auto-Seed Verification")
    
    try:
        response = requests.get(f"{API_BASE}/dashboard")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Dashboard data keys: {list(data.keys())}")
            
            # Check totals
            totals = data.get('totals', {})
            total_sku = totals.get('totalSku', 0)
            fast_sku = totals.get('fastSku', 0)
            medium_sku = totals.get('mediumSku', 0)
            slow_sku = totals.get('slowSku', 0)
            
            print_info(f"SKU counts: Total={total_sku}, FAST={fast_sku}, MEDIUM={medium_sku}, SLOW={slow_sku}")
            
            if total_sku == 50 and fast_sku == 17 and medium_sku == 17 and slow_sku == 16:
                print_success("✅ Auto-seed: 50 SKUs verified (17 FAST, 17 MEDIUM, 16 SLOW)")
            else:
                print_error(f"SKU counts incorrect. Expected 50 total (17/17/16), got {total_sku} ({fast_sku}/{medium_sku}/{slow_sku})")
            
            # Check employees
            employees = data.get('employees', [])
            print_info(f"Employees count: {len(employees)}")
            
            if len(employees) == 6:  # 6 staff (owner not in staff list)
                print_success("✅ Auto-seed: 6 staff employees found")
                
                # Verify weights
                weights = {emp['name']: emp['weight'] for emp in employees}
                expected_weights = {'Cindy': 120, 'Hayu': 100, 'Desak': 80, 'Naila': 90, 'Dian': 60, 'Shinta': 40}
                
                if weights == expected_weights:
                    print_success(f"✅ Employee weights correct: {weights}")
                else:
                    print_error(f"Employee weights incorrect. Expected {expected_weights}, got {weights}")
            else:
                print_error(f"Expected 6 employees, got {len(employees)}")
            
            # Check today's tasks
            today = data.get('today', {})
            target = today.get('target', 0)
            completed = today.get('completed', 0)
            remaining = today.get('remaining', 0)
            progress_pct = today.get('progressPct', 0)
            
            print_info(f"Today's tasks: target={target}, completed={completed}, remaining={remaining}, progress={progress_pct}%")
            
            if target > 0:
                print_success(f"✅ Daily tasks auto-generated: {target} tasks")
            else:
                print_error("No daily tasks generated")
            
            # Check working hours
            working = data.get('working', {})
            if working.get('start') == '07:00' and working.get('end') == '22:00':
                print_success(f"✅ Working hours: {working.get('start')} - {working.get('end')} {working.get('tz')}")
            else:
                print_error(f"Working hours incorrect: {working}")
            
            # Check backlog
            backlog = data.get('backlog', 0)
            print_info(f"Backlog count: {backlog}")
            
            return True
        else:
            print_error(f"Dashboard failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 3. PRODUCTS TESTS
# ============================================================================

def test_products_search():
    """Test GET /api/products with search parameter (owner-only)"""
    print_test("Products: Search for 'paracetamol'")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/products?search=paracetamol", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            total = data.get('total', 0)
            
            print_info(f"Found {len(items)} items (total: {total})")
            
            if len(items) > 0:
                for item in items:
                    print_info(f"  - {item.get('sku_code')}: {item.get('product_name')} ({item.get('category')})")
                print_success(f"Search returned {len(items)} matching products")
                return True
            else:
                print_error("No products found for 'paracetamol'")
                return False
        else:
            print_error(f"Products search failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_products_unauthorized():
    """Test GET /api/products without owner token returns 401"""
    print_test("Products: Unauthorized access (staff token)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/products", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print_success("Staff token correctly denied access to products list")
            return True
        else:
            print_error(f"Expected 401, got {response.status_code}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_products_import_json():
    """Test POST /api/products/import with JSON body"""
    print_test("Products: Import via JSON")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        # Test data with upsert and duplicate scenarios
        test_items = [
            {"sku_code": "TEST001", "product_name": "Test Product 1", "category": "FAST"},
            {"sku_code": "TEST002", "product_name": "Test Product 2", "category": "MEDIUM"},
            {"sku_code": "TEST001", "product_name": "Test Product 1 Duplicate", "category": "FAST"},  # Duplicate in file
            {"sku_code": "PRD00001", "product_name": "Paracetamol 500mg Updated", "category": "FAST"},  # Existing SKU (upsert)
            {"sku_code": "TEST003", "product_name": "Invalid Category", "category": "INVALID"},  # Invalid category
        ]
        
        payload = {"items": test_items}
        response = requests.post(f"{API_BASE}/products/import", headers=headers, json=payload)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Import result: {data}")
            
            inserted = data.get('inserted', 0)
            updated = data.get('updated', 0)
            total_rows = data.get('total_rows', 0)
            valid_rows = data.get('valid_rows', 0)
            duplicates = data.get('duplicates_in_file', [])
            
            print_info(f"Inserted: {inserted}, Updated: {updated}, Valid: {valid_rows}/{total_rows}")
            print_info(f"Duplicates in file: {duplicates}")
            
            # Verify behavior
            if 'TEST001' in duplicates:
                print_success("✅ Duplicate detection working (TEST001 found)")
            else:
                print_error("Duplicate detection failed")
            
            if updated >= 1:
                print_success(f"✅ Upsert working (updated {updated} existing SKUs)")
            else:
                print_error("Upsert may not be working")
            
            if valid_rows < total_rows:
                print_success(f"✅ Invalid category filtering working ({total_rows - valid_rows} rows filtered)")
            else:
                print_info("All rows had valid categories")
            
            return True
        else:
            print_error(f"Import failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_sku_history():
    """Test GET /api/products/:sku/history (owner-only)"""
    print_test("Products: SKU History for PRD00001")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/products/PRD00001/history", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            product = data.get('product', {})
            history = data.get('history', [])
            
            print_info(f"Product: {product.get('sku_code')} - {product.get('product_name')}")
            print_info(f"History records: {len(history)}")
            
            if product.get('sku_code') == 'PRD00001':
                print_success(f"✅ SKU history endpoint working (found {len(history)} records)")
                return True
            else:
                print_error(f"Wrong product returned: {product}")
                return False
        else:
            print_error(f"SKU history failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 4. EMPLOYEES TESTS
# ============================================================================

def test_employees_list():
    """Test GET /api/employees (owner-only)"""
    print_test("Employees: List all employees")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            
            print_info(f"Total employees: {len(items)}")
            
            if len(items) == 7:  # 1 owner + 6 staff
                print_success(f"✅ Found all 7 employees (1 owner + 6 staff)")
                
                # Verify owner is in list
                owner_found = any(emp.get('role') == 'owner' for emp in items)
                if owner_found:
                    print_success("✅ Owner account present in list")
                else:
                    print_error("Owner account not found")
                
                return True
            else:
                print_error(f"Expected 7 employees, got {len(items)}")
                return False
        else:
            print_error(f"Employees list failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_employees_create():
    """Test POST /api/employees (owner-only)"""
    print_test("Employees: Create new staff")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        new_employee = {
            "name": "Test Staff",
            "username": "teststaff",
            "password": "test123",
            "weight": 75,
            "status": "active"
        }
        
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=new_employee)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            employee = data.get('employee', {})
            
            if employee.get('username') == 'teststaff' and employee.get('role') == 'staff':
                print_success(f"✅ Employee created: {employee.get('name')} (weight: {employee.get('weight')})")
                return True
            else:
                print_error(f"Employee data incorrect: {employee}")
                return False
        else:
            print_error(f"Employee creation failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_employees_duplicate_username():
    """Test POST /api/employees with duplicate username returns 400"""
    print_test("Employees: Duplicate username")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        duplicate_employee = {
            "name": "Duplicate",
            "username": "cindy",  # Already exists
            "password": "test123",
            "weight": 50
        }
        
        response = requests.post(f"{API_BASE}/employees", headers=headers, json=duplicate_employee)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 400:
            print_success("✅ Duplicate username correctly rejected with 400")
            return True
        else:
            print_error(f"Expected 400, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_employees_update():
    """Test PUT /api/employees/:id"""
    print_test("Employees: Update employee")
    
    try:
        # First get the test employee we created
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        
        if response.status_code == 200:
            employees = response.json().get('items', [])
            test_emp = next((e for e in employees if e.get('username') == 'teststaff'), None)
            
            if not test_emp:
                print_error("Test employee not found")
                return False
            
            emp_id = test_emp.get('id')
            print_info(f"Updating employee ID: {emp_id}")
            
            # Update the employee
            update_data = {"weight": 85, "name": "Test Staff Updated"}
            response = requests.put(f"{API_BASE}/employees/{emp_id}", 
                                   headers={**headers, "Content-Type": "application/json"}, 
                                   json=update_data)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                employee = data.get('employee', {})
                
                if employee.get('weight') == 85 and employee.get('name') == 'Test Staff Updated':
                    print_success(f"✅ Employee updated: {employee.get('name')} (weight: {employee.get('weight')})")
                    return True
                else:
                    print_error(f"Update didn't apply correctly: {employee}")
                    return False
            else:
                print_error(f"Update failed: {response.text}")
                return False
        else:
            print_error("Failed to get employees list")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_employees_delete_owner():
    """Test DELETE /api/employees/:id for owner returns 403"""
    print_test("Employees: Cannot delete owner")
    
    try:
        # Get owner ID
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        
        if response.status_code == 200:
            employees = response.json().get('items', [])
            owner = next((e for e in employees if e.get('role') == 'owner'), None)
            
            if not owner:
                print_error("Owner not found")
                return False
            
            owner_id = owner.get('id')
            print_info(f"Attempting to delete owner ID: {owner_id}")
            
            response = requests.delete(f"{API_BASE}/employees/{owner_id}", headers=headers)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 403:
                print_success("✅ Owner deletion correctly blocked with 403")
                return True
            else:
                print_error(f"Expected 403, got {response.status_code}: {response.text}")
                return False
        else:
            print_error("Failed to get employees list")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_employees_delete():
    """Test DELETE /api/employees/:id"""
    print_test("Employees: Delete test employee")
    
    try:
        # Get test employee
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/employees", headers=headers)
        
        if response.status_code == 200:
            employees = response.json().get('items', [])
            test_emp = next((e for e in employees if e.get('username') == 'teststaff'), None)
            
            if not test_emp:
                print_error("Test employee not found")
                return False
            
            emp_id = test_emp.get('id')
            print_info(f"Deleting employee ID: {emp_id}")
            
            response = requests.delete(f"{API_BASE}/employees/{emp_id}", headers=headers)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                print_success("✅ Employee deleted successfully")
                return True
            else:
                print_error(f"Delete failed: {response.text}")
                return False
        else:
            print_error("Failed to get employees list")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 5. SETTINGS TESTS
# ============================================================================

def test_settings_get():
    """Test GET /api/settings returns settings + breakdown"""
    print_test("Settings: GET settings and breakdown")
    
    try:
        response = requests.get(f"{API_BASE}/settings")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            settings = data.get('settings', {})
            breakdown = data.get('breakdown', {})
            
            print_info(f"Settings: {settings}")
            print_info(f"Breakdown: {breakdown}")
            
            # Verify default settings
            if (settings.get('fast_per_month') == 4 and 
                settings.get('medium_per_month') == 2 and 
                settings.get('slow_per_month') == 1):
                print_success("✅ Default settings correct (4/2/1 per month)")
            else:
                print_error(f"Settings incorrect: {settings}")
            
            # Verify breakdown calculation
            daily_total = breakdown.get('daily_total', 0)
            print_info(f"Daily total estimate: {daily_total}")
            
            if daily_total > 0:
                print_success(f"✅ Daily target breakdown calculated: {daily_total} tasks/day")
                return True
            else:
                print_error("Daily total is 0")
                return False
        else:
            print_error(f"Settings get failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_settings_update():
    """Test PUT /api/settings (owner-only)"""
    print_test("Settings: Update fast_per_month to 2")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        update_data = {"fast_per_month": 2}
        response = requests.put(f"{API_BASE}/settings", headers=headers, json=update_data)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            # Verify the update
            response = requests.get(f"{API_BASE}/settings")
            if response.status_code == 200:
                data = response.json()
                settings = data.get('settings', {})
                breakdown = data.get('breakdown', {})
                
                if settings.get('fast_per_month') == 2:
                    print_success(f"✅ Settings updated: fast_per_month = 2")
                    print_info(f"New breakdown: {breakdown}")
                    
                    # Restore original value
                    restore_data = {"fast_per_month": 4}
                    requests.put(f"{API_BASE}/settings", headers=headers, json=restore_data)
                    print_info("Restored original settings")
                    
                    return True
                else:
                    print_error(f"Update didn't apply: {settings}")
                    return False
            else:
                print_error("Failed to verify update")
                return False
        else:
            print_error(f"Settings update failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 6. TASK GENERATION & DISTRIBUTION TESTS
# ============================================================================

def test_task_distribution():
    """Test daily task generation and weight-based distribution"""
    print_test("Tasks: Distribution algorithm verification")
    
    try:
        # Get dashboard to see current tasks
        response = requests.get(f"{API_BASE}/dashboard")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            today = data.get('today', {})
            employees = data.get('employees', [])
            
            target = today.get('target', 0)
            print_info(f"Total daily target: {target} tasks")
            
            # Calculate expected distribution
            total_weight = sum(emp['weight'] for emp in employees)
            print_info(f"Total weight: {total_weight}")
            
            # Verify each employee's assignment
            print_info("\nEmployee task distribution:")
            total_assigned = 0
            for emp in employees:
                assigned = emp.get('assigned', 0)
                weight = emp.get('weight', 0)
                expected_ratio = weight / total_weight if total_weight > 0 else 0
                actual_ratio = assigned / target if target > 0 else 0
                
                print_info(f"  {emp['name']}: {assigned} tasks (weight {weight}, expected ~{expected_ratio*100:.1f}%, actual {actual_ratio*100:.1f}%)")
                total_assigned += assigned
            
            # Verify total matches
            if total_assigned == target:
                print_success(f"✅ Total assigned ({total_assigned}) matches target ({target})")
            else:
                print_error(f"Total assigned ({total_assigned}) != target ({target})")
            
            # Verify proportional distribution (within reasonable margin)
            distribution_ok = True
            for emp in employees:
                assigned = emp.get('assigned', 0)
                weight = emp.get('weight', 0)
                expected = (target * weight) / total_weight
                diff_pct = abs(assigned - expected) / expected * 100 if expected > 0 else 0
                
                if diff_pct > 50:  # Allow 50% margin due to rounding
                    print_error(f"{emp['name']}: assigned {assigned} vs expected ~{expected:.1f} (diff {diff_pct:.1f}%)")
                    distribution_ok = False
            
            if distribution_ok:
                print_success("✅ Task distribution proportional to weights")
                return True
            else:
                print_error("Task distribution not proportional")
                return False
        else:
            print_error(f"Dashboard failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_task_generation_force():
    """Test POST /api/tasks/generate with force flag"""
    print_test("Tasks: Force regeneration")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}
        
        response = requests.post(f"{API_BASE}/tasks/generate", 
                                headers=headers, 
                                json={"force": True})
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print_info(f"Generation result: {data}")
            
            if 'created' in data or 'skipped' in data:
                print_success(f"✅ Task generation endpoint working: {data}")
                return True
            else:
                print_error(f"Unexpected response: {data}")
                return False
        else:
            print_error(f"Task generation failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 7. STAFF TASK FLOW TESTS
# ============================================================================

def test_tasks_mine():
    """Test GET /api/tasks/mine returns only current user's tasks"""
    print_test("Tasks: GET /api/tasks/mine (Cindy)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            tasks = data.get('tasks', [])
            
            print_info(f"Cindy's tasks: {len(tasks)}")
            
            if len(tasks) > 0:
                # Verify all tasks belong to Cindy
                all_cindys = all(task.get('employee_name') == 'Cindy' for task in tasks)
                
                if all_cindys:
                    print_success(f"✅ All {len(tasks)} tasks belong to Cindy")
                    
                    # Show first few tasks
                    for i, task in enumerate(tasks[:3]):
                        print_info(f"  Task {i+1}: {task.get('sku_code')} - {task.get('product_name')} (completed: {task.get('completed')})")
                    
                    return True
                else:
                    print_error("Some tasks don't belong to Cindy")
                    return False
            else:
                print_error("No tasks found for Cindy")
                return False
        else:
            print_error(f"Tasks/mine failed: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_task_complete_own():
    """Test POST /api/tasks/:id/complete for own task"""
    print_test("Tasks: Complete own task (Cindy)")
    
    try:
        # Get Cindy's tasks
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        
        if response.status_code == 200:
            tasks = response.json().get('tasks', [])
            
            # Find an incomplete task
            incomplete_task = next((t for t in tasks if not t.get('completed')), None)
            
            if not incomplete_task:
                print_error("No incomplete tasks found for Cindy")
                return False
            
            task_id = incomplete_task.get('id')
            sku_code = incomplete_task.get('sku_code')
            print_info(f"Completing task {task_id} ({sku_code})")
            
            # Complete the task
            response = requests.post(f"{API_BASE}/tasks/{task_id}/complete", headers=headers)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                print_success(f"✅ Task completed successfully")
                
                # Verify task is marked complete
                response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
                if response.status_code == 200:
                    tasks = response.json().get('tasks', [])
                    completed_task = next((t for t in tasks if t.get('id') == task_id), None)
                    
                    if completed_task and completed_task.get('completed'):
                        print_success("✅ Task marked as completed in database")
                        
                        # Verify SKU history was created
                        owner_headers = {"Authorization": f"Bearer {owner_token}"}
                        response = requests.get(f"{API_BASE}/products/{sku_code}/history", headers=owner_headers)
                        
                        if response.status_code == 200:
                            history = response.json().get('history', [])
                            recent = next((h for h in history if h.get('employee_name') == 'Cindy'), None)
                            
                            if recent:
                                print_success(f"✅ SKU history record created for {sku_code}")
                            else:
                                print_error("SKU history record not found")
                        
                        return True
                    else:
                        print_error("Task not marked as completed")
                        return False
                else:
                    print_error("Failed to verify completion")
                    return False
            else:
                print_error(f"Task completion failed: {response.text}")
                return False
        else:
            print_error("Failed to get tasks")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_task_complete_other():
    """Test POST /api/tasks/:id/complete for another employee's task returns 403"""
    print_test("Tasks: Cannot complete other employee's task")
    
    try:
        # Get Hayu's tasks
        headers_hayu = {"Authorization": f"Bearer {staff2_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers_hayu)
        
        if response.status_code == 200:
            hayu_tasks = response.json().get('tasks', [])
            
            if len(hayu_tasks) == 0:
                print_error("No tasks found for Hayu")
                return False
            
            hayu_task_id = hayu_tasks[0].get('id')
            print_info(f"Attempting to complete Hayu's task {hayu_task_id} as Cindy")
            
            # Try to complete Hayu's task as Cindy
            headers_cindy = {"Authorization": f"Bearer {staff_token}"}
            response = requests.post(f"{API_BASE}/tasks/{hayu_task_id}/complete", headers=headers_cindy)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 403:
                print_success("✅ Cross-employee task completion correctly blocked with 403")
                return True
            else:
                print_error(f"Expected 403, got {response.status_code}: {response.text}")
                return False
        else:
            print_error("Failed to get Hayu's tasks")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_task_uncomplete():
    """Test POST /api/tasks/:id/uncomplete"""
    print_test("Tasks: Uncomplete task")
    
    try:
        # Get Cindy's tasks
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        
        if response.status_code == 200:
            tasks = response.json().get('tasks', [])
            
            # Find a completed task
            completed_task = next((t for t in tasks if t.get('completed')), None)
            
            if not completed_task:
                print_error("No completed tasks found for Cindy")
                return False
            
            task_id = completed_task.get('id')
            print_info(f"Uncompleting task {task_id}")
            
            # Uncomplete the task
            response = requests.post(f"{API_BASE}/tasks/{task_id}/uncomplete", headers=headers)
            print_info(f"Status: {response.status_code}")
            
            if response.status_code == 200:
                print_success(f"✅ Task uncompleted successfully")
                
                # Verify task is marked incomplete
                response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
                if response.status_code == 200:
                    tasks = response.json().get('tasks', [])
                    uncompleted_task = next((t for t in tasks if t.get('id') == task_id), None)
                    
                    if uncompleted_task and not uncompleted_task.get('completed'):
                        print_success("✅ Task marked as incomplete in database")
                        return True
                    else:
                        print_error("Task still marked as completed")
                        return False
                else:
                    print_error("Failed to verify uncompletion")
                    return False
            else:
                print_error(f"Task uncompletion failed: {response.text}")
                return False
        else:
            print_error("Failed to get tasks")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# 8. AUTH GUARDS TESTS
# ============================================================================

def test_auth_guards():
    """Test that owner-only endpoints return 401/403 for staff"""
    print_test("Auth Guards: Staff accessing owner endpoints")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        
        tests = [
            ("GET /api/employees", requests.get(f"{API_BASE}/employees", headers=headers)),
            ("POST /api/employees", requests.post(f"{API_BASE}/employees", headers=headers, json={})),
            ("PUT /api/settings", requests.put(f"{API_BASE}/settings", headers=headers, json={})),
            ("POST /api/tasks/generate", requests.post(f"{API_BASE}/tasks/generate", headers=headers, json={})),
        ]
        
        all_blocked = True
        for name, response in tests:
            print_info(f"{name}: {response.status_code}")
            if response.status_code not in [401, 403]:
                print_error(f"{name} should return 401/403, got {response.status_code}")
                all_blocked = False
        
        if all_blocked:
            print_success("✅ All owner-only endpoints correctly blocked for staff")
            return True
        else:
            print_error("Some endpoints not properly protected")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_all_tests():
    """Run all backend tests"""
    print("\n" + "="*80)
    print("CYCLE COUNT MANAGEMENT SYSTEM - BACKEND API TESTS")
    print("="*80)
    print(f"API Base URL: {API_BASE}")
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    results = {}
    
    # 1. Auth tests
    results['auth_login_owner'] = test_auth_login_owner()
    results['auth_login_staff'] = test_auth_login_staff()
    results['auth_invalid_password'] = test_auth_invalid_password()
    results['auth_me'] = test_auth_me()
    results['auth_me_no_token'] = test_auth_me_no_token()
    
    # 2. Dashboard & seed
    results['dashboard_and_seed'] = test_dashboard_and_seed()
    
    # 3. Products
    results['products_search'] = test_products_search()
    results['products_unauthorized'] = test_products_unauthorized()
    results['products_import_json'] = test_products_import_json()
    results['sku_history'] = test_sku_history()
    
    # 4. Employees
    results['employees_list'] = test_employees_list()
    results['employees_create'] = test_employees_create()
    results['employees_duplicate_username'] = test_employees_duplicate_username()
    results['employees_update'] = test_employees_update()
    results['employees_delete_owner'] = test_employees_delete_owner()
    results['employees_delete'] = test_employees_delete()
    
    # 5. Settings
    results['settings_get'] = test_settings_get()
    results['settings_update'] = test_settings_update()
    
    # 6. Task generation
    results['task_distribution'] = test_task_distribution()
    results['task_generation_force'] = test_task_generation_force()
    
    # 7. Staff task flow
    results['tasks_mine'] = test_tasks_mine()
    results['task_complete_own'] = test_task_complete_own()
    results['task_complete_other'] = test_task_complete_other()
    results['task_uncomplete'] = test_task_uncomplete()
    
    # 8. Auth guards
    results['auth_guards'] = test_auth_guards()
    
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
