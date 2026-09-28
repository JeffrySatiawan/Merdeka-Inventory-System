#!/usr/bin/env python3
"""
Backend Test: Module Produk Fokus (Fase 1: Master + Pengajuan)
Test all /api/pf/* endpoints with comprehensive scenarios.
"""

import requests
import json
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test period (isolated, future period to avoid touching real data)
TEST_PERIOD = "9999-12"
TEST_PERIOD_SOURCE = "9999-11"  # For copy-previous test

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def cleanup_test_data():
    """Delete all test data from pf_* collections"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        
        # Delete test period data
        for collection in ['pf_masters', 'pf_pengajuan', 'pf_penjualan', 'pf_rekonsiliasi']:
            result = db[collection].delete_many({'period_key': {'$in': [TEST_PERIOD, TEST_PERIOD_SOURCE]}})
            if result.deleted_count > 0:
                log(f"✓ Cleaned up {result.deleted_count} docs from {collection}")
        
        client.close()
        return True
    except Exception as e:
        log(f"✗ Cleanup error: {e}")
        return False

def insert_fake_penjualan(master_id):
    """Insert fake penjualan doc to test delete blocking"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        
        doc = {
            'id': 'fake-penjualan-001',
            'master_id': master_id,
            'period_key': TEST_PERIOD,
            'date': datetime.utcnow(),
            'jumlah': 10,
            'createdAt': datetime.utcnow()
        }
        db['pf_penjualan'].insert_one(doc)
        client.close()
        log(f"✓ Inserted fake penjualan for master {master_id}")
        return True
    except Exception as e:
        log(f"✗ Insert fake penjualan error: {e}")
        return False

def delete_fake_penjualan():
    """Delete fake penjualan doc"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        result = db['pf_penjualan'].delete_many({'id': 'fake-penjualan-001'})
        client.close()
        log(f"✓ Deleted fake penjualan ({result.deleted_count} docs)")
        return True
    except Exception as e:
        log(f"✗ Delete fake penjualan error: {e}")
        return False

def main():
    log("=" * 80)
    log("BACKEND TEST: Module Produk Fokus (Fase 1)")
    log("=" * 80)
    
    # Cleanup before starting
    log("\n[SETUP] Cleaning up test data...")
    cleanup_test_data()
    
    owner_token = None
    staff_token = None
    staff_user_id = None
    master1_id = None
    master2_id = None
    pengajuan1_id = None
    pengajuan2_id = None
    pengajuan3_id = None
    
    tests_passed = 0
    tests_failed = 0
    
    # ========================================================================
    # TEST 1: Login as owner
    # ========================================================================
    log("\n[TEST 1] Login as owner (owner/owner123)")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": "owner",
            "password": "owner123"
        }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            owner_token = data.get('token')
            log(f"✅ TEST 1 PASSED: Owner login successful, token: {owner_token[:20]}...")
            tests_passed += 1
        else:
            log(f"❌ TEST 1 FAILED: Login failed with status {resp.status_code}: {resp.text}")
            tests_failed += 1
            return
    except Exception as e:
        log(f"❌ TEST 1 FAILED: Exception: {e}")
        tests_failed += 1
        return
    
    headers = {"Authorization": f"Bearer {owner_token}"}
    
    # ========================================================================
    # TEST 2: GET /api/pf/periods - verify array with periods >= 2026-09
    # ========================================================================
    log("\n[TEST 2] GET /api/pf/periods - verify periods array")
    try:
        resp = requests.get(f"{BASE_URL}/api/pf/periods", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            periods = data.get('periods', [])
            first_period_key = data.get('first_period_key')
            
            # Verify first_period_key
            if first_period_key != '2026-09':
                log(f"❌ TEST 2 FAILED: first_period_key is {first_period_key}, expected 2026-09")
                tests_failed += 1
            # Verify periods array
            elif not isinstance(periods, list):
                log(f"❌ TEST 2 FAILED: periods is not an array")
                tests_failed += 1
            # Verify all periods >= 2026-09
            elif any(p.get('period_key', '') < '2026-09' for p in periods):
                log(f"❌ TEST 2 FAILED: Found period < 2026-09")
                tests_failed += 1
            # Verify sorted descending
            elif periods and periods != sorted(periods, key=lambda x: x.get('period_key', ''), reverse=True):
                log(f"❌ TEST 2 FAILED: Periods not sorted descending")
                tests_failed += 1
            else:
                log(f"✅ TEST 2 PASSED: periods array has {len(periods)} items, first_period_key=2026-09, all >= 2026-09, sorted desc")
                tests_passed += 1
        else:
            log(f"❌ TEST 2 FAILED: Status {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 2 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 3: Reject invalid period (< 2026-09) - test with 2026-08
    # ========================================================================
    log("\n[TEST 3] POST /api/pf/masters with period_key=2026-08 (before first) - expect 400")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": "2026-08",
            "kode": "TEST001",
            "nama": "Test Product",
            "satuan": "pcs",
            "jumlah_type": "limited",
            "jumlah_max": 100,
            "bonus": 5000
        }, timeout=30)
        
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'sebelum periode pertama' in error_msg.lower() or '2026-09' in error_msg:
                log(f"✅ TEST 3 PASSED: Rejected 2026-08 with error: {error_msg}")
                tests_passed += 1
            else:
                log(f"❌ TEST 3 FAILED: Wrong error message: {error_msg}")
                tests_failed += 1
        else:
            log(f"❌ TEST 3 FAILED: Expected 400, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 3 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 4: Reject invalid period_key format
    # ========================================================================
    log("\n[TEST 4] POST /api/pf/masters with period_key='invalid' - expect 400")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": "invalid",
            "kode": "TEST001",
            "nama": "Test Product"
        }, timeout=30)
        
        if resp.status_code == 400:
            log(f"✅ TEST 4 PASSED: Rejected invalid period_key format")
            tests_passed += 1
        else:
            log(f"❌ TEST 4 FAILED: Expected 400, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 4 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 5: Missing fields validation
    # ========================================================================
    log("\n[TEST 5] POST /api/pf/masters with missing kode/nama - expect 400")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD
        }, timeout=30)
        
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'kode' in error_msg.lower() or 'nama' in error_msg.lower() or 'wajib' in error_msg.lower():
                log(f"✅ TEST 5 PASSED: Rejected missing fields with error: {error_msg}")
                tests_passed += 1
            else:
                log(f"❌ TEST 5 FAILED: Wrong error message: {error_msg}")
                tests_failed += 1
        else:
            log(f"❌ TEST 5 FAILED: Expected 400, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 5 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 6: Create master 1 (limited)
    # ========================================================================
    log("\n[TEST 6] POST /api/pf/masters - create master 1 (limited)")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "SK001",
            "nama": "Skincare Basic",
            "satuan": "pcs",
            "jumlah_type": "limited",
            "jumlah_max": 100,
            "bonus": 5000,
            "keterangan": "Fokus utama"
        }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            item = data.get('item', {})
            master1_id = item.get('id')
            
            # Verify fields
            if not master1_id:
                log(f"❌ TEST 6 FAILED: No id in response")
                tests_failed += 1
            elif item.get('kode') != 'SK001':
                log(f"❌ TEST 6 FAILED: kode mismatch")
                tests_failed += 1
            elif item.get('nama') != 'Skincare Basic':
                log(f"❌ TEST 6 FAILED: nama mismatch")
                tests_failed += 1
            elif item.get('jumlah_type') != 'limited':
                log(f"❌ TEST 6 FAILED: jumlah_type mismatch")
                tests_failed += 1
            elif item.get('jumlah_max') != 100:
                log(f"❌ TEST 6 FAILED: jumlah_max mismatch")
                tests_failed += 1
            elif item.get('bonus') != 5000:
                log(f"❌ TEST 6 FAILED: bonus mismatch")
                tests_failed += 1
            else:
                log(f"✅ TEST 6 PASSED: Created master 1 (limited), id={master1_id}")
                tests_passed += 1
        else:
            log(f"❌ TEST 6 FAILED: Status {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 6 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 7: Duplicate kode rejection
    # ========================================================================
    log("\n[TEST 7] POST /api/pf/masters with duplicate kode=SK001 - expect 409")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "SK001",
            "nama": "Duplicate Product",
            "satuan": "pcs",
            "jumlah_type": "limited",
            "jumlah_max": 50,
            "bonus": 1000
        }, timeout=30)
        
        if resp.status_code == 409:
            error_msg = resp.json().get('error', '')
            if 'sudah ada' in error_msg.lower():
                log(f"✅ TEST 7 PASSED: Rejected duplicate kode with 409: {error_msg}")
                tests_passed += 1
            else:
                log(f"❌ TEST 7 FAILED: Wrong error message: {error_msg}")
                tests_failed += 1
        else:
            log(f"❌ TEST 7 FAILED: Expected 409, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 7 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 8: Create master 2 (unlimited)
    # ========================================================================
    log("\n[TEST 8] POST /api/pf/masters - create master 2 (unlimited)")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "BL001",
            "nama": "Body Lotion",
            "satuan": "pcs",
            "jumlah_type": "unlimited",
            "jumlah_max": 0,
            "bonus": 2000
        }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            item = data.get('item', {})
            master2_id = item.get('id')
            
            # Verify fields
            if not master2_id:
                log(f"❌ TEST 8 FAILED: No id in response")
                tests_failed += 1
            elif item.get('jumlah_type') != 'unlimited':
                log(f"❌ TEST 8 FAILED: jumlah_type mismatch")
                tests_failed += 1
            elif item.get('jumlah_max') is not None:
                log(f"❌ TEST 8 FAILED: jumlah_max should be null for unlimited, got {item.get('jumlah_max')}")
                tests_failed += 1
            else:
                log(f"✅ TEST 8 PASSED: Created master 2 (unlimited), id={master2_id}, jumlah_max=null")
                tests_passed += 1
        else:
            log(f"❌ TEST 8 FAILED: Status {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 8 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 9: Limited must have jumlah_max > 0
    # ========================================================================
    log("\n[TEST 9] POST /api/pf/masters with jumlah_type=limited, jumlah_max=0 - expect 400")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "TEST002",
            "nama": "Test Product",
            "satuan": "pcs",
            "jumlah_type": "limited",
            "jumlah_max": 0,
            "bonus": 1000
        }, timeout=30)
        
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'jumlah' in error_msg.lower() and ('> 0' in error_msg or 'terbatas' in error_msg.lower()):
                log(f"✅ TEST 9 PASSED: Rejected limited with jumlah_max=0: {error_msg}")
                tests_passed += 1
            else:
                log(f"❌ TEST 9 FAILED: Wrong error message: {error_msg}")
                tests_failed += 1
        else:
            log(f"❌ TEST 9 FAILED: Expected 400, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 9 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 10: GET masters
    # ========================================================================
    log("\n[TEST 10] GET /api/pf/masters?period={TEST_PERIOD} - verify 2 items")
    try:
        resp = requests.get(f"{BASE_URL}/api/pf/masters?period={TEST_PERIOD}", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            items = data.get('items', [])
            
            if len(items) != 2:
                log(f"❌ TEST 10 FAILED: Expected 2 items, got {len(items)}")
                tests_failed += 1
            elif items[0].get('kode') != 'SK001':
                log(f"❌ TEST 10 FAILED: First item kode mismatch")
                tests_failed += 1
            elif items[1].get('kode') != 'BL001':
                log(f"❌ TEST 10 FAILED: Second item kode mismatch")
                tests_failed += 1
            else:
                log(f"✅ TEST 10 PASSED: GET masters returned 2 items in creation order")
                tests_passed += 1
        else:
            log(f"❌ TEST 10 FAILED: Status {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 10 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 11: PATCH master
    # ========================================================================
    log("\n[TEST 11] PATCH /api/pf/masters/{master1_id} - update bonus and keterangan")
    try:
        if not master1_id:
            log(f"❌ TEST 11 FAILED: master1_id not available")
            tests_failed += 1
        else:
            resp = requests.patch(f"{BASE_URL}/api/pf/masters/{master1_id}", headers=headers, json={
                "bonus": 7500,
                "keterangan": "Updated"
            }, timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                item = data.get('item', {})
                
                if item.get('bonus') != 7500:
                    log(f"❌ TEST 11 FAILED: bonus not updated")
                    tests_failed += 1
                elif item.get('keterangan') != 'Updated':
                    log(f"❌ TEST 11 FAILED: keterangan not updated")
                    tests_failed += 1
                elif item.get('kode') != 'SK001':
                    log(f"❌ TEST 11 FAILED: kode changed unexpectedly")
                    tests_failed += 1
                elif item.get('nama') != 'Skincare Basic':
                    log(f"❌ TEST 11 FAILED: nama changed unexpectedly")
                    tests_failed += 1
                else:
                    log(f"✅ TEST 11 PASSED: PATCH master updated bonus=7500, keterangan=Updated, other fields preserved")
                    tests_passed += 1
            else:
                log(f"❌ TEST 11 FAILED: Status {resp.status_code}: {resp.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 11 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 12: PATCH kode conflict
    # ========================================================================
    log("\n[TEST 12] PATCH /api/pf/masters/{master2_id} with kode=SK001 (conflict) - expect 409")
    try:
        if not master2_id:
            log(f"❌ TEST 12 FAILED: master2_id not available")
            tests_failed += 1
        else:
            resp = requests.patch(f"{BASE_URL}/api/pf/masters/{master2_id}", headers=headers, json={
                "kode": "SK001"
            }, timeout=30)
            
            if resp.status_code == 409:
                error_msg = resp.json().get('error', '')
                if 'sudah ada' in error_msg.lower():
                    log(f"✅ TEST 12 PASSED: PATCH rejected kode conflict with 409: {error_msg}")
                    tests_passed += 1
                else:
                    log(f"❌ TEST 12 FAILED: Wrong error message: {error_msg}")
                    tests_failed += 1
            else:
                log(f"❌ TEST 12 FAILED: Expected 409, got {resp.status_code}: {resp.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 12 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 13: DELETE master (no penjualan)
    # ========================================================================
    log("\n[TEST 13] DELETE /api/pf/masters/{master2_id} (no penjualan) - expect 200")
    try:
        if not master2_id:
            log(f"❌ TEST 13 FAILED: master2_id not available")
            tests_failed += 1
        else:
            resp = requests.delete(f"{BASE_URL}/api/pf/masters/{master2_id}", headers=headers, timeout=30)
            
            if resp.status_code == 200:
                # Verify list count = 1
                resp2 = requests.get(f"{BASE_URL}/api/pf/masters?period={TEST_PERIOD}", headers=headers, timeout=30)
                if resp2.status_code == 200:
                    items = resp2.json().get('items', [])
                    if len(items) == 1:
                        log(f"✅ TEST 13 PASSED: DELETE master successful, list count = 1")
                        tests_passed += 1
                    else:
                        log(f"❌ TEST 13 FAILED: Expected 1 item after delete, got {len(items)}")
                        tests_failed += 1
                else:
                    log(f"❌ TEST 13 FAILED: GET after delete failed")
                    tests_failed += 1
            else:
                log(f"❌ TEST 13 FAILED: Status {resp.status_code}: {resp.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 13 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 14: DELETE master (with penjualan) - expect 409
    # ========================================================================
    log("\n[TEST 14] DELETE /api/pf/masters/{master1_id} with penjualan - expect 409")
    try:
        if not master1_id:
            log(f"❌ TEST 14 FAILED: master1_id not available")
            tests_failed += 1
        else:
            # Insert fake penjualan
            if not insert_fake_penjualan(master1_id):
                log(f"❌ TEST 14 FAILED: Could not insert fake penjualan")
                tests_failed += 1
            else:
                resp = requests.delete(f"{BASE_URL}/api/pf/masters/{master1_id}", headers=headers, timeout=30)
                
                if resp.status_code == 409:
                    error_msg = resp.json().get('error', '')
                    if 'sudah dipakai' in error_msg.lower() or 'penjualan' in error_msg.lower():
                        log(f"✅ TEST 14 PASSED: DELETE blocked with 409: {error_msg}")
                        tests_passed += 1
                    else:
                        log(f"❌ TEST 14 FAILED: Wrong error message: {error_msg}")
                        tests_failed += 1
                else:
                    log(f"❌ TEST 14 FAILED: Expected 409, got {resp.status_code}: {resp.text}")
                    tests_failed += 1
                
                # Cleanup fake penjualan
                delete_fake_penjualan()
                
                # Now delete the master successfully
                resp2 = requests.delete(f"{BASE_URL}/api/pf/masters/{master1_id}", headers=headers, timeout=30)
                if resp2.status_code == 200:
                    log(f"✓ Cleaned up master1 after removing fake penjualan")
    except Exception as e:
        log(f"❌ TEST 14 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 15: POST pengajuan (owner user)
    # ========================================================================
    log("\n[TEST 15] POST /api/pf/pengajuan (owner user) - expect 200")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "NEW01",
            "nama": "New Product",
            "jumlah": 20,
            "satuan": "pcs"
        }, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            item = data.get('item', {})
            pengajuan1_id = item.get('id')
            
            if not pengajuan1_id:
                log(f"❌ TEST 15 FAILED: No id in response")
                tests_failed += 1
            elif item.get('status') != 'menunggu':
                log(f"❌ TEST 15 FAILED: status should be 'menunggu', got {item.get('status')}")
                tests_failed += 1
            elif not item.get('submitted_by'):
                log(f"❌ TEST 15 FAILED: submitted_by not set")
                tests_failed += 1
            else:
                log(f"✅ TEST 15 PASSED: POST pengajuan successful, id={pengajuan1_id}, status=menunggu")
                tests_passed += 1
        else:
            log(f"❌ TEST 15 FAILED: Status {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 15 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 16: POST pengajuan invalid jumlah
    # ========================================================================
    log("\n[TEST 16] POST /api/pf/pengajuan with jumlah=0 - expect 400")
    try:
        resp = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "TEST003",
            "nama": "Test Product",
            "jumlah": 0,
            "satuan": "pcs"
        }, timeout=30)
        
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'jumlah' in error_msg.lower() and '> 0' in error_msg:
                log(f"✅ TEST 16 PASSED: Rejected jumlah=0 with 400: {error_msg}")
                tests_passed += 1
            else:
                log(f"❌ TEST 16 FAILED: Wrong error message: {error_msg}")
                tests_failed += 1
        else:
            log(f"❌ TEST 16 FAILED: Expected 400, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 16 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 17: GET pengajuan
    # ========================================================================
    log("\n[TEST 17] GET /api/pf/pengajuan?period={TEST_PERIOD} - verify 1 item")
    try:
        resp = requests.get(f"{BASE_URL}/api/pf/pengajuan?period={TEST_PERIOD}", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            items = data.get('items', [])
            
            if len(items) != 1:
                log(f"❌ TEST 17 FAILED: Expected 1 item, got {len(items)}")
                tests_failed += 1
            elif items[0].get('kode') != 'NEW01':
                log(f"❌ TEST 17 FAILED: kode mismatch")
                tests_failed += 1
            else:
                log(f"✅ TEST 17 PASSED: GET pengajuan returned 1 item")
                tests_passed += 1
        else:
            log(f"❌ TEST 17 FAILED: Status {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 17 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 18: PATCH pengajuan accept - auto-create master
    # ========================================================================
    log("\n[TEST 18] PATCH /api/pf/pengajuan/{pengajuan1_id} accept - auto-create master")
    try:
        if not pengajuan1_id:
            log(f"❌ TEST 18 FAILED: pengajuan1_id not available")
            tests_failed += 1
        else:
            resp = requests.patch(f"{BASE_URL}/api/pf/pengajuan/{pengajuan1_id}", headers=headers, json={
                "action": "accept"
            }, timeout=30)
            
            if resp.status_code == 200:
                data = resp.json()
                item = data.get('item', {})
                master = data.get('master')
                
                if item.get('status') != 'diterima':
                    log(f"❌ TEST 18 FAILED: status should be 'diterima', got {item.get('status')}")
                    tests_failed += 1
                elif not item.get('reviewed_by'):
                    log(f"❌ TEST 18 FAILED: reviewed_by not set")
                    tests_failed += 1
                elif not item.get('reviewed_at'):
                    log(f"❌ TEST 18 FAILED: reviewed_at not set")
                    tests_failed += 1
                elif not master:
                    log(f"❌ TEST 18 FAILED: master not created")
                    tests_failed += 1
                elif master.get('kode') != 'NEW01':
                    log(f"❌ TEST 18 FAILED: master kode mismatch")
                    tests_failed += 1
                else:
                    log(f"✅ TEST 18 PASSED: PATCH accept successful, status=diterima, master auto-created with kode=NEW01")
                    tests_passed += 1
            else:
                log(f"❌ TEST 18 FAILED: Status {resp.status_code}: {resp.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 18 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 19: PATCH pengajuan already reviewed - expect 409
    # ========================================================================
    log("\n[TEST 19] PATCH /api/pf/pengajuan/{pengajuan1_id} again - expect 409")
    try:
        if not pengajuan1_id:
            log(f"❌ TEST 19 FAILED: pengajuan1_id not available")
            tests_failed += 1
        else:
            resp = requests.patch(f"{BASE_URL}/api/pf/pengajuan/{pengajuan1_id}", headers=headers, json={
                "action": "accept"
            }, timeout=30)
            
            if resp.status_code == 409:
                error_msg = resp.json().get('error', '')
                if 'sudah' in error_msg.lower():
                    log(f"✅ TEST 19 PASSED: PATCH rejected already reviewed with 409: {error_msg}")
                    tests_passed += 1
                else:
                    log(f"❌ TEST 19 FAILED: Wrong error message: {error_msg}")
                    tests_failed += 1
            else:
                log(f"❌ TEST 19 FAILED: Expected 409, got {resp.status_code}: {resp.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 19 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 20: PATCH pengajuan accept when master kode exists
    # ========================================================================
    log("\n[TEST 20] PATCH pengajuan accept when master kode exists - skip creation")
    try:
        # Create new pengajuan with same kode NEW01
        resp = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "NEW01",
            "nama": "Another New Product",
            "jumlah": 30,
            "satuan": "pcs"
        }, timeout=30)
        
        if resp.status_code != 200:
            log(f"❌ TEST 20 FAILED: Could not create second pengajuan")
            tests_failed += 1
        else:
            pengajuan2_id = resp.json().get('item', {}).get('id')
            
            # Accept it
            resp2 = requests.patch(f"{BASE_URL}/api/pf/pengajuan/{pengajuan2_id}", headers=headers, json={
                "action": "accept"
            }, timeout=30)
            
            if resp2.status_code == 200:
                data = resp2.json()
                item = data.get('item', {})
                master = data.get('master')
                
                if item.get('status') != 'diterima':
                    log(f"❌ TEST 20 FAILED: status should be 'diterima'")
                    tests_failed += 1
                elif master is not None:
                    log(f"❌ TEST 20 FAILED: master should be null (skip creation)")
                    tests_failed += 1
                elif not item.get('created_master_id'):
                    log(f"❌ TEST 20 FAILED: created_master_id should point to existing master")
                    tests_failed += 1
                else:
                    log(f"✅ TEST 20 PASSED: PATCH accept skipped master creation (kode exists), master=null, created_master_id set")
                    tests_passed += 1
            else:
                log(f"❌ TEST 20 FAILED: Status {resp2.status_code}: {resp2.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 20 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 21: PATCH pengajuan reject
    # ========================================================================
    log("\n[TEST 21] PATCH pengajuan reject")
    try:
        # Create new pengajuan
        resp = requests.post(f"{BASE_URL}/api/pf/pengajuan", headers=headers, json={
            "period_key": TEST_PERIOD,
            "kode": "REJ01",
            "nama": "Rejected Product",
            "jumlah": 10,
            "satuan": "pcs"
        }, timeout=30)
        
        if resp.status_code != 200:
            log(f"❌ TEST 21 FAILED: Could not create pengajuan")
            tests_failed += 1
        else:
            pengajuan3_id = resp.json().get('item', {}).get('id')
            
            # Reject it
            resp2 = requests.patch(f"{BASE_URL}/api/pf/pengajuan/{pengajuan3_id}", headers=headers, json={
                "action": "reject",
                "review_note": "tidak sesuai"
            }, timeout=30)
            
            if resp2.status_code == 200:
                data = resp2.json()
                item = data.get('item', {})
                
                if item.get('status') != 'ditolak':
                    log(f"❌ TEST 21 FAILED: status should be 'ditolak', got {item.get('status')}")
                    tests_failed += 1
                elif item.get('review_note') != 'tidak sesuai':
                    log(f"❌ TEST 21 FAILED: review_note mismatch")
                    tests_failed += 1
                else:
                    log(f"✅ TEST 21 PASSED: PATCH reject successful, status=ditolak, review_note saved")
                    tests_passed += 1
            else:
                log(f"❌ TEST 21 FAILED: Status {resp2.status_code}: {resp2.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 21 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 22: DELETE pengajuan (owner)
    # ========================================================================
    log("\n[TEST 22] DELETE /api/pf/pengajuan/{pengajuan3_id} (owner) - expect 200")
    try:
        if not pengajuan3_id:
            log(f"❌ TEST 22 FAILED: pengajuan3_id not available")
            tests_failed += 1
        else:
            resp = requests.delete(f"{BASE_URL}/api/pf/pengajuan/{pengajuan3_id}", headers=headers, timeout=30)
            
            if resp.status_code == 200:
                log(f"✅ TEST 22 PASSED: DELETE pengajuan successful")
                tests_passed += 1
            else:
                log(f"❌ TEST 22 FAILED: Status {resp.status_code}: {resp.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 22 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 23: Copy-previous
    # ========================================================================
    log("\n[TEST 23] POST /api/pf/masters/copy-previous - copy from 9999-11 to 9999-12")
    try:
        # First, create 2 masters in source period 9999-11
        resp1 = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD_SOURCE,
            "kode": "SRC01",
            "nama": "Source Product 1",
            "satuan": "pcs",
            "jumlah_type": "limited",
            "jumlah_max": 50,
            "bonus": 3000
        }, timeout=30)
        
        resp2 = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers, json={
            "period_key": TEST_PERIOD_SOURCE,
            "kode": "SRC02",
            "nama": "Source Product 2",
            "satuan": "pcs",
            "jumlah_type": "unlimited",
            "bonus": 1000
        }, timeout=30)
        
        if resp1.status_code != 200 or resp2.status_code != 200:
            log(f"❌ TEST 23 FAILED: Could not create source masters")
            tests_failed += 1
        else:
            # Copy to target period
            resp3 = requests.post(f"{BASE_URL}/api/pf/masters/copy-previous", headers=headers, json={
                "period_key": TEST_PERIOD
            }, timeout=30)
            
            if resp3.status_code == 200:
                data = resp3.json()
                copied = data.get('copied', 0)
                skipped = data.get('skipped', 0)
                
                # Note: NEW01 already exists in TEST_PERIOD from previous tests
                # So we expect copied=2 (SRC01, SRC02), skipped=0 (NEW01 is not in source period)
                if copied != 2:
                    log(f"❌ TEST 23 FAILED: Expected copied=2, got {copied}")
                    tests_failed += 1
                elif skipped != 0:
                    log(f"❌ TEST 23 FAILED: Expected skipped=0, got {skipped}")
                    tests_failed += 1
                else:
                    # Verify masters in target period
                    resp4 = requests.get(f"{BASE_URL}/api/pf/masters?period={TEST_PERIOD}", headers=headers, timeout=30)
                    if resp4.status_code == 200:
                        items = resp4.json().get('items', [])
                        # Should have NEW01 (from pengajuan accept) + SRC01 + SRC02 = 3 items
                        if len(items) < 2:
                            log(f"❌ TEST 23 FAILED: Expected at least 2 items in target period, got {len(items)}")
                            tests_failed += 1
                        else:
                            # Check if SRC01 and SRC02 exist
                            kodes = [item.get('kode') for item in items]
                            if 'SRC01' not in kodes or 'SRC02' not in kodes:
                                log(f"❌ TEST 23 FAILED: SRC01 or SRC02 not found in target period")
                                tests_failed += 1
                            else:
                                log(f"✅ TEST 23 PASSED: Copy-previous successful, copied=2, skipped=0, items in target={len(items)}")
                                tests_passed += 1
                    else:
                        log(f"❌ TEST 23 FAILED: GET after copy failed")
                        tests_failed += 1
            else:
                log(f"❌ TEST 23 FAILED: Status {resp3.status_code}: {resp3.text}")
                tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 23 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 24: Router guard - no token
    # ========================================================================
    log("\n[TEST 24] GET /api/pf/periods without token - expect 401")
    try:
        resp = requests.get(f"{BASE_URL}/api/pf/periods", timeout=30)
        
        if resp.status_code == 401:
            log(f"✅ TEST 24 PASSED: No token rejected with 401")
            tests_passed += 1
        else:
            log(f"❌ TEST 24 FAILED: Expected 401, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 24 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # TEST 25: Router guard - invalid token
    # ========================================================================
    log("\n[TEST 25] GET /api/pf/periods with invalid token - expect 401")
    try:
        resp = requests.get(f"{BASE_URL}/api/pf/periods", headers={"Authorization": "Bearer invalid-token-12345"}, timeout=30)
        
        if resp.status_code == 401:
            log(f"✅ TEST 25 PASSED: Invalid token rejected with 401")
            tests_passed += 1
        else:
            log(f"❌ TEST 25 FAILED: Expected 401, got {resp.status_code}: {resp.text}")
            tests_failed += 1
    except Exception as e:
        log(f"❌ TEST 25 FAILED: Exception: {e}")
        tests_failed += 1
    
    # ========================================================================
    # CLEANUP
    # ========================================================================
    log("\n[CLEANUP] Deleting all test data from pf_* collections...")
    cleanup_test_data()
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    log(f"✅ PASSED: {tests_passed}")
    log(f"❌ FAILED: {tests_failed}")
    log(f"TOTAL: {tests_passed + tests_failed}")
    log(f"SUCCESS RATE: {tests_passed / (tests_passed + tests_failed) * 100:.1f}%")
    log("=" * 80)
    
    if tests_failed == 0:
        log("\n🎉 ALL TESTS PASSED! Module Produk Fokus (Fase 1) is FULLY WORKING.")
    else:
        log(f"\n⚠️  {tests_failed} test(s) failed. Please review the failures above.")

if __name__ == "__main__":
    main()
