#!/usr/bin/env python3
"""
Backend test for Merdeka Share PWA - THIRD ROUND (Unified Manifest Fix)

ROOT CAUSE: Chrome Android does NOT support multiple PWAs on the same origin.
Two separate manifests (main + share-manifest) with distinct scopes were treated as ONE app.

FIX: Consolidate to ONE unified manifest at /app/app/manifest.js (Next.js dynamic manifest).

TEST SCOPE:
1. Dynamic manifest served at /manifest.webmanifest with all required fields
2. Old static manifests DELETED (return 404)
3. HTML SSR pages emit unified manifest link
4. PNG icons still served (regression)
5. Service worker (regression)
6. Backend endpoint regression (POST /api/om/pdfs/auto)
7. /share and / pages still load
"""

import requests
import json
import io
import re
from datetime import datetime

# Base URL from .env
BASE_URL = "https://priview-staging.preview.emergentagent.com"

# Test credentials
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"
STAFF_USERNAME = "cindy"
STAFF_PASSWORD = "cindy123"

def login(username, password):
    """Login and return token"""
    resp = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=30
    )
    if resp.status_code == 200:
        data = resp.json()
        return data.get("token")
    return None

def create_minimal_pdf():
    """Create a minimal valid PDF (543 bytes)"""
    return b"""%PDF-1.4
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

def main():
    print("=" * 80)
    print("MERDEKA SHARE PWA - UNIFIED MANIFEST FIX TEST (THIRD ROUND)")
    print("=" * 80)
    print()
    
    total_tests = 0
    passed_tests = 0
    
    # ========== TEST 1: Dynamic manifest served at /manifest.webmanifest ==========
    print("TEST 1: Dynamic manifest served at /manifest.webmanifest")
    print("-" * 80)
    
    try:
        resp = requests.get(f"{BASE_URL}/manifest.webmanifest", timeout=30)
        total_tests += 1
        if resp.status_code == 200:
            print(f"✅ GET /manifest.webmanifest returns 200")
            passed_tests += 1
        else:
            print(f"❌ GET /manifest.webmanifest returns {resp.status_code} (expected 200)")
        
        # Check Content-Type
        total_tests += 1
        content_type = resp.headers.get('Content-Type', '')
        if 'application/manifest+json' in content_type or 'application/json' in content_type:
            print(f"✅ Content-Type: {content_type}")
            passed_tests += 1
        else:
            print(f"❌ Content-Type: {content_type} (expected application/manifest+json)")
        
        # Parse JSON
        manifest = resp.json()
        
        # Check required fields
        checks = [
            ('name', 'Merdeka Share'),
            ('short_name', 'Merdeka Share'),
            ('id', '/'),
            ('start_url', '/'),
            ('scope', '/'),
            ('display', 'standalone'),
        ]
        
        for field, expected in checks:
            total_tests += 1
            actual = manifest.get(field)
            if actual == expected:
                print(f"✅ {field} = '{actual}'")
                passed_tests += 1
            else:
                print(f"❌ {field} = '{actual}' (expected '{expected}')")
        
        # Check display_override array
        total_tests += 1
        display_override = manifest.get('display_override', [])
        if isinstance(display_override, list) and len(display_override) == 3:
            print(f"✅ display_override array present with 3 items: {display_override}")
            passed_tests += 1
        else:
            print(f"❌ display_override = {display_override} (expected array with 3 items)")
        
        # Check dir and lang
        total_tests += 1
        if manifest.get('dir') == 'ltr':
            print(f"✅ dir = 'ltr'")
            passed_tests += 1
        else:
            print(f"❌ dir = '{manifest.get('dir')}' (expected 'ltr')")
        
        total_tests += 1
        if manifest.get('lang') == 'id-ID':
            print(f"✅ lang = 'id-ID'")
            passed_tests += 1
        else:
            print(f"❌ lang = '{manifest.get('lang')}' (expected 'id-ID')")
        
        total_tests += 1
        if manifest.get('prefer_related_applications') == False:
            print(f"✅ prefer_related_applications = false")
            passed_tests += 1
        else:
            print(f"❌ prefer_related_applications = {manifest.get('prefer_related_applications')} (expected false)")
        
        # Check icons array
        total_tests += 1
        icons = manifest.get('icons', [])
        if len(icons) == 3:
            print(f"✅ icons array with 3 entries")
            passed_tests += 1
            
            # Check each icon
            for icon in icons:
                total_tests += 1
                if icon.get('type') == 'image/png' and '/icons/merdeka-share-' in icon.get('src', ''):
                    print(f"  ✅ Icon: {icon.get('src')} ({icon.get('sizes')}, {icon.get('purpose')})")
                    passed_tests += 1
                else:
                    print(f"  ❌ Icon: {icon}")
        else:
            print(f"❌ icons array has {len(icons)} entries (expected 3)")
        
        # Check share_target
        total_tests += 1
        share_target = manifest.get('share_target', {})
        if share_target:
            print(f"✅ share_target present")
            passed_tests += 1
            
            # Check share_target.action (MUST be absolute URL)
            total_tests += 1
            action = share_target.get('action', '')
            if action.startswith('http://') or action.startswith('https://'):
                if action.endswith('/share'):
                    print(f"✅ share_target.action = '{action}' (ABSOLUTE URL ending with /share)")
                    passed_tests += 1
                else:
                    print(f"❌ share_target.action = '{action}' (absolute but doesn't end with /share)")
            else:
                print(f"❌ share_target.action = '{action}' (MUST be absolute URL starting with http:// or https://)")
            
            # Check share_target.method
            total_tests += 1
            if share_target.get('method') == 'POST':
                print(f"✅ share_target.method = 'POST'")
                passed_tests += 1
            else:
                print(f"❌ share_target.method = '{share_target.get('method')}' (expected 'POST')")
            
            # Check share_target.enctype
            total_tests += 1
            if share_target.get('enctype') == 'multipart/form-data':
                print(f"✅ share_target.enctype = 'multipart/form-data'")
                passed_tests += 1
            else:
                print(f"❌ share_target.enctype = '{share_target.get('enctype')}' (expected 'multipart/form-data')")
            
            # Check share_target.params.files
            total_tests += 1
            params = share_target.get('params', {})
            files = params.get('files', [])
            if len(files) > 0:
                file_entry = files[0]
                accept = file_entry.get('accept', [])
                name = file_entry.get('name', '')
                
                if ('application/pdf' in accept or '.pdf' in accept) and name == 'shared_files':
                    print(f"✅ share_target.params.files[0].accept includes PDF, name='shared_files'")
                    passed_tests += 1
                else:
                    print(f"❌ share_target.params.files[0]: accept={accept}, name={name}")
            else:
                print(f"❌ share_target.params.files is empty")
        else:
            print(f"❌ share_target not present")
        
        # Check shortcuts
        total_tests += 1
        shortcuts = manifest.get('shortcuts', [])
        has_share_shortcut = any(s.get('url') == '/share' for s in shortcuts)
        if has_share_shortcut:
            print(f"✅ shortcuts array includes entry with url='/share'")
            passed_tests += 1
        else:
            print(f"❌ shortcuts array does not include /share")
        
    except Exception as e:
        print(f"❌ Error testing dynamic manifest: {e}")
    
    print()
    
    # ========== TEST 2: Old static manifests DELETED (return 404) ==========
    print("TEST 2: Old static manifests DELETED (return 404)")
    print("-" * 80)
    
    old_manifests = [
        '/manifest.json',
        '/share-manifest.webmanifest'
    ]
    
    for path in old_manifests:
        try:
            resp = requests.get(f"{BASE_URL}{path}", timeout=30)
            total_tests += 1
            if resp.status_code == 404:
                print(f"✅ GET {path} returns 404 (correctly deleted)")
                passed_tests += 1
            else:
                print(f"❌ GET {path} returns {resp.status_code} (expected 404)")
        except Exception as e:
            print(f"❌ Error testing {path}: {e}")
    
    print()
    
    # ========== TEST 3: HTML SSR pages emit unified manifest link ==========
    print("TEST 3: HTML SSR pages emit unified manifest link")
    print("-" * 80)
    
    pages = [
        ('/', '/manifest.webmanifest'),
        ('/share', '/manifest.webmanifest')
    ]
    
    for page_path, expected_manifest in pages:
        try:
            resp = requests.get(f"{BASE_URL}{page_path}", timeout=30)
            total_tests += 1
            if resp.status_code == 200:
                html = resp.text
                # Look for <link rel="manifest" href="/manifest.webmanifest">
                manifest_link_pattern = r'<link[^>]*rel=["\']manifest["\'][^>]*href=["\']([^"\']+)["\']'
                matches = re.findall(manifest_link_pattern, html)
                
                if expected_manifest in matches:
                    print(f"✅ GET {page_path} HTML contains <link rel=\"manifest\" href=\"{expected_manifest}\">")
                    passed_tests += 1
                else:
                    print(f"❌ GET {page_path} HTML manifest links: {matches} (expected {expected_manifest})")
            else:
                print(f"❌ GET {page_path} returns {resp.status_code} (expected 200)")
        except Exception as e:
            print(f"❌ Error testing {page_path}: {e}")
    
    print()
    
    # ========== TEST 4: PNG icons still served (regression) ==========
    print("TEST 4: PNG icons still served (regression)")
    print("-" * 80)
    
    icons = [
        '/icons/merdeka-share-192.png',
        '/icons/merdeka-share-512.png',
        '/icons/merdeka-share-maskable-512.png',
        '/icons/mis-192.png',
        '/icons/mis-512.png',
        '/icons/mis-maskable-512.png'
    ]
    
    for icon_path in icons:
        try:
            resp = requests.get(f"{BASE_URL}{icon_path}", timeout=30)
            total_tests += 1
            if resp.status_code == 200:
                content_type = resp.headers.get('Content-Type', '')
                content_length = len(resp.content)
                
                # Check PNG magic bytes
                is_png = resp.content[:8] == b'\x89PNG\r\n\x1a\n'
                
                if 'image/png' in content_type and is_png and content_length > 500:
                    print(f"✅ {icon_path}: 200, {content_length} bytes, valid PNG")
                    passed_tests += 1
                else:
                    print(f"❌ {icon_path}: Content-Type={content_type}, size={content_length}, PNG={is_png}")
            else:
                print(f"❌ GET {icon_path} returns {resp.status_code} (expected 200)")
        except Exception as e:
            print(f"❌ Error testing {icon_path}: {e}")
    
    print()
    
    # ========== TEST 5: Service worker (regression) ==========
    print("TEST 5: Service worker (regression)")
    print("-" * 80)
    
    try:
        resp = requests.get(f"{BASE_URL}/sw.js", timeout=30)
        total_tests += 1
        if resp.status_code == 200:
            print(f"✅ GET /sw.js returns 200")
            passed_tests += 1
        else:
            print(f"❌ GET /sw.js returns {resp.status_code} (expected 200)")
        
        sw_content = resp.text
        
        # Check cache version
        total_tests += 1
        if "CACHE_VERSION = 'mis-v8-unified-share-2026-07-25'" in sw_content:
            print(f"✅ SW contains CACHE_VERSION = 'mis-v8-unified-share-2026-07-25'")
            passed_tests += 1
        else:
            print(f"❌ SW cache version not found or incorrect")
        
        # Check POST /share handler
        total_tests += 1
        if 'handleShareTarget' in sw_content and "method === 'POST'" in sw_content:
            print(f"✅ SW contains POST /share handler (handleShareTarget)")
            passed_tests += 1
        else:
            print(f"❌ SW POST /share handler not found")
        
    except Exception as e:
        print(f"❌ Error testing service worker: {e}")
    
    print()
    
    # ========== TEST 6: Backend endpoint regression (POST /api/om/pdfs/auto) ==========
    print("TEST 6: Backend endpoint regression (POST /api/om/pdfs/auto)")
    print("-" * 80)
    
    # Login as owner
    owner_token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not owner_token:
        print(f"❌ Failed to login as owner")
    else:
        print(f"✅ Logged in as owner")
        
        # Upload PDF as owner
        try:
            pdf_content = create_minimal_pdf()
            files = {'file': ('test.pdf', io.BytesIO(pdf_content), 'application/pdf')}
            headers = {'Authorization': f'Bearer {owner_token}'}
            
            resp = requests.post(
                f"{BASE_URL}/api/om/pdfs/auto",
                files=files,
                headers=headers,
                timeout=30
            )
            
            total_tests += 1
            if resp.status_code == 200:
                data = resp.json()
                item = data.get('item', {})
                filename = item.get('filename', '')
                
                # Check filename pattern DDMMYY-N.pdf
                pattern = r'^\d{6}-\d+\.pdf$'
                if re.match(pattern, filename):
                    print(f"✅ Owner upload successful: {filename} (matches DDMMYY-N.pdf pattern)")
                    passed_tests += 1
                    
                    # Store ID for cleanup
                    pdf_id = item.get('id')
                else:
                    print(f"❌ Owner upload filename '{filename}' doesn't match DDMMYY-N.pdf pattern")
            else:
                print(f"❌ Owner upload returns {resp.status_code} (expected 200)")
        except Exception as e:
            print(f"❌ Error testing owner upload: {e}")
    
    # Login as staff
    staff_token = login(STAFF_USERNAME, STAFF_PASSWORD)
    if not staff_token:
        print(f"❌ Failed to login as staff")
    else:
        print(f"✅ Logged in as staff")
        
        # Try upload as staff (should fail)
        try:
            pdf_content = create_minimal_pdf()
            files = {'file': ('test.pdf', io.BytesIO(pdf_content), 'application/pdf')}
            headers = {'Authorization': f'Bearer {staff_token}'}
            
            resp = requests.post(
                f"{BASE_URL}/api/om/pdfs/auto",
                files=files,
                headers=headers,
                timeout=30
            )
            
            total_tests += 1
            if resp.status_code == 403:
                print(f"✅ Staff upload correctly denied with 403")
                passed_tests += 1
            else:
                print(f"❌ Staff upload returns {resp.status_code} (expected 403)")
        except Exception as e:
            print(f"❌ Error testing staff upload: {e}")
    
    # Cleanup test PDF
    if owner_token and 'pdf_id' in locals():
        try:
            headers = {'Authorization': f'Bearer {owner_token}'}
            resp = requests.delete(
                f"{BASE_URL}/api/om/pdfs/{pdf_id}",
                headers=headers,
                timeout=30
            )
            total_tests += 1
            if resp.status_code == 200:
                print(f"✅ Cleanup: test PDF deleted")
                passed_tests += 1
            else:
                print(f"❌ Cleanup failed: {resp.status_code}")
        except Exception as e:
            print(f"❌ Error during cleanup: {e}")
    
    print()
    
    # ========== TEST 7: /share and / pages still load ==========
    print("TEST 7: /share and / pages still load")
    print("-" * 80)
    
    pages = ['/', '/share']
    
    for page_path in pages:
        try:
            resp = requests.get(f"{BASE_URL}{page_path}", timeout=30)
            total_tests += 1
            if resp.status_code == 200:
                print(f"✅ GET {page_path} returns 200")
                passed_tests += 1
            else:
                print(f"❌ GET {page_path} returns {resp.status_code} (expected 200)")
        except Exception as e:
            print(f"❌ Error testing {page_path}: {e}")
    
    print()
    
    # ========== SUMMARY ==========
    print("=" * 80)
    print(f"TEST SUMMARY: {passed_tests}/{total_tests} tests passed ({100*passed_tests//total_tests if total_tests > 0 else 0}%)")
    print("=" * 80)
    
    if passed_tests == total_tests:
        print("✅ ALL TESTS PASSED - Unified manifest fix fully working!")
        return 0
    else:
        print(f"❌ {total_tests - passed_tests} test(s) failed")
        return 1

if __name__ == '__main__':
    exit(main())
