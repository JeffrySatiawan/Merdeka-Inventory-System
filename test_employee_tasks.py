#!/usr/bin/env python3
"""
Backend API tests for GET /api/tasks/employees endpoint
Tests owner-only Employee Task view with grouping and idle employee detection
"""

import requests
import json
import os
from datetime import datetime

# Get base URL from environment
BASE_URL = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://pdf-notify-sound.preview.emergentagent.com')
API_BASE = f"{BASE_URL}/api"

# Test credentials
OWNER_CREDS = {"username": "owner", "password": "owner123"}
STAFF_CREDS = {"username": "cindy", "password": "cindy123"}

# Global tokens
owner_token = None
staff_token = None

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
# AUTHENTICATION
# ============================================================================

def test_login():
    """Login as owner and staff"""
    global owner_token, staff_token
    print_test("Authentication: Login owner and staff")
    
    try:
        # Owner login
        response = requests.post(f"{API_BASE}/auth/login", json=OWNER_CREDS)
        print_info(f"Owner login status: {response.status_code}")
        
        if response.status_code != 200:
            print_error(f"Owner login failed: {response.text}")
            return False
        
        data = response.json()
        owner_token = data.get('token')
        print_success(f"Owner logged in. Token: {owner_token[:20]}...")
        
        # Staff login
        response = requests.post(f"{API_BASE}/auth/login", json=STAFF_CREDS)
        print_info(f"Staff login status: {response.status_code}")
        
        if response.status_code != 200:
            print_error(f"Staff login failed: {response.text}")
            return False
        
        data = response.json()
        staff_token = data.get('token')
        user = data.get('user', {})
        modules = user.get('modules', [])
        print_success(f"Staff (Cindy) logged in. Token: {staff_token[:20]}...")
        print_info(f"Cindy's modules: {modules}")
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# MAIN TESTS FOR GET /api/tasks/employees
# ============================================================================

def test_employees_tasks_owner():
    """Test GET /api/tasks/employees as owner - should return 200 with full data"""
    print_test("GET /api/tasks/employees as owner")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/tasks/employees", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code != 200:
            print_error(f"Expected 200, got {response.status_code}: {response.text}")
            return False
        
        data = response.json()
        print_success("Owner can access /api/tasks/employees")
        
        # Validate response structure
        required_fields = ['date', 'time', 'is_closed', 'working', 'employees', 'total_tasks', 'total_completed', 'total_backlog']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            print_error(f"Missing required fields: {missing_fields}")
            return False
        
        print_success(f"All required fields present: {required_fields}")
        
        # Validate date format (YYYY-MM-DD)
        date = data.get('date')
        print_info(f"Date: {date}")
        if len(date) == 10 and date[4] == '-' and date[7] == '-':
            print_success(f"Date format correct: {date}")
        else:
            print_error(f"Date format incorrect: {date}")
        
        # Validate time format (HH:MM:SS)
        time = data.get('time')
        print_info(f"Time: {time}")
        if len(time) == 8 and time[2] == ':' and time[5] == ':':
            print_success(f"Time format correct: {time}")
        else:
            print_error(f"Time format incorrect: {time}")
        
        # Validate is_closed (boolean)
        is_closed = data.get('is_closed')
        print_info(f"Is closed: {is_closed}")
        if isinstance(is_closed, bool):
            print_success(f"is_closed is boolean: {is_closed}")
        else:
            print_error(f"is_closed is not boolean: {type(is_closed)}")
        
        # Validate working hours
        working = data.get('working', {})
        print_info(f"Working hours: {working}")
        if 'start' in working and 'end' in working:
            print_success(f"Working hours present: {working['start']} - {working['end']}")
        else:
            print_error(f"Working hours missing start/end: {working}")
        
        # Validate employees array
        employees = data.get('employees', [])
        print_info(f"Total employees in response: {len(employees)}")
        
        if len(employees) < 6:
            print_error(f"Expected at least 6 employees, got {len(employees)}")
            return False
        
        print_success(f"At least 6 employees present: {len(employees)}")
        
        # Check for specific employees (Cindy, Desak, Dian, Hayu, Naila, Shinta)
        expected_names = ['Cindy', 'Desak', 'Dian', 'Hayu', 'Naila', 'Shinta']
        found_names = [emp['employee']['name'] for emp in employees]
        
        print_info(f"Employee names found: {found_names}")
        
        for name in expected_names:
            if name in found_names:
                print_success(f"✅ Found employee: {name}")
            else:
                print_error(f"Missing expected employee: {name}")
        
        # Validate employee structure
        print_info("\nValidating employee structure:")
        for i, emp_entry in enumerate(employees[:3]):  # Check first 3 for brevity
            employee = emp_entry.get('employee', {})
            tasks = emp_entry.get('tasks', [])
            total = emp_entry.get('total', 0)
            completed = emp_entry.get('completed', 0)
            backlog = emp_entry.get('backlog', 0)
            
            print_info(f"\nEmployee {i+1}: {employee.get('name')}")
            print_info(f"  ID: {employee.get('id')}")
            print_info(f"  Username: {employee.get('username')}")
            print_info(f"  Role: {employee.get('role')}")
            print_info(f"  Weight: {employee.get('weight')}")
            print_info(f"  Tasks: {len(tasks)} (total: {total}, completed: {completed}, backlog: {backlog})")
            
            # Validate required employee fields
            required_emp_fields = ['id', 'name', 'username', 'role', 'weight']
            missing_emp_fields = [field for field in required_emp_fields if field not in employee]
            
            if missing_emp_fields:
                print_error(f"  Missing employee fields: {missing_emp_fields}")
            else:
                print_success(f"  All employee fields present")
            
            # Validate tasks array
            if not isinstance(tasks, list):
                print_error(f"  Tasks is not an array: {type(tasks)}")
            else:
                print_success(f"  Tasks is array with {len(tasks)} items")
            
            # Validate numeric fields
            if not isinstance(total, int):
                print_error(f"  Total is not integer: {type(total)}")
            if not isinstance(completed, int):
                print_error(f"  Completed is not integer: {type(completed)}")
            if not isinstance(backlog, int):
                print_error(f"  Backlog is not integer: {type(backlog)}")
        
        # Check for idle employees (employees with no tasks)
        idle_employees = [emp for emp in employees if emp.get('total', 0) == 0]
        print_info(f"\nIdle employees (total=0): {len(idle_employees)}")
        
        if len(idle_employees) > 0:
            print_success(f"✅ Found {len(idle_employees)} idle employee(s) with total=0")
            for idle_emp in idle_employees:
                emp_name = idle_emp['employee']['name']
                tasks_count = len(idle_emp.get('tasks', []))
                print_info(f"  - {emp_name}: {tasks_count} tasks, total={idle_emp.get('total')}")
                
                if tasks_count == 0 and idle_emp.get('total') == 0:
                    print_success(f"    ✅ {emp_name} correctly has empty tasks array and total=0")
                else:
                    print_error(f"    ❌ {emp_name} has inconsistent data")
        else:
            print_info("No idle employees found (all have tasks assigned)")
        
        # Validate task structure (if any tasks exist)
        print_info("\nValidating task structure:")
        task_found = False
        for emp_entry in employees:
            tasks = emp_entry.get('tasks', [])
            if len(tasks) > 0:
                task = tasks[0]
                task_found = True
                print_info(f"Sample task from {emp_entry['employee']['name']}:")
                print_info(f"  ID: {task.get('id')}")
                print_info(f"  Employee ID: {task.get('employee_id')}")
                print_info(f"  SKU Code: {task.get('sku_code')}")
                print_info(f"  Product ID: {task.get('product_id')}")
                print_info(f"  Product Name: {task.get('product_name')}")
                print_info(f"  Category: {task.get('category')}")
                print_info(f"  Completed: {task.get('completed')}")
                print_info(f"  Date: {task.get('date')}")
                print_info(f"  Is Backlog: {task.get('is_backlog')}")
                
                # Validate required task fields
                required_task_fields = ['id', 'employee_id', 'sku_code', 'product_id', 'product_name', 'category', 'completed', 'date', 'is_backlog']
                missing_task_fields = [field for field in required_task_fields if field not in task]
                
                if missing_task_fields:
                    print_error(f"  Missing task fields: {missing_task_fields}")
                else:
                    print_success(f"  All required task fields present")
                
                break
        
        if not task_found:
            print_info("No tasks found in any employee (all idle)")
        
        # Validate totals
        total_tasks = data.get('total_tasks', 0)
        total_completed = data.get('total_completed', 0)
        total_backlog = data.get('total_backlog', 0)
        
        print_info(f"\nGlobal totals:")
        print_info(f"  Total tasks: {total_tasks}")
        print_info(f"  Total completed: {total_completed}")
        print_info(f"  Total backlog: {total_backlog}")
        
        # Sanity check: sum of all employees.total should equal total_tasks
        sum_employee_totals = sum(emp.get('total', 0) for emp in employees)
        print_info(f"  Sum of employee totals: {sum_employee_totals}")
        
        if sum_employee_totals == total_tasks:
            print_success(f"✅ Total tasks ({total_tasks}) matches sum of employee totals ({sum_employee_totals})")
        else:
            print_error(f"❌ Total tasks ({total_tasks}) != sum of employee totals ({sum_employee_totals})")
        
        return True
    except Exception as e:
        print_error(f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_employees_tasks_no_auth():
    """Test GET /api/tasks/employees without auth - should return 401"""
    print_test("GET /api/tasks/employees without auth")
    
    try:
        response = requests.get(f"{API_BASE}/tasks/employees")
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print_success("No auth correctly returns 401")
            return True
        else:
            print_error(f"Expected 401, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_employees_tasks_staff():
    """Test GET /api/tasks/employees as staff - should return 403"""
    print_test("GET /api/tasks/employees as staff (Cindy)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/employees", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 403:
            data = response.json()
            error_msg = data.get('error', '')
            print_success(f"Staff correctly denied with 403")
            print_info(f"Error message: {error_msg}")
            
            if "owner" in error_msg.lower() and "employee task" in error_msg.lower():
                print_success(f"✅ Correct error message: '{error_msg}'")
            else:
                print_error(f"Error message doesn't match expected: '{error_msg}'")
            
            return True
        else:
            print_error(f"Expected 403, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# REGRESSION TESTS
# ============================================================================

def test_tasks_mine_owner():
    """Regression: GET /api/tasks/mine as owner should still work"""
    print_test("REGRESSION: GET /api/tasks/mine as owner")
    
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            tasks = data.get('tasks', [])
            print_success(f"✅ /api/tasks/mine still works for owner (returned {len(tasks)} tasks)")
            
            # Validate response structure
            if 'tasks' in data and 'date' in data and 'time' in data:
                print_success("Response has expected structure (tasks, date, time)")
            else:
                print_error(f"Response structure changed: {list(data.keys())}")
            
            return True
        else:
            print_error(f"Expected 200, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

def test_tasks_mine_staff():
    """Regression: GET /api/tasks/mine as staff should still work"""
    print_test("REGRESSION: GET /api/tasks/mine as staff (Cindy)")
    
    try:
        headers = {"Authorization": f"Bearer {staff_token}"}
        response = requests.get(f"{API_BASE}/tasks/mine", headers=headers)
        print_info(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            tasks = data.get('tasks', [])
            print_success(f"✅ /api/tasks/mine still works for staff (returned {len(tasks)} tasks)")
            
            # Validate all tasks belong to Cindy
            if len(tasks) > 0:
                all_cindys = all(task.get('employee_name') == 'Cindy' for task in tasks)
                if all_cindys:
                    print_success(f"All {len(tasks)} tasks belong to Cindy")
                else:
                    print_error("Some tasks don't belong to Cindy")
            else:
                print_info("Cindy has no tasks assigned")
            
            return True
        else:
            print_error(f"Expected 200, got {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print_error(f"Exception: {e}")
        return False

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_all_tests():
    """Run all tests for GET /api/tasks/employees endpoint"""
    print("\n" + "="*80)
    print("EMPLOYEE TASKS ENDPOINT TESTS - GET /api/tasks/employees")
    print("="*80)
    print(f"API Base URL: {API_BASE}")
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    results = {}
    
    # Authentication
    results['login'] = test_login()
    
    if not results['login']:
        print_error("Login failed, cannot continue tests")
        return False
    
    # Main tests
    results['employees_tasks_owner'] = test_employees_tasks_owner()
    results['employees_tasks_no_auth'] = test_employees_tasks_no_auth()
    results['employees_tasks_staff'] = test_employees_tasks_staff()
    
    # Regression tests
    results['tasks_mine_owner'] = test_tasks_mine_owner()
    results['tasks_mine_staff'] = test_tasks_mine_staff()
    
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
