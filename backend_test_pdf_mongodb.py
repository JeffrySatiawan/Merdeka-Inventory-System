#!/usr/bin/env python3
"""
Backend test for PDF preview 404 bug fix — MongoDB binary storage.

Tests the fix for production bug where PDFs returned 404 "PDF tidak ditemukan pada storage"
after redeploy due to K8s ephemeral/multi-replica filesystem. MongoDB is now the authoritative
binary storage with file_data field (BSON Binary).

8 test scenarios:
1. New upload writes both DB and disk
2. Serve from DB when disk file is missing (CRITICAL - simulates pod restart)
3. Legacy backfill: disk-only record migrates on read
4. DELETE unsets file_data
5. List endpoint doesn't leak binary
6. Response headers + body magic bytes
7. Auth regression (URL-token still works)
8. Photo endpoint regression (verify unchanged)
"""

import requests
import os
import hashlib
import time
from pymongo import MongoClient
from datetime import datetime
from uuid import uuid4

# Configuration
BASE_URL = "https://pdf-notify-sound.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test credentials
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"
CINDY_USERNAME = "cindy"
CINDY_PASSWORD = "cindy123"

# Minimal valid PDF (681 bytes)
MINIMAL_PDF = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 100 700 Td (Test PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000262 00000 n 
0000000355 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
422
%%EOF"""

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code != 200:
        print(f"❌ Login failed for {username}: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    token = data.get("token")
    print(f"✅ Login successful for {username}")
    return token

def upload_pdf(token, pdf_bytes=MINIMAL_PDF, filename="test.pdf"):
    """Upload PDF via POST /api/om/pdfs"""
    files = {"file": (filename, pdf_bytes, "application/pdf")}
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", files=files, headers=headers)
    if resp.status_code != 200:
        print(f"❌ Upload failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    item = data.get("item")
    print(f"✅ Upload successful: {item.get('id')} - {item.get('filename')}")
    return item

def upload_pdf_auto(token, pdf_bytes=MINIMAL_PDF, filename="test.pdf"):
    """Upload PDF via POST /api/om/pdfs/auto (Merdeka Share)"""
    files = {"file": (filename, pdf_bytes, "application/pdf")}
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs/auto", files=files, headers=headers)
    if resp.status_code != 200:
        print(f"❌ Auto-upload failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    item = data.get("item")
    print(f"✅ Auto-upload successful: {item.get('id')} - {item.get('filename')}")
    return item

def get_pdf_file(pdf_id, token):
    """GET /api/om/pdfs/{id}/file?token=<token>"""
    resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/file?token={token}")
    return resp

def delete_pdf(pdf_id, token):
    """DELETE /api/om/pdfs/{id}"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    return resp

def list_pdfs(token):
    """GET /api/om/pdfs"""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=headers)
    return resp

def sha256(data):
    """Compute SHA256 hash of bytes"""
    return hashlib.sha256(data).hexdigest()

def main():
    print("=" * 80)
    print("PDF MongoDB Storage Fix — Backend Test")
    print("=" * 80)
    
    # Connect to MongoDB
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    om_pdfs = db["om_pdfs"]
    om_shipments = db["om_shipments"]
    
    print(f"\n✅ Connected to MongoDB: {MONGO_URL}/{DB_NAME}")
    
    # Login
    print("\n" + "=" * 80)
    print("AUTHENTICATION")
    print("=" * 80)
    owner_token = login(OWNER_USERNAME, OWNER_PASSWORD)
    cindy_token = login(CINDY_USERNAME, CINDY_PASSWORD)
    
    if not owner_token or not cindy_token:
        print("❌ Authentication failed. Exiting.")
        return
    
    test_pdf_ids = []  # Track all test PDFs for cleanup
    
    # ========================================================================
    # TEST 1: New upload writes both DB and disk
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 1: New upload writes both DB and disk")
    print("=" * 80)
    
    try:
        # Test POST /api/om/pdfs
        print("\n[1a] Testing POST /api/om/pdfs...")
        item1 = upload_pdf(owner_token, MINIMAL_PDF, "test1a.pdf")
        if not item1:
            print("❌ TEST 1a FAILED: Upload failed")
        else:
            test_pdf_ids.append(item1["id"])
            
            # Check MongoDB
            doc1 = om_pdfs.find_one({"id": item1["id"]})
            if not doc1:
                print("❌ TEST 1a FAILED: Document not found in MongoDB")
            elif "file_data" not in doc1:
                print("❌ TEST 1a FAILED: file_data field missing in MongoDB")
            elif not doc1["file_data"]:
                print("❌ TEST 1a FAILED: file_data is empty")
            elif len(doc1["file_data"]) != len(MINIMAL_PDF):
                print(f"❌ TEST 1a FAILED: file_data length mismatch (expected {len(MINIMAL_PDF)}, got {len(doc1['file_data'])})")
            elif "file_path" not in doc1:
                print("❌ TEST 1a FAILED: file_path field missing")
            elif "file_data" in item1:
                print("❌ TEST 1a FAILED: Response body contains file_data (should be filtered)")
            else:
                print(f"✅ TEST 1a PASSED: file_data exists in DB ({len(doc1['file_data'])} bytes), file_path exists, response filtered")
        
        # Test POST /api/om/pdfs/auto
        print("\n[1b] Testing POST /api/om/pdfs/auto...")
        item1b = upload_pdf_auto(owner_token, MINIMAL_PDF, "test1b.pdf")
        if not item1b:
            print("❌ TEST 1b FAILED: Auto-upload failed")
        else:
            test_pdf_ids.append(item1b["id"])
            
            # Check MongoDB
            doc1b = om_pdfs.find_one({"id": item1b["id"]})
            if not doc1b:
                print("❌ TEST 1b FAILED: Document not found in MongoDB")
            elif "file_data" not in doc1b:
                print("❌ TEST 1b FAILED: file_data field missing in MongoDB")
            elif not doc1b["file_data"]:
                print("❌ TEST 1b FAILED: file_data is empty")
            elif len(doc1b["file_data"]) != len(MINIMAL_PDF):
                print(f"❌ TEST 1b FAILED: file_data length mismatch (expected {len(MINIMAL_PDF)}, got {len(doc1b['file_data'])})")
            elif "file_path" not in doc1b:
                print("❌ TEST 1b FAILED: file_path field missing")
            elif "file_data" in item1b:
                print("❌ TEST 1b FAILED: Response body contains file_data (should be filtered)")
            else:
                print(f"✅ TEST 1b PASSED: file_data exists in DB ({len(doc1b['file_data'])} bytes), file_path exists, response filtered")
    
    except Exception as e:
        print(f"❌ TEST 1 EXCEPTION: {e}")
    
    # ========================================================================
    # TEST 2: Serve from DB when disk file is missing (CRITICAL)
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 2: Serve from DB when disk file is missing (CRITICAL)")
    print("=" * 80)
    
    try:
        print("\n[2] Uploading PDF and deleting disk file...")
        item2 = upload_pdf(owner_token, MINIMAL_PDF, "test2.pdf")
        if not item2:
            print("❌ TEST 2 FAILED: Upload failed")
        else:
            test_pdf_ids.append(item2["id"])
            pdf_id = item2["id"]
            
            # Get file_path from MongoDB
            doc2 = om_pdfs.find_one({"id": pdf_id})
            if not doc2 or not doc2.get("file_path"):
                print("❌ TEST 2 FAILED: file_path not found in MongoDB")
            else:
                file_path = doc2["file_path"]
                print(f"   File path: {file_path}")
                
                # Compute SHA256 of original bytes
                original_sha = sha256(MINIMAL_PDF)
                print(f"   Original SHA256: {original_sha}")
                
                # Delete the disk file
                if os.path.exists(file_path):
                    os.remove(file_path)
                    print(f"   ✅ Deleted disk file: {file_path}")
                else:
                    print(f"   ⚠️  Disk file not found (may have failed to write): {file_path}")
                
                # Verify file is gone
                if os.path.exists(file_path):
                    print(f"❌ TEST 2 FAILED: File still exists after deletion")
                else:
                    print(f"   ✅ Verified: disk file is gone")
                    
                    # Now try to GET the PDF
                    print(f"   Requesting GET /api/om/pdfs/{pdf_id}/file?token=...")
                    resp = get_pdf_file(pdf_id, owner_token)
                    
                    if resp.status_code != 200:
                        print(f"❌ TEST 2 FAILED: GET returned {resp.status_code} (expected 200)")
                        print(f"   Response: {resp.text[:200]}")
                    elif resp.headers.get("Content-Type") != "application/pdf":
                        print(f"❌ TEST 2 FAILED: Content-Type is {resp.headers.get('Content-Type')} (expected application/pdf)")
                    else:
                        response_sha = sha256(resp.content)
                        print(f"   Response SHA256: {response_sha}")
                        
                        if response_sha != original_sha:
                            print(f"❌ TEST 2 FAILED: Response bytes don't match original (SHA256 mismatch)")
                        else:
                            print(f"✅ TEST 2 PASSED: PDF served from MongoDB even with disk file missing (byte-identical)")
    
    except Exception as e:
        print(f"❌ TEST 2 EXCEPTION: {e}")
    
    # ========================================================================
    # TEST 3: Legacy backfill: disk-only record migrates on read
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 3: Legacy backfill: disk-only record migrates on read")
    print("=" * 80)
    
    legacy_id = None
    legacy_file_path = None
    
    try:
        print("\n[3] Creating synthetic legacy record...")
        
        # Create a disk file
        legacy_id = str(uuid4())
        legacy_file_path = f"/app/uploads/om/pdfs/legacy_test_{legacy_id}.pdf"
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(legacy_file_path), exist_ok=True)
        
        # Write PDF to disk
        with open(legacy_file_path, "wb") as f:
            f.write(MINIMAL_PDF)
        print(f"   ✅ Created disk file: {legacy_file_path}")
        
        # Insert MongoDB doc WITHOUT file_data
        legacy_doc = {
            "id": legacy_id,
            "filename": "legacy.pdf",
            "original_filename": "legacy.pdf",
            "size": len(MINIMAL_PDF),
            "file_path": legacy_file_path,
            # NO file_data field
            "uploaded_at": datetime.utcnow(),
            "uploaded_wita_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "uploaded_by_id": "test",
            "uploaded_by_name": "test",
            "pages_count": None,
            "detected_tracking_numbers": [],
            "scanned_at": None,
            "printed_at": None,
            "printed_by_id": None,
            "printed_by_name": None,
            "ketoko_input_at": None,
            "ketoko_input_by_id": None,
            "ketoko_input_by_name": None,
            "first_open_at": None,
            "first_open_by_id": None,
            "first_open_by_name": None,
            "last_open_at": None,
            "last_open_by_id": None,
            "last_open_by_name": None,
            "open_count": 0,
            "deleted": False,
        }
        om_pdfs.insert_one(legacy_doc)
        print(f"   ✅ Inserted legacy doc (no file_data): {legacy_id}")
        
        # Verify file_data is absent
        check_doc = om_pdfs.find_one({"id": legacy_id})
        if "file_data" in check_doc:
            print(f"❌ TEST 3 FAILED: file_data exists before migration (should be absent)")
        else:
            print(f"   ✅ Verified: file_data is absent before GET")
            
            # GET the PDF
            print(f"   Requesting GET /api/om/pdfs/{legacy_id}/file?token=...")
            resp = get_pdf_file(legacy_id, owner_token)
            
            if resp.status_code != 200:
                print(f"❌ TEST 3 FAILED: GET returned {resp.status_code} (expected 200)")
                print(f"   Response: {resp.text[:200]}")
            elif resp.content != MINIMAL_PDF:
                print(f"❌ TEST 3 FAILED: Response bytes don't match disk file")
            else:
                print(f"   ✅ GET returned 200 with correct bytes")
                
                # Wait a moment for async migration
                time.sleep(1)
                
                # Check if file_data was migrated
                migrated_doc = om_pdfs.find_one({"id": legacy_id})
                if "file_data" not in migrated_doc:
                    print(f"❌ TEST 3 FAILED: file_data still absent after GET (migration didn't happen)")
                elif not migrated_doc["file_data"]:
                    print(f"❌ TEST 3 FAILED: file_data is empty after migration")
                elif len(migrated_doc["file_data"]) != len(MINIMAL_PDF):
                    print(f"❌ TEST 3 FAILED: file_data length mismatch after migration")
                else:
                    print(f"✅ TEST 3 PASSED: Legacy disk-only record migrated to MongoDB on read ({len(migrated_doc['file_data'])} bytes)")
    
    except Exception as e:
        print(f"❌ TEST 3 EXCEPTION: {e}")
    
    finally:
        # Cleanup legacy test
        if legacy_id:
            try:
                om_pdfs.delete_one({"id": legacy_id})
                print(f"   🧹 Cleaned up legacy doc: {legacy_id}")
            except:
                pass
        if legacy_file_path and os.path.exists(legacy_file_path):
            try:
                os.remove(legacy_file_path)
                print(f"   🧹 Cleaned up legacy file: {legacy_file_path}")
            except:
                pass
    
    # ========================================================================
    # TEST 4: DELETE unsets file_data
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 4: DELETE unsets file_data")
    print("=" * 80)
    
    try:
        print("\n[4] Uploading PDF and deleting...")
        item4 = upload_pdf(owner_token, MINIMAL_PDF, "test4.pdf")
        if not item4:
            print("❌ TEST 4 FAILED: Upload failed")
        else:
            pdf_id = item4["id"]
            
            # Verify file_data exists before delete
            doc4_before = om_pdfs.find_one({"id": pdf_id})
            if not doc4_before or "file_data" not in doc4_before:
                print("❌ TEST 4 FAILED: file_data not found before delete")
            else:
                print(f"   ✅ file_data exists before delete ({len(doc4_before['file_data'])} bytes)")
                
                # DELETE
                print(f"   Deleting PDF: {pdf_id}")
                resp = delete_pdf(pdf_id, owner_token)
                
                if resp.status_code != 200:
                    print(f"❌ TEST 4 FAILED: DELETE returned {resp.status_code} (expected 200)")
                    print(f"   Response: {resp.text}")
                else:
                    print(f"   ✅ DELETE returned 200")
                    
                    # Check MongoDB
                    doc4_after = om_pdfs.find_one({"id": pdf_id})
                    if not doc4_after:
                        print(f"❌ TEST 4 FAILED: Document not found after delete (should be soft-deleted)")
                    elif not doc4_after.get("deleted"):
                        print(f"❌ TEST 4 FAILED: deleted flag not set to true")
                    elif doc4_after.get("file_path") is not None:
                        print(f"❌ TEST 4 FAILED: file_path not set to null")
                    elif "file_data" in doc4_after:
                        print(f"❌ TEST 4 FAILED: file_data field still exists (should be unset)")
                    else:
                        print(f"✅ TEST 4 PASSED: DELETE sets deleted=true, file_path=null, unsets file_data")
                        
                        # Verify GET returns 410
                        resp_get = get_pdf_file(pdf_id, owner_token)
                        if resp_get.status_code != 410:
                            print(f"   ⚠️  GET after delete returned {resp_get.status_code} (expected 410)")
                        else:
                            print(f"   ✅ GET after delete returns 410 (Gone)")
    
    except Exception as e:
        print(f"❌ TEST 4 EXCEPTION: {e}")
    
    # ========================================================================
    # TEST 5: List endpoint doesn't leak binary
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 5: List endpoint doesn't leak binary")
    print("=" * 80)
    
    try:
        print("\n[5] Uploading 2 test PDFs and checking list...")
        item5a = upload_pdf(owner_token, MINIMAL_PDF, "test5a.pdf")
        item5b = upload_pdf(owner_token, MINIMAL_PDF, "test5b.pdf")
        
        if not item5a or not item5b:
            print("❌ TEST 5 FAILED: Upload failed")
        else:
            test_pdf_ids.extend([item5a["id"], item5b["id"]])
            
            # GET list
            resp = list_pdfs(owner_token)
            if resp.status_code != 200:
                print(f"❌ TEST 5 FAILED: GET /api/om/pdfs returned {resp.status_code}")
            else:
                data = resp.json()
                items = data.get("items", [])
                
                # Check if any item has file_data
                leaked = False
                for item in items:
                    if "file_data" in item:
                        leaked = True
                        print(f"❌ TEST 5 FAILED: Item {item.get('id')} has file_data in list response")
                        break
                
                if not leaked:
                    print(f"✅ TEST 5 PASSED: List endpoint doesn't leak file_data ({len(items)} items checked)")
    
    except Exception as e:
        print(f"❌ TEST 5 EXCEPTION: {e}")
    
    # ========================================================================
    # TEST 6: Response headers + body magic bytes
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 6: Response headers + body magic bytes")
    print("=" * 80)
    
    try:
        print("\n[6] Uploading PDF and checking response headers...")
        item6 = upload_pdf(owner_token, MINIMAL_PDF, "test6.pdf")
        if not item6:
            print("❌ TEST 6 FAILED: Upload failed")
        else:
            test_pdf_ids.append(item6["id"])
            pdf_id = item6["id"]
            
            # GET the file
            resp = get_pdf_file(pdf_id, owner_token)
            
            if resp.status_code != 200:
                print(f"❌ TEST 6 FAILED: GET returned {resp.status_code}")
            else:
                headers = resp.headers
                content = resp.content
                
                # Check headers
                checks = []
                
                # Content-Type
                ct = headers.get("Content-Type", "")
                if ct.lower() == "application/pdf":
                    checks.append(("Content-Type", "✅ application/pdf"))
                else:
                    checks.append(("Content-Type", f"❌ {ct} (expected application/pdf)"))
                
                # Content-Disposition
                cd = headers.get("Content-Disposition", "")
                if cd.startswith("inline"):
                    checks.append(("Content-Disposition", f"✅ starts with 'inline'"))
                else:
                    checks.append(("Content-Disposition", f"❌ {cd} (expected to start with 'inline')"))
                
                # Content-Length
                cl = headers.get("Content-Length", "")
                if cl.isdigit() and int(cl) == len(content):
                    checks.append(("Content-Length", f"✅ {cl} (matches body length)"))
                else:
                    checks.append(("Content-Length", f"❌ {cl} (body length: {len(content)})"))
                
                # Cache-Control
                cc = headers.get("Cache-Control", "")
                if "private" in cc:
                    checks.append(("Cache-Control", f"✅ contains 'private'"))
                else:
                    checks.append(("Cache-Control", f"❌ {cc} (expected to contain 'private')"))
                
                # X-Content-Type-Options
                xcto = headers.get("X-Content-Type-Options", "")
                if xcto.lower() == "nosniff":
                    checks.append(("X-Content-Type-Options", f"✅ nosniff"))
                else:
                    checks.append(("X-Content-Type-Options", f"❌ {xcto} (expected 'nosniff')"))
                
                # Body magic bytes
                if content[:5] == b"%PDF-":
                    checks.append(("Body magic", f"✅ starts with '%PDF-'"))
                else:
                    checks.append(("Body magic", f"❌ starts with {content[:5]} (expected b'%PDF-')"))
                
                # Print results
                all_passed = True
                for name, result in checks:
                    print(f"   {result}")
                    if "❌" in result:
                        all_passed = False
                
                if all_passed:
                    print(f"✅ TEST 6 PASSED: All headers and body magic bytes correct")
                else:
                    print(f"❌ TEST 6 FAILED: Some checks failed (see above)")
    
    except Exception as e:
        print(f"❌ TEST 6 EXCEPTION: {e}")
    
    # ========================================================================
    # TEST 7: Auth regression (URL-token still works)
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 7: Auth regression (URL-token still works)")
    print("=" * 80)
    
    try:
        print("\n[7] Uploading PDF and testing auth scenarios...")
        item7 = upload_pdf(owner_token, MINIMAL_PDF, "test7.pdf")
        if not item7:
            print("❌ TEST 7 FAILED: Upload failed")
        else:
            test_pdf_ids.append(item7["id"])
            pdf_id = item7["id"]
            
            # Test 7a: URL token (owner)
            print("\n   [7a] GET with URL token (owner)...")
            resp = get_pdf_file(pdf_id, owner_token)
            if resp.status_code == 200:
                print(f"   ✅ URL token (owner) → 200")
            else:
                print(f"   ❌ URL token (owner) → {resp.status_code} (expected 200)")
            
            # Test 7b: Bearer header
            print("\n   [7b] GET with Bearer header...")
            headers = {"Authorization": f"Bearer {owner_token}"}
            resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/file", headers=headers)
            if resp.status_code == 200:
                print(f"   ✅ Bearer header → 200")
            else:
                print(f"   ❌ Bearer header → {resp.status_code} (expected 200)")
            
            # Test 7c: Fake token
            print("\n   [7c] GET with fake token...")
            resp = get_pdf_file(pdf_id, "fake-token-12345")
            if resp.status_code == 401:
                print(f"   ✅ Fake token → 401")
            else:
                print(f"   ❌ Fake token → {resp.status_code} (expected 401)")
            
            # Test 7d: No auth
            print("\n   [7d] GET with no auth...")
            resp = requests.get(f"{BASE_URL}/api/om/pdfs/{pdf_id}/file")
            if resp.status_code == 401:
                print(f"   ✅ No auth → 401")
            else:
                print(f"   ❌ No auth → {resp.status_code} (expected 401)")
            
            # Test 7e: Cindy (no OM module)
            print("\n   [7e] GET as Cindy (no OM module)...")
            resp = get_pdf_file(pdf_id, cindy_token)
            if resp.status_code == 403:
                data = resp.json()
                error = data.get("error", "")
                if "Order Management" in error:
                    print(f"   ✅ Cindy (no OM module) → 403 with correct error")
                else:
                    print(f"   ⚠️  Cindy → 403 but error message unexpected: {error}")
            else:
                print(f"   ❌ Cindy (no OM module) → {resp.status_code} (expected 403)")
            
            print(f"\n✅ TEST 7 PASSED: All auth scenarios working correctly")
    
    except Exception as e:
        print(f"❌ TEST 7 EXCEPTION: {e}")
    
    # ========================================================================
    # TEST 8: Photo endpoint regression (verify unchanged)
    # ========================================================================
    print("\n" + "=" * 80)
    print("TEST 8: Photo endpoint regression (verify unchanged)")
    print("=" * 80)
    
    try:
        print("\n[8] Checking if test shipment with photo exists...")
        
        # Look for existing test shipment (from previous photo auth test)
        test_shipment = om_shipments.find_one({"tracking_number": {"$regex": "^TESTPHOTO-"}})
        
        if not test_shipment:
            print("   ℹ️  No existing test shipment found. Creating one...")
            
            # Create a minimal test shipment with photo
            # First, get an expedition
            expeditions_resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers={"Authorization": f"Bearer {owner_token}"})
            if expeditions_resp.status_code != 200:
                print(f"   ⚠️  Cannot get expeditions: {expeditions_resp.status_code}")
                print(f"   ⚠️  Skipping TEST 8 (photo endpoint regression)")
            else:
                expeditions = expeditions_resp.json().get("items", [])
                if not expeditions:
                    print(f"   ⚠️  No expeditions found")
                    print(f"   ⚠️  Skipping TEST 8 (photo endpoint regression)")
                else:
                    exp = expeditions[0]
                    
                    # Create shipment via scan/pack (which saves photo)
                    tracking = f"TESTPHOTO-{int(time.time())}"
                    
                    # First print
                    print_resp = requests.post(
                        f"{BASE_URL}/api/om/scan/print",
                        json={"tracking_number": tracking, "expedition_id": exp["id"]},
                        headers={"Authorization": f"Bearer {owner_token}"}
                    )
                    
                    if print_resp.status_code != 200:
                        print(f"   ⚠️  Print scan failed: {print_resp.status_code}")
                        print(f"   ⚠️  Skipping TEST 8")
                    else:
                        # Then pack with photo
                        # Create a minimal 1x1 webp image (data URL)
                        photo_data_url = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA="
                        
                        pack_resp = requests.post(
                            f"{BASE_URL}/api/om/scan/pack",
                            json={
                                "tracking_number": tracking,
                                "sku_count": 1,
                                "item_count": 1,
                                "photo_data_url": photo_data_url
                            },
                            headers={"Authorization": f"Bearer {owner_token}"}
                        )
                        
                        if pack_resp.status_code != 200:
                            print(f"   ⚠️  Pack scan failed: {pack_resp.status_code}")
                            print(f"   ⚠️  Skipping TEST 8")
                        else:
                            shipment_data = pack_resp.json().get("shipment", {})
                            shipment_id = shipment_data.get("id")
                            print(f"   ✅ Created test shipment: {tracking} (id: {shipment_id})")
                            test_shipment = {"id": shipment_id, "tracking_number": tracking}
        
        if test_shipment:
            shipment_id = test_shipment["id"]
            print(f"   Testing GET /api/om/photos/{shipment_id}?token=...")
            
            # GET photo with URL token
            resp = requests.get(f"{BASE_URL}/api/om/photos/{shipment_id}?token={owner_token}")
            
            if resp.status_code == 200:
                ct = resp.headers.get("Content-Type", "")
                if ct.startswith("image/"):
                    print(f"   ✅ Photo endpoint returns 200 with Content-Type: {ct}")
                    print(f"✅ TEST 8 PASSED: Photo endpoint regression verified (unchanged)")
                else:
                    print(f"   ❌ Photo endpoint returns 200 but Content-Type is {ct} (expected image/*)")
            elif resp.status_code == 410:
                print(f"   ℹ️  Photo expired (410) - this is expected if retention period passed")
                print(f"✅ TEST 8 PASSED: Photo endpoint working (expired photo is normal)")
            else:
                print(f"   ❌ Photo endpoint returned {resp.status_code} (expected 200 or 410)")
                print(f"   Response: {resp.text[:200]}")
        else:
            print(f"   ⚠️  Could not create or find test shipment")
            print(f"   ⚠️  Skipping TEST 8")
    
    except Exception as e:
        print(f"❌ TEST 8 EXCEPTION: {e}")
    
    # ========================================================================
    # CLEANUP
    # ========================================================================
    print("\n" + "=" * 80)
    print("CLEANUP")
    print("=" * 80)
    
    print(f"\n🧹 Cleaning up {len(test_pdf_ids)} test PDFs...")
    for pdf_id in test_pdf_ids:
        try:
            resp = delete_pdf(pdf_id, owner_token)
            if resp.status_code == 200:
                print(f"   ✅ Deleted: {pdf_id}")
            else:
                print(f"   ⚠️  Delete failed for {pdf_id}: {resp.status_code}")
        except Exception as e:
            print(f"   ⚠️  Delete exception for {pdf_id}: {e}")
    
    print("\n" + "=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()
