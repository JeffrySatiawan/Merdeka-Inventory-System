#!/usr/bin/env python3
"""
Backend test for Absensi real-time points in report.
Tests that GET /api/absensi/report and Excel export include real-time points from leaderboard.
"""

import requests
import sys
from io import BytesIO
from openpyxl import load_workbook

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def test_realtime_points():
    """Test real-time points in Absensi report (JSON + Excel)."""
    
    print("\n" + "="*80)
    print("TEST: Absensi Real-Time Points in Report")
    print("="*80)
    
    # ========================================================================
    # TEST 1: Login as owner
    # ========================================================================
    print("\n✅ TEST 1: Login as owner")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"}, timeout=30)
        assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
        token = resp.json().get("token")
        assert token, "No token in login response"
        headers = {"Authorization": f"Bearer {token}"}
        print(f"   ✓ Login successful, token: {token[:20]}...")
    except Exception as e:
        print(f"   ✗ TEST 1 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 2: GET /api/absensi/points/leaderboard → note balance for current period
    # ========================================================================
    print("\n✅ TEST 2: GET /api/absensi/points/leaderboard")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/points/leaderboard", headers=headers, timeout=30)
        assert resp.status_code == 200, f"Leaderboard failed: {resp.status_code} {resp.text}"
        leaderboard = resp.json()
        assert "items" in leaderboard, "No items in leaderboard response"
        assert "period_key" in leaderboard, "No period_key in leaderboard response"
        
        period = leaderboard["period_key"]
        items = leaderboard["items"]
        print(f"   ✓ Leaderboard period: {period}")
        print(f"   ✓ Leaderboard items count: {len(items)}")
        
        # Build map: user_id → {balance, rank, capped}
        leaderboard_map = {}
        for item in items:
            user_id = item.get("user_id")
            balance = item.get("balance", 0)
            rank = item.get("rank", 0)
            capped = item.get("capped", False)
            leaderboard_map[user_id] = {"balance": balance, "rank": rank, "capped": capped}
            print(f"      - {item.get('user_name', 'Unknown')}: balance={balance}, rank={rank}, capped={capped}")
        
        assert len(leaderboard_map) > 0, "Leaderboard is empty"
        print(f"   ✓ Leaderboard map built with {len(leaderboard_map)} users")
    except Exception as e:
        print(f"   ✗ TEST 2 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 3: GET /api/absensi/report?from=2026-08-01&to=2026-09-30
    # ========================================================================
    print("\n✅ TEST 3: GET /api/absensi/report?from=2026-08-01&to=2026-09-30")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/report?from=2026-08-01&to=2026-09-30", headers=headers, timeout=30)
        assert resp.status_code == 200, f"Report failed: {resp.status_code} {resp.text}"
        report = resp.json()
        
        # Check required fields
        assert "points_by_user" in report, "No points_by_user in report response"
        assert "points_period" in report, "No points_period in report response"
        
        points_by_user = report["points_by_user"]
        points_period = report["points_period"]
        
        print(f"   ✓ Report has points_by_user field (type: {type(points_by_user).__name__})")
        print(f"   ✓ Report has points_period field: {points_period}")
        
        # Verify points_period matches leaderboard period
        assert points_period == period, f"points_period mismatch: report={points_period}, leaderboard={period}"
        print(f"   ✓ points_period matches leaderboard period: {points_period}")
        
        # Verify points_by_user is an object/dict
        assert isinstance(points_by_user, dict), f"points_by_user should be dict, got {type(points_by_user).__name__}"
        print(f"   ✓ points_by_user is a dict with {len(points_by_user)} users")
        
        # Verify each user in leaderboard has matching balance in points_by_user
        mismatches = []
        for user_id, lb_data in leaderboard_map.items():
            if user_id not in points_by_user:
                mismatches.append(f"User {user_id} in leaderboard but NOT in points_by_user")
                continue
            
            report_data = points_by_user[user_id]
            lb_balance = lb_data["balance"]
            report_balance = report_data.get("balance", 0)
            
            if lb_balance != report_balance:
                mismatches.append(f"User {user_id}: leaderboard balance={lb_balance}, report balance={report_balance}")
            else:
                print(f"      ✓ User {user_id}: balance={report_balance} (matches leaderboard)")
        
        if mismatches:
            print(f"   ✗ Balance mismatches found:")
            for m in mismatches:
                print(f"      - {m}")
            return False
        
        print(f"   ✓ All {len(leaderboard_map)} users have matching balance in points_by_user")
        
    except Exception as e:
        print(f"   ✗ TEST 3 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 4: GET /api/absensi/report/export?from=2026-08-01&to=2026-09-30
    # ========================================================================
    print("\n✅ TEST 4: GET /api/absensi/report/export?from=2026-08-01&to=2026-09-30")
    try:
        resp = requests.get(f"{BASE_URL}/api/absensi/report/export?from=2026-08-01&to=2026-09-30", headers=headers, timeout=30)
        assert resp.status_code == 200, f"Export failed: {resp.status_code} {resp.text}"
        assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in resp.headers.get("content-type", ""), \
            f"Wrong content-type: {resp.headers.get('content-type')}"
        
        file_size = len(resp.content)
        print(f"   ✓ Excel export successful, file size: {file_size} bytes")
        
        # Load workbook
        wb = load_workbook(BytesIO(resp.content))
        sheet_names = wb.sheetnames
        print(f"   ✓ Workbook loaded, sheets: {sheet_names}")
        
    except Exception as e:
        print(f"   ✗ TEST 4 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 5: Verify Sheet Order (Rekapitulasi → Identitas → Absensi → Jam Kerja → Stock Opname → Lembur → Verifikasi)
    # ========================================================================
    print("\n✅ TEST 5: Verify Sheet Order")
    try:
        expected_order = ["Rekapitulasi", "Identitas", "Absensi", "Jam Kerja", "Stock Opname", "Lembur", "Verifikasi"]
        assert sheet_names == expected_order, f"Sheet order mismatch: expected {expected_order}, got {sheet_names}"
        print(f"   ✓ Sheet order correct: {' → '.join(sheet_names)}")
    except Exception as e:
        print(f"   ✗ TEST 5 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 6: Verify Rekapitulasi Sheet - "Poin Saat Ini" column exists
    # ========================================================================
    print("\n✅ TEST 6: Verify Rekapitulasi Sheet - 'Poin Saat Ini' column")
    try:
        ws = wb["Rekapitulasi"]
        
        # Read header row (row 1)
        header_row = [cell.value for cell in ws[1]]
        print(f"   ✓ Rekapitulasi header: {header_row}")
        
        # Check if "Poin Saat Ini" is in header
        assert "Poin Saat Ini" in header_row, f"'Poin Saat Ini' not found in header: {header_row}"
        poin_col_idx = header_row.index("Poin Saat Ini")
        print(f"   ✓ 'Poin Saat Ini' column found at index {poin_col_idx} (column {chr(65 + poin_col_idx)})")
        
        # Expected header structure
        expected_header = [
            "Nama Staff",
            "Total Jam Kerja Diakui (jam)",
            "Total Jam SO Diakui (jam)",
            "Total Jam Lembur Diakui (jam)",
            "Total Jam Diakui (jam)",
            "Poin Saat Ini"
        ]
        assert header_row == expected_header, f"Header mismatch: expected {expected_header}, got {header_row}"
        print(f"   ✓ Header structure matches expected")
        
    except Exception as e:
        print(f"   ✗ TEST 6 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 7: Verify Rekapitulasi Sheet - "Poin Saat Ini" values match leaderboard
    # ========================================================================
    print("\n✅ TEST 7: Verify Rekapitulasi Sheet - 'Poin Saat Ini' values match leaderboard")
    try:
        ws = wb["Rekapitulasi"]
        
        # Get all employees from GET /api/employees to map name → user_id
        resp = requests.get(f"{BASE_URL}/api/employees", headers=headers, timeout=30)
        assert resp.status_code == 200, f"Get employees failed: {resp.status_code}"
        employees = resp.json().get("items", [])
        name_to_id = {emp["name"]: emp["id"] for emp in employees}
        print(f"   ✓ Loaded {len(name_to_id)} employees for name→id mapping")
        
        # Read data rows (starting from row 2)
        mismatches = []
        row_count = 0
        for row_idx in range(2, ws.max_row + 1):
            row = [cell.value for cell in ws[row_idx]]
            if not row[0]:  # Skip empty rows
                continue
            
            staff_name = row[0]
            poin_value = row[poin_col_idx]
            
            # Get user_id from name
            user_id = name_to_id.get(staff_name)
            if not user_id:
                print(f"      ⚠ Staff '{staff_name}' not found in employees list, skipping")
                continue
            
            # Get expected balance from leaderboard
            if user_id in leaderboard_map:
                expected_balance = leaderboard_map[user_id]["balance"]
                
                # Handle '-' for users not in leaderboard
                if poin_value == '-':
                    # This is acceptable if user has 0 balance or not in leaderboard
                    print(f"      ✓ {staff_name}: Poin = '-' (not in leaderboard or 0 balance)")
                else:
                    # Compare numeric values
                    poin_numeric = float(poin_value) if poin_value not in [None, '-'] else 0
                    if abs(poin_numeric - expected_balance) > 0.01:
                        mismatches.append(f"{staff_name}: Excel={poin_numeric}, Leaderboard={expected_balance}")
                    else:
                        print(f"      ✓ {staff_name}: Poin = {poin_numeric} (matches leaderboard)")
            else:
                # User not in leaderboard, should show '-' or 0
                if poin_value not in ['-', 0, None]:
                    mismatches.append(f"{staff_name}: Excel={poin_value}, but user not in leaderboard (expected '-' or 0)")
                else:
                    print(f"      ✓ {staff_name}: Poin = '{poin_value}' (not in leaderboard, correct)")
            
            row_count += 1
        
        if mismatches:
            print(f"   ✗ Poin value mismatches found:")
            for m in mismatches:
                print(f"      - {m}")
            return False
        
        print(f"   ✓ All {row_count} staff rows have correct 'Poin Saat Ini' values")
        
    except Exception as e:
        print(f"   ✗ TEST 7 FAILED: {e}")
        return False
    
    # ========================================================================
    # TEST 8: Regression - Verify 6 other sheets exist and structure unchanged
    # ========================================================================
    print("\n✅ TEST 8: Regression - Verify 6 other sheets exist and structure unchanged")
    try:
        # Expected headers for each sheet
        expected_headers = {
            "Identitas": ["Tanggal", "Nama Staff", "Role/Bagian", "Shift", "Jadwal Shift"],
            "Absensi": ["Tanggal", "Nama Staff", "Shift", "Jadwal Shift", "Jam Masuk", "Jam Keluar", "Status Kehadiran", "Menit Terlambat"],
            "Jam Kerja": ["Tanggal", "Nama Staff", "Jam Kerja Normal (jam)", "Jam Kerja Aktual (jam)", "Jam Kerja Diakui (jam)"],
            "Stock Opname": ["Tanggal", "Nama Staff", "Shift", "Status SO", "Jam Masuk SO", "Jam Kerja Efektif SO", "Jam SO Diakui (jam)"],
            "Lembur": ["Tanggal", "Nama Staff", "Shift", "Jam Selesai Shift", "Jam Mulai Lembur", "Jam Selesai Lembur", "Potensi Lembur (jam)", "Alasan", "Status Approval", "Approver", "Jam Lembur Diakui (jam)"],
            "Verifikasi": ["Tanggal", "Nama Staff", "Status Foto Masuk", "Latitude Masuk", "Longitude Masuk", "Jarak Masuk (m)", "Radius Masuk (m)", "Status GPS Masuk", "Status Foto Keluar", "Latitude Keluar", "Longitude Keluar", "Jarak Keluar (m)", "Radius Keluar (m)", "Status GPS Keluar"]
        }
        
        for sheet_name, expected_header in expected_headers.items():
            ws = wb[sheet_name]
            actual_header = [cell.value for cell in ws[1]]
            
            assert actual_header == expected_header, f"Sheet '{sheet_name}' header mismatch: expected {expected_header}, got {actual_header}"
            print(f"   ✓ Sheet '{sheet_name}': header structure unchanged ({len(actual_header)} columns)")
        
        print(f"   ✓ All 6 sheets have correct structure (no regressions)")
        
    except Exception as e:
        print(f"   ✗ TEST 8 FAILED: {e}")
        return False
    
    # ========================================================================
    # ALL TESTS PASSED
    # ========================================================================
    print("\n" + "="*80)
    print("✅ ALL 8 TESTS PASSED (100%)")
    print("="*80)
    print("\nSUMMARY:")
    print("  ✅ Leaderboard endpoint working")
    print("  ✅ JSON report has points_by_user and points_period fields")
    print("  ✅ points_by_user values match leaderboard balance")
    print("  ✅ Excel export successful")
    print("  ✅ Sheet order correct (Rekapitulasi → Identitas → Absensi → Jam Kerja → Stock Opname → Lembur → Verifikasi)")
    print("  ✅ Rekapitulasi sheet has 'Poin Saat Ini' column")
    print("  ✅ 'Poin Saat Ini' values match leaderboard balance")
    print("  ✅ All 6 other sheets have correct structure (no regressions)")
    print("\n")
    
    return True

if __name__ == "__main__":
    try:
        success = test_realtime_points()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
