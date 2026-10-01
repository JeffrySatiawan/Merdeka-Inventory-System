#!/usr/bin/env python3
"""
Backend test for Trading Journal duration recomputation changes.
Tests tanggal_close field, duration_minutes calculation, duration_label formatting,
BWC for legacy trades, and export endpoints.
"""

import requests
import json
import time
from datetime import datetime, timedelta

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            log(f"✅ Login successful for {username}, token: {token[:20]}...")
            return token
        else:
            log(f"❌ Login failed for {username}: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ Login exception: {e}")
        return None

def test_post_trade_cross_day_explicit(token):
    """TEST 1: POST trade with explicit tanggal_close cross-day (4 hours)"""
    log("\n=== TEST 1: POST trade with explicit tanggal_close cross-day ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "EURUSD",
        "tf": "H1",
        "metode": "Breakout",
        "position": "BUY",
        "entry_price": 100,
        "sl_price": 95,
        "tp_price": 110,
        "sl_money": 50,
        "tp_money": 100,
        "tanggal": "2026-09-29",
        "jam_entry": "23:00",
        "tanggal_close": "2026-09-30",
        "jam_close": "03:00",
        "hasil": "TP",
        "close_price": 110,
        "hasil_trade": 100
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            
            # Verify duration_minutes = 240 (4 hours)
            duration_minutes = item.get("duration_minutes")
            tanggal_close = item.get("tanggal_close")
            duration_label = item.get("duration_label")
            
            log(f"✅ POST trade successful")
            log(f"   Trade ID: {item.get('id')}")
            log(f"   tanggal: {item.get('tanggal')}, jam_entry: {item.get('jam_entry')}")
            log(f"   tanggal_close: {tanggal_close}, jam_close: {item.get('jam_close')}")
            log(f"   duration_minutes: {duration_minutes}")
            log(f"   duration_label: {duration_label}")
            
            # Assertions
            assert duration_minutes == 240, f"Expected duration_minutes=240, got {duration_minutes}"
            assert tanggal_close == "2026-09-30", f"Expected tanggal_close='2026-09-30', got {tanggal_close}"
            assert duration_label == "4 jam", f"Expected duration_label='4 jam', got {duration_label}"
            
            log(f"✅ TEST 1 PASSED: duration_minutes={duration_minutes}, duration_label='{duration_label}', tanggal_close='{tanggal_close}'")
            return item.get("id")
        else:
            log(f"❌ POST trade failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ TEST 1 exception: {e}")
        return None

def test_post_trade_long_cross_day(token):
    """TEST 2: POST trade longer cross-day (28h15m = 1 day 4h 15m)"""
    log("\n=== TEST 2: POST trade longer cross-day (28h15m) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "GBPUSD",
        "tf": "H4",
        "metode": "Trend Following",
        "position": "SELL",
        "entry_price": 200,
        "sl_price": 210,
        "tp_price": 180,
        "sl_money": 100,
        "tp_money": 200,
        "tanggal": "2026-09-29",
        "jam_entry": "14:30",
        "tanggal_close": "2026-09-30",
        "jam_close": "18:45",
        "hasil": "TP",
        "close_price": 180,
        "hasil_trade": 200
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            
            duration_minutes = item.get("duration_minutes")
            duration_label = item.get("duration_label")
            expected_minutes = 28 * 60 + 15  # 1695
            
            log(f"✅ POST trade successful")
            log(f"   Trade ID: {item.get('id')}")
            log(f"   duration_minutes: {duration_minutes}")
            log(f"   duration_label: {duration_label}")
            
            # Assertions
            assert duration_minutes == expected_minutes, f"Expected duration_minutes={expected_minutes}, got {duration_minutes}"
            assert duration_label == "1 hari 4 jam 15 menit", f"Expected duration_label='1 hari 4 jam 15 menit', got {duration_label}"
            
            log(f"✅ TEST 2 PASSED: duration_minutes={duration_minutes}, duration_label='{duration_label}'")
            return item.get("id")
        else:
            log(f"❌ POST trade failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ TEST 2 exception: {e}")
        return None

def test_post_trade_same_day_no_tanggal_close(token):
    """TEST 3: POST trade same-day without tanggal_close (should default to tanggal)"""
    log("\n=== TEST 3: POST trade same-day without tanggal_close ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "USDJPY",
        "tf": "M15",
        "metode": "Scalping",
        "position": "BUY",
        "entry_price": 150,
        "sl_price": 148,
        "tp_price": 155,
        "sl_money": 20,
        "tp_money": 50,
        "tanggal": "2026-09-30",
        "jam_entry": "09:00",
        "jam_close": "10:30",
        "hasil": "TP",
        "close_price": 155,
        "hasil_trade": 50
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            
            duration_minutes = item.get("duration_minutes")
            tanggal_close = item.get("tanggal_close")
            duration_label = item.get("duration_label")
            
            log(f"✅ POST trade successful")
            log(f"   Trade ID: {item.get('id')}")
            log(f"   tanggal_close: {tanggal_close} (should default to tanggal)")
            log(f"   duration_minutes: {duration_minutes}")
            log(f"   duration_label: {duration_label}")
            
            # Assertions
            assert tanggal_close == "2026-09-30", f"Expected tanggal_close='2026-09-30', got {tanggal_close}"
            assert duration_minutes == 90, f"Expected duration_minutes=90, got {duration_minutes}"
            assert duration_label == "1 jam 30 menit", f"Expected duration_label='1 jam 30 menit', got {duration_label}"
            
            log(f"✅ TEST 3 PASSED: tanggal_close defaulted to '{tanggal_close}', duration_minutes={duration_minutes}")
            return item.get("id")
        else:
            log(f"❌ POST trade failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ TEST 3 exception: {e}")
        return None

def test_bwc_legacy_trade(token):
    """TEST 4: BWC legacy trade (simulate missing tanggal_close via MongoDB)"""
    log("\n=== TEST 4: BWC legacy trade (missing tanggal_close) ===")
    
    # First, create a trade with tanggal_close
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "AUDUSD",
        "tf": "H1",
        "metode": "Support Resistance",
        "position": "BUY",
        "entry_price": 100,
        "sl_price": 95,
        "tp_price": 110,
        "sl_money": 50,
        "tp_money": 100,
        "tanggal": "2026-09-30",
        "jam_entry": "23:00",
        "jam_close": "03:00",
        "hasil": "TP",
        "close_price": 110,
        "hasil_trade": 100
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code != 200:
            log(f"❌ POST trade failed: {resp.status_code} {resp.text}")
            return None
        
        trade_id = resp.json().get("item", {}).get("id")
        log(f"✅ Created trade {trade_id}")
        
        # Now unset tanggal_close via MongoDB to simulate legacy trade
        from pymongo import MongoClient
        client = MongoClient("mongodb://localhost:27017")
        db = client["cycle_count"]
        result = db.tj_trades.update_one({"id": trade_id}, {"$unset": {"tanggal_close": ""}})
        log(f"✅ Unset tanggal_close via MongoDB (matched: {result.matched_count}, modified: {result.modified_count})")
        
        # Now GET the trade and verify BWC fallback
        resp = requests.get(f"{BASE_URL}/api/tj/trades/{trade_id}", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            
            duration_minutes = item.get("duration_minutes")
            tanggal_close = item.get("tanggal_close")
            duration_label = item.get("duration_label")
            
            log(f"✅ GET trade successful")
            log(f"   tanggal_close: {tanggal_close} (should be None or missing)")
            log(f"   duration_minutes: {duration_minutes} (should be 240 with BWC +24h fallback)")
            log(f"   duration_label: {duration_label}")
            
            # Assertions: BWC should add 24h when jam_close < jam_entry and no tanggal_close
            assert duration_minutes == 240, f"Expected duration_minutes=240 (BWC +24h), got {duration_minutes}"
            
            log(f"✅ TEST 4 PASSED: BWC fallback working, duration_minutes={duration_minutes}")
            return trade_id
        else:
            log(f"❌ GET trade failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ TEST 4 exception: {e}")
        return None

def test_patch_tanggal_close(token):
    """TEST 5: PATCH tanggal_close (duration should increase by 24*60)"""
    log("\n=== TEST 5: PATCH tanggal_close ===")
    
    # First, create a same-day trade
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "NZDUSD",
        "tf": "H1",
        "metode": "Breakout",
        "position": "BUY",
        "entry_price": 100,
        "sl_price": 95,
        "tp_price": 110,
        "sl_money": 50,
        "tp_money": 100,
        "tanggal": "2026-09-30",
        "jam_entry": "10:00",
        "jam_close": "14:00",
        "hasil": "TP",
        "close_price": 110,
        "hasil_trade": 100
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code != 200:
            log(f"❌ POST trade failed: {resp.status_code} {resp.text}")
            return None
        
        trade_id = resp.json().get("item", {}).get("id")
        initial_duration = resp.json().get("item", {}).get("duration_minutes")
        log(f"✅ Created trade {trade_id}, initial duration_minutes={initial_duration}")
        
        # Now PATCH tanggal_close to next day
        patch_body = {"tanggal_close": "2026-10-01"}
        resp = requests.patch(f"{BASE_URL}/api/tj/trades/{trade_id}", json=patch_body, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            
            new_duration = item.get("duration_minutes")
            tanggal_close = item.get("tanggal_close")
            duration_label = item.get("duration_label")
            
            log(f"✅ PATCH successful")
            log(f"   tanggal_close: {tanggal_close}")
            log(f"   new duration_minutes: {new_duration}")
            log(f"   duration_label: {duration_label}")
            
            # Assertions: duration should increase by 24*60 = 1440
            expected_duration = initial_duration + 24 * 60
            assert new_duration == expected_duration, f"Expected duration_minutes={expected_duration}, got {new_duration}"
            assert tanggal_close == "2026-10-01", f"Expected tanggal_close='2026-10-01', got {tanggal_close}"
            
            log(f"✅ TEST 5 PASSED: duration increased from {initial_duration} to {new_duration} (+{24*60})")
            return trade_id
        else:
            log(f"❌ PATCH failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ TEST 5 exception: {e}")
        return None

def test_invalid_tanggal_close(token):
    """TEST 6: Negative/invalid dates (should default to tanggal entry)"""
    log("\n=== TEST 6: Invalid tanggal_close (should default to tanggal) ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "USDCAD",
        "tf": "M30",
        "metode": "Range Trading",
        "position": "SELL",
        "entry_price": 100,
        "sl_price": 105,
        "tp_price": 90,
        "sl_money": 50,
        "tp_money": 100,
        "tanggal": "2026-09-30",
        "jam_entry": "10:00",
        "tanggal_close": "invalid",
        "jam_close": "12:00",
        "hasil": "TP",
        "close_price": 90,
        "hasil_trade": 100
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            item = data.get("item", {})
            
            tanggal_close = item.get("tanggal_close")
            duration_minutes = item.get("duration_minutes")
            
            log(f"✅ POST trade successful")
            log(f"   Trade ID: {item.get('id')}")
            log(f"   tanggal_close: {tanggal_close} (should default to tanggal)")
            log(f"   duration_minutes: {duration_minutes}")
            
            # Assertions: invalid tanggal_close should default to tanggal
            assert tanggal_close == "2026-09-30", f"Expected tanggal_close='2026-09-30', got {tanggal_close}"
            assert duration_minutes == 120, f"Expected duration_minutes=120, got {duration_minutes}"
            
            log(f"✅ TEST 6 PASSED: invalid tanggal_close defaulted to tanggal")
            return item.get("id")
        else:
            log(f"❌ POST trade failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ TEST 6 exception: {e}")
        return None

def test_export_json(token):
    """TEST 7a: Export JSON includes tanggal_close and duration_label"""
    log("\n=== TEST 7a: Export JSON ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/export?format=json", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            trades = data.get("trades", [])
            
            log(f"✅ Export JSON successful, {len(trades)} trades")
            
            if len(trades) > 0:
                first_trade = trades[0]
                has_tanggal_close = "tanggal_close" in first_trade
                has_duration_label = "duration_label" in first_trade
                
                log(f"   First trade keys: {list(first_trade.keys())}")
                log(f"   tanggal_close present: {has_tanggal_close}")
                log(f"   duration_label present: {has_duration_label}")
                
                if has_tanggal_close:
                    log(f"   tanggal_close value: {first_trade.get('tanggal_close')}")
                if has_duration_label:
                    log(f"   duration_label value: {first_trade.get('duration_label')}")
                
                # Assertions
                assert has_tanggal_close, "tanggal_close field missing in JSON export"
                assert has_duration_label, "duration_label field missing in JSON export"
                
                log(f"✅ TEST 7a PASSED: JSON export includes tanggal_close and duration_label")
            else:
                log(f"⚠️  No trades in export, cannot verify fields")
            
            return True
        else:
            log(f"❌ Export JSON failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        log(f"❌ TEST 7a exception: {e}")
        return False

def test_export_csv(token):
    """TEST 7b: Export CSV includes tanggal_close and duration_label headers"""
    log("\n=== TEST 7b: Export CSV ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        resp = requests.get(f"{BASE_URL}/api/tj/export?format=csv", headers=headers, timeout=10)
        if resp.status_code == 200:
            csv_text = resp.text
            lines = csv_text.split('\n')
            
            log(f"✅ Export CSV successful, {len(lines)} lines")
            
            if len(lines) > 0:
                header_line = lines[0]
                headers_list = header_line.split(',')
                
                has_tanggal_close = "tanggal_close" in headers_list
                has_duration_label = "duration_label" in headers_list
                
                log(f"   CSV headers: {headers_list}")
                log(f"   tanggal_close in headers: {has_tanggal_close}")
                log(f"   duration_label in headers: {has_duration_label}")
                
                # Assertions
                assert has_tanggal_close, "tanggal_close header missing in CSV export"
                assert has_duration_label, "duration_label header missing in CSV export"
                
                log(f"✅ TEST 7b PASSED: CSV export includes tanggal_close and duration_label headers")
            else:
                log(f"⚠️  Empty CSV, cannot verify headers")
            
            return True
        else:
            log(f"❌ Export CSV failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        log(f"❌ TEST 7b exception: {e}")
        return False

def test_get_trades_list(token):
    """TEST 8: GET trades list returns tanggal_close and duration_label"""
    log("\n=== TEST 8: GET trades list ===")
    
    # First create a test trade to ensure we have at least one trade with tanggal_close
    headers = {"Authorization": f"Bearer {token}"}
    body = {
        "pair": "TESTPAIR",
        "tf": "H1",
        "metode": "Test",
        "position": "BUY",
        "entry_price": 100,
        "sl_price": 95,
        "tp_price": 110,
        "sl_money": 50,
        "tp_money": 100,
        "tanggal": "2026-09-30",
        "jam_entry": "10:00",
        "tanggal_close": "2026-09-30",
        "jam_close": "12:00",
        "hasil": "TP",
        "close_price": 110,
        "hasil_trade": 100
    }
    
    try:
        # Create test trade
        resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body, headers=headers, timeout=10)
        if resp.status_code != 200:
            log(f"❌ Failed to create test trade: {resp.status_code}")
            return False
        
        test_trade_id = resp.json().get("item", {}).get("id")
        log(f"✅ Created test trade {test_trade_id}")
        
        # Now GET trades list
        resp = requests.get(f"{BASE_URL}/api/tj/trades", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            
            log(f"✅ GET trades list successful, {len(items)} trades")
            
            # Find our test trade
            test_trade = None
            for item in items:
                if item.get("id") == test_trade_id:
                    test_trade = item
                    break
            
            if test_trade:
                has_tanggal_close = "tanggal_close" in test_trade
                has_duration_label = "duration_label" in test_trade
                
                log(f"   Test trade keys: {list(test_trade.keys())}")
                log(f"   tanggal_close present: {has_tanggal_close}")
                log(f"   duration_label present: {has_duration_label}")
                
                if has_tanggal_close:
                    log(f"   tanggal_close value: {test_trade.get('tanggal_close')}")
                if has_duration_label:
                    log(f"   duration_label value: {test_trade.get('duration_label')}")
                
                # Cleanup test trade
                requests.delete(f"{BASE_URL}/api/tj/trades/{test_trade_id}", headers=headers, timeout=10)
                log(f"✅ Cleaned up test trade {test_trade_id}")
                
                # Assertions
                assert has_tanggal_close, "tanggal_close field missing in trades list"
                assert has_duration_label, "duration_label field missing in trades list"
                
                log(f"✅ TEST 8 PASSED: GET trades list includes tanggal_close and duration_label")
                return True
            else:
                log(f"❌ Test trade not found in list")
                return False
        else:
            log(f"❌ GET trades list failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        log(f"❌ TEST 8 exception: {e}")
        return False

def test_cleanup(token, trade_ids):
    """TEST 9: Cleanup - delete all test trades"""
    log("\n=== TEST 9: Cleanup ===")
    
    headers = {"Authorization": f"Bearer {token}"}
    deleted_count = 0
    
    for trade_id in trade_ids:
        if trade_id:
            try:
                resp = requests.delete(f"{BASE_URL}/api/tj/trades/{trade_id}", headers=headers, timeout=10)
                if resp.status_code == 200:
                    deleted_count += 1
                    log(f"✅ Deleted trade {trade_id}")
                else:
                    log(f"⚠️  Failed to delete trade {trade_id}: {resp.status_code}")
            except Exception as e:
                log(f"⚠️  Exception deleting trade {trade_id}: {e}")
    
    log(f"✅ TEST 9 PASSED: Deleted {deleted_count}/{len(trade_ids)} test trades")
    return True

def main():
    log("=" * 80)
    log("TRADING JOURNAL DURATION RECOMPUTATION TEST")
    log("=" * 80)
    
    # Login
    token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not token:
        log("❌ FATAL: Cannot login, aborting tests")
        return
    
    # Track created trade IDs for cleanup
    trade_ids = []
    
    # Run tests
    test_results = []
    
    # TEST 1: POST trade with explicit tanggal_close cross-day (4 hours)
    trade_id = test_post_trade_cross_day_explicit(token)
    test_results.append(("TEST 1: POST cross-day explicit tanggal_close", trade_id is not None))
    if trade_id:
        trade_ids.append(trade_id)
    
    # TEST 2: POST trade longer cross-day (28h15m)
    trade_id = test_post_trade_long_cross_day(token)
    test_results.append(("TEST 2: POST long cross-day (28h15m)", trade_id is not None))
    if trade_id:
        trade_ids.append(trade_id)
    
    # TEST 3: POST trade same-day without tanggal_close
    trade_id = test_post_trade_same_day_no_tanggal_close(token)
    test_results.append(("TEST 3: POST same-day no tanggal_close", trade_id is not None))
    if trade_id:
        trade_ids.append(trade_id)
    
    # TEST 4: BWC legacy trade (missing tanggal_close)
    trade_id = test_bwc_legacy_trade(token)
    test_results.append(("TEST 4: BWC legacy trade", trade_id is not None))
    if trade_id:
        trade_ids.append(trade_id)
    
    # TEST 5: PATCH tanggal_close
    trade_id = test_patch_tanggal_close(token)
    test_results.append(("TEST 5: PATCH tanggal_close", trade_id is not None))
    if trade_id:
        trade_ids.append(trade_id)
    
    # TEST 6: Invalid tanggal_close
    trade_id = test_invalid_tanggal_close(token)
    test_results.append(("TEST 6: Invalid tanggal_close", trade_id is not None))
    if trade_id:
        trade_ids.append(trade_id)
    
    # TEST 7a: Export JSON
    result = test_export_json(token)
    test_results.append(("TEST 7a: Export JSON", result))
    
    # TEST 7b: Export CSV
    result = test_export_csv(token)
    test_results.append(("TEST 7b: Export CSV", result))
    
    # TEST 8: GET trades list
    result = test_get_trades_list(token)
    test_results.append(("TEST 8: GET trades list", result))
    
    # TEST 9: Cleanup
    result = test_cleanup(token, trade_ids)
    test_results.append(("TEST 9: Cleanup", result))
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    log("=" * 80)
    log(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    log("=" * 80)
    
    if passed == total:
        log("✅ ALL TESTS PASSED")
    else:
        log(f"❌ {total - passed} TEST(S) FAILED")

if __name__ == "__main__":
    main()
