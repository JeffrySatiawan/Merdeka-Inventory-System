#!/usr/bin/env python3
"""
Backend Test: Trading Journal Screenshot Refactor (Resilient Upload Pattern)
=============================================================================
Tests the new tj_screenshots collection with BSON Binary fallback storage.

CREDENTIALS: owner / owner123 (owner-only endpoints)

TEST SCENARIOS:
1. Auth guards (no token, non-owner, ?token= query param)
2. Upload happy path (multipart PNG)
3. Photo GET by screenshot id
4. Photo GET BWC by raw Telegram file_id
5. Retry endpoint
6. JSON data_url upload
7. Size cap (13MB rejection)
"""

import requests
import base64
import io
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def create_test_png(size_bytes=200):
    """Create a minimal valid PNG in memory."""
    # PNG signature + IHDR chunk (1x1 pixel, grayscale)
    png_header = bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
        0x00, 0x00, 0x00, 0x0D,  # IHDR length
        0x49, 0x48, 0x44, 0x52,  # "IHDR"
        0x00, 0x00, 0x00, 0x01,  # width=1
        0x00, 0x00, 0x00, 0x01,  # height=1
        0x08, 0x00, 0x00, 0x00, 0x00,  # bit depth=8, grayscale
        0x3A, 0x7E, 0x9B, 0x55,  # CRC
        0x00, 0x00, 0x00, 0x0A,  # IDAT length
        0x49, 0x44, 0x41, 0x54,  # "IDAT"
        0x08, 0x1D, 0x01, 0x02, 0x00, 0xFD, 0xFF, 0x00, 0x00, 0x02,
        0x00, 0x01,  # compressed data
        0xE2, 0x21, 0xBC, 0x33,  # CRC
        0x00, 0x00, 0x00, 0x00,  # IEND length
        0x49, 0x45, 0x4E, 0x44,  # "IEND"
        0xAE, 0x42, 0x60, 0x82,  # CRC
    ])
    # Pad to desired size if needed
    if size_bytes > len(png_header):
        padding = b'\x00' * (size_bytes - len(png_header))
        return png_header + padding
    return png_header[:size_bytes]

def main():
    log("=" * 80)
    log("TEST: Trading Journal Screenshot Refactor (Resilient Upload)")
    log("=" * 80)
    
    # ========================================================================
    # TEST 1: AUTH GUARDS
    # ========================================================================
    log("\n[TEST 1] AUTH GUARDS")
    
    # 1a. No token → 401
    log("  1a. GET /api/tj/photo/test-id without token → expect 401")
    r = requests.get(f"{BASE_URL}/api/tj/photo/test-id")
    assert r.status_code == 401, f"Expected 401, got {r.status_code}"
    log("     ✅ No token → 401")
    
    # 1b. Login as owner
    log("  1b. Login as owner (owner/owner123)")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"})
    assert r.status_code == 200, f"Owner login failed: {r.status_code}"
    owner_token = r.json()["token"]
    log(f"     ✅ Owner token: {owner_token[:20]}...")
    
    # 1c. Login as non-owner (cindy)
    log("  1c. Login as non-owner (cindy/cindy123)")
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "cindy", "password": "cindy123"})
    assert r.status_code == 200, f"Cindy login failed: {r.status_code}"
    cindy_token = r.json()["token"]
    log(f"     ✅ Cindy token: {cindy_token[:20]}...")
    
    # 1d. Non-owner tries /api/tj/upload → 403
    log("  1d. POST /api/tj/upload as cindy → expect 403")
    png_bytes = create_test_png(200)
    files = {"photo": ("test.png", io.BytesIO(png_bytes), "image/png")}
    r = requests.post(f"{BASE_URL}/api/tj/upload", files=files, headers={"Authorization": f"Bearer {cindy_token}"})
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
    log("     ✅ Non-owner → 403")
    
    # 1e. ?token= query param (for <img> tag auth)
    log("  1e. GET /api/tj/photo/test-id?token=<owner-token> → should authenticate")
    # We'll test this properly after we have a real screenshot id
    log("     ⏭️  Deferred until we have a real screenshot id")
    
    log("\n✅ TEST 1 PASSED: Auth guards working")
    
    # ========================================================================
    # TEST 2: UPLOAD HAPPY PATH (multipart)
    # ========================================================================
    log("\n[TEST 2] UPLOAD HAPPY PATH (multipart PNG)")
    
    log("  2a. POST /api/tj/upload with 200-byte PNG")
    png_bytes = create_test_png(200)
    files = {"photo": ("test_screenshot.png", io.BytesIO(png_bytes), "image/png")}
    r = requests.post(f"{BASE_URL}/api/tj/upload", files=files, headers={"Authorization": f"Bearer {owner_token}"})
    assert r.status_code == 200, f"Upload failed: {r.status_code}: {r.text}"
    data = r.json()
    assert "screenshot" in data, "Response missing 'screenshot' key"
    screenshot = data["screenshot"]
    
    log(f"     ✅ Upload returned 200")
    log(f"     Screenshot keys: {list(screenshot.keys())}")
    
    # Verify response shape
    assert "id" in screenshot, "Missing 'id' (UUID)"
    assert "telegram_status" in screenshot, "Missing 'telegram_status'"
    assert "mime" in screenshot, "Missing 'mime'"
    assert "filename" in screenshot, "Missing 'filename'"
    assert "size" in screenshot, "Missing 'size'"
    assert "uploaded_at" in screenshot, "Missing 'uploaded_at'"
    
    screenshot_id = screenshot["id"]
    telegram_status = screenshot["telegram_status"]
    file_id = screenshot.get("file_id")
    
    log(f"     ✅ screenshot.id: {screenshot_id}")
    log(f"     ✅ telegram_status: {telegram_status}")
    log(f"     ✅ mime: {screenshot['mime']}")
    log(f"     ✅ filename: {screenshot['filename']}")
    log(f"     ✅ size: {screenshot['size']}")
    log(f"     ✅ uploaded_at: {screenshot['uploaded_at']}")
    
    if telegram_status == "sent":
        log(f"     ✅ Telegram SUCCESS: file_id={file_id}")
        assert file_id is not None, "file_id should be present when status=sent"
    elif telegram_status == "failed":
        log(f"     ⚠️  Telegram FAILED: {screenshot.get('telegram_error', 'unknown')}")
        log(f"     ✅ But upload still returned 200 (resilient!)")
        assert file_id is None, "file_id should be null when status=failed"
    else:
        log(f"     ⚠️  Unexpected status: {telegram_status}")
    
    log("\n✅ TEST 2 PASSED: Upload happy path working (resilient pattern)")
    
    # ========================================================================
    # TEST 3: PHOTO GET BY SCREENSHOT ID
    # ========================================================================
    log("\n[TEST 3] PHOTO GET BY SCREENSHOT ID")
    
    log(f"  3a. GET /api/tj/photo/{screenshot_id} with Bearer token")
    r = requests.get(f"{BASE_URL}/api/tj/photo/{screenshot_id}", headers={"Authorization": f"Bearer {owner_token}"})
    assert r.status_code == 200, f"Photo GET failed: {r.status_code}: {r.text}"
    assert r.headers.get("Content-Type", "").startswith("image/"), f"Expected image/* content-type, got {r.headers.get('Content-Type')}"
    assert len(r.content) > 0, "Photo body is empty"
    log(f"     ✅ GET /api/tj/photo/{screenshot_id} → 200")
    log(f"     ✅ Content-Type: {r.headers.get('Content-Type')}")
    log(f"     ✅ Body size: {len(r.content)} bytes")
    
    # 3b. Test ?token= query param (for <img> tag)
    log(f"  3b. GET /api/tj/photo/{screenshot_id}?token={owner_token[:20]}... (query param auth)")
    r = requests.get(f"{BASE_URL}/api/tj/photo/{screenshot_id}?token={owner_token}")
    assert r.status_code == 200, f"Photo GET with ?token failed: {r.status_code}: {r.text}"
    assert len(r.content) > 0, "Photo body is empty"
    log(f"     ✅ ?token= query param works (for <img> tag)")
    
    log("\n✅ TEST 3 PASSED: Photo GET by screenshot id working")
    
    # ========================================================================
    # TEST 4: PHOTO GET BWC BY RAW TELEGRAM FILE_ID
    # ========================================================================
    log("\n[TEST 4] PHOTO GET BWC BY RAW TELEGRAM FILE_ID")
    
    if telegram_status == "sent" and file_id:
        log(f"  4a. GET /api/tj/photo/{file_id} (raw Telegram file_id)")
        r = requests.get(f"{BASE_URL}/api/tj/photo/{file_id}", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200, f"BWC photo GET failed: {r.status_code}: {r.text}"
        assert r.headers.get("Content-Type", "").startswith("image/"), f"Expected image/* content-type"
        assert len(r.content) > 0, "Photo body is empty"
        log(f"     ✅ BWC: raw file_id works (old trades compatibility)")
        log("\n✅ TEST 4 PASSED: BWC raw file_id working")
    else:
        log(f"  ⏭️  SKIPPED: Telegram upload failed, no file_id to test BWC")
        log("     (This is expected if Telegram env is not configured)")
    
    # ========================================================================
    # TEST 5: RETRY ENDPOINT
    # ========================================================================
    log("\n[TEST 5] RETRY ENDPOINT")
    
    if telegram_status == "failed":
        log(f"  5a. POST /api/tj/photo/{screenshot_id}/retry (retry failed upload)")
        r = requests.post(f"{BASE_URL}/api/tj/photo/{screenshot_id}/retry", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200, f"Retry failed: {r.status_code}: {r.text}"
        data = r.json()
        assert "ok" in data, "Missing 'ok' key"
        assert "screenshot" in data, "Missing 'screenshot' key"
        log(f"     ✅ Retry returned 200")
        log(f"     ok: {data['ok']}")
        log(f"     screenshot.telegram_status: {data['screenshot']['telegram_status']}")
        if data["ok"]:
            log(f"     ✅ Retry SUCCESS: status now 'sent'")
        else:
            log(f"     ⚠️  Retry still failed (Telegram env issue)")
            log(f"     telegram_error: {data.get('telegram', {}).get('error', 'unknown')}")
        log("\n✅ TEST 5 PASSED: Retry endpoint working")
    elif telegram_status == "sent":
        log(f"  5a. POST /api/tj/photo/{screenshot_id}/retry (already sent)")
        r = requests.post(f"{BASE_URL}/api/tj/photo/{screenshot_id}/retry", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200, f"Retry failed: {r.status_code}: {r.text}"
        data = r.json()
        assert data["ok"] == True, "Retry should return ok=true for already-sent screenshot"
        log(f"     ✅ Retry on already-sent screenshot returns ok=true (idempotent)")
        log("\n✅ TEST 5 PASSED: Retry endpoint working")
    else:
        log(f"  ⏭️  SKIPPED: Unexpected status {telegram_status}")
    
    # ========================================================================
    # TEST 6: JSON DATA_URL UPLOAD
    # ========================================================================
    log("\n[TEST 6] JSON DATA_URL UPLOAD")
    
    log("  6a. POST /api/tj/upload with JSON data_url")
    png_bytes = create_test_png(200)
    b64 = base64.b64encode(png_bytes).decode('ascii')
    data_url = f"data:image/png;base64,{b64}"
    r = requests.post(
        f"{BASE_URL}/api/tj/upload",
        json={"data_url": data_url, "filename": "test_dataurl.png"},
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert r.status_code == 200, f"JSON upload failed: {r.status_code}: {r.text}"
    data = r.json()
    assert "screenshot" in data, "Response missing 'screenshot' key"
    screenshot2 = data["screenshot"]
    screenshot2_id = screenshot2["id"]
    log(f"     ✅ JSON data_url upload returned 200")
    log(f"     screenshot.id: {screenshot2_id}")
    log(f"     telegram_status: {screenshot2['telegram_status']}")
    
    # Verify we can GET it
    log(f"  6b. GET /api/tj/photo/{screenshot2_id}")
    r = requests.get(f"{BASE_URL}/api/tj/photo/{screenshot2_id}", headers={"Authorization": f"Bearer {owner_token}"})
    assert r.status_code == 200, f"Photo GET failed: {r.status_code}"
    assert len(r.content) > 0, "Photo body is empty"
    log(f"     ✅ Photo GET works for JSON-uploaded screenshot")
    
    log("\n✅ TEST 6 PASSED: JSON data_url upload working")
    
    # ========================================================================
    # TEST 7: SIZE CAP (13MB)
    # ========================================================================
    log("\n[TEST 7] SIZE CAP (13MB rejection)")
    
    log("  7a. POST /api/tj/upload with 13MB dummy buffer → expect 413")
    large_buffer = b'\x00' * (13 * 1024 * 1024)
    files = {"photo": ("large.png", io.BytesIO(large_buffer), "image/png")}
    r = requests.post(f"{BASE_URL}/api/tj/upload", files=files, headers={"Authorization": f"Bearer {owner_token}"})
    assert r.status_code == 413, f"Expected 413, got {r.status_code}: {r.text}"
    log(f"     ✅ 13MB upload rejected with 413")
    
    log("\n✅ TEST 7 PASSED: Size cap working")
    
    # ========================================================================
    # CLEANUP
    # ========================================================================
    log("\n[CLEANUP] Deleting test screenshots from tj_screenshots collection")
    
    # We need to delete via MongoDB directly (no DELETE endpoint for screenshots)
    # For now, just log the ids
    log(f"  Test screenshot ids created: {screenshot_id}, {screenshot2_id}")
    log(f"  ⚠️  Manual cleanup required: delete from tj_screenshots collection")
    log(f"     (No DELETE endpoint for screenshots, by design)")
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    log("\n" + "=" * 80)
    log("✅ ALL TESTS PASSED")
    log("=" * 80)
    log("\nSUMMARY:")
    log("  1. ✅ Auth guards: no token → 401, non-owner → 403, ?token= works")
    log("  2. ✅ Upload happy path: multipart PNG → 200 with screenshot object")
    log(f"  3. ✅ Photo GET by id: /api/tj/photo/{screenshot_id} → 200 image")
    if telegram_status == "sent" and file_id:
        log(f"  4. ✅ Photo GET BWC: /api/tj/photo/{file_id} → 200 (raw file_id)")
    else:
        log(f"  4. ⏭️  Photo GET BWC: SKIPPED (Telegram not configured)")
    log("  5. ✅ Retry endpoint: POST /api/tj/photo/<id>/retry → 200")
    log("  6. ✅ JSON data_url upload: POST with data_url → 200")
    log("  7. ✅ Size cap: 13MB upload → 413")
    log("\nTELEGRAM STATUS:")
    if telegram_status == "sent":
        log("  ✅ Telegram env configured and working")
    else:
        log("  ⚠️  Telegram env missing/unreachable (expected in some environments)")
        log("     Resilient pattern working: upload still returns 200, stores file_data locally")
    log("\nCLEANUP:")
    log(f"  ⚠️  Test screenshots NOT deleted (no DELETE endpoint)")
    log(f"     Manual cleanup: delete {screenshot_id}, {screenshot2_id} from tj_screenshots")
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
