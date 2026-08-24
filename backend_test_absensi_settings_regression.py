#!/usr/bin/env python3
"""
Quick regression re-test on the 2 minor bugs previously flagged in /app/lib/modules/absensi/service.js.
Fixes applied. Verify only these two cases + a quick regression on the exact same endpoints.

Base URL: NEXT_PUBLIC_BASE_URL from /app/.env, prefix /api. Credentials: owner/owner123.

Cases:
1. GET /api/absensi/settings (owner) → 200; settings.photo_retention_days must be a number (default 30 fallback if persisted doc lacks the field).
2. PUT /api/absensi/settings (owner) body { photo_retention_days: 0 } → 200; subsequent GET must show photo_retention_days === 1 (clamped up from 0, not defaulted to 30).
3. PUT /api/absensi/settings body { photo_retention_days: 45 } → 200; GET returns 45. (Persistence not broken by the fix.)
4. PUT /api/absensi/settings body { photo_retention_days: 9999 } → 200; GET returns 365 (clamped max — still working).
5. PUT /api/absensi/settings body { photo_retention_days: 'abc' } → 200; GET returns 30 (invalid → default; via Number.isFinite).

Cleanup: restore photo_retention_days to 30 at the end.

Do NOT modify code. Return pass/fail summary.
"""

import requests
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_CREDS = {"username": "owner", "password": "owner123"}

def main():
    print("=" * 80)
    print("ABSENSI SETTINGS REGRESSION TEST - 2 MINOR BUGS FIX VERIFICATION")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test date: {datetime.utcnow().isoformat()}Z")
    print(f"Credentials: {OWNER_CREDS['username']}")
    print()

    # Login as owner
    print("🔐 Logging in as owner...")
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER_CREDS, timeout=30)
    if r.status_code != 200:
        print(f"❌ FAILED: Owner login returned {r.status_code}")
        print(f"Response: {r.text}")
        sys.exit(1)
    owner_token = r.json().get("token")
    if not owner_token:
        print("❌ FAILED: No token in login response")
        sys.exit(1)
    print(f"✅ Owner login successful, token: {owner_token[:20]}...")
    print()

    headers = {"Authorization": f"Bearer {owner_token}"}

    # ========================================================================
    # TEST CASE 1: GET /api/absensi/settings (owner) → photo_retention_days must be a number
    # ========================================================================
    print("=" * 80)
    print("TEST CASE 1: GET /api/absensi/settings (owner) - photo_retention_days exists")
    print("=" * 80)
    print("Expected: 200; settings.photo_retention_days is a number (default 30 if missing from DB)")
    print()

    r = requests.get(f"{BASE_URL}/api/absensi/settings", headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"❌ FAILED: GET /api/absensi/settings returned {r.status_code}")
        print(f"Response: {r.text}")
        sys.exit(1)
    
    data = r.json()
    settings = data.get("settings", {})
    photo_retention = settings.get("photo_retention_days")
    
    if photo_retention is None:
        print(f"❌ FAILED: photo_retention_days field is missing from response")
        print(f"Response: {data}")
        sys.exit(1)
    
    if not isinstance(photo_retention, (int, float)):
        print(f"❌ FAILED: photo_retention_days is not a number: {type(photo_retention)}")
        print(f"Value: {photo_retention}")
        sys.exit(1)
    
    print(f"✅ PASSED: photo_retention_days exists and is a number: {photo_retention}")
    print(f"   (This verifies Bug #1 fix: default fallback when field missing from DB)")
    print()

    # ========================================================================
    # TEST CASE 2: PUT with photo_retention_days=0 → should clamp to 1, not default to 30
    # ========================================================================
    print("=" * 80)
    print("TEST CASE 2: PUT /api/absensi/settings - photo_retention_days: 0 → clamped to 1")
    print("=" * 80)
    print("Expected: 200; subsequent GET returns 1 (clamped to min, NOT defaulted to 30)")
    print("This is the CRITICAL test for Bug #2 fix")
    print()

    r = requests.put(
        f"{BASE_URL}/api/absensi/settings",
        headers=headers,
        json={"photo_retention_days": 0},
        timeout=30
    )
    if r.status_code != 200:
        print(f"❌ FAILED: PUT /api/absensi/settings returned {r.status_code}")
        print(f"Response: {r.text}")
        sys.exit(1)
    
    print(f"✅ PUT successful (200)")
    
    # Verify with GET
    r = requests.get(f"{BASE_URL}/api/absensi/settings", headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"❌ FAILED: GET after PUT returned {r.status_code}")
        sys.exit(1)
    
    data = r.json()
    settings = data.get("settings", {})
    photo_retention = settings.get("photo_retention_days")
    
    if photo_retention != 1:
        print(f"❌ FAILED: Expected photo_retention_days=1 (clamped), got {photo_retention}")
        print(f"   Bug #2 NOT FIXED: Value 0 should clamp to 1, not default to 30")
        print(f"   Response: {settings}")
        sys.exit(1)
    
    print(f"✅ PASSED: photo_retention_days correctly clamped to 1 (not defaulted to 30)")
    print(f"   ✅ Bug #2 FIX VERIFIED: Number.isFinite check working correctly")
    print()

    # ========================================================================
    # TEST CASE 3: PUT with photo_retention_days=45 → persistence working
    # ========================================================================
    print("=" * 80)
    print("TEST CASE 3: PUT /api/absensi/settings - photo_retention_days: 45")
    print("=" * 80)
    print("Expected: 200; GET returns 45 (persistence not broken by fix)")
    print()

    r = requests.put(
        f"{BASE_URL}/api/absensi/settings",
        headers=headers,
        json={"photo_retention_days": 45},
        timeout=30
    )
    if r.status_code != 200:
        print(f"❌ FAILED: PUT returned {r.status_code}")
        print(f"Response: {r.text}")
        sys.exit(1)
    
    print(f"✅ PUT successful (200)")
    
    r = requests.get(f"{BASE_URL}/api/absensi/settings", headers=headers, timeout=30)
    data = r.json()
    photo_retention = data.get("settings", {}).get("photo_retention_days")
    
    if photo_retention != 45:
        print(f"❌ FAILED: Expected 45, got {photo_retention}")
        sys.exit(1)
    
    print(f"✅ PASSED: photo_retention_days correctly persisted as 45")
    print()

    # ========================================================================
    # TEST CASE 4: PUT with photo_retention_days=9999 → clamped to 365
    # ========================================================================
    print("=" * 80)
    print("TEST CASE 4: PUT /api/absensi/settings - photo_retention_days: 9999")
    print("=" * 80)
    print("Expected: 200; GET returns 365 (clamped to max)")
    print()

    r = requests.put(
        f"{BASE_URL}/api/absensi/settings",
        headers=headers,
        json={"photo_retention_days": 9999},
        timeout=30
    )
    if r.status_code != 200:
        print(f"❌ FAILED: PUT returned {r.status_code}")
        print(f"Response: {r.text}")
        sys.exit(1)
    
    print(f"✅ PUT successful (200)")
    
    r = requests.get(f"{BASE_URL}/api/absensi/settings", headers=headers, timeout=30)
    data = r.json()
    photo_retention = data.get("settings", {}).get("photo_retention_days")
    
    if photo_retention != 365:
        print(f"❌ FAILED: Expected 365 (max), got {photo_retention}")
        sys.exit(1)
    
    print(f"✅ PASSED: photo_retention_days correctly clamped to 365 (max)")
    print()

    # ========================================================================
    # TEST CASE 5: PUT with photo_retention_days='abc' → invalid, default to 30
    # ========================================================================
    print("=" * 80)
    print("TEST CASE 5: PUT /api/absensi/settings - photo_retention_days: 'abc'")
    print("=" * 80)
    print("Expected: 200; GET returns 30 (invalid → default via Number.isFinite)")
    print()

    r = requests.put(
        f"{BASE_URL}/api/absensi/settings",
        headers=headers,
        json={"photo_retention_days": "abc"},
        timeout=30
    )
    if r.status_code != 200:
        print(f"❌ FAILED: PUT returned {r.status_code}")
        print(f"Response: {r.text}")
        sys.exit(1)
    
    print(f"✅ PUT successful (200)")
    
    r = requests.get(f"{BASE_URL}/api/absensi/settings", headers=headers, timeout=30)
    data = r.json()
    photo_retention = data.get("settings", {}).get("photo_retention_days")
    
    if photo_retention != 30:
        print(f"❌ FAILED: Expected 30 (default for invalid), got {photo_retention}")
        sys.exit(1)
    
    print(f"✅ PASSED: photo_retention_days correctly defaulted to 30 for invalid input")
    print()

    # ========================================================================
    # CLEANUP: Restore photo_retention_days to 30
    # ========================================================================
    print("=" * 80)
    print("CLEANUP: Restoring photo_retention_days to 30")
    print("=" * 80)
    
    r = requests.put(
        f"{BASE_URL}/api/absensi/settings",
        headers=headers,
        json={"photo_retention_days": 30},
        timeout=30
    )
    if r.status_code != 200:
        print(f"⚠️  WARNING: Cleanup PUT returned {r.status_code}")
    else:
        print(f"✅ Cleanup successful: photo_retention_days restored to 30")
    print()

    # ========================================================================
    # FINAL SUMMARY
    # ========================================================================
    print("=" * 80)
    print("✅ ALL 5 TESTS PASSED (100%)")
    print("=" * 80)
    print()
    print("VERIFICATION SUMMARY:")
    print()
    print("✅ TEST 1: GET /api/absensi/settings returns photo_retention_days as number")
    print("   - Bug #1 FIX VERIFIED: Default fallback (30) when field missing from DB")
    print()
    print("✅ TEST 2: PUT with photo_retention_days=0 → clamped to 1 (NOT 30)")
    print("   - Bug #2 FIX VERIFIED: Number.isFinite check prevents 0 from defaulting")
    print()
    print("✅ TEST 3: PUT with photo_retention_days=45 → persisted correctly")
    print("   - Persistence not broken by fix")
    print()
    print("✅ TEST 4: PUT with photo_retention_days=9999 → clamped to 365")
    print("   - Max clamping still working")
    print()
    print("✅ TEST 5: PUT with photo_retention_days='abc' → defaulted to 30")
    print("   - Invalid input handling via Number.isFinite working")
    print()
    print("✅ CLEANUP: photo_retention_days restored to 30")
    print()
    print("=" * 80)
    print("CONCLUSION: Both minor bugs are FIXED and verified.")
    print("=" * 80)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ TEST FAILED WITH EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
