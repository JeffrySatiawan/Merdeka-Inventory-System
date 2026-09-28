#!/usr/bin/env python3
"""
Backend Test: Module Produk Fokus (Fase 3: Rekonsiliasi POS + Histori)
Test all rekonsiliasi and histori endpoints with comprehensive scenarios.
"""

import requests
import json
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
HEADERS = {"Content-Type": "application/json"}

# Test state
token = None
master1_id = None
master2_id = None
staff1_id = None
staff2_id = None
staff3_id = None
staff1_name = None
staff2_name = None
staff3_name = None

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login():
    """TEST 1: Login as owner"""
    global token
    log("TEST 1: Login as owner")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"}, headers=HEADERS)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data, "No token in response"
    token = data["token"]
    log(f"✅ Login successful, token: {token[:20]}...")
    return True

def test_get_staff_list():
    """TEST 2: Get staff list and pick 3 staff"""
    global staff1_id, staff2_id, staff3_id, staff1_name, staff2_name, staff3_name
    log("TEST 2: Get staff list")
    r = requests.get(f"{BASE_URL}/api/pf/staff-list", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET staff-list failed: {r.status_code} {r.text}"
    data = r.json()
    assert "items" in data, "No items in response"
    assert len(data["items"]) >= 3, f"Need at least 3 staff, got {len(data['items'])}"
    staff1_id = data["items"][0]["id"]
    staff1_name = data["items"][0]["name"]
    staff2_id = data["items"][1]["id"]
    staff2_name = data["items"][1]["name"]
    staff3_id = data["items"][2]["id"]
    staff3_name = data["items"][2]["name"]
    log(f"✅ Got 3 staff: {staff1_name}, {staff2_name}, {staff3_name}")
    return True

def test_create_master():
    """TEST 3: Create test master"""
    global master1_id
    log("TEST 3: Create test master REK-01")
    body = {
        "period_key": "2026-10",
        "kode": "REK-01",
        "nama": "Rekon Test A",
        "satuan": "pcs",
        "jumlah_type": "limited",
        "jumlah_max": 100,
        "bonus": 5000
    }
    r = requests.post(f"{BASE_URL}/api/pf/masters", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"POST master failed: {r.status_code} {r.text}"
    data = r.json()
    assert "item" in data, "No item in response"
    master1_id = data["item"]["id"]
    log(f"✅ Master created: {master1_id}, kode={data['item']['kode']}, bonus={data['item']['bonus']}")
    return True

def test_post_penjualan():
    """TEST 4: POST penjualan for 3 staff (MIS total = 45)"""
    log("TEST 4: POST penjualan - staff1=20, staff2=15, staff3=10 (MIS total=45)")
    
    # Staff 1: qty=20
    r1 = requests.post(f"{BASE_URL}/api/pf/penjualan", json={
        "staff_id": staff1_id,
        "master_id": master1_id,
        "qty": 20
    }, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r1.status_code == 200, f"POST penjualan staff1 failed: {r1.status_code} {r1.text}"
    
    # Staff 2: qty=15
    r2 = requests.post(f"{BASE_URL}/api/pf/penjualan", json={
        "staff_id": staff2_id,
        "master_id": master1_id,
        "qty": 15
    }, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"POST penjualan staff2 failed: {r2.status_code} {r2.text}"
    
    # Staff 3: qty=10
    r3 = requests.post(f"{BASE_URL}/api/pf/penjualan", json={
        "staff_id": staff3_id,
        "master_id": master1_id,
        "qty": 10
    }, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r3.status_code == 200, f"POST penjualan staff3 failed: {r3.status_code} {r3.text}"
    
    log(f"✅ Posted 3 penjualan: {staff1_name}=20, {staff2_name}=15, {staff3_name}=10 (total=45)")
    return True

def test_get_rekonsiliasi_before_put():
    """TEST 5: GET rekonsiliasi before PUT (should show MIS total=45, no adjustment)"""
    log("TEST 5: GET rekonsiliasi before PUT")
    r = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET rekonsiliasi failed: {r.status_code} {r.text}"
    data = r.json()
    assert "items" in data, "No items in response"
    assert len(data["items"]) >= 1, "Should have at least 1 master"
    
    # Find master1
    item = next((x for x in data["items"] if x["master_id"] == master1_id), None)
    assert item is not None, f"Master {master1_id} not found in rekonsiliasi"
    
    assert item["mis_total"] == 45, f"Expected mis_total=45, got {item['mis_total']}"
    assert item["pos_total"] is None, f"Expected pos_total=None, got {item['pos_total']}"
    assert item["adjustment_pct"] == 1, f"Expected adjustment_pct=1, got {item['adjustment_pct']}"
    assert item["total_diakui"] == 45, f"Expected total_diakui=45, got {item['total_diakui']}"
    
    # Check per_staff
    assert len(item["per_staff"]) == 3, f"Expected 3 staff, got {len(item['per_staff'])}"
    for ps in item["per_staff"]:
        assert ps["qty_input"] == ps["qty_diakui"], f"Before rekon, qty_input should equal qty_diakui: {ps}"
        expected_bonus = ps["qty_diakui"] * 5000
        assert ps["bonus"] == expected_bonus, f"Expected bonus={expected_bonus}, got {ps['bonus']}"
    
    log(f"✅ GET rekonsiliasi before PUT: mis_total=45, pos_total=None, adjustment_pct=1, total_diakui=45")
    log(f"   Per staff: all qty_input == qty_diakui (no adjustment)")
    return True

def test_put_pos_total_36():
    """TEST 6: PUT pos_total=36 (< MIS 45; pct=0.8)"""
    log("TEST 6: PUT pos_total=36 (< MIS 45; pct=0.8)")
    body = {
        "period_key": "2026-10",
        "entries": [
            {"master_id": master1_id, "pos_total": 36}
        ]
    }
    r = requests.put(f"{BASE_URL}/api/pf/rekonsiliasi", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"PUT rekonsiliasi failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("ok") is True, "Expected ok=true"
    
    # GET again to verify
    r2 = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"GET rekonsiliasi failed: {r2.status_code} {r2.text}"
    data2 = r2.json()
    item = next((x for x in data2["items"] if x["master_id"] == master1_id), None)
    assert item is not None, "Master not found"
    
    assert item["pos_total"] == 36, f"Expected pos_total=36, got {item['pos_total']}"
    assert abs(item["adjustment_pct"] - 0.8) < 0.01, f"Expected adjustment_pct≈0.8, got {item['adjustment_pct']}"
    assert item["total_diakui"] == 36, f"Expected total_diakui=36, got {item['total_diakui']}"
    
    # Check per_staff: staff1(20) → 16, staff2(15) → 12, staff3(10) → 8
    # floor(20*0.8)=16, floor(15*0.8)=12, floor(10*0.8)=8, sum=36 (no remainder)
    per_staff_map = {ps["staff_id"]: ps for ps in item["per_staff"]}
    
    ps1 = per_staff_map.get(staff1_id)
    assert ps1 is not None, f"Staff1 not found in per_staff"
    assert ps1["qty_input"] == 20, f"Expected qty_input=20, got {ps1['qty_input']}"
    assert ps1["qty_diakui"] == 16, f"Expected qty_diakui=16, got {ps1['qty_diakui']}"
    assert ps1["bonus"] == 80000, f"Expected bonus=80000, got {ps1['bonus']}"
    
    ps2 = per_staff_map.get(staff2_id)
    assert ps2 is not None, f"Staff2 not found in per_staff"
    assert ps2["qty_input"] == 15, f"Expected qty_input=15, got {ps2['qty_input']}"
    assert ps2["qty_diakui"] == 12, f"Expected qty_diakui=12, got {ps2['qty_diakui']}"
    assert ps2["bonus"] == 60000, f"Expected bonus=60000, got {ps2['bonus']}"
    
    ps3 = per_staff_map.get(staff3_id)
    assert ps3 is not None, f"Staff3 not found in per_staff"
    assert ps3["qty_input"] == 10, f"Expected qty_input=10, got {ps3['qty_input']}"
    assert ps3["qty_diakui"] == 8, f"Expected qty_diakui=8, got {ps3['qty_diakui']}"
    assert ps3["bonus"] == 40000, f"Expected bonus=40000, got {ps3['bonus']}"
    
    log(f"✅ PUT pos_total=36: adjustment_pct=0.8, total_diakui=36")
    log(f"   Per staff: {staff1_name}(20→16), {staff2_name}(15→12), {staff3_name}(10→8)")
    return True

def test_put_pos_total_37_remainder():
    """TEST 7: PUT pos_total=37 (tricky remainder, 37/45≈0.822)"""
    log("TEST 7: PUT pos_total=37 (tricky remainder)")
    body = {
        "period_key": "2026-10",
        "entries": [
            {"master_id": master1_id, "pos_total": 37}
        ]
    }
    r = requests.put(f"{BASE_URL}/api/pf/rekonsiliasi", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"PUT rekonsiliasi failed: {r.status_code} {r.text}"
    
    # GET again
    r2 = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"GET rekonsiliasi failed: {r2.status_code} {r2.text}"
    data2 = r2.json()
    item = next((x for x in data2["items"] if x["master_id"] == master1_id), None)
    assert item is not None, "Master not found"
    
    assert item["pos_total"] == 37, f"Expected pos_total=37, got {item['pos_total']}"
    assert item["total_diakui"] == 37, f"Expected total_diakui=37, got {item['total_diakui']}"
    
    # floor(20*0.822)=16, floor(15*0.822)=12, floor(10*0.822)=8, sum=36, remainder=1
    # Remainder goes to largest qty_input (staff1 with 20)
    # Expected: staff1=17, staff2=12, staff3=8
    per_staff_map = {ps["staff_id"]: ps for ps in item["per_staff"]}
    
    ps1 = per_staff_map.get(staff1_id)
    assert ps1["qty_diakui"] == 17, f"Expected staff1 qty_diakui=17 (largest qty gets remainder), got {ps1['qty_diakui']}"
    
    ps2 = per_staff_map.get(staff2_id)
    assert ps2["qty_diakui"] == 12, f"Expected staff2 qty_diakui=12, got {ps2['qty_diakui']}"
    
    ps3 = per_staff_map.get(staff3_id)
    assert ps3["qty_diakui"] == 8, f"Expected staff3 qty_diakui=8, got {ps3['qty_diakui']}"
    
    total = ps1["qty_diakui"] + ps2["qty_diakui"] + ps3["qty_diakui"]
    assert total == 37, f"Expected total_diakui=37, got {total}"
    
    log(f"✅ PUT pos_total=37: remainder=1 allocated to largest qty_input (staff1)")
    log(f"   Per staff: {staff1_name}(20→17), {staff2_name}(15→12), {staff3_name}(10→8), sum=37")
    return True

def test_put_pos_total_60_no_adjustment():
    """TEST 8: PUT pos_total=60 (>= MIS, no adjustment)"""
    log("TEST 8: PUT pos_total=60 (>= MIS, no adjustment)")
    body = {
        "period_key": "2026-10",
        "entries": [
            {"master_id": master1_id, "pos_total": 60}
        ]
    }
    r = requests.put(f"{BASE_URL}/api/pf/rekonsiliasi", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"PUT rekonsiliasi failed: {r.status_code} {r.text}"
    
    # GET again
    r2 = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"GET rekonsiliasi failed: {r2.status_code} {r2.text}"
    data2 = r2.json()
    item = next((x for x in data2["items"] if x["master_id"] == master1_id), None)
    assert item is not None, "Master not found"
    
    assert item["pos_total"] == 60, f"Expected pos_total=60, got {item['pos_total']}"
    assert item["adjustment_pct"] == 1, f"Expected adjustment_pct=1 (no adjustment), got {item['adjustment_pct']}"
    assert item["total_diakui"] == 45, f"Expected total_diakui=45 (MIS total), got {item['total_diakui']}"
    
    # All qty_diakui should equal qty_input
    per_staff_map = {ps["staff_id"]: ps for ps in item["per_staff"]}
    for staff_id in [staff1_id, staff2_id, staff3_id]:
        ps = per_staff_map.get(staff_id)
        assert ps["qty_input"] == ps["qty_diakui"], f"Expected qty_input==qty_diakui for {ps['staff_name']}, got {ps}"
    
    log(f"✅ PUT pos_total=60 (>= MIS): adjustment_pct=1, no adjustment applied")
    return True

def test_put_pos_total_null_reset():
    """TEST 9: PUT pos_total=null (reset rekon)"""
    log("TEST 9: PUT pos_total=null (reset rekon)")
    body = {
        "period_key": "2026-10",
        "entries": [
            {"master_id": master1_id, "pos_total": None}
        ]
    }
    r = requests.put(f"{BASE_URL}/api/pf/rekonsiliasi", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"PUT rekonsiliasi failed: {r.status_code} {r.text}"
    
    # GET again
    r2 = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"GET rekonsiliasi failed: {r2.status_code} {r2.text}"
    data2 = r2.json()
    item = next((x for x in data2["items"] if x["master_id"] == master1_id), None)
    assert item is not None, "Master not found"
    
    assert item["pos_total"] is None, f"Expected pos_total=None (reset), got {item['pos_total']}"
    assert item["adjustment_pct"] == 1, f"Expected adjustment_pct=1 (reset), got {item['adjustment_pct']}"
    
    log(f"✅ PUT pos_total=null: rekon entry deleted, pos_total=None, adjustment_pct=1")
    return True

def test_multiple_entries():
    """TEST 10: Multiple entries at once (create master2, add sales, PUT both)"""
    global master2_id
    log("TEST 10: Multiple entries at once")
    
    # Create master2
    body = {
        "period_key": "2026-10",
        "kode": "REK-02",
        "nama": "Rekon Test B",
        "satuan": "pcs",
        "jumlah_type": "limited",
        "jumlah_max": 50,
        "bonus": 1000
    }
    r = requests.post(f"{BASE_URL}/api/pf/masters", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"POST master2 failed: {r.status_code} {r.text}"
    master2_id = r.json()["item"]["id"]
    log(f"   Created master2: {master2_id}")
    
    # Add sales to master2: staff1=30, staff2=15, staff3=5 (MIS=50)
    for staff_id, qty in [(staff1_id, 30), (staff2_id, 15), (staff3_id, 5)]:
        r = requests.post(f"{BASE_URL}/api/pf/penjualan", json={
            "staff_id": staff_id,
            "master_id": master2_id,
            "qty": qty
        }, headers={**HEADERS, "Authorization": f"Bearer {token}"})
        assert r.status_code == 200, f"POST penjualan failed: {r.status_code} {r.text}"
    log(f"   Added sales to master2: staff1=30, staff2=15, staff3=5 (MIS=50)")
    
    # PUT both master1 pos=40, master2 pos=40
    body = {
        "period_key": "2026-10",
        "entries": [
            {"master_id": master1_id, "pos_total": 40},
            {"master_id": master2_id, "pos_total": 40}
        ]
    }
    r = requests.put(f"{BASE_URL}/api/pf/rekonsiliasi", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"PUT rekonsiliasi failed: {r.status_code} {r.text}"
    
    # GET and verify both
    r2 = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"GET rekonsiliasi failed: {r2.status_code} {r2.text}"
    data2 = r2.json()
    
    item1 = next((x for x in data2["items"] if x["master_id"] == master1_id), None)
    assert item1 is not None, "Master1 not found"
    assert item1["pos_total"] == 40, f"Expected master1 pos_total=40, got {item1['pos_total']}"
    
    item2 = next((x for x in data2["items"] if x["master_id"] == master2_id), None)
    assert item2 is not None, "Master2 not found"
    assert item2["pos_total"] == 40, f"Expected master2 pos_total=40, got {item2['pos_total']}"
    
    log(f"✅ Multiple entries: both master1 and master2 updated to pos_total=40")
    return True

def test_put_nonexistent_master():
    """TEST 11: PUT non-existent master_id (silently skipped)"""
    log("TEST 11: PUT non-existent master_id (silently skipped)")
    body = {
        "period_key": "2026-10",
        "entries": [
            {"master_id": "nonexistent-id-12345", "pos_total": 100},
            {"master_id": master1_id, "pos_total": 42}  # valid entry
        ]
    }
    r = requests.put(f"{BASE_URL}/api/pf/rekonsiliasi", json=body, headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"PUT rekonsiliasi should succeed (skip invalid): {r.status_code} {r.text}"
    
    # GET and verify master1 updated, nonexistent ignored
    r2 = requests.get(f"{BASE_URL}/api/pf/rekonsiliasi?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r2.status_code == 200, f"GET rekonsiliasi failed: {r2.status_code} {r2.text}"
    data2 = r2.json()
    
    item1 = next((x for x in data2["items"] if x["master_id"] == master1_id), None)
    assert item1 is not None, "Master1 not found"
    assert item1["pos_total"] == 42, f"Expected master1 pos_total=42, got {item1['pos_total']}"
    
    # Verify nonexistent master not in items
    nonexistent = next((x for x in data2["items"] if x["master_id"] == "nonexistent-id-12345"), None)
    assert nonexistent is None, "Nonexistent master should not be in items"
    
    log(f"✅ PUT non-existent master_id: silently skipped, valid entry applied")
    return True

def test_get_histori_with_data():
    """TEST 12: GET histori with data"""
    log("TEST 12: GET histori with data")
    r = requests.get(f"{BASE_URL}/api/pf/histori?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET histori failed: {r.status_code} {r.text}"
    data = r.json()
    
    # Verify structure
    assert "masters" in data, "No masters in histori"
    assert "pengajuan" in data, "No pengajuan in histori"
    assert "penjualan" in data, "No penjualan in histori"
    assert "rekonsiliasi" in data, "No rekonsiliasi in histori"
    assert "rekap_per_staff" in data, "No rekap_per_staff in histori"
    assert "totals" in data, "No totals in histori"
    
    # Verify masters
    assert len(data["masters"]) >= 2, f"Expected at least 2 masters, got {len(data['masters'])}"
    
    # Verify penjualan (3 per master1 + 3 per master2 = 6)
    assert len(data["penjualan"]) == 6, f"Expected 6 penjualan, got {len(data['penjualan'])}"
    
    # Verify each penjualan has qty_diakui and bonus_estimate
    for p in data["penjualan"]:
        assert "qty_diakui" in p, f"Missing qty_diakui in penjualan: {p}"
        assert "bonus_estimate" in p, f"Missing bonus_estimate in penjualan: {p}"
    
    # Verify rekap_per_staff (sorted desc by bonus)
    assert len(data["rekap_per_staff"]) == 3, f"Expected 3 staff in rekap, got {len(data['rekap_per_staff'])}"
    for i in range(len(data["rekap_per_staff"]) - 1):
        assert data["rekap_per_staff"][i]["bonus"] >= data["rekap_per_staff"][i+1]["bonus"], \
            f"rekap_per_staff not sorted desc by bonus: {data['rekap_per_staff']}"
    
    # Verify totals
    # master1: MIS=45, master2: MIS=50, total qty=95
    # master1: pos=42 (from test 11), master2: pos=40
    # total qty_diakui = 42 + 40 = 82
    assert data["totals"]["qty"] == 95, f"Expected totals.qty=95, got {data['totals']['qty']}"
    assert data["totals"]["qty_diakui"] == 82, f"Expected totals.qty_diakui=82, got {data['totals']['qty_diakui']}"
    
    # Verify totals.bonus (compute expected)
    # master1: pos=42, MIS=45, pct=42/45≈0.933
    # staff1(20): floor(20*0.933)=18, staff2(15): floor(15*0.933)=13, staff3(10): floor(10*0.933)=9, sum=40, remainder=2
    # Remainder goes to largest qty first: staff1 gets +1, staff2 gets +1 → staff1=19, staff2=14, staff3=9, sum=42
    # Bonus: 19*5000 + 14*5000 + 9*5000 = 95000 + 70000 + 45000 = 210000
    # master2: pos=40, MIS=50, pct=40/50=0.8
    # staff1(30): floor(30*0.8)=24, staff2(15): floor(15*0.8)=12, staff3(5): floor(5*0.8)=4, sum=40 (no remainder)
    # Bonus: 24*1000 + 12*1000 + 4*1000 = 24000 + 12000 + 4000 = 40000
    # Total bonus = 210000 + 40000 = 250000
    expected_bonus = 250000
    assert data["totals"]["bonus"] == expected_bonus, f"Expected totals.bonus={expected_bonus}, got {data['totals']['bonus']}"
    
    log(f"✅ GET histori: masters={len(data['masters'])}, penjualan={len(data['penjualan'])}, rekap_per_staff={len(data['rekap_per_staff'])}")
    log(f"   totals: qty=95, qty_diakui=82, bonus={data['totals']['bonus']}")
    return True

def test_dashboard_owner_reflects_qty_diakui():
    """TEST 13: Dashboard owner reflects qty_diakui"""
    log("TEST 13: Dashboard owner reflects qty_diakui")
    r = requests.get(f"{BASE_URL}/api/pf/dashboard/owner?period=2026-10", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET dashboard/owner failed: {r.status_code} {r.text}"
    data = r.json()
    
    assert "grand_qty_diakui" in data, "No grand_qty_diakui in dashboard/owner"
    assert data["grand_qty_diakui"] == 82, f"Expected grand_qty_diakui=82, got {data['grand_qty_diakui']}"
    
    # Verify per_staff has qty_diakui
    assert "per_staff" in data, "No per_staff in dashboard/owner"
    for ps in data["per_staff"]:
        assert "qty_diakui" in ps, f"Missing qty_diakui in per_staff: {ps}"
    
    log(f"✅ Dashboard owner: grand_qty_diakui=82, per_staff has qty_diakui field")
    return True

def test_dashboard_staff_reflects_qty_diakui():
    """TEST 14: Dashboard staff reflects qty_diakui"""
    log("TEST 14: Dashboard staff reflects qty_diakui")
    r = requests.get(f"{BASE_URL}/api/pf/dashboard/staff?period=2026-10&staff_id={staff1_id}", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET dashboard/staff failed: {r.status_code} {r.text}"
    data = r.json()
    
    assert "total_my_qty_diakui" in data, "No total_my_qty_diakui in dashboard/staff"
    assert "total_my_qty" in data, "No total_my_qty in dashboard/staff"
    
    # staff1: master1 qty=20, master2 qty=30, total=50
    # staff1: master1 diakui=19 (from test 12 calculation), master2 diakui=24, total=43
    assert data["total_my_qty"] == 50, f"Expected total_my_qty=50, got {data['total_my_qty']}"
    assert data["total_my_qty_diakui"] == 43, f"Expected total_my_qty_diakui=43, got {data['total_my_qty_diakui']}"
    assert data["total_my_qty_diakui"] < data["total_my_qty"], "qty_diakui should be less than qty (rekon applied)"
    
    # Verify rows have my_qty_diakui
    assert "rows" in data, "No rows in dashboard/staff"
    for row in data["rows"]:
        assert "my_qty_diakui" in row, f"Missing my_qty_diakui in row: {row}"
    
    log(f"✅ Dashboard staff: total_my_qty=50, total_my_qty_diakui=43 (rekon applied)")
    return True

def test_get_histori_empty_period():
    """TEST 15: GET histori empty period"""
    log("TEST 15: GET histori empty period (2027-01)")
    r = requests.get(f"{BASE_URL}/api/pf/histori?period=2027-01", headers={**HEADERS, "Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"GET histori failed: {r.status_code} {r.text}"
    data = r.json()
    
    # Verify empty arrays
    assert len(data["masters"]) == 0, f"Expected empty masters, got {len(data['masters'])}"
    assert len(data["pengajuan"]) == 0, f"Expected empty pengajuan, got {len(data['pengajuan'])}"
    assert len(data["penjualan"]) == 0, f"Expected empty penjualan, got {len(data['penjualan'])}"
    assert len(data["rekonsiliasi"]) == 0, f"Expected empty rekonsiliasi, got {len(data['rekonsiliasi'])}"
    assert len(data["rekap_per_staff"]) == 0, f"Expected empty rekap_per_staff, got {len(data['rekap_per_staff'])}"
    
    # Verify totals=0
    assert data["totals"]["qty"] == 0, f"Expected totals.qty=0, got {data['totals']['qty']}"
    assert data["totals"]["qty_diakui"] == 0, f"Expected totals.qty_diakui=0, got {data['totals']['qty_diakui']}"
    assert data["totals"]["bonus"] == 0, f"Expected totals.bonus=0, got {data['totals']['bonus']}"
    
    log(f"✅ GET histori empty period: all arrays empty, totals=0")
    return True

def test_cleanup():
    """TEST 16: Cleanup - delete all test data"""
    log("TEST 16: Cleanup - delete all test data")
    
    # Delete masters (will cascade to penjualan via backend logic)
    if master1_id:
        r = requests.delete(f"{BASE_URL}/api/pf/masters/{master1_id}", headers={**HEADERS, "Authorization": f"Bearer {token}"})
        # May fail if penjualan exists, but we'll clean via MongoDB directly
        log(f"   Attempted to delete master1: {r.status_code}")
    
    if master2_id:
        r = requests.delete(f"{BASE_URL}/api/pf/masters/{master2_id}", headers={**HEADERS, "Authorization": f"Bearer {token}"})
        log(f"   Attempted to delete master2: {r.status_code}")
    
    # Clean via MongoDB directly (since we can't delete masters with penjualan via API)
    import pymongo
    client = pymongo.MongoClient("mongodb://localhost:27017")
    db = client["cycle_count"]
    
    # Delete all pf_* docs with period_key=2026-10
    result1 = db["pf_masters"].delete_many({"period_key": "2026-10"})
    result2 = db["pf_penjualan"].delete_many({"period_key": "2026-10"})
    result3 = db["pf_rekonsiliasi"].delete_many({"period_key": "2026-10"})
    result4 = db["pf_pengajuan"].delete_many({"period_key": "2026-10"})
    
    log(f"✅ Cleanup: deleted {result1.deleted_count} masters, {result2.deleted_count} penjualan, {result3.deleted_count} rekonsiliasi, {result4.deleted_count} pengajuan")
    return True

def main():
    tests = [
        ("Login as owner", test_login),
        ("Get staff list", test_get_staff_list),
        ("Create test master", test_create_master),
        ("POST penjualan (MIS=45)", test_post_penjualan),
        ("GET rekonsiliasi before PUT", test_get_rekonsiliasi_before_put),
        ("PUT pos_total=36 (< MIS)", test_put_pos_total_36),
        ("PUT pos_total=37 (remainder)", test_put_pos_total_37_remainder),
        ("PUT pos_total=60 (>= MIS)", test_put_pos_total_60_no_adjustment),
        ("PUT pos_total=null (reset)", test_put_pos_total_null_reset),
        ("Multiple entries at once", test_multiple_entries),
        ("PUT non-existent master_id", test_put_nonexistent_master),
        ("GET histori with data", test_get_histori_with_data),
        ("Dashboard owner reflects qty_diakui", test_dashboard_owner_reflects_qty_diakui),
        ("Dashboard staff reflects qty_diakui", test_dashboard_staff_reflects_qty_diakui),
        ("GET histori empty period", test_get_histori_empty_period),
        ("Cleanup", test_cleanup),
    ]
    
    passed = 0
    failed = 0
    
    log("=" * 80)
    log("BACKEND TEST: Module Produk Fokus (Fase 3: Rekonsiliasi POS + Histori)")
    log("=" * 80)
    
    for name, test_func in tests:
        try:
            log(f"\n{'='*80}")
            if test_func():
                passed += 1
                log(f"✅ PASSED: {name}")
            else:
                failed += 1
                log(f"❌ FAILED: {name}")
        except AssertionError as e:
            failed += 1
            log(f"❌ FAILED: {name}")
            log(f"   Error: {e}")
        except Exception as e:
            failed += 1
            log(f"❌ FAILED: {name}")
            log(f"   Exception: {e}")
    
    log(f"\n{'='*80}")
    log(f"TEST SUMMARY: {passed} passed, {failed} failed out of {len(tests)} tests")
    log(f"{'='*80}")
    
    if failed > 0:
        sys.exit(1)
    else:
        log("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
