#!/usr/bin/env python3
"""
PRODUCTION BUG FIX Testing — Split Menu "Scan Mulai Packing" Cross-Mode Duplicate 409 Bug

This test suite verifies the fix for the production bug where:
- Serah Terima (SKU+Item only) prematurely set status='packed'
- Then Dokumentasi (Photo only) for same resi got FALSE 409 "RESI SUDAH PERNAH DIPACKING"

The fix applied per-mode duplicate checking and status='packed' only when photo captured.

Test Scenarios:
A. NEW WORKFLOW (Serah Terima → Dokumentasi on same resi) — MUST WORK NOW (CRITICAL)
B. PER-MODE DUPLICATE — Serah Terima re-do blocked
C. PER-MODE DUPLICATE — Dokumentasi re-do blocked
D. REVERSE ORDER — Dokumentasi first, then Serah Terima
E. LEGACY FULL MODE (backward compat)
F. DELIVERED RESI CANNOT BE RE-PROCESSED
G. VALIDATION UNCHANGED
H. REGRESSION — Endpoints not affected
"""

import requests
import time
import sys
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# Tiny valid 1x1 PNG for photo testing (47 bytes decoded)
TINY_PNG_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": username, "password": password},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            log(f"✅ Login successful: {username} → token: {token[:20]}...")
            return token
        else:
            log(f"❌ Login failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ Login exception: {e}")
        return None

def get_expeditions(token):
    """Get expeditions (GET /api/om/expeditions)"""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/om/expeditions",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            if items:
                return items[0].get("id")  # Return first expedition ID
            else:
                log(f"❌ No expeditions found")
                return None
        else:
            log(f"❌ Get expeditions failed: {resp.status_code}")
            return None
    except Exception as e:
        log(f"❌ Get expeditions exception: {e}")
        return None

def print_resi(token, tracking_number, expedition_id):
    """Print a resi (POST /api/om/scan/print)"""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers={"Authorization": f"Bearer {token}"},
            json={"tracking_number": tracking_number, "expedition_id": expedition_id},
            timeout=10
        )
        if resp.status_code == 200:
            data = resp.json()
            shipment = data.get("shipment", {})
            log(f"✅ Print resi: {tracking_number} → status={shipment.get('status')}")
            return shipment
        else:
            log(f"❌ Print resi failed: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        log(f"❌ Print resi exception: {e}")
        return None

def pack_resi(token, payload):
    """Pack a resi (POST /api/om/scan/pack)"""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/pack",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
            timeout=10
        )
        return resp
    except Exception as e:
        log(f"❌ Pack resi exception: {e}")
        return None

def deliver_resi(token, tracking_number):
    """Deliver a resi (POST /api/om/scan/deliver)"""
    try:
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/deliver",
            headers={"Authorization": f"Bearer {token}"},
            json={"tracking_number": tracking_number},
            timeout=10
        )
        return resp
    except Exception as e:
        log(f"❌ Deliver resi exception: {e}")
        return None

def get_shipments(token):
    """Get all shipments (GET /api/om/shipments)"""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/om/shipments",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"❌ Get shipments failed: {resp.status_code}")
            return None
    except Exception as e:
        log(f"❌ Get shipments exception: {e}")
        return None

def get_dashboard(token):
    """Get dashboard (GET /api/om/dashboard)"""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/om/dashboard",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"❌ Get dashboard failed: {resp.status_code}")
            return None
    except Exception as e:
        log(f"❌ Get dashboard exception: {e}")
        return None

def get_tab_packing(token):
    """Get packing tab (GET /api/om/tab/packing)"""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/om/tab/packing",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"❌ Get tab packing failed: {resp.status_code}")
            return None
    except Exception as e:
        log(f"❌ Get tab packing exception: {e}")
        return None

def get_tab_cetak(token):
    """Get cetak tab (GET /api/om/tab/cetak)"""
    try:
        resp = requests.get(
            f"{BASE_URL}/api/om/tab/cetak",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        if resp.status_code == 200:
            return resp.json()
        else:
            log(f"❌ Get tab cetak failed: {resp.status_code}")
            return None
    except Exception as e:
        log(f"❌ Get tab cetak exception: {e}")
        return None

def run_tests():
    """Run all test scenarios"""
    log("=" * 80)
    log("PRODUCTION BUG FIX Testing — Split Menu Scan Mulai Packing")
    log("=" * 80)
    
    # Generate unique suffix for this test run to avoid conflicts with previous test data
    test_suffix = str(int(time.time()))[-6:]  # Last 6 digits of timestamp
    log(f"\n🔖 Test run suffix: {test_suffix}")
    
    # Login
    log("\n🔐 AUTHENTICATION")
    token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not token:
        log("❌ CRITICAL: Cannot login. Aborting all tests.")
        return False
    
    # Get expedition_id
    log("\n🚚 GET EXPEDITION")
    expedition_id = get_expeditions(token)
    if not expedition_id:
        log("❌ CRITICAL: Cannot get expedition_id. Aborting all tests.")
        return False
    log(f"✅ Using expedition_id: {expedition_id}")
    
    all_passed = True
    
    # ========================================================================
    # SCENARIO A: NEW WORKFLOW (Serah Terima → Dokumentasi on same resi)
    # THIS IS THE CRITICAL TEST THAT WAS BROKEN
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO A: NEW WORKFLOW (Serah Terima → Dokumentasi on same resi)")
    log("=" * 80)
    log("This is the CRITICAL test that was broken in production.")
    
    tracking_a = f"BUGFIX-A-{test_suffix}"
    
    # Step 1: Print resi
    log(f"\n📝 Step 1: Print resi {tracking_a}")
    shipment_a = print_resi(token, tracking_a, expedition_id)
    if not shipment_a or shipment_a.get("status") != "printed":
        log(f"❌ SCENARIO A FAILED: Print failed or status != 'printed'")
        all_passed = False
    else:
        log(f"✅ Step 1 PASS: Resi printed, status='printed'")
    
    # Step 2: Serah Terima (SKU+Item only, NO photo)
    log(f"\n📦 Step 2: Serah Terima (SKU+Item only, NO photo)")
    payload_serah = {
        "tracking_number": tracking_a,
        "sku_count": 5,
        "item_count": 10
    }
    resp_serah = pack_resi(token, payload_serah)
    if resp_serah.status_code != 200:
        log(f"❌ SCENARIO A FAILED: Serah Terima returned {resp_serah.status_code}")
        log(f"   Response: {resp_serah.text}")
        all_passed = False
    else:
        data_serah = resp_serah.json()
        shipment_serah = data_serah.get("shipment", {})
        message_serah = data_serah.get("message", "")
        
        # Verify status is still 'printed' (NOT 'packed')
        if shipment_serah.get("status") != "printed":
            log(f"❌ SCENARIO A FAILED: After Serah Terima, status={shipment_serah.get('status')} (expected 'printed')")
            all_passed = False
        else:
            log(f"✅ Step 2a PASS: status='printed' (NOT 'packed' yet)")
        
        # Verify sku_count and item_count saved
        if shipment_serah.get("sku_count") != 5 or shipment_serah.get("item_count") != 10:
            log(f"❌ SCENARIO A FAILED: sku_count={shipment_serah.get('sku_count')}, item_count={shipment_serah.get('item_count')} (expected 5, 10)")
            all_passed = False
        else:
            log(f"✅ Step 2b PASS: sku_count=5, item_count=10 saved")
        
        # Verify packed_at is null/undefined (not set yet)
        if shipment_serah.get("packed_at") is not None:
            log(f"❌ SCENARIO A FAILED: packed_at={shipment_serah.get('packed_at')} (expected null)")
            all_passed = False
        else:
            log(f"✅ Step 2c PASS: packed_at is null (not finalized yet)")
        
        # Verify message contains "serah terima"
        if "serah terima" not in message_serah.lower():
            log(f"❌ SCENARIO A FAILED: message='{message_serah}' (expected 'serah terima barang tersimpan')")
            all_passed = False
        else:
            log(f"✅ Step 2d PASS: message contains 'serah terima barang tersimpan'")
    
    # Step 3: Dokumentasi (Photo only, SAME resi) — THIS SHOULD NOW WORK (was 409 before fix)
    log(f"\n📸 Step 3: Dokumentasi (Photo only, SAME resi) — CRITICAL TEST")
    payload_dok = {
        "tracking_number": tracking_a,
        "photo_data_url": TINY_PNG_BASE64
    }
    resp_dok = pack_resi(token, payload_dok)
    if resp_dok.status_code != 200:
        log(f"❌ SCENARIO A FAILED (CRITICAL): Dokumentasi returned {resp_dok.status_code} (expected 200)")
        log(f"   Response: {resp_dok.text}")
        log(f"   THIS IS THE PRODUCTION BUG — Dokumentasi should NOT get 409 after Serah Terima!")
        all_passed = False
    else:
        data_dok = resp_dok.json()
        shipment_dok = data_dok.get("shipment", {})
        message_dok = data_dok.get("message", "")
        
        # Verify status is NOW 'packed'
        if shipment_dok.get("status") != "packed":
            log(f"❌ SCENARIO A FAILED: After Dokumentasi, status={shipment_dok.get('status')} (expected 'packed')")
            all_passed = False
        else:
            log(f"✅ Step 3a PASS: status='packed' (finalized after photo)")
        
        # Verify photo_url is set
        if not shipment_dok.get("photo_url") or not shipment_dok.get("photo_url").startswith("/api/om/photos/"):
            log(f"❌ SCENARIO A FAILED: photo_url={shipment_dok.get('photo_url')} (expected /api/om/photos/...)")
            all_passed = False
        else:
            log(f"✅ Step 3b PASS: photo_url set ({shipment_dok.get('photo_url')})")
        
        # Verify sku_count and item_count STILL 5 and 10 (NOT overwritten to null)
        if shipment_dok.get("sku_count") != 5 or shipment_dok.get("item_count") != 10:
            log(f"❌ SCENARIO A FAILED: sku_count={shipment_dok.get('sku_count')}, item_count={shipment_dok.get('item_count')} (expected 5, 10 from Serah Terima)")
            all_passed = False
        else:
            log(f"✅ Step 3c PASS: sku_count=5, item_count=10 preserved (NOT overwritten)")
        
        # Verify packed_at is NOW set
        if shipment_dok.get("packed_at") is None:
            log(f"❌ SCENARIO A FAILED: packed_at is null (expected timestamp)")
            all_passed = False
        else:
            log(f"✅ Step 3d PASS: packed_at set ({shipment_dok.get('packed_at')})")
        
        # Verify message contains "dokumentasi packing"
        if "dokumentasi packing" not in message_dok.lower():
            log(f"❌ SCENARIO A FAILED: message='{message_dok}' (expected 'dokumentasi packing selesai')")
            all_passed = False
        else:
            log(f"✅ Step 3e PASS: message contains 'dokumentasi packing selesai'")
        
        log(f"\n🎉 SCENARIO A PASS: The production bug is FIXED! Serah Terima → Dokumentasi works correctly.")
    
    # ========================================================================
    # SCENARIO B: PER-MODE DUPLICATE — Serah Terima re-do blocked
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO B: PER-MODE DUPLICATE — Serah Terima re-do blocked")
    log("=" * 80)
    
    # Try Serah Terima AGAIN on same resi
    log(f"\n📦 Attempt Serah Terima AGAIN on {tracking_a}")
    payload_serah_dup = {
        "tracking_number": tracking_a,
        "sku_count": 7,
        "item_count": 15
    }
    resp_serah_dup = pack_resi(token, payload_serah_dup)
    if resp_serah_dup.status_code != 409:
        log(f"❌ SCENARIO B FAILED: Expected 409, got {resp_serah_dup.status_code}")
        all_passed = False
    else:
        data_dup = resp_serah_dup.json()
        error_msg = data_dup.get("error", "")
        if "SERAH TERIMA BARANG SUDAH DILAKUKAN" not in error_msg:
            log(f"❌ SCENARIO B FAILED: error='{error_msg}' (expected 'SERAH TERIMA BARANG SUDAH DILAKUKAN')")
            all_passed = False
        else:
            log(f"✅ SCENARIO B PASS: Serah Terima re-do correctly blocked with 409 '{error_msg}'")
    
    # ========================================================================
    # SCENARIO C: PER-MODE DUPLICATE — Dokumentasi re-do blocked
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO C: PER-MODE DUPLICATE — Dokumentasi re-do blocked")
    log("=" * 80)
    
    # Try Dokumentasi AGAIN on same resi
    log(f"\n📸 Attempt Dokumentasi AGAIN on {tracking_a}")
    payload_dok_dup = {
        "tracking_number": tracking_a,
        "photo_data_url": TINY_PNG_BASE64
    }
    resp_dok_dup = pack_resi(token, payload_dok_dup)
    if resp_dok_dup.status_code != 409:
        log(f"❌ SCENARIO C FAILED: Expected 409, got {resp_dok_dup.status_code}")
        all_passed = False
    else:
        data_dup = resp_dok_dup.json()
        error_msg = data_dup.get("error", "")
        if "DOKUMENTASI PACKING SUDAH DILAKUKAN" not in error_msg:
            log(f"❌ SCENARIO C FAILED: error='{error_msg}' (expected 'DOKUMENTASI PACKING SUDAH DILAKUKAN')")
            all_passed = False
        else:
            log(f"✅ SCENARIO C PASS: Dokumentasi re-do correctly blocked with 409 '{error_msg}'")
    
    # ========================================================================
    # SCENARIO D: REVERSE ORDER — Dokumentasi first, then Serah Terima
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO D: REVERSE ORDER — Dokumentasi first, then Serah Terima")
    log("=" * 80)
    
    tracking_d = f"BUGFIX-D-{test_suffix}"
    
    # Step 1: Print resi
    log(f"\n📝 Step 1: Print resi {tracking_d}")
    shipment_d = print_resi(token, tracking_d, expedition_id)
    if not shipment_d or shipment_d.get("status") != "printed":
        log(f"❌ SCENARIO D FAILED: Print failed")
        all_passed = False
    
    # Step 2: Dokumentasi FIRST (photo only)
    log(f"\n📸 Step 2: Dokumentasi FIRST (photo only)")
    payload_dok_first = {
        "tracking_number": tracking_d,
        "photo_data_url": TINY_PNG_BASE64
    }
    resp_dok_first = pack_resi(token, payload_dok_first)
    if resp_dok_first.status_code != 200:
        log(f"❌ SCENARIO D FAILED: Dokumentasi first returned {resp_dok_first.status_code}")
        all_passed = False
    else:
        data_dok_first = resp_dok_first.json()
        shipment_dok_first = data_dok_first.get("shipment", {})
        
        # Verify status='packed'
        if shipment_dok_first.get("status") != "packed":
            log(f"❌ SCENARIO D FAILED: After Dokumentasi first, status={shipment_dok_first.get('status')} (expected 'packed')")
            all_passed = False
        else:
            log(f"✅ Step 2a PASS: status='packed'")
        
        # Verify photo_url set
        if not shipment_dok_first.get("photo_url"):
            log(f"❌ SCENARIO D FAILED: photo_url not set")
            all_passed = False
        else:
            log(f"✅ Step 2b PASS: photo_url set")
    
    # Step 3: Serah Terima AFTER Dokumentasi (should ALLOW because sku_count was null before)
    log(f"\n📦 Step 3: Serah Terima AFTER Dokumentasi (should ALLOW)")
    payload_serah_after = {
        "tracking_number": tracking_d,
        "sku_count": 3,
        "item_count": 8
    }
    resp_serah_after = pack_resi(token, payload_serah_after)
    if resp_serah_after.status_code != 200:
        log(f"❌ SCENARIO D FAILED: Serah Terima after Dokumentasi returned {resp_serah_after.status_code} (expected 200)")
        log(f"   Response: {resp_serah_after.text}")
        all_passed = False
    else:
        data_serah_after = resp_serah_after.json()
        shipment_serah_after = data_serah_after.get("shipment", {})
        
        # Verify sku_count and item_count NOW saved
        if shipment_serah_after.get("sku_count") != 3 or shipment_serah_after.get("item_count") != 8:
            log(f"❌ SCENARIO D FAILED: sku_count={shipment_serah_after.get('sku_count')}, item_count={shipment_serah_after.get('item_count')} (expected 3, 8)")
            all_passed = False
        else:
            log(f"✅ Step 3a PASS: sku_count=3, item_count=8 saved")
        
        # Verify status still 'packed'
        if shipment_serah_after.get("status") != "packed":
            log(f"❌ SCENARIO D FAILED: status={shipment_serah_after.get('status')} (expected 'packed')")
            all_passed = False
        else:
            log(f"✅ Step 3b PASS: status still 'packed'")
        
        # Verify photo_url STILL set (NOT overwritten)
        if not shipment_serah_after.get("photo_url"):
            log(f"❌ SCENARIO D FAILED: photo_url lost (expected preserved)")
            all_passed = False
        else:
            log(f"✅ Step 3c PASS: photo_url preserved")
        
        log(f"\n✅ SCENARIO D PASS: Reverse order (Dokumentasi → Serah Terima) works correctly")
    
    # ========================================================================
    # SCENARIO E: LEGACY FULL MODE (backward compat)
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO E: LEGACY FULL MODE (backward compat)")
    log("=" * 80)
    
    tracking_e = f"BUGFIX-E-{test_suffix}"
    
    # Step 1: Print resi
    log(f"\n📝 Step 1: Print resi {tracking_e}")
    shipment_e = print_resi(token, tracking_e, expedition_id)
    if not shipment_e or shipment_e.get("status") != "printed":
        log(f"❌ SCENARIO E FAILED: Print failed")
        all_passed = False
    
    # Step 2: Legacy full mode (all fields together)
    log(f"\n📦 Step 2: Legacy full mode (SKU+Item+Photo together)")
    payload_full = {
        "tracking_number": tracking_e,
        "sku_count": 3,
        "item_count": 8,
        "photo_data_url": TINY_PNG_BASE64
    }
    resp_full = pack_resi(token, payload_full)
    if resp_full.status_code != 200:
        log(f"❌ SCENARIO E FAILED: Legacy full mode returned {resp_full.status_code}")
        all_passed = False
    else:
        data_full = resp_full.json()
        shipment_full = data_full.get("shipment", {})
        message_full = data_full.get("message", "")
        
        # Verify ALL fields saved
        if shipment_full.get("sku_count") != 3 or shipment_full.get("item_count") != 8:
            log(f"❌ SCENARIO E FAILED: sku_count={shipment_full.get('sku_count')}, item_count={shipment_full.get('item_count')} (expected 3, 8)")
            all_passed = False
        else:
            log(f"✅ Step 2a PASS: sku_count=3, item_count=8")
        
        if not shipment_full.get("photo_url"):
            log(f"❌ SCENARIO E FAILED: photo_url not set")
            all_passed = False
        else:
            log(f"✅ Step 2b PASS: photo_url set")
        
        # Verify status='packed'
        if shipment_full.get("status") != "packed":
            log(f"❌ SCENARIO E FAILED: status={shipment_full.get('status')} (expected 'packed')")
            all_passed = False
        else:
            log(f"✅ Step 2c PASS: status='packed'")
        
        # Verify message contains "packing selesai"
        if "packing selesai" not in message_full.lower():
            log(f"❌ SCENARIO E FAILED: message='{message_full}' (expected 'packing selesai')")
            all_passed = False
        else:
            log(f"✅ Step 2d PASS: message contains 'packing selesai'")
    
    # Step 3: Try again (should get 409 "RESI SUDAH PERNAH DIPACKING")
    log(f"\n📦 Step 3: Try legacy full mode AGAIN (should get 409)")
    resp_full_dup = pack_resi(token, payload_full)
    if resp_full_dup.status_code != 409:
        log(f"❌ SCENARIO E FAILED: Expected 409, got {resp_full_dup.status_code}")
        all_passed = False
    else:
        data_dup = resp_full_dup.json()
        error_msg = data_dup.get("error", "")
        if "RESI SUDAH PERNAH DIPACKING" not in error_msg:
            log(f"❌ SCENARIO E FAILED: error='{error_msg}' (expected 'RESI SUDAH PERNAH DIPACKING')")
            all_passed = False
        else:
            log(f"✅ Step 3 PASS: Legacy full mode re-do correctly blocked with 409 '{error_msg}'")
        
        log(f"\n✅ SCENARIO E PASS: Legacy full mode backward compatibility maintained")
    
    # ========================================================================
    # SCENARIO F: DELIVERED RESI CANNOT BE RE-PROCESSED
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO F: DELIVERED RESI CANNOT BE RE-PROCESSED")
    log("=" * 80)
    
    # Use tracking_a (already packed from Scenario A)
    log(f"\n🚚 Step 1: Deliver resi {tracking_a}")
    resp_deliver = deliver_resi(token, tracking_a)
    if resp_deliver.status_code != 200:
        log(f"❌ SCENARIO F FAILED: Deliver returned {resp_deliver.status_code}")
        all_passed = False
    else:
        data_deliver = resp_deliver.json()
        shipment_deliver = data_deliver.get("shipment", {})
        if shipment_deliver.get("status") != "delivered":
            log(f"❌ SCENARIO F FAILED: status={shipment_deliver.get('status')} (expected 'delivered')")
            all_passed = False
        else:
            log(f"✅ Step 1 PASS: status='delivered'")
    
    # Try Serah Terima on delivered resi
    log(f"\n📦 Step 2: Try Serah Terima on delivered resi (should get 409)")
    payload_serah_delivered = {
        "tracking_number": tracking_a,
        "sku_count": 99,
        "item_count": 99
    }
    resp_serah_delivered = pack_resi(token, payload_serah_delivered)
    if resp_serah_delivered.status_code != 409:
        log(f"❌ SCENARIO F FAILED: Expected 409, got {resp_serah_delivered.status_code}")
        all_passed = False
    else:
        data_dup = resp_serah_delivered.json()
        error_msg = data_dup.get("error", "")
        duplicate = data_dup.get("duplicate", {})
        if "RESI SUDAH DISERAHTERIMAKAN KE KURIR" not in error_msg:
            log(f"❌ SCENARIO F FAILED: error='{error_msg}' (expected 'RESI SUDAH DISERAHTERIMAKAN KE KURIR')")
            all_passed = False
        elif duplicate.get("stage") != "delivered":
            log(f"❌ SCENARIO F FAILED: duplicate.stage={duplicate.get('stage')} (expected 'delivered')")
            all_passed = False
        else:
            log(f"✅ Step 2 PASS: Serah Terima on delivered resi blocked with 409 '{error_msg}'")
    
    # Try Dokumentasi on delivered resi
    log(f"\n📸 Step 3: Try Dokumentasi on delivered resi (should get 409)")
    payload_dok_delivered = {
        "tracking_number": tracking_a,
        "photo_data_url": TINY_PNG_BASE64
    }
    resp_dok_delivered = pack_resi(token, payload_dok_delivered)
    if resp_dok_delivered.status_code != 409:
        log(f"❌ SCENARIO F FAILED: Expected 409, got {resp_dok_delivered.status_code}")
        all_passed = False
    else:
        data_dup = resp_dok_delivered.json()
        error_msg = data_dup.get("error", "")
        if "RESI SUDAH DISERAHTERIMAKAN KE KURIR" not in error_msg:
            log(f"❌ SCENARIO F FAILED: error='{error_msg}' (expected 'RESI SUDAH DISERAHTERIMAKAN KE KURIR')")
            all_passed = False
        else:
            log(f"✅ Step 3 PASS: Dokumentasi on delivered resi blocked with 409 '{error_msg}'")
        
        log(f"\n✅ SCENARIO F PASS: Delivered resi cannot be re-processed")
    
    # ========================================================================
    # SCENARIO G: VALIDATION UNCHANGED
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO G: VALIDATION UNCHANGED")
    log("=" * 80)
    
    # Test 1: Empty payload
    log(f"\n❌ Test 1: Empty payload (should get 400)")
    resp_empty = pack_resi(token, {})
    if resp_empty.status_code != 400:
        log(f"❌ SCENARIO G FAILED: Expected 400, got {resp_empty.status_code}")
        all_passed = False
    else:
        data_empty = resp_empty.json()
        error_msg = data_empty.get("error", "")
        if "tracking_number wajib" not in error_msg.lower():
            log(f"❌ SCENARIO G FAILED: error='{error_msg}' (expected 'tracking_number wajib')")
            all_passed = False
        else:
            log(f"✅ Test 1 PASS: Empty payload correctly rejected with 400 '{error_msg}'")
    
    # Test 2: Only tracking_number (no SKU/Item/Photo)
    log(f"\n❌ Test 2: Only tracking_number (should get 400)")
    tracking_g = f"BUGFIX-G-{test_suffix}"
    print_resi(token, tracking_g, expedition_id)  # Print first
    payload_only_tracking = {
        "tracking_number": tracking_g
    }
    resp_only_tracking = pack_resi(token, payload_only_tracking)
    if resp_only_tracking.status_code != 400:
        log(f"❌ SCENARIO G FAILED: Expected 400, got {resp_only_tracking.status_code}")
        all_passed = False
    else:
        data_only = resp_only_tracking.json()
        error_msg = data_only.get("error", "")
        if "isi minimal sku+item atau foto barang" not in error_msg.lower():
            log(f"❌ SCENARIO G FAILED: error='{error_msg}' (expected 'Isi minimal SKU+Item atau Foto barang')")
            all_passed = False
        else:
            log(f"✅ Test 2 PASS: Only tracking_number correctly rejected with 400 '{error_msg}'")
        
        log(f"\n✅ SCENARIO G PASS: Validation unchanged")
    
    # ========================================================================
    # SCENARIO H: REGRESSION — Endpoints not affected
    # ========================================================================
    log("\n" + "=" * 80)
    log("SCENARIO H: REGRESSION — Endpoints not affected")
    log("=" * 80)
    
    # Test 1: GET /api/om/shipments
    log(f"\n📋 Test 1: GET /api/om/shipments")
    shipments_data = get_shipments(token)
    if not shipments_data:
        log(f"❌ SCENARIO H FAILED: GET /api/om/shipments failed")
        all_passed = False
    else:
        log(f"✅ Test 1 PASS: GET /api/om/shipments returned {len(shipments_data.get('items', []))} shipments")
    
    # Test 2: GET /api/om/dashboard
    log(f"\n📊 Test 2: GET /api/om/dashboard")
    dashboard_data = get_dashboard(token)
    if not dashboard_data:
        log(f"❌ SCENARIO H FAILED: GET /api/om/dashboard failed")
        all_passed = False
    else:
        log(f"✅ Test 2 PASS: GET /api/om/dashboard returned data")
    
    # Test 3: GET /api/om/tab/packing (should only contain status='packed' items)
    log(f"\n📦 Test 3: GET /api/om/tab/packing (should only contain status='packed' items)")
    packing_data = get_tab_packing(token)
    if not packing_data:
        log(f"❌ SCENARIO H FAILED: GET /api/om/tab/packing failed")
        all_passed = False
    else:
        packing_items = packing_data.get("items", [])
        # Verify all items have status='packed'
        non_packed = [item for item in packing_items if item.get("status") != "packed"]
        if non_packed:
            log(f"❌ SCENARIO H FAILED: Found {len(non_packed)} non-packed items in packing tab")
            all_passed = False
        else:
            log(f"✅ Test 3 PASS: GET /api/om/tab/packing returned {len(packing_items)} items, all status='packed'")
    
    # Test 4: GET /api/om/tab/cetak (should contain status='printed' items INCLUDING resi yang baru Serah Terima)
    log(f"\n📝 Test 4: GET /api/om/tab/cetak (should contain status='printed' items)")
    cetak_data = get_tab_cetak(token)
    if not cetak_data:
        log(f"❌ SCENARIO H FAILED: GET /api/om/tab/cetak failed")
        all_passed = False
    else:
        cetak_items = cetak_data.get("items", [])
        # Verify all items have status='printed'
        non_printed = [item for item in cetak_items if item.get("status") != "printed"]
        if non_printed:
            log(f"❌ SCENARIO H FAILED: Found {len(non_printed)} non-printed items in cetak tab")
            all_passed = False
        else:
            log(f"✅ Test 4 PASS: GET /api/om/tab/cetak returned {len(cetak_items)} items, all status='printed'")
        
        log(f"\n✅ SCENARIO H PASS: No regression detected in endpoints")
    
    # ========================================================================
    # FINAL SUMMARY
    # ========================================================================
    log("\n" + "=" * 80)
    log("FINAL SUMMARY")
    log("=" * 80)
    
    if all_passed:
        log("✅ ALL SCENARIOS PASSED (100%)")
        log("✅ PRODUCTION BUG IS FIXED!")
        log("✅ Serah Terima → Dokumentasi workflow works correctly")
        log("✅ Per-mode duplicate checking works correctly")
        log("✅ Backward compatibility maintained")
        log("✅ No regressions detected")
        return True
    else:
        log("❌ SOME SCENARIOS FAILED")
        log("❌ PRODUCTION BUG MAY NOT BE FULLY FIXED")
        return False

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
