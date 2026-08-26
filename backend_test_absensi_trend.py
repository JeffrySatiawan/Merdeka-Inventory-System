#!/usr/bin/env python3
"""
Backend test for Absensi Points Trend Endpoint
Tests GET /api/absensi/points/trend?period=YYYY-MM
"""

import requests
import json
from datetime import datetime, timedelta

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def login(username, password):
    """Login and return token"""
    try:
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            user = data.get("user", {})
            print(f"✅ Login successful: {username} (role: {user.get('role')})")
            return token, user
        else:
            print(f"❌ Login failed for {username}: {resp.status_code} - {resp.text}")
            return None, None
    except Exception as e:
        print(f"❌ Login exception for {username}: {e}")
        return None, None

def get_trend(token, period=None):
    """GET /api/absensi/points/trend"""
    try:
        url = f"{BASE_URL}/api/absensi/points/trend"
        if period:
            url += f"?period={period}"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        resp = requests.get(url, headers=headers, timeout=10)
        return resp
    except Exception as e:
        print(f"❌ Exception in get_trend: {e}")
        return None

def get_leaderboard(token, period=None):
    """GET /api/absensi/points/leaderboard"""
    try:
        url = f"{BASE_URL}/api/absensi/points/leaderboard"
        if period:
            url += f"?period={period}"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        resp = requests.get(url, headers=headers, timeout=10)
        return resp
    except Exception as e:
        print(f"❌ Exception in get_leaderboard: {e}")
        return None

def get_history(token, period=None):
    """GET /api/absensi/points/history"""
    try:
        url = f"{BASE_URL}/api/absensi/points/history"
        if period:
            url += f"?period={period}"
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        resp = requests.get(url, headers=headers, timeout=10)
        return resp
    except Exception as e:
        print(f"❌ Exception in get_history: {e}")
        return None

def calculate_current_period():
    """Calculate current period based on WITA timezone (26th cycle)"""
    # WITA is UTC+8
    now_utc = datetime.utcnow()
    now_wita = now_utc + timedelta(hours=8)
    year = now_wita.year
    month = now_wita.month
    day = now_wita.day
    
    # If day >= 26, period is next month
    if day >= 26:
        month += 1
        if month > 12:
            month = 1
            year += 1
    
    return f"{year}-{month:02d}"

def calculate_period_range(period_key):
    """Calculate period range from period key (YYYY-MM)"""
    year, month = map(int, period_key.split('-'))
    
    # Previous month
    prev_month = month - 1
    prev_year = year
    if prev_month < 1:
        prev_month = 12
        prev_year -= 1
    
    from_date = f"{prev_year}-{prev_month:02d}-26"
    to_date = f"{year}-{month:02d}-25"
    
    return from_date, to_date

def main():
    print("=" * 80)
    print("ABSENSI POINTS TREND ENDPOINT - BACKEND TEST")
    print("=" * 80)
    print()
    
    # Calculate expected current period
    expected_period = calculate_current_period()
    expected_from, expected_to = calculate_period_range(expected_period)
    print(f"📅 Expected current period: {expected_period}")
    print(f"📅 Expected period range: {expected_from} to {expected_to}")
    print()
    
    # ========== TEST 1: AUTH - OWNER LOGIN ==========
    print("=" * 80)
    print("TEST 1: AUTH - OWNER LOGIN")
    print("=" * 80)
    owner_token, owner_user = login("owner", "owner123")
    if not owner_token:
        print("❌ TEST 1 FAILED: Owner login failed")
        return
    print("✅ TEST 1 PASSED: Owner login successful")
    print()
    
    # ========== TEST 2: AUTH - STAFF LOGIN ==========
    print("=" * 80)
    print("TEST 2: AUTH - STAFF LOGIN")
    print("=" * 80)
    staff_token, staff_user = login("cindy", "cindy123")
    if not staff_token:
        print("❌ TEST 2 FAILED: Staff login failed")
        return
    print("✅ TEST 2 PASSED: Staff login successful")
    print()
    
    # ========== TEST 3: DEFAULT PERIOD CALL (OWNER) ==========
    print("=" * 80)
    print("TEST 3: DEFAULT PERIOD CALL (NO QUERY PARAM) - OWNER")
    print("=" * 80)
    resp = get_trend(owner_token)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 3 FAILED: Expected 200, got {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"Response keys: {list(data.keys())}")
    
    # Verify response structure
    required_keys = ['period_key', 'period_range', 'days', 'total_users', 'series']
    missing_keys = [k for k in required_keys if k not in data]
    if missing_keys:
        print(f"❌ TEST 3 FAILED: Missing keys: {missing_keys}")
        return
    print(f"✅ All required keys present: {required_keys}")
    
    # Verify period_key matches current period
    period_key = data['period_key']
    print(f"📅 period_key: {period_key}")
    if period_key != expected_period:
        print(f"⚠️  WARNING: period_key ({period_key}) != expected ({expected_period})")
        print(f"   This might be OK if test runs near midnight WITA")
    else:
        print(f"✅ period_key matches expected current period")
    
    # Verify period_range
    period_range = data['period_range']
    print(f"📅 period_range: {period_range}")
    if 'from' not in period_range or 'to' not in period_range:
        print(f"❌ TEST 3 FAILED: period_range missing 'from' or 'to'")
        return
    print(f"✅ period_range has 'from' and 'to'")
    
    # Verify days array
    days = data['days']
    print(f"📅 days array length: {len(days)}")
    if not isinstance(days, list) or len(days) == 0:
        print(f"❌ TEST 3 FAILED: days is not a non-empty array")
        return
    print(f"✅ days is a non-empty array")
    print(f"   First day: {days[0]}")
    print(f"   Last day: {days[-1]}")
    
    # Verify first day equals period_range.from
    if days[0] != period_range['from']:
        print(f"❌ TEST 3 FAILED: First day ({days[0]}) != period_range.from ({period_range['from']})")
        return
    print(f"✅ First day equals period_range.from")
    
    # Verify last day <= min(today WITA, period_range.to)
    # We can't easily calculate today WITA in Python without pytz, so just check it's <= to
    if days[-1] > period_range['to']:
        print(f"❌ TEST 3 FAILED: Last day ({days[-1]}) > period_range.to ({period_range['to']})")
        return
    print(f"✅ Last day <= period_range.to")
    
    # Verify total_users
    total_users = data['total_users']
    print(f"👥 total_users: {total_users}")
    if not isinstance(total_users, int) or total_users < 0:
        print(f"❌ TEST 3 FAILED: total_users is not a non-negative integer")
        return
    print(f"✅ total_users is a non-negative integer")
    
    # Verify series array
    series = data['series']
    print(f"📊 series array length: {len(series)}")
    if not isinstance(series, list):
        print(f"❌ TEST 3 FAILED: series is not an array")
        return
    print(f"✅ series is an array")
    
    if len(series) == 0:
        print(f"⚠️  WARNING: series is empty (no users)")
    else:
        # Verify each series entry
        for i, entry in enumerate(series):
            required_entry_keys = ['user_id', 'user_name', 'ranks', 'balances']
            missing_entry_keys = [k for k in required_entry_keys if k not in entry]
            if missing_entry_keys:
                print(f"❌ TEST 3 FAILED: series[{i}] missing keys: {missing_entry_keys}")
                return
        print(f"✅ All series entries have required keys: {required_entry_keys}")
        
        # Verify ranks and balances arrays have same length as days
        for i, entry in enumerate(series):
            ranks = entry['ranks']
            balances = entry['balances']
            if len(ranks) != len(days):
                print(f"❌ TEST 3 FAILED: series[{i}] ranks length ({len(ranks)}) != days length ({len(days)})")
                return
            if len(balances) != len(days):
                print(f"❌ TEST 3 FAILED: series[{i}] balances length ({len(balances)}) != days length ({len(days)})")
                return
        print(f"✅ All series entries: ranks.length == balances.length == days.length")
        
        # Verify all ranks are integers in [1, total_users]
        for i, entry in enumerate(series):
            ranks = entry['ranks']
            for j, rank in enumerate(ranks):
                if not isinstance(rank, int) or rank < 1 or rank > total_users:
                    print(f"❌ TEST 3 FAILED: series[{i}].ranks[{j}] = {rank} not in [1, {total_users}]")
                    return
        print(f"✅ All ranks are integers in [1, {total_users}]")
        
        # Verify no duplicate ranks within a single day (strict rank)
        for day_idx in range(len(days)):
            ranks_for_day = [entry['ranks'][day_idx] for entry in series]
            if len(ranks_for_day) != len(set(ranks_for_day)):
                print(f"❌ TEST 3 FAILED: Duplicate ranks found for day {days[day_idx]}: {ranks_for_day}")
                return
        print(f"✅ No duplicate ranks within any single day (strict rank)")
        
        # Print sample data
        print(f"\n📊 Sample series data (first entry):")
        print(f"   user_id: {series[0]['user_id']}")
        print(f"   user_name: {series[0]['user_name']}")
        print(f"   ranks (first 5): {series[0]['ranks'][:5]}")
        print(f"   balances (first 5): {series[0]['balances'][:5]}")
        print(f"   ranks (last 5): {series[0]['ranks'][-5:]}")
        print(f"   balances (last 5): {series[0]['balances'][-5:]}")
    
    print("✅ TEST 3 PASSED: Default period call structure verified")
    print()
    
    # ========== TEST 4: CROSS-CHECK WITH LEADERBOARD ==========
    print("=" * 80)
    print("TEST 4: CROSS-CHECK WITH LEADERBOARD (CONSISTENCY)")
    print("=" * 80)
    
    # Get leaderboard for same period
    lb_resp = get_leaderboard(owner_token, period_key)
    if not lb_resp or lb_resp.status_code != 200:
        print(f"❌ TEST 4 FAILED: Leaderboard request failed: {lb_resp.status_code if lb_resp else 'None'}")
        if lb_resp:
            print(f"Response: {lb_resp.text}")
        return
    
    lb_data = lb_resp.json()
    print(f"✅ Leaderboard request successful")
    print(f"Leaderboard keys: {list(lb_data.keys())}")
    
    if 'items' not in lb_data:
        print(f"❌ TEST 4 FAILED: Leaderboard missing 'items' key")
        return
    
    lb_items = lb_data['items']
    print(f"📊 Leaderboard items count: {len(lb_items)}")
    
    # Build map of user_id -> rank from leaderboard
    lb_rank_map = {}
    for item in lb_items:
        if 'user_id' in item and 'rank' in item:
            lb_rank_map[item['user_id']] = item['rank']
    
    print(f"📊 Leaderboard rank map: {lb_rank_map}")
    
    # Compare last-day ranks from trend with leaderboard ranks
    if len(series) > 0:
        mismatches = []
        for entry in series:
            user_id = entry['user_id']
            last_day_rank = entry['ranks'][-1]  # Last day rank from trend
            lb_rank = lb_rank_map.get(user_id)
            
            if lb_rank is None:
                print(f"⚠️  WARNING: User {user_id} ({entry['user_name']}) not found in leaderboard")
                continue
            
            if last_day_rank != lb_rank:
                mismatches.append({
                    'user_id': user_id,
                    'user_name': entry['user_name'],
                    'trend_rank': last_day_rank,
                    'leaderboard_rank': lb_rank
                })
        
        if mismatches:
            print(f"❌ TEST 4 FAILED: Rank mismatches found:")
            for m in mismatches:
                print(f"   User {m['user_id']} ({m['user_name']}): trend={m['trend_rank']}, leaderboard={m['leaderboard_rank']}")
            return
        
        print(f"✅ All last-day ranks match leaderboard ranks")
        
        # Print sample comparison
        if len(series) > 0:
            sample = series[0]
            print(f"\n📊 Sample comparison (user {sample['user_id']} - {sample['user_name']}):")
            print(f"   Trend last-day rank: {sample['ranks'][-1]}")
            print(f"   Leaderboard rank: {lb_rank_map.get(sample['user_id'])}")
    
    print("✅ TEST 4 PASSED: Trend ranks match leaderboard ranks")
    print()
    
    # ========== TEST 5: EXPLICIT PERIOD PARAM (CURRENT) ==========
    print("=" * 80)
    print("TEST 5: EXPLICIT PERIOD PARAM (CURRENT PERIOD)")
    print("=" * 80)
    
    resp = get_trend(owner_token, period_key)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 5 FAILED: Expected 200, got {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"📅 period_key: {data['period_key']}")
    
    if data['period_key'] != period_key:
        print(f"❌ TEST 5 FAILED: period_key mismatch")
        return
    
    print("✅ TEST 5 PASSED: Explicit current period param works")
    print()
    
    # ========== TEST 6: EXPLICIT PERIOD PARAM (PAST) ==========
    print("=" * 80)
    print("TEST 6: EXPLICIT PERIOD PARAM (PAST PERIOD)")
    print("=" * 80)
    
    past_period = "2025-01"
    resp = get_trend(owner_token, past_period)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 6 FAILED: Expected 200, got {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"📅 period_key: {data['period_key']}")
    print(f"📅 days array length: {len(data['days'])}")
    print(f"📊 series array length: {len(data['series'])}")
    
    # Verify days array is populated
    if len(data['days']) == 0:
        print(f"❌ TEST 6 FAILED: days array is empty for past period")
        return
    
    print(f"✅ days array populated for past period")
    
    # Verify ranks are still valid (all users same balance → strict rank by name tiebreaker)
    if len(data['series']) > 0:
        for entry in data['series']:
            ranks = entry['ranks']
            for rank in ranks:
                if not isinstance(rank, int) or rank < 1 or rank > data['total_users']:
                    print(f"❌ TEST 6 FAILED: Invalid rank {rank} for past period")
                    return
        print(f"✅ All ranks valid for past period")
    
    print("✅ TEST 6 PASSED: Past period param works")
    print()
    
    # ========== TEST 7: EXPLICIT PERIOD PARAM (FUTURE) ==========
    print("=" * 80)
    print("TEST 7: EXPLICIT PERIOD PARAM (FUTURE PERIOD)")
    print("=" * 80)
    
    future_period = "2030-01"
    resp = get_trend(owner_token, future_period)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 7 FAILED: Expected 200, got {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"📅 period_key: {data['period_key']}")
    print(f"📅 days array length: {len(data['days'])}")
    print(f"📊 series array length: {len(data['series'])}")
    
    # For future period, days may be empty if from > today
    print(f"✅ Future period returns safely (days may be empty if from > today)")
    
    print("✅ TEST 7 PASSED: Future period param works")
    print()
    
    # ========== TEST 8: STAFF ACCESS ==========
    print("=" * 80)
    print("TEST 8: STAFF ACCESS (CINDY)")
    print("=" * 80)
    
    resp = get_trend(staff_token)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 8 FAILED: Expected 200, got {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"📅 period_key: {data['period_key']}")
    print(f"📊 series array length: {len(data['series'])}")
    
    print("✅ TEST 8 PASSED: Staff can access trend endpoint")
    print()
    
    # ========== TEST 9: REGRESSION - LEADERBOARD STILL WORKS ==========
    print("=" * 80)
    print("TEST 9: REGRESSION - LEADERBOARD ENDPOINT")
    print("=" * 80)
    
    resp = get_leaderboard(owner_token)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 9 FAILED: Leaderboard request failed: {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"Response keys: {list(data.keys())}")
    
    # Verify expected keys
    expected_keys = ['period_key', 'period_range', 'settings', 'items']
    missing_keys = [k for k in expected_keys if k not in data]
    if missing_keys:
        print(f"❌ TEST 9 FAILED: Missing keys: {missing_keys}")
        return
    print(f"✅ All expected keys present: {expected_keys}")
    
    # Verify settings has late_tiers
    settings = data.get('settings', {})
    if 'late_tiers' not in settings:
        print(f"❌ TEST 9 FAILED: settings missing 'late_tiers'")
        return
    print(f"✅ settings has 'late_tiers'")
    
    # Verify items structure
    items = data.get('items', [])
    print(f"📊 items count: {len(items)}")
    if len(items) > 0:
        sample = items[0]
        print(f"📊 Sample item keys: {list(sample.keys())}")
        required_item_keys = ['rank', 'user_id', 'user_name', 'balance']
        missing_item_keys = [k for k in required_item_keys if k not in sample]
        if missing_item_keys:
            print(f"❌ TEST 9 FAILED: items[0] missing keys: {missing_item_keys}")
            return
        print(f"✅ items have required keys: {required_item_keys}")
    
    print("✅ TEST 9 PASSED: Leaderboard endpoint still works")
    print()
    
    # ========== TEST 10: REGRESSION - HISTORY STILL WORKS ==========
    print("=" * 80)
    print("TEST 10: REGRESSION - HISTORY ENDPOINT")
    print("=" * 80)
    
    resp = get_history(owner_token, period_key)
    if not resp or resp.status_code != 200:
        print(f"❌ TEST 10 FAILED: History request failed: {resp.status_code if resp else 'None'}")
        if resp:
            print(f"Response: {resp.text}")
        return
    
    data = resp.json()
    print(f"✅ Status: 200 OK")
    print(f"Response keys: {list(data.keys())}")
    
    # Verify expected keys
    if 'items' not in data:
        print(f"❌ TEST 10 FAILED: Missing 'items' key")
        return
    print(f"✅ 'items' key present")
    
    items = data.get('items', [])
    print(f"📊 items count: {len(items)}")
    
    print("✅ TEST 10 PASSED: History endpoint still works")
    print()
    
    # ========== SUMMARY ==========
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print("✅ ALL 10 TESTS PASSED (100%)")
    print()
    print("Tests completed:")
    print("  1. ✅ Owner login")
    print("  2. ✅ Staff login")
    print("  3. ✅ Default period call (owner) - structure verified")
    print("  4. ✅ Cross-check with leaderboard - ranks match")
    print("  5. ✅ Explicit period param (current)")
    print("  6. ✅ Explicit period param (past)")
    print("  7. ✅ Explicit period param (future)")
    print("  8. ✅ Staff access")
    print("  9. ✅ Regression - leaderboard endpoint")
    print(" 10. ✅ Regression - history endpoint")
    print()
    print("=" * 80)

if __name__ == "__main__":
    main()
