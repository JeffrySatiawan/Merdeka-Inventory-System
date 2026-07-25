#!/usr/bin/env python3
"""
Backend/HTTP-level tests for PWA Share Target Manifest Fix
Tests SSR manifest link override, manifest content, service worker, and backend endpoint
"""
import requests
import json
import re
import io
from typing import Dict, Any

# Base URL from .env
BASE_URL = "https://priview-staging.preview.emergentagent.com"

def print_test(name: str):
    print(f"\n{'='*80}")
    print(f"TEST: {name}")
    print('='*80)

def print_result(passed: bool, message: str):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {message}")

def get_auth_token(username: str, password: str) -> str:
    """Login and get Bearer token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code != 200:
        raise Exception(f"Login failed: {resp.status_code} {resp.text}")
    data = resp.json()
    return data.get("token")

def create_minimal_pdf() -> bytes:
    """Create a minimal valid PDF (smallest possible)"""
    return b"""%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
203
%%EOF"""

# ============================================================================
# TEST 1: Manifest link SSR override
# ============================================================================
print_test("1. Manifest link SSR override")

# Test 1a: Root page should have /manifest.json
print("\n1a. Root page (/) manifest link:")
try:
    resp = requests.get(f"{BASE_URL}/", timeout=30)
    html = resp.text
    
    # Check for manifest.json link
    has_manifest_json = 'href="/manifest.json"' in html or 'href="/manifest.json"' in html
    has_share_manifest = 'href="/share-manifest.webmanifest"' in html
    
    print_result(
        has_manifest_json and not has_share_manifest,
        f"Root page has correct manifest link (manifest.json: {has_manifest_json}, share-manifest: {has_share_manifest})"
    )
    
    if not has_manifest_json:
        print(f"   ⚠️  Could not find manifest.json link in root HTML")
        # Print first 2000 chars to debug
        print(f"   HTML preview: {html[:2000]}")
except Exception as e:
    print_result(False, f"Root page request failed: {e}")

# Test 1b: /share page should have /share-manifest.webmanifest
print("\n1b. Share page (/share) manifest link:")
try:
    resp = requests.get(f"{BASE_URL}/share", timeout=30)
    html = resp.text
    
    # Check for share-manifest.webmanifest link
    has_share_manifest = 'href="/share-manifest.webmanifest"' in html
    has_manifest_json = 'href="/manifest.json"' in html and 'share-manifest' not in html
    
    print_result(
        has_share_manifest and not has_manifest_json,
        f"Share page has correct manifest link (share-manifest: {has_share_manifest}, manifest.json only: {has_manifest_json})"
    )
    
    if not has_share_manifest:
        print(f"   ⚠️  Could not find share-manifest.webmanifest link in /share HTML")
        # Print first 2000 chars to debug
        print(f"   HTML preview: {html[:2000]}")
except Exception as e:
    print_result(False, f"Share page request failed: {e}")

# ============================================================================
# TEST 2: Manifest content validation
# ============================================================================
print_test("2. Manifest content validation")

# Test 2a: /manifest.json content
print("\n2a. Main manifest (/manifest.json):")
try:
    resp = requests.get(f"{BASE_URL}/manifest.json", timeout=10)
    manifest = resp.json()
    
    checks = {
        "name is 'Merdeka Inventory System'": manifest.get("name") == "Merdeka Inventory System",
        "has share_target": "share_target" in manifest,
        "share_target.action is '/share'": manifest.get("share_target", {}).get("action") == "/share",
        "share_target.method is 'POST'": manifest.get("share_target", {}).get("method") == "POST",
        "share_target.enctype is 'multipart/form-data'": manifest.get("share_target", {}).get("enctype") == "multipart/form-data",
        "share_target has files param": "files" in manifest.get("share_target", {}).get("params", {}),
        "files param accepts application/pdf": any(
            "application/pdf" in f.get("accept", []) or ".pdf" in f.get("accept", [])
            for f in manifest.get("share_target", {}).get("params", {}).get("files", [])
        ),
        "has icons array": isinstance(manifest.get("icons"), list) and len(manifest.get("icons", [])) > 0,
        "has 512x512 icon": any("512" in icon.get("sizes", "") for icon in manifest.get("icons", [])),
    }
    
    for check_name, passed in checks.items():
        print_result(passed, check_name)
        
    if not all(checks.values()):
        print(f"\n   📄 Full manifest: {json.dumps(manifest, indent=2)}")
        
except Exception as e:
    print_result(False, f"Failed to fetch/parse manifest.json: {e}")

# Test 2b: /share-manifest.webmanifest content
print("\n2b. Share manifest (/share-manifest.webmanifest):")
try:
    resp = requests.get(f"{BASE_URL}/share-manifest.webmanifest", timeout=10)
    manifest = resp.json()
    
    checks = {
        "name is 'Merdeka Share'": manifest.get("name") == "Merdeka Share",
        "scope is '/share'": manifest.get("scope") == "/share",
        "start_url is '/share'": manifest.get("start_url") == "/share",
        "has share_target": "share_target" in manifest,
        "share_target.action is '/share'": manifest.get("share_target", {}).get("action") == "/share",
        "share_target.method is 'POST'": manifest.get("share_target", {}).get("method") == "POST",
        "share_target.enctype is 'multipart/form-data'": manifest.get("share_target", {}).get("enctype") == "multipart/form-data",
        "share_target has files param": "files" in manifest.get("share_target", {}).get("params", {}),
        "files param accepts application/pdf": any(
            "application/pdf" in f.get("accept", []) or ".pdf" in f.get("accept", [])
            for f in manifest.get("share_target", {}).get("params", {}).get("files", [])
        ),
        "has icons array": isinstance(manifest.get("icons"), list) and len(manifest.get("icons", [])) > 0,
        "has 512x512 icon": any("512" in icon.get("sizes", "") for icon in manifest.get("icons", [])),
    }
    
    for check_name, passed in checks.items():
        print_result(passed, check_name)
        
    if not all(checks.values()):
        print(f"\n   📄 Full manifest: {json.dumps(manifest, indent=2)}")
        
except Exception as e:
    print_result(False, f"Failed to fetch/parse share-manifest.webmanifest: {e}")

# ============================================================================
# TEST 3: Content-Type headers
# ============================================================================
print_test("3. Content-Type headers")

print("\n3a. /manifest.json Content-Type:")
try:
    resp = requests.get(f"{BASE_URL}/manifest.json", timeout=10)
    content_type = resp.headers.get("Content-Type", "")
    is_valid = "application/json" in content_type or "application/manifest+json" in content_type
    print_result(is_valid, f"Content-Type: {content_type}")
except Exception as e:
    print_result(False, f"Failed: {e}")

print("\n3b. /share-manifest.webmanifest Content-Type:")
try:
    resp = requests.get(f"{BASE_URL}/share-manifest.webmanifest", timeout=10)
    content_type = resp.headers.get("Content-Type", "")
    is_valid = "application/manifest+json" in content_type or "application/json" in content_type
    print_result(is_valid, f"Content-Type: {content_type}")
except Exception as e:
    print_result(False, f"Failed: {e}")

# ============================================================================
# TEST 4: Service Worker
# ============================================================================
print_test("4. Service Worker")

print("\n4a. /sw.js exists and returns JavaScript:")
try:
    resp = requests.get(f"{BASE_URL}/sw.js", timeout=10)
    is_200 = resp.status_code == 200
    content_type = resp.headers.get("Content-Type", "")
    is_js = "javascript" in content_type.lower() or "text/plain" in content_type.lower()
    
    print_result(is_200 and is_js, f"Status: {resp.status_code}, Content-Type: {content_type}")
    
    if is_200:
        sw_content = resp.text
        
        # Check for handleShareTarget function
        has_handle_share = "handleShareTarget" in sw_content or "handle-share" in sw_content.lower()
        print_result(has_handle_share, f"Contains handleShareTarget function: {has_handle_share}")
        
        # Check for POST /share handling
        has_post_check = "POST" in sw_content and "/share" in sw_content
        print_result(has_post_check, f"Contains POST /share handling: {has_post_check}")
        
        # Check for pathname check
        has_pathname_check = "pathname" in sw_content and "/share" in sw_content
        print_result(has_pathname_check, f"Contains pathname check: {has_pathname_check}")
        
except Exception as e:
    print_result(False, f"Failed: {e}")

# ============================================================================
# TEST 5: Backend endpoint regression (POST /api/om/pdfs/auto)
# ============================================================================
print_test("5. Backend endpoint regression (POST /api/om/pdfs/auto)")

# Get tokens
try:
    owner_token = get_auth_token("owner", "owner123")
    print(f"✓ Owner token obtained")
except Exception as e:
    print(f"❌ Failed to get owner token: {e}")
    owner_token = None

try:
    cindy_token = get_auth_token("cindy", "cindy123")
    print(f"✓ Cindy (staff) token obtained")
except Exception as e:
    print(f"❌ Failed to get cindy token: {e}")
    cindy_token = None

# Test 5a: Owner can upload
print("\n5a. Owner can upload PDF:")
if owner_token:
    try:
        pdf_bytes = create_minimal_pdf()
        files = {"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
        headers = {"Authorization": f"Bearer {owner_token}"}
        
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers, timeout=30)
        
        is_200 = resp.status_code == 200
        print_result(is_200, f"Status: {resp.status_code}")
        
        if is_200:
            data = resp.json()
            item = data.get("item", {})
            filename = item.get("filename", "")
            
            # Check filename pattern DDMMYY-N.pdf
            pattern_match = re.match(r'^\d{6}-\d+\.pdf$', filename)
            print_result(bool(pattern_match), f"Filename matches DDMMYY-N.pdf pattern: {filename}")
            
            # Store ID for cleanup
            uploaded_id = item.get("id")
            print(f"   📝 Uploaded PDF ID: {uploaded_id}")
        else:
            print(f"   Response: {resp.text[:500]}")
            
    except Exception as e:
        print_result(False, f"Upload failed: {e}")
else:
    print_result(False, "Skipped - no owner token")

# Test 5b: Staff without OM module → 403
print("\n5b. Staff without OM module → 403:")
if cindy_token:
    try:
        pdf_bytes = create_minimal_pdf()
        files = {"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
        headers = {"Authorization": f"Bearer {cindy_token}"}
        
        resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers, timeout=30)
        
        is_403 = resp.status_code == 403
        print_result(is_403, f"Status: {resp.status_code} (expected 403)")
        
        if not is_403:
            print(f"   ⚠️  Expected 403, got {resp.status_code}: {resp.text[:500]}")
            
    except Exception as e:
        print_result(False, f"Request failed: {e}")
else:
    print_result(False, "Skipped - no cindy token")

# Test 5c: Check if cindy has OM module, if yes test owner-only enforcement
print("\n5c. Verify owner-only enforcement (if staff has OM module):")
if cindy_token:
    try:
        # Check cindy's modules
        headers = {"Authorization": f"Bearer {cindy_token}"}
        resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
        
        if resp.status_code == 200:
            user = resp.json().get("user", {})
            modules = user.get("modules", [])
            has_om = "order_management" in modules
            
            print(f"   📋 Cindy's modules: {modules}")
            
            if has_om:
                # Try upload - should still be 403 (owner-only)
                pdf_bytes = create_minimal_pdf()
                files = {"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
                
                resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers, timeout=30)
                is_403 = resp.status_code == 403
                print_result(is_403, f"Staff WITH OM module correctly denied: {resp.status_code} (expected 403)")
            else:
                print_result(True, "Staff does not have OM module (test 5b already verified 403)")
                
    except Exception as e:
        print_result(False, f"Failed: {e}")
else:
    print_result(False, "Skipped - no cindy token")

# Test 5d: Cleanup - delete uploaded PDF
print("\n5d. Cleanup uploaded test PDF:")
if owner_token and 'uploaded_id' in locals():
    try:
        headers = {"Authorization": f"Bearer {owner_token}"}
        resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{uploaded_id}", headers=headers, timeout=10)
        
        is_200 = resp.status_code == 200
        print_result(is_200, f"Deleted test PDF: {resp.status_code}")
        
    except Exception as e:
        print_result(False, f"Cleanup failed: {e}")
else:
    print("   ⚠️  Skipped - no uploaded PDF to clean up")

# ============================================================================
# TEST 6: /share page loads
# ============================================================================
print_test("6. /share page loads")

try:
    resp = requests.get(f"{BASE_URL}/share", timeout=30)
    is_200 = resp.status_code == 200
    
    print_result(is_200, f"Status: {resp.status_code}")
    
    if is_200:
        html = resp.text
        # Check for some expected content
        has_content = len(html) > 100
        print_result(has_content, f"HTML content length: {len(html)} bytes")
    else:
        print(f"   Response: {resp.text[:500]}")
        
except Exception as e:
    print_result(False, f"Failed: {e}")

# ============================================================================
# SUMMARY
# ============================================================================
print("\n" + "="*80)
print("TEST SUMMARY")
print("="*80)
print("""
✅ = Test passed
❌ = Test failed
⚠️  = Warning or additional info

Review the results above to verify:
1. Manifest link SSR override working (root → manifest.json, /share → share-manifest.webmanifest)
2. Both manifests have correct share_target configuration
3. Content-Type headers are correct
4. Service worker exists and has share target handling code
5. Backend endpoint /api/om/pdfs/auto is owner-only
6. /share page loads successfully

NOTE: This test suite covers BACKEND/HTTP level only.
Real Android share sheet visibility requires testing on actual device.
""")
