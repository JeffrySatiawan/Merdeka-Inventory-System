#!/usr/bin/env python3
"""
Test Merdeka Share PWA PNG Icon Fix (Second Round)
Verifies fixes for: "masih belum muncul merdeka share saat mau share pdf"

Root causes fixed:
1. SVG data URI icons → Real PNG icons (192×192, 512×512, maskable)
2. Scope overlap (both manifests had share_target) → Only share manifest has it
3. Trailing slash mismatch → Consistent no-trailing-slash in share manifest
"""

import requests
import json
import os
import sys

BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"

# Test credentials
OWNER_USER = "owner"
OWNER_PASS = "owner123"
STAFF_USER = "cindy"
STAFF_PASS = "cindy123"

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code == 200:
        data = resp.json()
        return data.get("token")
    return None

def check_png_magic_bytes(filepath):
    """Verify file is a valid PNG by checking magic bytes"""
    with open(filepath, 'rb') as f:
        magic = f.read(8)
        # PNG magic: \x89PNG\r\n\x1a\n
        expected = b'\x89PNG\r\n\x1a\n'
        return magic == expected

print("=" * 80)
print("TEST 1: PNG ICONS SERVED CORRECTLY")
print("=" * 80)

icon_files = [
    "merdeka-share-192.png",
    "merdeka-share-512.png",
    "merdeka-share-maskable-512.png",
    "mis-192.png",
    "mis-512.png",
    "mis-maskable-512.png"
]

test1_passed = 0
test1_total = len(icon_files) * 3  # 3 checks per file

for icon in icon_files:
    url = f"{BASE_URL}/icons/{icon}"
    print(f"\n📦 Testing {icon}...")
    
    # Check HTTP response
    resp = requests.head(url)
    if resp.status_code == 200:
        print(f"  ✅ HTTP 200")
        test1_passed += 1
    else:
        print(f"  ❌ HTTP {resp.status_code} (expected 200)")
    
    # Check Content-Type
    ct = resp.headers.get('Content-Type', '')
    if 'image/png' in ct:
        print(f"  ✅ Content-Type: {ct}")
        test1_passed += 1
    else:
        print(f"  ❌ Content-Type: {ct} (expected image/png)")
    
    # Check Content-Length
    cl = resp.headers.get('Content-Length', '0')
    if int(cl) > 500:
        print(f"  ✅ Content-Length: {cl} bytes (> 500)")
        test1_passed += 1
    else:
        print(f"  ❌ Content-Length: {cl} bytes (expected > 500)")
    
    # Verify PNG magic bytes
    local_path = f"/app/public/icons/{icon}"
    if os.path.exists(local_path):
        if check_png_magic_bytes(local_path):
            print(f"  ✅ Valid PNG magic bytes (\\x89PNG\\r\\n\\x1a\\n)")
        else:
            print(f"  ❌ Invalid PNG magic bytes")

print(f"\n📊 TEST 1 RESULT: {test1_passed}/{test1_total} checks passed")

print("\n" + "=" * 80)
print("TEST 2: MAIN MANIFEST (/manifest.json)")
print("=" * 80)

resp = requests.get(f"{BASE_URL}/manifest.json")
test2_passed = 0
test2_total = 8

print(f"\n📦 GET /manifest.json")
if resp.status_code == 200:
    print(f"  ✅ HTTP 200")
    test2_passed += 1
else:
    print(f"  ❌ HTTP {resp.status_code}")

ct = resp.headers.get('Content-Type', '')
if 'application/json' in ct or 'application/manifest+json' in ct:
    print(f"  ✅ Content-Type: {ct}")
    test2_passed += 1
else:
    print(f"  ❌ Content-Type: {ct}")

try:
    manifest = resp.json()
    
    # Check required fields
    if manifest.get('name') == 'Merdeka Inventory System':
        print(f"  ✅ name: {manifest['name']}")
        test2_passed += 1
    else:
        print(f"  ❌ name: {manifest.get('name')}")
    
    if manifest.get('short_name'):
        print(f"  ✅ short_name: {manifest['short_name']}")
        test2_passed += 1
    else:
        print(f"  ❌ short_name missing")
    
    if manifest.get('start_url'):
        print(f"  ✅ start_url: {manifest['start_url']}")
        test2_passed += 1
    else:
        print(f"  ❌ start_url missing")
    
    # Check icons are PNG
    icons = manifest.get('icons', [])
    png_192 = any(i.get('sizes') == '192x192' and i.get('type') == 'image/png' and '/icons/' in i.get('src', '') for i in icons)
    png_512 = any(i.get('sizes') == '512x512' and i.get('type') == 'image/png' and '/icons/' in i.get('src', '') for i in icons)
    
    if png_192:
        print(f"  ✅ Has 192×192 PNG icon")
        test2_passed += 1
    else:
        print(f"  ❌ Missing 192×192 PNG icon")
    
    if png_512:
        print(f"  ✅ Has 512×512 PNG icon")
        test2_passed += 1
    else:
        print(f"  ❌ Missing 512×512 PNG icon")
    
    # CRITICAL: Check share_target is REMOVED
    if 'share_target' not in manifest:
        print(f"  ✅ share_target field REMOVED (correct!)")
        test2_passed += 1
    else:
        print(f"  ❌ share_target field PRESENT (should be removed!)")
        print(f"     Found: {manifest['share_target']}")
    
except Exception as e:
    print(f"  ❌ Failed to parse JSON: {e}")

print(f"\n📊 TEST 2 RESULT: {test2_passed}/{test2_total} checks passed")

print("\n" + "=" * 80)
print("TEST 3: SHARE MANIFEST (/share-manifest.webmanifest)")
print("=" * 80)

resp = requests.get(f"{BASE_URL}/share-manifest.webmanifest")
test3_passed = 0
test3_total = 14

print(f"\n📦 GET /share-manifest.webmanifest")
if resp.status_code == 200:
    print(f"  ✅ HTTP 200")
    test3_passed += 1
else:
    print(f"  ❌ HTTP {resp.status_code}")

ct = resp.headers.get('Content-Type', '')
if 'application/manifest+json' in ct or 'application/json' in ct:
    print(f"  ✅ Content-Type: {ct}")
    test3_passed += 1
else:
    print(f"  ❌ Content-Type: {ct}")

try:
    manifest = resp.json()
    
    # Check name
    if manifest.get('name') == 'Merdeka Share':
        print(f"  ✅ name: {manifest['name']}")
        test3_passed += 1
    else:
        print(f"  ❌ name: {manifest.get('name')}")
    
    # Check consistent no-trailing-slash
    if manifest.get('id') == '/share':
        print(f"  ✅ id: /share (no trailing slash)")
        test3_passed += 1
    else:
        print(f"  ❌ id: {manifest.get('id')} (expected /share)")
    
    if manifest.get('scope') == '/share':
        print(f"  ✅ scope: /share (no trailing slash)")
        test3_passed += 1
    else:
        print(f"  ❌ scope: {manifest.get('scope')} (expected /share)")
    
    if manifest.get('start_url') == '/share':
        print(f"  ✅ start_url: /share (no trailing slash)")
        test3_passed += 1
    else:
        print(f"  ❌ start_url: {manifest.get('start_url')} (expected /share)")
    
    if manifest.get('display') == 'standalone':
        print(f"  ✅ display: standalone")
        test3_passed += 1
    else:
        print(f"  ❌ display: {manifest.get('display')}")
    
    # Check icons are PNG
    icons = manifest.get('icons', [])
    png_192 = any(i.get('sizes') == '192x192' and i.get('type') == 'image/png' for i in icons)
    png_512_any = any(i.get('sizes') == '512x512' and i.get('type') == 'image/png' and i.get('purpose') == 'any' for i in icons)
    png_512_maskable = any(i.get('sizes') == '512x512' and i.get('type') == 'image/png' and i.get('purpose') == 'maskable' for i in icons)
    
    if png_192:
        print(f"  ✅ Has 192×192 PNG icon (any)")
        test3_passed += 1
    else:
        print(f"  ❌ Missing 192×192 PNG icon")
    
    if png_512_any:
        print(f"  ✅ Has 512×512 PNG icon (any)")
        test3_passed += 1
    else:
        print(f"  ❌ Missing 512×512 PNG icon (any)")
    
    if png_512_maskable:
        print(f"  ✅ Has 512×512 PNG icon (maskable)")
        test3_passed += 1
    else:
        print(f"  ❌ Missing 512×512 PNG icon (maskable)")
    
    # Check share_target
    st = manifest.get('share_target', {})
    if st.get('action') == '/share':
        print(f"  ✅ share_target.action: /share")
        test3_passed += 1
    else:
        print(f"  ❌ share_target.action: {st.get('action')}")
    
    if st.get('method') == 'POST':
        print(f"  ✅ share_target.method: POST")
        test3_passed += 1
    else:
        print(f"  ❌ share_target.method: {st.get('method')}")
    
    if st.get('enctype') == 'multipart/form-data':
        print(f"  ✅ share_target.enctype: multipart/form-data")
        test3_passed += 1
    else:
        print(f"  ❌ share_target.enctype: {st.get('enctype')}")
    
    # Check files param accepts PDF
    files = st.get('params', {}).get('files', [])
    pdf_accepted = any('application/pdf' in f.get('accept', []) or '.pdf' in f.get('accept', []) for f in files)
    if pdf_accepted:
        print(f"  ✅ share_target accepts PDF files")
        test3_passed += 1
    else:
        print(f"  ❌ share_target does not accept PDF files")
        print(f"     Files: {files}")
    
except Exception as e:
    print(f"  ❌ Failed to parse JSON: {e}")

print(f"\n📊 TEST 3 RESULT: {test3_passed}/{test3_total} checks passed")

print("\n" + "=" * 80)
print("TEST 4: SSR MANIFEST LINK INJECTION")
print("=" * 80)

test4_passed = 0
test4_total = 2

# Check root page
print(f"\n📦 GET / (root page)")
resp = requests.get(BASE_URL)
if resp.status_code == 200:
    html = resp.text
    if '<link rel="manifest" href="/manifest.json"' in html:
        print(f"  ✅ Root page has <link rel=\"manifest\" href=\"/manifest.json\">")
        test4_passed += 1
    else:
        print(f"  ❌ Root page missing correct manifest link")
        # Check if wrong manifest is present
        if 'share-manifest.webmanifest' in html:
            print(f"     ERROR: Found share-manifest.webmanifest in root page!")
else:
    print(f"  ❌ HTTP {resp.status_code}")

# Check /share page
print(f"\n📦 GET /share")
resp = requests.get(f"{BASE_URL}/share")
if resp.status_code == 200:
    html = resp.text
    if '<link rel="manifest" href="/share-manifest.webmanifest"' in html:
        print(f"  ✅ /share page has <link rel=\"manifest\" href=\"/share-manifest.webmanifest\">")
        test4_passed += 1
    else:
        print(f"  ❌ /share page missing correct manifest link")
        # Check if wrong manifest is present
        if 'href="/manifest.json"' in html:
            print(f"     ERROR: Found /manifest.json in /share page!")
else:
    print(f"  ❌ HTTP {resp.status_code}")

print(f"\n📊 TEST 4 RESULT: {test4_passed}/{test4_total} checks passed")

print("\n" + "=" * 80)
print("TEST 5: SERVICE WORKER")
print("=" * 80)

test5_passed = 0
test5_total = 3

print(f"\n📦 GET /sw.js")
resp = requests.get(f"{BASE_URL}/sw.js")
if resp.status_code == 200:
    print(f"  ✅ HTTP 200")
    test5_passed += 1
    
    sw_content = resp.text
    
    # Check cache version
    if "CACHE_VERSION = 'mis-v7-share-png-2026-07-25'" in sw_content:
        print(f"  ✅ Cache version updated: mis-v7-share-png-2026-07-25")
        test5_passed += 1
    else:
        print(f"  ❌ Cache version not found or incorrect")
        # Try to find what version is there
        import re
        match = re.search(r"CACHE_VERSION = '([^']+)'", sw_content)
        if match:
            print(f"     Found: {match.group(1)}")
    
    # Check POST /share handler
    if 'handleShareTarget' in sw_content and "url.pathname === '/share'" in sw_content:
        print(f"  ✅ POST /share handler present (handleShareTarget)")
        test5_passed += 1
    else:
        print(f"  ❌ POST /share handler missing")
else:
    print(f"  ❌ HTTP {resp.status_code}")

print(f"\n📊 TEST 5 RESULT: {test5_passed}/{test5_total} checks passed")

print("\n" + "=" * 80)
print("TEST 6: BACKEND ENDPOINT REGRESSION (POST /api/om/pdfs/auto)")
print("=" * 80)

test6_passed = 0
test6_total = 3

# Login as owner
print(f"\n🔐 Logging in as owner...")
owner_token = login(OWNER_USER, OWNER_PASS)
if owner_token:
    print(f"  ✅ Owner login successful")
    test6_passed += 1
else:
    print(f"  ❌ Owner login failed")

# Login as staff (Cindy)
print(f"\n🔐 Logging in as staff (Cindy)...")
staff_token = login(STAFF_USER, STAFF_PASS)
if staff_token:
    print(f"  ✅ Staff login successful")
else:
    print(f"  ❌ Staff login failed")

# Create minimal valid PDF
pdf_content = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
190
%%EOF"""

test_pdf_ids = []

# Test owner can upload
if owner_token:
    print(f"\n📤 Testing owner upload to /api/om/pdfs/auto...")
    files = {'file': ('test.pdf', pdf_content, 'application/pdf')}
    headers = {'Authorization': f'Bearer {owner_token}'}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers)
    
    if resp.status_code == 200:
        data = resp.json()
        item = data.get('item', {})
        filename = item.get('filename', '')
        
        # Check filename pattern DDMMYY-N.pdf
        import re
        if re.match(r'^\d{6}-\d+\.pdf$', filename):
            print(f"  ✅ Owner upload successful: {filename}")
            test6_passed += 1
            test_pdf_ids.append(item.get('id'))
        else:
            print(f"  ❌ Filename pattern incorrect: {filename}")
    else:
        print(f"  ❌ Owner upload failed: HTTP {resp.status_code}")
        print(f"     Response: {resp.text[:200]}")

# Test staff cannot upload (should get 403)
if staff_token:
    print(f"\n📤 Testing staff upload (should be denied)...")
    files = {'file': ('test.pdf', pdf_content, 'application/pdf')}
    headers = {'Authorization': f'Bearer {staff_token}'}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers)
    
    if resp.status_code == 403:
        print(f"  ✅ Staff correctly denied (403)")
        test6_passed += 1
    else:
        print(f"  ❌ Staff should be denied but got HTTP {resp.status_code}")

print(f"\n📊 TEST 6 RESULT: {test6_passed}/{test6_total} checks passed")

# Cleanup
if test_pdf_ids and owner_token:
    print(f"\n🧹 Cleaning up test PDFs...")
    for pdf_id in test_pdf_ids:
        headers = {'Authorization': f'Bearer {owner_token}'}
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
        if resp.status_code == 200:
            print(f"  ✅ Deleted {pdf_id}")
        else:
            print(f"  ⚠️  Failed to delete {pdf_id}: HTTP {resp.status_code}")

print("\n" + "=" * 80)
print("TEST 7: /SHARE PAGE LOADS")
print("=" * 80)

test7_passed = 0
test7_total = 2

print(f"\n📦 GET /share")
resp = requests.get(f"{BASE_URL}/share")
if resp.status_code == 200:
    print(f"  ✅ HTTP 200")
    test7_passed += 1
    
    html = resp.text
    if '<title>Merdeka Share' in html or 'Merdeka Share' in html:
        print(f"  ✅ Page contains 'Merdeka Share'")
        test7_passed += 1
    else:
        print(f"  ❌ Page does not contain 'Merdeka Share'")
else:
    print(f"  ❌ HTTP {resp.status_code}")

print(f"\n📊 TEST 7 RESULT: {test7_passed}/{test7_total} checks passed")

# Final summary
print("\n" + "=" * 80)
print("FINAL SUMMARY")
print("=" * 80)

total_passed = test1_passed + test2_passed + test3_passed + test4_passed + test5_passed + test6_passed + test7_passed
total_tests = test1_total + test2_total + test3_total + test4_total + test5_total + test6_total + test7_total

print(f"\n📊 OVERALL: {total_passed}/{total_tests} checks passed ({100*total_passed//total_tests}%)")
print(f"\n  TEST 1 (PNG Icons):           {test1_passed}/{test1_total}")
print(f"  TEST 2 (Main Manifest):       {test2_passed}/{test2_total}")
print(f"  TEST 3 (Share Manifest):      {test3_passed}/{test3_total}")
print(f"  TEST 4 (SSR Manifest Links):  {test4_passed}/{test4_total}")
print(f"  TEST 5 (Service Worker):      {test5_passed}/{test5_total}")
print(f"  TEST 6 (Backend Regression):  {test6_passed}/{test6_total}")
print(f"  TEST 7 (/share Page):         {test7_passed}/{test7_total}")

if total_passed == total_tests:
    print(f"\n✅ ALL TESTS PASSED - PWA should now be installable on Android!")
    print(f"\n⚠️  NOTE: Real Android share sheet visibility CANNOT be verified in container.")
    print(f"   Requires physical Android device with Chrome to test share sheet.")
    sys.exit(0)
else:
    print(f"\n❌ SOME TESTS FAILED - Review failures above")
    sys.exit(1)
