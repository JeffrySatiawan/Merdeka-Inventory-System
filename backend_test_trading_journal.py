#!/usr/bin/env python3
"""
Backend test for Personal Trading Journal Module (/api/tj/*).
PRIVATE, Owner-only module.

Test scenarios:
1. Setup: Create masters (pairs, timeframes, methods)
2. Auth guards (401 without token, 403 for non-owner)
3. Master CRUD operations (POST, GET, PATCH, duplicate handling)
4. Trade CRUD operations with validation
5. Compounding calculations
6. Analytics
7. Export (CSV and JSON)
8. Cleanup
"""

import requests
import json
import time
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# MongoDB connection for cleanup
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

def test_trading_journal():
    print("=" * 80)
    print("TRADING JOURNAL MODULE BACKEND TEST")
    print("=" * 80)
    
    # Connect to MongoDB for cleanup
    mongo_client = MongoClient(MONGO_URL)
    db = mongo_client[DB_NAME]
    
    # Test counters
    total_tests = 0
    passed_tests = 0
    
    # ========================================================================
    # TEST 1: Login as owner
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Login as owner")
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "username": OWNER_USERNAME,
            "password": OWNER_PASSWORD
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "token" in data, "No token in response"
        owner_token = data["token"]
        print(f"✅ PASS: Owner login successful, token: {owner_token[:20]}...")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
        return
    
    headers_owner = {"Authorization": f"Bearer {owner_token}"}
    
    # ========================================================================
    # TEST 2: Auth guard - no token
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Auth guard - GET /api/tj/masters without token")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/masters", timeout=10)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print(f"✅ PASS: Correctly rejected with 401")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST 3: Auth guard - non-owner (skip if no staff user)
    # ========================================================================
    # We'll skip this test as per review request: "skip if no staff user"
    print(f"\n[TEST SKIPPED] Auth guard - non-owner staff (no staff user available)")
    
    # ========================================================================
    # SETUP: Create masters
    # ========================================================================
    print(f"\n[SETUP] Creating masters...")
    masters_created = []
    
    # Create pairs
    for pair_name in ["AUDJPY", "EURUSD"]:
        total_tests += 1
        print(f"\n[TEST {total_tests}] POST master pair={pair_name}")
        try:
            resp = requests.post(f"{BASE_URL}/api/tj/masters", headers=headers_owner, json={
                "kind": "pair",
                "nama": pair_name
            }, timeout=10)
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
            data = resp.json()
            assert "item" in data, "No item in response"
            assert data["item"]["nama"] == pair_name, f"Expected nama={pair_name}, got {data['item']['nama']}"
            assert data["item"]["kind"] == "pair", f"Expected kind=pair, got {data['item']['kind']}"
            masters_created.append(data["item"])
            print(f"✅ PASS: Master pair {pair_name} created, id={data['item']['id']}")
            passed_tests += 1
        except Exception as e:
            print(f"❌ FAIL: {e}")
    
    # Create timeframes
    for tf_name in ["H1", "M15"]:
        total_tests += 1
        print(f"\n[TEST {total_tests}] POST master tf={tf_name}")
        try:
            resp = requests.post(f"{BASE_URL}/api/tj/masters", headers=headers_owner, json={
                "kind": "tf",
                "nama": tf_name
            }, timeout=10)
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
            data = resp.json()
            assert data["item"]["nama"] == tf_name, f"Expected nama={tf_name}, got {data['item']['nama']}"
            assert data["item"]["kind"] == "tf", f"Expected kind=tf, got {data['item']['kind']}"
            masters_created.append(data["item"])
            print(f"✅ PASS: Master tf {tf_name} created, id={data['item']['id']}")
            passed_tests += 1
        except Exception as e:
            print(f"❌ FAIL: {e}")
    
    # Create methods
    for metode_name in ["BoS", "FVG"]:
        total_tests += 1
        print(f"\n[TEST {total_tests}] POST master metode={metode_name}")
        try:
            resp = requests.post(f"{BASE_URL}/api/tj/masters", headers=headers_owner, json={
                "kind": "metode",
                "nama": metode_name
            }, timeout=10)
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
            data = resp.json()
            assert data["item"]["nama"] == metode_name, f"Expected nama={metode_name}, got {data['item']['nama']}"
            assert data["item"]["kind"] == "metode", f"Expected kind=metode, got {data['item']['kind']}"
            masters_created.append(data["item"])
            print(f"✅ PASS: Master metode {metode_name} created, id={data['item']['id']}")
            passed_tests += 1
        except Exception as e:
            print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Master POST duplicate
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Master POST duplicate - pair=AUDJPY again")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/masters", headers=headers_owner, json={
            "kind": "pair",
            "nama": "AUDJPY"
        }, timeout=10)
        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: Duplicate rejected with 409, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Master PATCH nama
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Master PATCH nama - rename AUDJPY to AUDJPY_TEST")
    try:
        audjpy_master = next((m for m in masters_created if m["nama"] == "AUDJPY"), None)
        assert audjpy_master is not None, "AUDJPY master not found"
        
        resp = requests.patch(f"{BASE_URL}/api/tj/masters/{audjpy_master['id']}", headers=headers_owner, json={
            "nama": "AUDJPY_TEST"
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data["item"]["nama"] == "AUDJPY_TEST", f"Expected nama=AUDJPY_TEST, got {data['item']['nama']}"
        print(f"✅ PASS: Master renamed to AUDJPY_TEST")
        passed_tests += 1
        
        # Rename back
        resp = requests.patch(f"{BASE_URL}/api/tj/masters/{audjpy_master['id']}", headers=headers_owner, json={
            "nama": "AUDJPY"
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Master PATCH duplicate rename
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Master PATCH duplicate rename - rename AUDJPY to EURUSD")
    try:
        audjpy_master = next((m for m in masters_created if m["nama"] == "AUDJPY"), None)
        assert audjpy_master is not None, "AUDJPY master not found"
        
        resp = requests.patch(f"{BASE_URL}/api/tj/masters/{audjpy_master['id']}", headers=headers_owner, json={
            "nama": "EURUSD"
        }, timeout=10)
        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: Duplicate rename rejected with 409, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Master PATCH toggle active
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Master PATCH toggle active - set AUDJPY to inactive")
    try:
        audjpy_master = next((m for m in masters_created if m["nama"] == "AUDJPY"), None)
        assert audjpy_master is not None, "AUDJPY master not found"
        
        resp = requests.patch(f"{BASE_URL}/api/tj/masters/{audjpy_master['id']}", headers=headers_owner, json={
            "active": False
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data["item"]["active"] == False, f"Expected active=False, got {data['item']['active']}"
        print(f"✅ PASS: Master set to inactive")
        passed_tests += 1
        
        # Toggle back
        resp = requests.patch(f"{BASE_URL}/api/tj/masters/{audjpy_master['id']}", headers=headers_owner, json={
            "active": True
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data["item"]["active"] == True, f"Expected active=True, got {data['item']['active']}"
        print(f"✅ PASS: Master toggled back to active")
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Master GET filter by kind
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Master GET filter by kind=pair")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/masters?kind=pair", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "items" in data, "No items in response"
        assert len(data["items"]) == 2, f"Expected 2 pairs, got {len(data['items'])}"
        assert all(item["kind"] == "pair" for item in data["items"]), "Not all items are pairs"
        print(f"✅ PASS: GET filter by kind=pair returned {len(data['items'])} pairs")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade POST minimal
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade POST minimal")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-28",
            "pair": "AUDJPY",
            "tf": "H1",
            "metode": "BoS",
            "position": "BUY",
            "entry_price": 100.5,
            "sl_price": 100.0,
            "tp_price": 101.5,
            "sl_money": 50,
            "tp_money": 100,
            "emosi": "tenang",
            "jam_entry": "09:15",
            "reason": "break"
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "item" in data, "No item in response"
        trade1 = data["item"]
        
        # Verify nama auto-generated
        assert trade1["nama"] == "AUDJPY 28 September 2026", f"Expected nama='AUDJPY 28 September 2026', got {trade1['nama']}"
        
        # Verify rr calculation
        # risk = entry - sl = 100.5 - 100.0 = 0.5
        # reward = tp - entry = 101.5 - 100.5 = 1.0
        # rr = reward / risk = 1.0 / 0.5 = 2.0
        assert abs(trade1["rr"] - 2.0) < 0.01, f"Expected rr=2.0, got {trade1['rr']}"
        
        # Verify hasil is null (no close yet)
        assert trade1["hasil"] is None, f"Expected hasil=None, got {trade1['hasil']}"
        
        # Verify duration_minutes is null
        assert trade1["duration_minutes"] is None, f"Expected duration_minutes=None, got {trade1['duration_minutes']}"
        
        print(f"✅ PASS: Trade created, nama={trade1['nama']}, rr={trade1['rr']}, hasil={trade1['hasil']}, duration_minutes={trade1['duration_minutes']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade validation - missing pair
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade validation - missing pair")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-28",
            "tf": "H1",
            "metode": "BoS",
            "position": "BUY",
            "entry_price": 100.5,
            "sl_price": 100.0,
            "tp_price": 101.5,
            "sl_money": 50,
            "tp_money": 100
        }, timeout=10)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: Missing pair rejected with 400, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade validation - entry_price=0
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade validation - entry_price=0")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-28",
            "pair": "AUDJPY",
            "tf": "H1",
            "metode": "BoS",
            "position": "BUY",
            "entry_price": 0,
            "sl_price": 100.0,
            "tp_price": 101.5,
            "sl_money": 50,
            "tp_money": 100
        }, timeout=10)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: entry_price=0 rejected with 400, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade validation - invalid position "HOLD"
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade validation - invalid position 'HOLD'")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-28",
            "pair": "AUDJPY",
            "tf": "H1",
            "metode": "BoS",
            "position": "HOLD",
            "entry_price": 100.5,
            "sl_price": 100.0,
            "tp_price": 101.5,
            "sl_money": 50,
            "tp_money": 100
        }, timeout=10)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: Invalid position rejected with 400, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade PATCH close
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade PATCH close")
    try:
        resp = requests.patch(f"{BASE_URL}/api/tj/trades/{trade1['id']}", headers=headers_owner, json={
            "hasil": "TP",
            "close_price": 101.5,
            "jam_close": "10:45",
            "hasil_trade": 95,
            "evaluasi": "disiplin"
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "item" in data, "No item in response"
        trade1_closed = data["item"]
        
        # Verify duration_minutes = 90 (09:15 to 10:45 = 90 minutes)
        assert trade1_closed["duration_minutes"] == 90, f"Expected duration_minutes=90, got {trade1_closed['duration_minutes']}"
        
        # Verify actual_r = 1.9 (hasil_trade / sl_money = 95 / 50 = 1.9)
        assert abs(trade1_closed["actual_r"] - 1.9) < 0.01, f"Expected actual_r=1.9, got {trade1_closed['actual_r']}"
        
        print(f"✅ PASS: Trade closed, duration_minutes={trade1_closed['duration_minutes']}, actual_r={trade1_closed['actual_r']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade PATCH invalid hasil
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade PATCH invalid hasil='MANUAL'")
    try:
        resp = requests.patch(f"{BASE_URL}/api/tj/trades/{trade1['id']}", headers=headers_owner, json={
            "hasil": "MANUAL"
        }, timeout=10)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: Invalid hasil rejected with 400, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade PATCH invalid position
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade PATCH invalid position='XX'")
    try:
        resp = requests.patch(f"{BASE_URL}/api/tj/trades/{trade1['id']}", headers=headers_owner, json={
            "position": "XX"
        }, timeout=10)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "No error in response"
        print(f"✅ PASS: Invalid position rejected with 400, error: {data['error']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade name auto-regenerate
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade name auto-regenerate - PATCH pair=EURUSD")
    try:
        resp = requests.patch(f"{BASE_URL}/api/tj/trades/{trade1['id']}", headers=headers_owner, json={
            "pair": "EURUSD"
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "item" in data, "No item in response"
        trade1_renamed = data["item"]
        
        # Verify nama recalculated to "EURUSD 28 September 2026"
        assert trade1_renamed["nama"] == "EURUSD 28 September 2026", f"Expected nama='EURUSD 28 September 2026', got {trade1_renamed['nama']}"
        
        print(f"✅ PASS: Trade nama auto-regenerated to {trade1_renamed['nama']}")
        passed_tests += 1
        
        # Revert back to AUDJPY
        resp = requests.patch(f"{BASE_URL}/api/tj/trades/{trade1['id']}", headers=headers_owner, json={
            "pair": "AUDJPY"
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Create 2 more trades with different pair/hasil
    # ========================================================================
    print(f"\n[SETUP] Creating 2 more trades...")
    
    # Trade 2: EURUSD, TP
    total_tests += 1
    print(f"\n[TEST {total_tests}] Create trade 2 - EURUSD, TP")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-28",
            "pair": "EURUSD",
            "tf": "M15",
            "metode": "FVG",
            "position": "SELL",
            "entry_price": 1.1000,
            "sl_price": 1.1050,
            "tp_price": 1.0950,
            "sl_money": 50,
            "tp_money": 100,
            "jam_entry": "14:00",
            "hasil": "TP",
            "close_price": 1.0950,
            "jam_close": "15:30",
            "hasil_trade": 100
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        trade2 = data["item"]
        print(f"✅ PASS: Trade 2 created, id={trade2['id']}, pair={trade2['pair']}, hasil={trade2['hasil']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
        trade2 = None
    
    # Trade 3: AUDJPY, SL
    total_tests += 1
    print(f"\n[TEST {total_tests}] Create trade 3 - AUDJPY, SL")
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-27",
            "pair": "AUDJPY",
            "tf": "H1",
            "metode": "BoS",
            "position": "BUY",
            "entry_price": 100.0,
            "sl_price": 99.7,
            "tp_price": 100.6,
            "sl_money": 30,
            "tp_money": 60,
            "jam_entry": "08:00",
            "hasil": "SL",
            "close_price": 99.7,
            "jam_close": "09:00",
            "hasil_trade": -30
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        trade3 = data["item"]
        print(f"✅ PASS: Trade 3 created, id={trade3['id']}, pair={trade3['pair']}, hasil={trade3['hasil']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
        trade3 = None
    
    # ========================================================================
    # TEST: Trade GET filters
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade GET filter by pair=EURUSD")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/trades?pair=EURUSD", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "items" in data, "No items in response"
        assert len(data["items"]) == 1, f"Expected 1 trade, got {len(data['items'])}"
        assert data["items"][0]["pair"] == "EURUSD", f"Expected pair=EURUSD, got {data['items'][0]['pair']}"
        print(f"✅ PASS: GET filter by pair=EURUSD returned {len(data['items'])} trade")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade GET filter by hasil=TP")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/trades?hasil=TP", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "items" in data, "No items in response"
        assert len(data["items"]) == 2, f"Expected 2 trades, got {len(data['items'])}"
        assert all(item["hasil"] == "TP" for item in data["items"]), "Not all items have hasil=TP"
        print(f"✅ PASS: GET filter by hasil=TP returned {len(data['items'])} trades")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade GET filter by date range from=2026-09-27&to=2026-09-28")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/trades?from=2026-09-27&to=2026-09-28", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "items" in data, "No items in response"
        assert len(data["items"]) == 3, f"Expected 3 trades, got {len(data['items'])}"
        print(f"✅ PASS: GET filter by date range returned {len(data['items'])} trades")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Trade DELETE
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Trade DELETE")
    try:
        # Delete trade3
        resp = requests.delete(f"{BASE_URL}/api/tj/trades/{trade3['id']}", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data["ok"] == True, f"Expected ok=True, got {data['ok']}"
        
        # Verify trade3 is not present
        resp = requests.get(f"{BASE_URL}/api/tj/trades", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "items" in data, "No items in response"
        assert not any(item["id"] == trade3["id"] for item in data["items"]), "Trade3 still present after delete"
        
        print(f"✅ PASS: Trade deleted successfully")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Compounding PUT
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Compounding PUT modal_awal=1000")
    try:
        resp = requests.put(f"{BASE_URL}/api/tj/compounding", headers=headers_owner, json={
            "modal_awal": 1000
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data["ok"] == True, f"Expected ok=True, got {data['ok']}"
        assert data["modal_awal"] == 1000, f"Expected modal_awal=1000, got {data['modal_awal']}"
        print(f"✅ PASS: Compounding modal_awal set to 1000")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Compounding GET after 1 TP trade with hasil_trade=95
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Compounding GET after 1 TP trade with hasil_trade=95")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/compounding", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        
        # We have 2 TP trades now: trade1 (hasil_trade=95) and trade2 (hasil_trade=100)
        # modal_awal = 1000
        # After trade1: 1000 + 95 = 1095
        # After trade2: 1095 + 100 = 1195
        # total_pl = 95 + 100 = 195
        # wins = 2, losses = 0
        
        assert data["modal_saat_ini"] == 1195, f"Expected modal_saat_ini=1195, got {data['modal_saat_ini']}"
        assert data["total_pl"] == 195, f"Expected total_pl=195, got {data['total_pl']}"
        assert data["wins"] == 2, f"Expected wins=2, got {data['wins']}"
        assert data["losses"] == 0, f"Expected losses=0, got {data['losses']}"
        
        # Verify rows[0] has pct = 9.5 (95/1000*100)
        assert len(data["rows"]) == 2, f"Expected 2 rows, got {len(data['rows'])}"
        row0 = data["rows"][0]
        assert abs(row0["pct"] - 9.5) < 0.01, f"Expected pct=9.5, got {row0['pct']}"
        
        print(f"✅ PASS: Compounding GET returned modal_saat_ini={data['modal_saat_ini']}, total_pl={data['total_pl']}, wins={data['wins']}, losses={data['losses']}, rows[0].pct={row0['pct']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Analytics with data
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Analytics with data")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/analytics", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        
        # Verify fields present
        assert "win_rate" in data, "No win_rate in response"
        assert "expectancy" in data, "No expectancy in response"
        assert "profit_factor" in data, "No profit_factor in response"
        assert "max_consecutive_wins" in data, "No max_consecutive_wins in response"
        assert "max_drawdown_pct" in data, "No max_drawdown_pct in response"
        
        # We have 2 TP trades, 0 SL trades (trade3 was deleted)
        # win_rate should be 100%
        assert abs(data["win_rate"] - 100.0) < 0.01, f"Expected win_rate=100.0, got {data['win_rate']}"
        
        # profit_factor should be null (no losses = Infinity → null)
        assert data["profit_factor"] is None, f"Expected profit_factor=None, got {data['profit_factor']}"
        
        print(f"✅ PASS: Analytics returned win_rate={data['win_rate']}, expectancy={data['expectancy']}, profit_factor={data['profit_factor']}, max_consecutive_wins={data['max_consecutive_wins']}, max_drawdown_pct={data['max_drawdown_pct']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Analytics with 1 TP + 1 SL trade
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Analytics with 1 TP + 1 SL trade")
    try:
        # Create SL trade with hasil_trade=-30
        resp = requests.post(f"{BASE_URL}/api/tj/trades", headers=headers_owner, json={
            "tanggal": "2026-09-29",
            "pair": "AUDJPY",
            "tf": "H1",
            "metode": "BoS",
            "position": "BUY",
            "entry_price": 100.0,
            "sl_price": 99.7,
            "tp_price": 100.6,
            "sl_money": 30,
            "tp_money": 60,
            "jam_entry": "08:00",
            "hasil": "SL",
            "close_price": 99.7,
            "jam_close": "09:00",
            "hasil_trade": -30
        }, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        trade_sl = resp.json()["item"]
        
        # Get analytics
        resp = requests.get(f"{BASE_URL}/api/tj/analytics", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        
        # We have 2 TP trades (95 + 100 = 195) and 1 SL trade (-30)
        # profit_factor = 195 / 30 = 6.5
        assert data["profit_factor"] is not None, f"Expected profit_factor to be not None, got {data['profit_factor']}"
        assert abs(data["profit_factor"] - 6.5) < 0.01, f"Expected profit_factor=6.5, got {data['profit_factor']}"
        
        print(f"✅ PASS: Analytics with 1 SL trade returned profit_factor={data['profit_factor']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Export CSV
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Export CSV")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/export?format=csv", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert resp.headers["Content-Type"].startswith("text/csv"), f"Expected Content-Type=text/csv, got {resp.headers['Content-Type']}"
        
        csv_content = resp.text
        lines = csv_content.split("\n")
        assert len(lines) > 1, f"Expected at least 2 lines (header + data), got {len(lines)}"
        
        # Verify header
        header = lines[0]
        assert "nama" in header, "No 'nama' in CSV header"
        assert "tanggal" in header, "No 'tanggal' in CSV header"
        assert "pair" in header, "No 'pair' in CSV header"
        
        print(f"✅ PASS: Export CSV returned {len(lines)} lines, header: {header[:100]}...")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Export JSON
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Export JSON")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/export?format=json", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        
        assert "generated_at" in data, "No generated_at in response"
        assert "config" in data, "No config in response"
        assert "trades" in data, "No trades in response"
        
        # Verify trades array contains rr, actual_r, screenshot file_ids
        assert len(data["trades"]) > 0, f"Expected at least 1 trade, got {len(data['trades'])}"
        trade = data["trades"][0]
        assert "rr" in trade, "No rr in trade"
        assert "actual_r" in trade, "No actual_r in trade"
        assert "entry_screenshot_file_id" in trade, "No entry_screenshot_file_id in trade"
        assert "close_screenshot_file_id" in trade, "No close_screenshot_file_id in trade"
        
        print(f"✅ PASS: Export JSON returned {len(data['trades'])} trades, generated_at={data['generated_at']}")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # TEST: Export filter
    # ========================================================================
    total_tests += 1
    print(f"\n[TEST {total_tests}] Export filter - format=json&pair=EURUSD")
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/export?format=json&pair=EURUSD", headers=headers_owner, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        
        assert "trades" in data, "No trades in response"
        assert len(data["trades"]) == 1, f"Expected 1 trade, got {len(data['trades'])}"
        assert data["trades"][0]["pair"] == "EURUSD", f"Expected pair=EURUSD, got {data['trades'][0]['pair']}"
        
        print(f"✅ PASS: Export filter returned {len(data['trades'])} EURUSD trade")
        passed_tests += 1
    except Exception as e:
        print(f"❌ FAIL: {e}")
    
    # ========================================================================
    # CLEANUP: Delete ALL docs in tj_masters, tj_trades, tj_config
    # ========================================================================
    print(f"\n[CLEANUP] Deleting all docs in tj_masters, tj_trades, tj_config...")
    try:
        result_masters = db.tj_masters.delete_many({})
        result_trades = db.tj_trades.delete_many({})
        result_config = db.tj_config.delete_many({})
        
        print(f"✅ Deleted {result_masters.deleted_count} masters, {result_trades.deleted_count} trades, {result_config.deleted_count} config docs")
    except Exception as e:
        print(f"❌ CLEANUP FAIL: {e}")
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("\n" + "=" * 80)
    print(f"TEST SUMMARY: {passed_tests}/{total_tests} tests passed")
    print("=" * 80)
    
    if passed_tests == total_tests:
        print("✅ ALL TESTS PASSED")
    else:
        print(f"❌ {total_tests - passed_tests} TESTS FAILED")
    
    return passed_tests == total_tests

if __name__ == "__main__":
    try:
        success = test_trading_journal()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
