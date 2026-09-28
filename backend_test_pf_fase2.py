#!/usr/bin/env python3
"""
Backend test for Module Produk Fokus (Fase 2) - Input Penjualan + Dashboard
Test date: 2026-09-26 or later (active period should be 2026-10)
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# Test state
token = None
owner_user = None
staff_a = None
master_limited = None
master_unlimited = None
master_old_period = None
test_penjualan_ids = []
test_master_ids = []

def log(msg):
    print(f"[{datetime.utcnow().isoformat()}] {msg}")

def login_owner():
    global token, owner_user
    log("TEST SETUP: Login as owner")
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": OWNER_USERNAME,
        "password": OWNER_PASSWORD
    })
    assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
    data = resp.json()
    token = data.get("token")
    owner_user = data.get("user")
    assert token, "No token returned"
    assert owner_user, "No user returned"
    assert owner_user.get("role") == "owner", f"Expected owner role, got {owner_user.get('role')}"
    log(f"✅ Owner login successful, user_id={owner_user.get('id')}")
    return token

def headers():
    return {"Authorization": f"Bearer {token}"}

def test_1_periods():
    """Verify GET /api/pf/periods returns active period 2026-10"""
    log("\n=== TEST 1: GET /api/pf/periods ===")
    resp = requests.get(f"{BASE_URL}/api/pf/periods", headers=headers())
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    periods = data.get("periods", [])
    assert len(periods) > 0, "No periods returned"
    first = periods[0]
    log(f"First period: {first}")
    assert first.get("period_key") == "2026-10", f"Expected first period 2026-10, got {first.get('period_key')}"
    log("✅ TEST 1 PASSED: Active period is 2026-10")

def test_2_staff_list():
    """TEST 1: staff-list works"""
    global staff_a
    log("\n=== TEST 2: GET /api/pf/staff-list ===")
    resp = requests.get(f"{BASE_URL}/api/pf/staff-list", headers=headers())
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    items = data.get("items", [])
    assert len(items) > 0, "No staff returned"
    staff_a = items[0]
    log(f"Staff A: {staff_a}")
    assert "id" in staff_a, "Staff missing id"
    assert "name" in staff_a, "Staff missing name"
    assert len(staff_a.keys()) == 2, f"Staff should only have id and name, got {staff_a.keys()}"
    log(f"✅ TEST 2 PASSED: staff-list returns {len(items)} staff, first is {staff_a['name']}")

def test_3_create_masters():
    """Setup: Create test masters"""
    global master_limited, master_unlimited
    log("\n=== TEST 3: Create test masters ===")
    
    # Limited master
    resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers(), json={
        "period_key": "2026-10",
        "kode": "T2-01",
        "nama": "Test 2 Limited",
        "satuan": "pcs",
        "jumlah_type": "limited",
        "jumlah_max": 10,
        "bonus": 5000,
        "keterangan": "test fase 2"
    })
    assert resp.status_code == 200, f"Create limited master failed: {resp.status_code} {resp.text}"
    master_limited = resp.json().get("item")
    test_master_ids.append(master_limited["id"])
    log(f"✅ Created limited master: {master_limited['id']}, kode={master_limited['kode']}, max=10, bonus=5000")
    
    # Unlimited master
    resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers(), json={
        "period_key": "2026-10",
        "kode": "T2-02",
        "nama": "Test 2 Unlimited",
        "satuan": "pcs",
        "jumlah_type": "unlimited",
        "jumlah_max": 0,
        "bonus": 1000
    })
    assert resp.status_code == 200, f"Create unlimited master failed: {resp.status_code} {resp.text}"
    master_unlimited = resp.json().get("item")
    test_master_ids.append(master_unlimited["id"])
    log(f"✅ Created unlimited master: {master_unlimited['id']}, kode={master_unlimited['kode']}, bonus=1000")

def test_4_post_penjualan_happy_path():
    """TEST 2: POST penjualan happy path (owner input for staffA)"""
    log("\n=== TEST 4: POST penjualan happy path (owner input for staffA) ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "staff_id": staff_a["id"],
        "master_id": master_limited["id"],
        "qty": 3
    })
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
    item = resp.json().get("item")
    test_penjualan_ids.append(item["id"])
    assert item["qty"] == 3, f"Expected qty=3, got {item['qty']}"
    assert item["staff_id"] == staff_a["id"], f"Expected staff_id={staff_a['id']}, got {item['staff_id']}"
    assert item["input_by"] == owner_user["id"], f"Expected input_by={owner_user['id']}, got {item['input_by']}"
    assert item["bonus_unit"] == 5000, f"Expected bonus_unit=5000, got {item['bonus_unit']}"
    assert item["period_key"] == "2026-10", f"Expected period_key=2026-10, got {item['period_key']}"
    log(f"✅ TEST 4 PASSED: Posted 3 qty for staffA, item_id={item['id']}")

def test_5_post_penjualan_default_staff():
    """TEST 3: POST penjualan default staff_id (no staff_id in body)"""
    log("\n=== TEST 5: POST penjualan default staff_id ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_unlimited["id"],
        "qty": 5
    })
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
    item = resp.json().get("item")
    test_penjualan_ids.append(item["id"])
    assert item["staff_id"] == owner_user["id"], f"Expected staff_id={owner_user['id']} (fallback), got {item['staff_id']}"
    log(f"✅ TEST 5 PASSED: Default staff_id fallback to owner, item_id={item['id']}")

def test_6_reject_non_active_period():
    """TEST 4: POST reject non-active period"""
    global master_old_period
    log("\n=== TEST 6: POST reject non-active period ===")
    
    # Create master in old period 2026-09
    resp = requests.post(f"{BASE_URL}/api/pf/masters", headers=headers(), json={
        "period_key": "2026-09",
        "kode": "OLD-01",
        "nama": "Old Period Test",
        "satuan": "pcs",
        "jumlah_type": "limited",
        "jumlah_max": 10,
        "bonus": 1000
    })
    assert resp.status_code == 200, f"Create old master failed: {resp.status_code} {resp.text}"
    master_old_period = resp.json().get("item")
    test_master_ids.append(master_old_period["id"])
    log(f"Created old period master: {master_old_period['id']}, period=2026-09")
    
    # Try to post penjualan to old period master
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_old_period["id"],
        "qty": 1
    })
    assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"
    error = resp.json().get("error", "")
    assert "periode aktif" in error.lower(), f"Expected 'periode aktif' in error, got: {error}"
    log(f"✅ TEST 6 PASSED: Rejected old period with 409: {error}")

def test_7_reject_qty_zero():
    """TEST 5: POST reject qty 0"""
    log("\n=== TEST 7: POST reject qty 0 ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_limited["id"],
        "qty": 0
    })
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    error = resp.json().get("error", "")
    assert "bilangan bulat positif" in error.lower(), f"Expected 'bilangan bulat positif' in error, got: {error}"
    log(f"✅ TEST 7 PASSED: Rejected qty=0 with 400: {error}")

def test_8_reject_qty_negative():
    """TEST 6: POST reject qty negative"""
    log("\n=== TEST 8: POST reject qty negative ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_limited["id"],
        "qty": -2
    })
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    error = resp.json().get("error", "")
    assert "bilangan bulat positif" in error.lower() or "positif" in error.lower(), f"Expected 'positif' in error, got: {error}"
    log(f"✅ TEST 8 PASSED: Rejected qty=-2 with 400: {error}")

def test_9_reject_qty_decimal():
    """TEST 7: POST reject qty decimal"""
    log("\n=== TEST 9: POST reject qty decimal ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_limited["id"],
        "qty": 1.5
    })
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    error = resp.json().get("error", "")
    assert "bilangan bulat" in error.lower() or "positif" in error.lower(), f"Expected 'bilangan bulat' in error, got: {error}"
    log(f"✅ TEST 9 PASSED: Rejected qty=1.5 with 400: {error}")

def test_10_limit_check():
    """TEST 8: POST limit check (after 3/10 sold, attempt 8 should fail)"""
    log("\n=== TEST 10: POST limit check ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_limited["id"],
        "qty": 8
    })
    assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"
    error = resp.json().get("error", "")
    assert "sisa" in error.lower() or "kuota" in error.lower(), f"Expected 'sisa' or 'kuota' in error, got: {error}"
    assert "7" in error, f"Expected sisa=7 in error, got: {error}"
    log(f"✅ TEST 10 PASSED: Limit check rejected qty=8 with 409: {error}")

def test_11_fill_to_max():
    """TEST 9: POST fill to max (qty=7, now sold=10, sisa=0)"""
    log("\n=== TEST 11: POST fill to max ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_limited["id"],
        "qty": 7
    })
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
    item = resp.json().get("item")
    test_penjualan_ids.append(item["id"])
    assert item["qty"] == 7, f"Expected qty=7, got {item['qty']}"
    log(f"✅ TEST 11 PASSED: Filled to max, now sold=10, sisa=0, item_id={item['id']}")

def test_12_sold_out():
    """TEST 10: POST after sold out (sisa=0)"""
    log("\n=== TEST 12: POST after sold out ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_limited["id"],
        "qty": 1
    })
    assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"
    error = resp.json().get("error", "")
    assert "habis" in error.lower() or "kuota 0" in error.lower(), f"Expected 'habis' in error, got: {error}"
    log(f"✅ TEST 12 PASSED: Sold out rejected with 409: {error}")

def test_13_unlimited_works():
    """TEST 11: POST unlimited works unlimitedly"""
    log("\n=== TEST 13: POST unlimited works unlimitedly ===")
    resp = requests.post(f"{BASE_URL}/api/pf/penjualan", headers=headers(), json={
        "master_id": master_unlimited["id"],
        "qty": 1000
    })
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
    item = resp.json().get("item")
    test_penjualan_ids.append(item["id"])
    assert item["qty"] == 1000, f"Expected qty=1000, got {item['qty']}"
    log(f"✅ TEST 13 PASSED: Unlimited master accepts qty=1000, item_id={item['id']}")

def test_14_get_penjualan_owner():
    """TEST 12: GET penjualan (owner sees all)"""
    log("\n=== TEST 14: GET penjualan (owner sees all) ===")
    resp = requests.get(f"{BASE_URL}/api/pf/penjualan?period=2026-10", headers=headers())
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    items = data.get("items", [])
    assert len(items) >= 4, f"Expected at least 4 items (3+7+5+1000), got {len(items)}"
    
    # Verify contains items for both staffA and owner
    staff_ids = set(item["staff_id"] for item in items)
    assert staff_a["id"] in staff_ids, f"Expected staffA {staff_a['id']} in items"
    assert owner_user["id"] in staff_ids, f"Expected owner {owner_user['id']} in items"
    log(f"✅ TEST 14 PASSED: Owner sees all {len(items)} penjualan items")

def test_15_dashboard_staff_owner():
    """TEST 13: GET dashboard/staff (owner as self)"""
    log("\n=== TEST 15: GET dashboard/staff (owner as self) ===")
    resp = requests.get(f"{BASE_URL}/api/pf/dashboard/staff?period=2026-10", headers=headers())
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert "total_my_qty" in data, "Missing total_my_qty"
    assert "total_my_bonus" in data, "Missing total_my_bonus"
    assert isinstance(data["total_my_qty"], int), f"total_my_qty should be int, got {type(data['total_my_qty'])}"
    assert isinstance(data["total_my_bonus"], int), f"total_my_bonus should be int, got {type(data['total_my_bonus'])}"
    rows = data.get("rows", [])
    assert len(rows) >= 2, f"Expected at least 2 masters in rows, got {len(rows)}"
    
    # Verify rows contain both masters
    master_ids = set(row["master_id"] for row in rows)
    assert master_limited["id"] in master_ids, f"Expected limited master in rows"
    assert master_unlimited["id"] in master_ids, f"Expected unlimited master in rows"
    
    log(f"✅ TEST 15 PASSED: Dashboard staff for owner, total_my_qty={data['total_my_qty']}, total_my_bonus={data['total_my_bonus']}, rows={len(rows)}")

def test_16_dashboard_staff_for_staffa():
    """TEST 14: GET dashboard/staff for staffA (owner ?staff_id=)"""
    log("\n=== TEST 16: GET dashboard/staff for staffA ===")
    resp = requests.get(f"{BASE_URL}/api/pf/dashboard/staff?period=2026-10&staff_id={staff_a['id']}", headers=headers())
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert data["staff_id"] == staff_a["id"], f"Expected staff_id={staff_a['id']}, got {data['staff_id']}"
    rows = data.get("rows", [])
    
    # Find T2-01 row
    t2_01_row = next((r for r in rows if r["kode"] == "T2-01"), None)
    assert t2_01_row is not None, "T2-01 not found in rows"
    assert t2_01_row["my_qty"] == 3, f"Expected my_qty=3 for T2-01, got {t2_01_row['my_qty']}"
    assert t2_01_row["total_qty"] == 10, f"Expected total_qty=10 for T2-01, got {t2_01_row['total_qty']}"
    
    log(f"✅ TEST 16 PASSED: Dashboard staff for staffA, my_qty=3 for T2-01")

def test_17_dashboard_owner():
    """TEST 15: GET dashboard/owner"""
    log("\n=== TEST 17: GET dashboard/owner ===")
    resp = requests.get(f"{BASE_URL}/api/pf/dashboard/owner?period=2026-10", headers=headers())
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    
    # Verify structure
    assert "grand_qty" in data, "Missing grand_qty"
    assert "grand_bonus" in data, "Missing grand_bonus"
    assert "per_produk" in data, "Missing per_produk"
    assert "per_staff" in data, "Missing per_staff"
    
    # Verify calculations: 3+7 (limited) + 5+1000 (unlimited) = 1015
    expected_qty = 3 + 7 + 5 + 1000
    assert data["grand_qty"] == expected_qty, f"Expected grand_qty={expected_qty}, got {data['grand_qty']}"
    
    # Verify bonus: (3+7)*5000 + (5+1000)*1000 = 50000 + 1005000 = 1055000
    expected_bonus = (3 + 7) * 5000 + (5 + 1000) * 1000
    assert data["grand_bonus"] == expected_bonus, f"Expected grand_bonus={expected_bonus}, got {data['grand_bonus']}"
    
    # Verify per_staff sorted by bonus desc
    per_staff = data["per_staff"]
    assert len(per_staff) >= 2, f"Expected at least 2 staff, got {len(per_staff)}"
    for i in range(len(per_staff) - 1):
        assert per_staff[i]["bonus"] >= per_staff[i+1]["bonus"], f"per_staff not sorted by bonus desc"
    
    log(f"✅ TEST 17 PASSED: Dashboard owner, grand_qty={data['grand_qty']}, grand_bonus={data['grand_bonus']}, per_staff sorted")

def test_18_no_patch_delete():
    """TEST 17: No PATCH/DELETE for penjualan"""
    log("\n=== TEST 18: No PATCH/DELETE for penjualan ===")
    
    # Try PATCH
    if test_penjualan_ids:
        resp = requests.patch(f"{BASE_URL}/api/pf/penjualan/{test_penjualan_ids[0]}", headers=headers(), json={"qty": 999})
        # Should be 404 (endpoint doesn't exist) or 405 (method not allowed)
        assert resp.status_code in [404, 405], f"PATCH should return 404/405, got {resp.status_code}"
        log(f"✅ PATCH /api/pf/penjualan returns {resp.status_code} (endpoint doesn't exist)")
        
        # Try DELETE
        resp = requests.delete(f"{BASE_URL}/api/pf/penjualan/{test_penjualan_ids[0]}", headers=headers())
        assert resp.status_code in [404, 405], f"DELETE should return 404/405, got {resp.status_code}"
        log(f"✅ DELETE /api/pf/penjualan returns {resp.status_code} (endpoint doesn't exist)")
    
    log(f"✅ TEST 18 PASSED: No PATCH/DELETE endpoints for penjualan (immutable)")

def cleanup():
    """Cleanup test data"""
    log("\n=== CLEANUP ===")
    
    # Delete penjualan (via MongoDB since no DELETE endpoint)
    import pymongo
    client = pymongo.MongoClient("mongodb://localhost:27017")
    db = client["cycle_count"]
    
    # Delete penjualan by master_id
    for master_id in test_master_ids:
        result = db.pf_penjualan.delete_many({"master_id": master_id})
        log(f"Deleted {result.deleted_count} penjualan for master {master_id}")
    
    # Delete masters
    for master_id in test_master_ids:
        resp = requests.delete(f"{BASE_URL}/api/pf/masters/{master_id}", headers=headers())
        if resp.status_code == 200:
            log(f"✅ Deleted master {master_id}")
        else:
            log(f"⚠️ Failed to delete master {master_id}: {resp.status_code}")
    
    log("✅ CLEANUP COMPLETE")

def main():
    try:
        login_owner()
        test_1_periods()
        test_2_staff_list()
        test_3_create_masters()
        test_4_post_penjualan_happy_path()
        test_5_post_penjualan_default_staff()
        test_6_reject_non_active_period()
        test_7_reject_qty_zero()
        test_8_reject_qty_negative()
        test_9_reject_qty_decimal()
        test_10_limit_check()
        test_11_fill_to_max()
        test_12_sold_out()
        test_13_unlimited_works()
        test_14_get_penjualan_owner()
        test_15_dashboard_staff_owner()
        test_16_dashboard_staff_for_staffa()
        test_17_dashboard_owner()
        test_18_no_patch_delete()
        
        log("\n" + "="*80)
        log("✅ ALL 18 TESTS PASSED (100%)")
        log("="*80)
        
    except AssertionError as e:
        log(f"\n❌ TEST FAILED: {e}")
        raise
    except Exception as e:
        log(f"\n❌ UNEXPECTED ERROR: {e}")
        raise
    finally:
        cleanup()

if __name__ == "__main__":
    main()
