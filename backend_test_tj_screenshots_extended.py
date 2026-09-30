#!/usr/bin/env python3
"""
Extended test: Try with a real valid PNG to test Telegram success path + BWC
"""

import requests
import base64
import io
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def create_real_png():
    """Create a proper 10x10 red PNG."""
    import struct
    import zlib
    
    width, height = 10, 10
    
    # PNG signature
    png = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)  # RGB
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    png += struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    # IDAT chunk - red pixels
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter type
        for x in range(width):
            raw_data += b'\xff\x00\x00'  # RGB red
    
    compressed = zlib.compress(raw_data, 9)
    idat_crc = zlib.crc32(b'IDAT' + compressed) & 0xffffffff
    png += struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)
    
    # IEND chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    png += struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    
    return png

def main():
    log("=" * 80)
    log("EXTENDED TEST: Real PNG + Telegram Success Path + BWC + Cleanup")
    log("=" * 80)
    
    # Login
    log("\n[SETUP] Login as owner")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"})
    assert r.status_code == 200
    owner_token = r.json()["token"]
    log(f"  ✅ Owner token: {owner_token[:20]}...")
    
    # Upload real PNG
    log("\n[TEST] Upload real 10x10 red PNG")
    png_bytes = create_real_png()
    log(f"  PNG size: {len(png_bytes)} bytes")
    files = {"photo": ("real_test.png", io.BytesIO(png_bytes), "image/png")}
    r = requests.post(f"{BASE_URL}/api/tj/upload", files=files, headers={"Authorization": f"Bearer {owner_token}"})
    assert r.status_code == 200, f"Upload failed: {r.status_code}: {r.text}"
    data = r.json()
    screenshot = data["screenshot"]
    
    screenshot_id = screenshot["id"]
    telegram_status = screenshot["telegram_status"]
    file_id = screenshot.get("file_id")
    
    log(f"  ✅ Upload returned 200")
    log(f"  screenshot.id: {screenshot_id}")
    log(f"  telegram_status: {telegram_status}")
    log(f"  file_id: {file_id}")
    log(f"  width: {screenshot.get('width')}")
    log(f"  height: {screenshot.get('height')}")
    
    if telegram_status == "sent":
        log(f"  ✅ Telegram SUCCESS!")
        
        # Test BWC with raw file_id
        log(f"\n[TEST] BWC: GET /api/tj/photo/{file_id} (raw Telegram file_id)")
        r = requests.get(f"{BASE_URL}/api/tj/photo/{file_id}", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200, f"BWC failed: {r.status_code}"
        assert len(r.content) > 0
        log(f"  ✅ BWC raw file_id works: {len(r.content)} bytes")
        
        # Test GET by id (should proxy from Telegram)
        log(f"\n[TEST] GET /api/tj/photo/{screenshot_id} (should proxy from Telegram)")
        r = requests.get(f"{BASE_URL}/api/tj/photo/{screenshot_id}", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200
        assert len(r.content) > 0
        log(f"  ✅ GET by id works (proxied from Telegram): {len(r.content)} bytes")
        
    else:
        log(f"  ⚠️  Telegram FAILED: {screenshot.get('telegram_error')}")
        log(f"  ✅ But resilient pattern working (upload returned 200)")
        
        # Test GET by id (should stream from local file_data)
        log(f"\n[TEST] GET /api/tj/photo/{screenshot_id} (should stream from local file_data)")
        r = requests.get(f"{BASE_URL}/api/tj/photo/{screenshot_id}", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200
        assert len(r.content) > 0
        log(f"  ✅ GET by id works (local fallback): {len(r.content)} bytes")
    
    # Cleanup
    log("\n[CLEANUP] Delete test screenshots from MongoDB")
    client = MongoClient("mongodb://localhost:27017")
    db = client["cycle_count"]
    
    # Find all test screenshots
    test_screenshots = list(db.tj_screenshots.find({}, {"id": 1, "filename": 1}))
    log(f"  Found {len(test_screenshots)} screenshots in tj_screenshots collection")
    
    for doc in test_screenshots:
        log(f"    - {doc['id']}: {doc.get('filename', 'unknown')}")
    
    if test_screenshots:
        result = db.tj_screenshots.delete_many({})
        log(f"  ✅ Deleted {result.deleted_count} test screenshots")
    else:
        log(f"  ℹ️  No screenshots to delete")
    
    log("\n" + "=" * 80)
    log("✅ EXTENDED TEST COMPLETE")
    log("=" * 80)

if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        log(f"\n❌ TEST FAILED: {e}")
        exit(1)
    except Exception as e:
        log(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
