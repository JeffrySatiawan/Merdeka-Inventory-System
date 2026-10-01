#!/usr/bin/env python3
"""
Detailed test report for Trading Journal duration recomputation changes.
Captures exact response bodies for critical scenarios.
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=10)
    if resp.status_code == 200:
        return resp.json().get("token")
    return None

def main():
    log("=" * 80)
    log("TRADING JOURNAL DURATION RECOMPUTATION - DETAILED TEST REPORT")
    log("=" * 80)
    
    token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not token:
        log("❌ FATAL: Cannot login")
        return
    
    headers = {"Authorization": f"Bearer {token}"}
    trade_ids = []
    
    # ========================================================================
    # SCENARIO 1: POST trade with explicit tanggal_close cross-day (4 hours)
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO 1: POST trade with explicit tanggal_close cross-day (4 hours)")
    log("=" * 80)
    
    body1 = {
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
    
    log(f"\nREQUEST: POST /api/tj/trades")
    log(f"Body: {json.dumps(body1, indent=2)}")
    
    resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body1, headers=headers, timeout=10)
    log(f"\nRESPONSE: {resp.status_code}")
    log(f"Body: {json.dumps(resp.json(), indent=2)}")
    
    item1 = resp.json().get("item", {})
    trade_ids.append(item1.get("id"))
    
    log(f"\n✅ VERIFICATION:")
    log(f"   duration_minutes: {item1.get('duration_minutes')} (expected: 240)")
    log(f"   duration_label: '{item1.get('duration_label')}' (expected: '4 jam')")
    log(f"   tanggal_close: '{item1.get('tanggal_close')}' (expected: '2026-09-30')")
    
    assert item1.get("duration_minutes") == 240, "FAIL: duration_minutes != 240"
    assert item1.get("duration_label") == "4 jam", "FAIL: duration_label != '4 jam'"
    assert item1.get("tanggal_close") == "2026-09-30", "FAIL: tanggal_close != '2026-09-30'"
    log(f"   ✅ PASS")
    
    # ========================================================================
    # SCENARIO 2: POST trade longer cross-day (28h15m = 1 day 4h 15m)
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO 2: POST trade longer cross-day (28h15m = 1 day 4h 15m)")
    log("=" * 80)
    
    body2 = {
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
    
    log(f"\nREQUEST: POST /api/tj/trades")
    log(f"Body: {json.dumps(body2, indent=2)}")
    
    resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body2, headers=headers, timeout=10)
    log(f"\nRESPONSE: {resp.status_code}")
    log(f"Body: {json.dumps(resp.json(), indent=2)}")
    
    item2 = resp.json().get("item", {})
    trade_ids.append(item2.get("id"))
    
    log(f"\n✅ VERIFICATION:")
    log(f"   duration_minutes: {item2.get('duration_minutes')} (expected: 1695)")
    log(f"   duration_label: '{item2.get('duration_label')}' (expected: '1 hari 4 jam 15 menit')")
    
    assert item2.get("duration_minutes") == 1695, "FAIL: duration_minutes != 1695"
    assert item2.get("duration_label") == "1 hari 4 jam 15 menit", "FAIL: duration_label != '1 hari 4 jam 15 menit'"
    log(f"   ✅ PASS")
    
    # ========================================================================
    # SCENARIO 4: BWC legacy trade (missing tanggal_close)
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO 4: BWC legacy trade (missing tanggal_close)")
    log("=" * 80)
    
    body4 = {
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
    
    log(f"\nSTEP 1: Create trade")
    resp = requests.post(f"{BASE_URL}/api/tj/trades", json=body4, headers=headers, timeout=10)
    trade_id4 = resp.json().get("item", {}).get("id")
    trade_ids.append(trade_id4)
    log(f"Created trade: {trade_id4}")
    
    log(f"\nSTEP 2: Unset tanggal_close via MongoDB to simulate legacy trade")
    from pymongo import MongoClient
    client = MongoClient("mongodb://localhost:27017")
    db = client["cycle_count"]
    result = db.tj_trades.update_one({"id": trade_id4}, {"$unset": {"tanggal_close": ""}})
    log(f"MongoDB update: matched={result.matched_count}, modified={result.modified_count}")
    
    log(f"\nSTEP 3: GET trade to verify BWC fallback")
    log(f"REQUEST: GET /api/tj/trades/{trade_id4}")
    
    resp = requests.get(f"{BASE_URL}/api/tj/trades/{trade_id4}", headers=headers, timeout=10)
    log(f"\nRESPONSE: {resp.status_code}")
    log(f"Body: {json.dumps(resp.json(), indent=2)}")
    
    item4 = resp.json().get("item", {})
    
    log(f"\n✅ VERIFICATION:")
    log(f"   tanggal_close: {item4.get('tanggal_close')} (expected: None/missing)")
    log(f"   duration_minutes: {item4.get('duration_minutes')} (expected: 240 with BWC +24h fallback)")
    log(f"   duration_label: '{item4.get('duration_label')}' (expected: '4 jam')")
    log(f"   BWC Logic: jam_close (03:00) < jam_entry (23:00) → add 24h → 240 minutes")
    
    assert item4.get("duration_minutes") == 240, "FAIL: BWC fallback not working"
    log(f"   ✅ PASS")
    
    # ========================================================================
    # SCENARIO 7: Export CSV/JSON
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO 7: Export CSV/JSON")
    log("=" * 80)
    
    log(f"\nREQUEST: GET /api/tj/export?format=json")
    resp = requests.get(f"{BASE_URL}/api/tj/export?format=json", headers=headers, timeout=10)
    log(f"\nRESPONSE: {resp.status_code}")
    data = resp.json()
    log(f"Total trades: {len(data.get('trades', []))}")
    
    if data.get("trades"):
        first_trade = data["trades"][0]
        log(f"\nFirst trade in JSON export:")
        log(f"  tanggal: {first_trade.get('tanggal')}")
        log(f"  tanggal_close: {first_trade.get('tanggal_close')}")
        log(f"  duration_minutes: {first_trade.get('duration_minutes')}")
        log(f"  duration_label: '{first_trade.get('duration_label')}'")
        
        assert "tanggal_close" in first_trade, "FAIL: tanggal_close missing in JSON export"
        assert "duration_label" in first_trade, "FAIL: duration_label missing in JSON export"
        log(f"  ✅ PASS: JSON export includes tanggal_close and duration_label")
    
    log(f"\nREQUEST: GET /api/tj/export?format=csv")
    resp = requests.get(f"{BASE_URL}/api/tj/export?format=csv", headers=headers, timeout=10)
    log(f"\nRESPONSE: {resp.status_code}")
    csv_lines = resp.text.split('\n')
    headers_line = csv_lines[0] if csv_lines else ""
    log(f"CSV Headers: {headers_line}")
    
    assert "tanggal_close" in headers_line, "FAIL: tanggal_close missing in CSV headers"
    assert "duration_label" in headers_line, "FAIL: duration_label missing in CSV headers"
    log(f"✅ PASS: CSV export includes tanggal_close and duration_label headers")
    
    # ========================================================================
    # CLEANUP
    # ========================================================================
    log("\n" + "=" * 80)
    log("CLEANUP")
    log("=" * 80)
    
    for trade_id in trade_ids:
        if trade_id:
            resp = requests.delete(f"{BASE_URL}/api/tj/trades/{trade_id}", headers=headers, timeout=10)
            log(f"Deleted trade {trade_id}: {resp.status_code}")
    
    log("\n" + "=" * 80)
    log("✅ ALL CRITICAL SCENARIOS PASSED")
    log("=" * 80)

if __name__ == "__main__":
    main()
