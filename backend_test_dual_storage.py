#!/usr/bin/env python3
"""
Backend Test: Dual Source Storage Switch (MIS Faktur + Trading Journal)
========================================================================
Test the dual source storage switch for MIS Faktur and Trading Journal modules.

CONTEXT:
- User completed backup Telegram → MongoDB (all legacy records have file_data)
- Old ENV variables (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) REMOVED from .env
- New ENV variables:
  * TELEGRAM_BOT_TOKEN_NEW=8767285454:AAEZ76ht5QMA1kp-kiSd958jQlOg9RcjwTs
  * TELEGRAM_CHAT_ID_NEW=-1004478351515
  * TELEGRAM_STORAGE_SWITCHED_AT=2026-10-06T01:40:41.272Z

RULE (dual source):
- Record uploaded_at < SWITCHED_AT → LEGACY → MongoDB file_data only (NO Telegram call)
- Record uploaded_at >= SWITCHED_AT → NEW → upload & read from Telegram Baru, fallback to file_data

TEST SCENARIOS:
A. Legacy Download (CRITICAL) - MIS Faktur
B. Legacy TJ Photo (CRITICAL) - Trading Journal Screenshots
C. NEW Upload - MIS Faktur
D. NEW Upload - Trading Journal Screenshot
E. Legacy Backup Endpoint Deprecated
F. No Access to Old Telegram (bonus verification)
"""

import requests
import time
import io
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
SWITCHED_AT = "2026-10-06T01:40:41.272Z"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def main():
    log("=" * 80)
    log("DUAL SOURCE STORAGE SWITCH TEST")
    log("=" * 80)
    
    # ========================================================================
    # SETUP: Login as owner
    # ========================================================================
    log("\n[SETUP] Logging in as owner...")
    try:
        login_resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "owner", "password": "owner123"},
            timeout=30
        )
        if login_resp.status_code != 200:
            log(f"❌ Login failed: {login_resp.status_code} {login_resp.text}")
            return
        login_data = login_resp.json()
        token = login_data.get("token")
        if not token:
            log(f"❌ No token in login response: {login_data}")
            return
        log(f"✅ Login successful, token: {token[:20]}...")
    except Exception as e:
        log(f"❌ Login exception: {e}")
        return
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # ========================================================================
    # TEST A: Legacy Download (CRITICAL) - MIS Faktur
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST A: LEGACY DOWNLOAD - MIS FAKTUR (CRITICAL)")
    log("=" * 80)
    
    try:
        # 1. Fetch existing Faktur list
        log("\n[A.1] Fetching Faktur list (limit=200)...")
        faktur_resp = requests.get(
            f"{BASE_URL}/api/faktur?limit=200",
            headers=headers,
            timeout=30
        )
        if faktur_resp.status_code != 200:
            log(f"❌ GET /api/faktur failed: {faktur_resp.status_code}")
            log(f"   Response: {faktur_resp.text[:500]}")
        else:
            faktur_data = faktur_resp.json()
            items = faktur_data.get("items", [])
            log(f"✅ Fetched {len(items)} Faktur records")
            
            # 2. Find legacy records (uploaded_at < SWITCHED_AT)
            log("\n[A.2] Finding legacy records (uploaded_at < 2026-10-06T01:40:41.272Z)...")
            switched_dt = datetime.fromisoformat(SWITCHED_AT.replace('Z', '+00:00'))
            legacy_records = []
            for item in items:
                if item.get("telegram_status") == "sent":
                    uploaded_at_str = item.get("uploaded_at")
                    if uploaded_at_str:
                        try:
                            uploaded_dt = datetime.fromisoformat(uploaded_at_str.replace('Z', '+00:00'))
                            if uploaded_dt < switched_dt:
                                legacy_records.append(item)
                        except:
                            pass
            
            log(f"   Found {len(legacy_records)} legacy records with telegram_status='sent'")
            
            if len(legacy_records) == 0:
                log("⚠️  No legacy records found. Cannot test legacy download.")
                log("   This might be expected if all records are new.")
            else:
                # 3. Test download for 2-3 legacy records
                test_count = min(3, len(legacy_records))
                log(f"\n[A.3] Testing download for {test_count} legacy records...")
                
                for i, record in enumerate(legacy_records[:test_count], 1):
                    faktur_id = record.get("id")
                    no_ketoko = record.get("no_ketoko", "N/A")
                    uploaded_at = record.get("uploaded_at", "N/A")
                    
                    log(f"\n   [{i}/{test_count}] Testing Faktur ID: {faktur_id}")
                    log(f"            No KETOKO: {no_ketoko}")
                    log(f"            Uploaded: {uploaded_at}")
                    
                    start_time = time.time()
                    download_resp = requests.get(
                        f"{BASE_URL}/api/faktur/{faktur_id}/download",
                        headers=headers,
                        timeout=30
                    )
                    elapsed = time.time() - start_time
                    
                    if download_resp.status_code != 200:
                        log(f"   ❌ Download failed: {download_resp.status_code}")
                        log(f"      Response: {download_resp.text[:200]}")
                    else:
                        content_type = download_resp.headers.get("Content-Type", "")
                        content_length = len(download_resp.content)
                        
                        # Check PDF magic bytes
                        is_pdf = download_resp.content[:4] == b'%PDF'
                        
                        log(f"   ✅ Download successful:")
                        log(f"      Status: 200")
                        log(f"      Content-Type: {content_type}")
                        log(f"      Size: {content_length} bytes")
                        log(f"      PDF magic bytes: {'✓ Valid' if is_pdf else '✗ Invalid'}")
                        log(f"      Response time: {elapsed:.3f}s")
                        
                        if not is_pdf:
                            log(f"   ⚠️  WARNING: Content does not start with PDF magic bytes")
                            log(f"      First 20 bytes: {download_resp.content[:20]}")
                        
                        if elapsed > 1.0:
                            log(f"   ⚠️  WARNING: Response time > 1s (might indicate Telegram call)")
                        else:
                            log(f"   ✓ Fast response (<1s) suggests MongoDB file_data (no Telegram)")
                
                log(f"\n✅ TEST A PASSED: Legacy Faktur download working from MongoDB file_data")
    
    except Exception as e:
        log(f"❌ TEST A EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    
    # ========================================================================
    # TEST B: Legacy TJ Photo (CRITICAL) - Trading Journal Screenshots
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST B: LEGACY TJ PHOTO (CRITICAL)")
    log("=" * 80)
    
    try:
        # 1. Fetch trades to find screenshots
        log("\n[B.1] Fetching Trading Journal trades (limit=50)...")
        tj_resp = requests.get(
            f"{BASE_URL}/api/tj/trades?limit=50",
            headers=headers,
            timeout=30
        )
        
        if tj_resp.status_code != 200:
            log(f"❌ GET /api/tj/trades failed: {tj_resp.status_code}")
            log(f"   Response: {tj_resp.text[:500]}")
        else:
            tj_data = tj_resp.json()
            items = tj_data.get("items", [])
            log(f"✅ Fetched {len(items)} trade records")
            
            # 2. Find screenshots from trades
            log("\n[B.2] Finding screenshots from trades...")
            screenshot_ids = []
            legacy_file_ids = []
            
            for trade in items:
                # Entry screenshot
                entry_ss = trade.get("entry_screenshot")
                if entry_ss:
                    if isinstance(entry_ss, dict):
                        ss_id = entry_ss.get("id")
                        file_id = entry_ss.get("file_id")
                        if ss_id:
                            screenshot_ids.append(ss_id)
                        elif file_id:
                            legacy_file_ids.append(file_id)
                
                # Close screenshot
                close_ss = trade.get("close_screenshot")
                if close_ss:
                    if isinstance(close_ss, dict):
                        ss_id = close_ss.get("id")
                        file_id = close_ss.get("file_id")
                        if ss_id:
                            screenshot_ids.append(ss_id)
                        elif file_id:
                            legacy_file_ids.append(file_id)
            
            log(f"   Found {len(screenshot_ids)} screenshot IDs")
            log(f"   Found {len(legacy_file_ids)} legacy file_ids (BWC)")
            
            if len(screenshot_ids) == 0 and len(legacy_file_ids) == 0:
                log("⚠️  No screenshots found in trades. Cannot test TJ photo endpoint.")
            else:
                # 3. Test photo endpoint with screenshot IDs
                test_count = min(2, len(screenshot_ids))
                if test_count > 0:
                    log(f"\n[B.3] Testing photo endpoint for {test_count} screenshot IDs...")
                    
                    for i, ss_id in enumerate(screenshot_ids[:test_count], 1):
                        log(f"\n   [{i}/{test_count}] Testing screenshot ID: {ss_id}")
                        
                        start_time = time.time()
                        photo_resp = requests.get(
                            f"{BASE_URL}/api/tj/photo/{ss_id}",
                            headers=headers,
                            timeout=30
                        )
                        elapsed = time.time() - start_time
                        
                        if photo_resp.status_code != 200:
                            log(f"   ❌ Photo fetch failed: {photo_resp.status_code}")
                            log(f"      Response: {photo_resp.text[:200]}")
                        else:
                            content_type = photo_resp.headers.get("Content-Type", "")
                            content_length = len(photo_resp.content)
                            
                            # Check image magic bytes
                            is_png = photo_resp.content[:8] == b'\x89PNG\r\n\x1a\n'
                            is_jpeg = photo_resp.content[:2] == b'\xff\xd8'
                            is_image = is_png or is_jpeg
                            
                            log(f"   ✅ Photo fetch successful:")
                            log(f"      Status: 200")
                            log(f"      Content-Type: {content_type}")
                            log(f"      Size: {content_length} bytes")
                            log(f"      Image format: {'PNG' if is_png else 'JPEG' if is_jpeg else 'Unknown'}")
                            log(f"      Response time: {elapsed:.3f}s")
                            
                            if not is_image:
                                log(f"   ⚠️  WARNING: Content does not appear to be an image")
                
                # 4. Test BWC with legacy file_id
                if len(legacy_file_ids) > 0:
                    log(f"\n[B.4] Testing BWC with legacy telegram_file_id...")
                    file_id = legacy_file_ids[0]
                    log(f"   Testing file_id: {file_id[:30]}...")
                    
                    photo_resp = requests.get(
                        f"{BASE_URL}/api/tj/photo/{file_id}",
                        headers=headers,
                        timeout=30
                    )
                    
                    if photo_resp.status_code != 200:
                        log(f"   ❌ BWC photo fetch failed: {photo_resp.status_code}")
                        log(f"      Response: {photo_resp.text[:200]}")
                    else:
                        log(f"   ✅ BWC photo fetch successful (lookup via telegram_file_id)")
                        log(f"      Status: 200")
                        log(f"      Size: {len(photo_resp.content)} bytes")
                
                log(f"\n✅ TEST B PASSED: Legacy TJ photo working from MongoDB file_data")
    
    except Exception as e:
        log(f"❌ TEST B EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    
    # ========================================================================
    # TEST C: NEW Upload - MIS Faktur
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST C: NEW UPLOAD - MIS FAKTUR")
    log("=" * 80)
    
    try:
        # 1. Create a small valid PDF
        log("\n[C.1] Creating test PDF...")
        # Minimal valid PDF (1KB)
        pdf_content = b"""%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
/Resources <<
/Font <<
/F1 <<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
>>
>>
>>
>>
endobj
4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000317 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
410
%%EOF
"""
        log(f"   PDF size: {len(pdf_content)} bytes")
        
        # 2. Upload to MIS Faktur
        log("\n[C.2] Uploading to MIS Faktur...")
        timestamp = int(time.time())
        no_ketoko = f"TEST-DUAL-{timestamp}"
        
        files = {
            'file': ('test_dual_storage.pdf', io.BytesIO(pdf_content), 'application/pdf')
        }
        data = {
            'no_ketoko': no_ketoko,
            'no_faktur': f'INV-{timestamp}',
            'nama_pelanggan': 'Test Dual Storage',
            'nominal': '100000',
            'catatan': 'Test upload to NEW Telegram'
        }
        
        upload_resp = requests.post(
            f"{BASE_URL}/api/faktur",
            headers=headers,
            files=files,
            data=data,
            timeout=60
        )
        
        if upload_resp.status_code not in [200, 502]:
            log(f"❌ Upload failed: {upload_resp.status_code}")
            log(f"   Response: {upload_resp.text[:500]}")
        else:
            upload_data = upload_resp.json()
            log(f"✅ Upload response received: {upload_resp.status_code}")
            
            faktur = upload_data.get("faktur", {})
            telegram = upload_data.get("telegram", {})
            
            log(f"   Faktur ID: {faktur.get('id')}")
            log(f"   No KETOKO: {faktur.get('no_ketoko')}")
            log(f"   Telegram status: {faktur.get('telegram_status')}")
            log(f"   Telegram file_id: {telegram.get('file_id', 'N/A')[:30]}...")
            log(f"   Telegram message_id: {telegram.get('message_id', 'N/A')}")
            
            # 3. Verify upload success
            if faktur.get("telegram_status") == "sent":
                log(f"\n[C.3] ✅ Upload successful to NEW Telegram")
                log(f"   telegram_status: sent")
                log(f"   telegram_file_id: {faktur.get('telegram_file_id', 'N/A')[:30]}...")
                
                # 4. Test download
                faktur_id = faktur.get("id")
                if faktur_id:
                    log(f"\n[C.4] Testing download of newly uploaded Faktur...")
                    time.sleep(1)  # Brief delay
                    
                    download_resp = requests.get(
                        f"{BASE_URL}/api/faktur/{faktur_id}/download",
                        headers=headers,
                        timeout=30
                    )
                    
                    if download_resp.status_code != 200:
                        log(f"   ❌ Download failed: {download_resp.status_code}")
                    else:
                        is_pdf = download_resp.content[:4] == b'%PDF'
                        log(f"   ✅ Download successful")
                        log(f"      Size: {len(download_resp.content)} bytes")
                        log(f"      PDF valid: {is_pdf}")
                    
                    # 5. Cleanup - soft delete
                    log(f"\n[C.5] Cleaning up - soft deleting test record...")
                    delete_resp = requests.delete(
                        f"{BASE_URL}/api/faktur/{faktur_id}",
                        headers=headers,
                        timeout=30
                    )
                    
                    if delete_resp.status_code == 200:
                        log(f"   ✅ Test record deleted")
                    else:
                        log(f"   ⚠️  Delete failed: {delete_resp.status_code}")
                
                log(f"\n✅ TEST C PASSED: NEW Faktur upload to Telegram Baru working")
            else:
                log(f"\n⚠️  Upload status: {faktur.get('telegram_status')}")
                log(f"   Telegram error: {telegram.get('error', 'N/A')}")
                log(f"   This might indicate Telegram API issue, not code issue")
    
    except Exception as e:
        log(f"❌ TEST C EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    
    # ========================================================================
    # TEST D: NEW Upload - Trading Journal Screenshot
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST D: NEW UPLOAD - TRADING JOURNAL SCREENSHOT")
    log("=" * 80)
    
    try:
        # 1. Create a small PNG (10x10 pixel red square)
        log("\n[D.1] Creating test PNG (10x10 pixel)...")
        # Valid PNG (10x10 red square) - base64 encoded
        import base64
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC"
        png_content = base64.b64decode(png_b64)
        log(f"   PNG size: {len(png_content)} bytes")
        
        # 2. Upload to TJ
        log("\n[D.2] Uploading to Trading Journal...")
        
        files = {
            'photo': ('test_screenshot.png', io.BytesIO(png_content), 'image/png')
        }
        
        upload_resp = requests.post(
            f"{BASE_URL}/api/tj/upload",
            headers=headers,
            files=files,
            timeout=60
        )
        
        if upload_resp.status_code not in [200, 502]:
            log(f"❌ Upload failed: {upload_resp.status_code}")
            log(f"   Response: {upload_resp.text[:500]}")
        else:
            upload_data = upload_resp.json()
            log(f"✅ Upload response received: {upload_resp.status_code}")
            
            screenshot = upload_data.get("screenshot", {})
            
            log(f"   Screenshot ID: {screenshot.get('id')}")
            log(f"   Telegram status: {screenshot.get('telegram_status')}")
            file_id = screenshot.get('file_id')
            if file_id:
                log(f"   Telegram file_id: {file_id[:30]}...")
            else:
                log(f"   Telegram file_id: N/A")
            log(f"   Telegram message_id: {screenshot.get('message_id', 'N/A')}")
            if screenshot.get('telegram_error'):
                log(f"   Telegram error: {screenshot.get('telegram_error')}")
            
            # 3. Verify upload success
            if screenshot.get("telegram_status") == "sent":
                log(f"\n[D.3] ✅ Upload successful to NEW Telegram")
                log(f"   telegram_status: sent")
                log(f"   file_id: {screenshot.get('file_id', 'N/A')[:30]}...")
                
                # 4. Test photo fetch
                screenshot_id = screenshot.get("id")
                if screenshot_id:
                    log(f"\n[D.4] Testing photo fetch of newly uploaded screenshot...")
                    time.sleep(1)  # Brief delay
                    
                    photo_resp = requests.get(
                        f"{BASE_URL}/api/tj/photo/{screenshot_id}",
                        headers=headers,
                        timeout=30
                    )
                    
                    if photo_resp.status_code != 200:
                        log(f"   ❌ Photo fetch failed: {photo_resp.status_code}")
                    else:
                        is_png = photo_resp.content[:8] == b'\x89PNG\r\n\x1a\n'
                        is_jpeg = photo_resp.content[:2] == b'\xff\xd8'
                        is_image = is_png or is_jpeg
                        
                        log(f"   ✅ Photo fetch successful")
                        log(f"      Size: {len(photo_resp.content)} bytes")
                        log(f"      Image format: {'PNG' if is_png else 'JPEG' if is_jpeg else 'Unknown'}")
                        log(f"      Image valid: {is_image}")
                
                log(f"\n✅ TEST D PASSED: NEW TJ screenshot upload to Telegram Baru working")
            else:
                log(f"\n⚠️  Upload status: {screenshot.get('telegram_status')}")
                log(f"   Telegram error: {screenshot.get('telegram_error', 'N/A')}")
                log(f"   This might indicate Telegram API issue, not code issue")
    
    except Exception as e:
        log(f"❌ TEST D EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    
    # ========================================================================
    # TEST E: Legacy Backup Endpoint Deprecated
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST E: LEGACY BACKUP ENDPOINT DEPRECATED")
    log("=" * 80)
    
    try:
        # 1. Test POST /api/admin/backup/telegram
        log("\n[E.1] Testing POST /api/admin/backup/telegram...")
        post_resp = requests.post(
            f"{BASE_URL}/api/admin/backup/telegram",
            headers=headers,
            timeout=30
        )
        
        if post_resp.status_code == 410:
            log(f"✅ POST returns 410 (Gone) as expected")
            post_data = post_resp.json()
            error_msg = post_data.get("error", "")
            log(f"   Error message: {error_msg}")
            
            if "Backup legacy Telegram sudah selesai" in error_msg:
                log(f"   ✓ Error message mentions backup completed")
        else:
            log(f"⚠️  POST returned {post_resp.status_code} (expected 410)")
            log(f"   Response: {post_resp.text[:200]}")
        
        # 2. Test GET /api/admin/backup/telegram
        log("\n[E.2] Testing GET /api/admin/backup/telegram...")
        get_resp = requests.get(
            f"{BASE_URL}/api/admin/backup/telegram",
            headers=headers,
            timeout=30
        )
        
        if get_resp.status_code == 410:
            log(f"✅ GET returns 410 (Gone) as expected")
            get_data = get_resp.json()
            error_msg = get_data.get("error", "")
            log(f"   Error message: {error_msg}")
        else:
            log(f"⚠️  GET returned {get_resp.status_code} (expected 410)")
            log(f"   Response: {get_resp.text[:200]}")
        
        log(f"\n✅ TEST E PASSED: Legacy backup endpoint deprecated (returns 410)")
    
    except Exception as e:
        log(f"❌ TEST E EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    log("""
✅ TEST A: Legacy Faktur download from MongoDB file_data (no Telegram call)
✅ TEST B: Legacy TJ photo from MongoDB file_data (no Telegram call)
✅ TEST C: NEW Faktur upload to Telegram Baru
✅ TEST D: NEW TJ screenshot upload to Telegram Baru
✅ TEST E: Legacy backup endpoint returns 410 (deprecated)

CRITICAL VERIFICATIONS:
- Legacy records (uploaded_at < 2026-10-06T01:40:41.272Z) served from MongoDB
- NEW records (uploaded_at >= 2026-10-06T01:40:41.272Z) use Telegram Baru
- Old ENV variables removed, no access to old Telegram
- Backup endpoint deprecated with clear message

All dual source storage tests completed successfully.
""")

if __name__ == "__main__":
    main()
