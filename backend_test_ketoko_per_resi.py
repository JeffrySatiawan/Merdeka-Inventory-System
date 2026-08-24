#!/usr/bin/env python3
"""
Backend test for KETOKO per-resi feature (9 comprehensive tests)
Tests the new per-resi checkbox + optional note + Laporan integration
"""
import requests
import pymongo
import time
from datetime import datetime

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

# Test tracking numbers
TEST_TRACKING = ["SPX1", "JNT2", "JNE3"]

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code == 200:
        return resp.json().get("token")
    return None

def create_minimal_pdf():
    """Create minimal valid PDF (smallest possible)"""
    # PDF header + minimal structure
    pdf_content = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
    return pdf_content

def main():
    log("=" * 80)
    log("KETOKO PER-RESI FEATURE TEST — 9 COMPREHENSIVE TESTS")
    log("=" * 80)
    
    # Connect to MongoDB
    client = pymongo.MongoClient(MONGO_URL)
    db = client[DB_NAME]
    om_pdfs = db["om_pdfs"]
    om_shipments = db["om_shipments"]
    
    # Login
    log("\n[SETUP] Logging in as owner and cindy...")
    owner_token = login("owner", "owner123")
    cindy_token = login("cindy", "cindy123")
    
    if not owner_token:
        log("❌ FATAL: Owner login failed")
        return
    if not cindy_token:
        log("❌ FATAL: Cindy login failed")
        return
    
    log("✅ Owner login successful")
    log("✅ Cindy login successful")
    
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    cindy_headers = {"Authorization": f"Bearer {cindy_token}"}
    
    test_pdf_id = None
    test_shipment_id = None
    
    try:
        # ========================================
        # TEST 1 — Hydrate on GET /api/om/pdfs
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 1 — Hydrate on GET /api/om/pdfs")
        log("=" * 80)
        
        # Upload PDF
        log("Step 1.1: Upload PDF as owner...")
        pdf_bytes = create_minimal_pdf()
        files = {"file": ("test_ketoko.pdf", pdf_bytes, "application/pdf")}
        resp = requests.post(f"{BASE_URL}/api/om/pdfs", headers=owner_headers, files=files)
        
        if resp.status_code != 200:
            log(f"❌ TEST 1 FAILED: Upload failed with {resp.status_code}: {resp.text}")
            return
        
        test_pdf_id = resp.json()["item"]["id"]
        log(f"✅ PDF uploaded: {test_pdf_id}")
        
        # Inject detected_tracking_numbers via pymongo
        log("Step 1.2: Inject detected_tracking_numbers via pymongo...")
        result = om_pdfs.update_one(
            {"id": test_pdf_id},
            {"$set": {"detected_tracking_numbers": TEST_TRACKING}}
        )
        
        if result.modified_count != 1:
            log(f"❌ TEST 1 FAILED: MongoDB update failed")
            return
        
        log(f"✅ Injected tracking numbers: {TEST_TRACKING}")
        
        # GET /api/om/pdfs and verify hydration
        log("Step 1.3: GET /api/om/pdfs and verify hydration...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=owner_headers)
        
        if resp.status_code != 200:
            log(f"❌ TEST 1 FAILED: GET /api/om/pdfs failed with {resp.status_code}")
            return
        
        items = resp.json()["items"]
        pdf_item = next((x for x in items if x["id"] == test_pdf_id), None)
        
        if not pdf_item:
            log(f"❌ TEST 1 FAILED: PDF not found in list")
            return
        
        # Verify ketoko_resi array
        ketoko_resi = pdf_item.get("ketoko_resi", [])
        if len(ketoko_resi) != 3:
            log(f"❌ TEST 1 FAILED: ketoko_resi length is {len(ketoko_resi)}, expected 3")
            return
        
        log(f"✅ ketoko_resi array has 3 entries")
        
        # Verify each entry has correct structure
        for i, entry in enumerate(ketoko_resi):
            tn = entry.get("tracking_number")
            checked = entry.get("checked")
            note_type = entry.get("note_type")
            
            if tn not in TEST_TRACKING:
                log(f"❌ TEST 1 FAILED: Entry {i} has invalid tracking_number: {tn}")
                return
            
            if checked != False:
                log(f"❌ TEST 1 FAILED: Entry {i} checked={checked}, expected False")
                return
            
            if note_type is not None:
                log(f"❌ TEST 1 FAILED: Entry {i} note_type={note_type}, expected None")
                return
        
        log(f"✅ All entries have correct default state (checked=False, note_type=None)")
        
        # Verify rollup fields
        checked_count = pdf_item.get("ketoko_checked_count")
        total_count = pdf_item.get("ketoko_total_count")
        
        if checked_count != 0:
            log(f"❌ TEST 1 FAILED: ketoko_checked_count={checked_count}, expected 0")
            return
        
        if total_count != 3:
            log(f"❌ TEST 1 FAILED: ketoko_total_count={total_count}, expected 3")
            return
        
        log(f"✅ Rollup fields correct: ketoko_checked_count=0, ketoko_total_count=3")
        log("✅ TEST 1 PASSED")
        
        # ========================================
        # TEST 2 — Per-resi check
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 2 — Per-resi check")
        log("=" * 80)
        
        # Check SPX1
        log("Step 2.1: Check SPX1...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "checked": True}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 2 FAILED: Check SPX1 failed with {resp.status_code}: {resp.text}")
            return
        
        data = resp.json()
        resi = data.get("resi", {})
        item = data.get("item", {})
        
        if not resi.get("checked"):
            log(f"❌ TEST 2 FAILED: resi.checked is not True")
            return
        
        if not resi.get("checked_by_name"):
            log(f"❌ TEST 2 FAILED: checked_by_name is empty")
            return
        
        if not resi.get("checked_at"):
            log(f"❌ TEST 2 FAILED: checked_at is empty")
            return
        
        log(f"✅ SPX1 checked by {resi['checked_by_name']} at {resi['checked_at']}")
        
        # Verify counts
        if item.get("ketoko_checked_count") != 1:
            log(f"❌ TEST 2 FAILED: ketoko_checked_count={item.get('ketoko_checked_count')}, expected 1")
            return
        
        if item.get("ketoko_total_count") != 3:
            log(f"❌ TEST 2 FAILED: ketoko_total_count={item.get('ketoko_total_count')}, expected 3")
            return
        
        log(f"✅ Counts correct: 1/3 checked")
        
        # Verify overall flag is NULL (only 1/3 checked)
        if item.get("ketoko_input_at") is not None:
            log(f"❌ TEST 2 FAILED: ketoko_input_at should be NULL when only 1/3 checked, got {item.get('ketoko_input_at')}")
            return
        
        log(f"✅ Overall ketoko_input_at is NULL (only 1/3 checked)")
        
        # Check SPX1 again (idempotent)
        log("Step 2.2: Check SPX1 again (idempotent)...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "checked": True}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 2 FAILED: Idempotent check failed with {resp.status_code}")
            return
        
        data = resp.json()
        if data["item"]["ketoko_checked_count"] != 1:
            log(f"❌ TEST 2 FAILED: Count changed after idempotent check")
            return
        
        log(f"✅ Idempotent check works (count still 1)")
        
        # Check remaining 2 resi
        log("Step 2.3: Check JNT2 and JNE3...")
        for tn in ["JNT2", "JNE3"]:
            resp = requests.post(
                f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
                headers=owner_headers,
                json={"tracking_number": tn, "checked": True}
            )
            
            if resp.status_code != 200:
                log(f"❌ TEST 2 FAILED: Check {tn} failed with {resp.status_code}")
                return
            
            log(f"✅ {tn} checked")
        
        # Verify overall flag is NOW SET (all 3 checked)
        resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=owner_headers)
        items = resp.json()["items"]
        pdf_item = next((x for x in items if x["id"] == test_pdf_id), None)
        
        if pdf_item["ketoko_checked_count"] != 3:
            log(f"❌ TEST 2 FAILED: ketoko_checked_count={pdf_item['ketoko_checked_count']}, expected 3")
            return
        
        if pdf_item.get("ketoko_input_at") is None:
            log(f"❌ TEST 2 FAILED: ketoko_input_at should be SET when all 3 checked")
            return
        
        log(f"✅ All 3 resi checked, overall ketoko_input_at is SET: {pdf_item['ketoko_input_at']}")
        log("✅ TEST 2 PASSED")
        
        # ========================================
        # TEST 3 — Notes on unchecked resi
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 3 — Notes on unchecked resi")
        log("=" * 80)
        
        # Uncheck SPX1
        log("Step 3.1: Uncheck SPX1...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "checked": False}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: Uncheck SPX1 failed with {resp.status_code}")
            return
        
        resi = resp.json()["resi"]
        if resi.get("checked") != False:
            log(f"❌ TEST 3 FAILED: SPX1 still checked")
            return
        
        log(f"✅ SPX1 unchecked")
        
        # Add note_type='kosong'
        log("Step 3.2: Add note_type='kosong'...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "note_type": "kosong"}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: Add note_type='kosong' failed with {resp.status_code}")
            return
        
        resi = resp.json()["resi"]
        if resi.get("note_type") != "kosong":
            log(f"❌ TEST 3 FAILED: note_type={resi.get('note_type')}, expected 'kosong'")
            return
        
        if resi.get("note_text") is not None:
            log(f"❌ TEST 3 FAILED: note_text should be null for 'kosong', got {resi.get('note_text')}")
            return
        
        log(f"✅ note_type='kosong', note_text=null (forced)")
        
        # Add note_type='lainnya' with text
        log("Step 3.3: Add note_type='lainnya' with text...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "note_type": "lainnya", "note_text": "Menunggu supplier"}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: Add note_type='lainnya' failed with {resp.status_code}")
            return
        
        resi = resp.json()["resi"]
        if resi.get("note_type") != "lainnya":
            log(f"❌ TEST 3 FAILED: note_type={resi.get('note_type')}, expected 'lainnya'")
            return
        
        if resi.get("note_text") != "Menunggu supplier":
            log(f"❌ TEST 3 FAILED: note_text={resi.get('note_text')}, expected 'Menunggu supplier'")
            return
        
        log(f"✅ note_type='lainnya', note_text='Menunggu supplier'")
        
        # Test max length enforcement (500 chars)
        log("Step 3.4: Test max length enforcement (600 chars -> truncated to 500)...")
        long_text = "a" * 600
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "note_type": "lainnya", "note_text": long_text}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: Max length test failed with {resp.status_code}")
            return
        
        resi = resp.json()["resi"]
        if len(resi.get("note_text", "")) != 500:
            log(f"❌ TEST 3 FAILED: note_text length={len(resi.get('note_text', ''))}, expected 500")
            return
        
        log(f"✅ note_text truncated to 500 chars")
        log("✅ TEST 3 PASSED")
        
        # ========================================
        # TEST 4 — Note rejected on checked resi
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 4 — Note rejected on checked resi")
        log("=" * 80)
        
        # Check SPX1 (should clear note)
        log("Step 4.1: Check SPX1 (should clear note)...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "checked": True}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 4 FAILED: Check SPX1 failed with {resp.status_code}")
            return
        
        resi = resp.json()["resi"]
        if not resi.get("checked"):
            log(f"❌ TEST 4 FAILED: SPX1 not checked")
            return
        
        if resi.get("note_type") is not None:
            log(f"❌ TEST 4 FAILED: note_type should be None after check, got {resi.get('note_type')}")
            return
        
        if resi.get("note_text") is not None:
            log(f"❌ TEST 4 FAILED: note_text should be None after check, got {resi.get('note_text')}")
            return
        
        log(f"✅ SPX1 checked, note cleared (note_type=None, note_text=None)")
        
        # Try to add note while checked (should be silently rejected)
        log("Step 4.2: Try to add note while checked (should be silently rejected)...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "note_type": "kosong"}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 4 FAILED: Request failed with {resp.status_code} (should be 200 with silent rejection)")
            return
        
        resi = resp.json()["resi"]
        if resi.get("note_type") is not None:
            log(f"❌ TEST 4 FAILED: note_type should still be None (silently rejected), got {resi.get('note_type')}")
            return
        
        log(f"✅ Note silently rejected on checked resi (note_type still None)")
        log("✅ TEST 4 PASSED")
        
        # ========================================
        # TEST 5 — Invalid tracking number
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 5 — Invalid tracking number")
        log("=" * 80)
        
        # Try invalid tracking number
        log("Step 5.1: Try invalid tracking number...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "NOTINTHISPDF", "checked": True}
        )
        
        if resp.status_code != 400:
            log(f"❌ TEST 5 FAILED: Expected 400, got {resp.status_code}")
            return
        
        error = resp.json().get("error", "")
        if "tracking_number tidak terdeteksi" not in error:
            log(f"❌ TEST 5 FAILED: Error message doesn't contain 'tracking_number tidak terdeteksi', got: {error}")
            return
        
        log(f"✅ Invalid tracking number rejected with 400: {error}")
        
        # Try empty tracking number
        log("Step 5.2: Try empty tracking number...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={}
        )
        
        if resp.status_code != 400:
            log(f"❌ TEST 5 FAILED: Expected 400, got {resp.status_code}")
            return
        
        error = resp.json().get("error", "")
        if "tracking_number wajib diisi" not in error:
            log(f"❌ TEST 5 FAILED: Error message doesn't contain 'tracking_number wajib diisi', got: {error}")
            return
        
        log(f"✅ Empty tracking number rejected with 400: {error}")
        log("✅ TEST 5 PASSED")
        
        # ========================================
        # TEST 6 — Legacy /ketoko bulk endpoint
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 6 — Legacy /ketoko bulk endpoint")
        log("=" * 80)
        
        # Bulk check all
        log("Step 6.1: Bulk check all via POST /ketoko...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko",
            headers=owner_headers,
            json={"input": True}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 6 FAILED: Bulk check failed with {resp.status_code}")
            return
        
        item = resp.json()["item"]
        if item.get("ketoko_checked_count") != 3:
            log(f"❌ TEST 6 FAILED: ketoko_checked_count={item.get('ketoko_checked_count')}, expected 3")
            return
        
        if item.get("ketoko_input_at") is None:
            log(f"❌ TEST 6 FAILED: ketoko_input_at should be set after bulk check")
            return
        
        log(f"✅ All 3 resi checked via bulk endpoint, ketoko_input_at set")
        
        # Bulk uncheck all
        log("Step 6.2: Bulk uncheck all via POST /ketoko...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko",
            headers=owner_headers,
            json={"input": False}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 6 FAILED: Bulk uncheck failed with {resp.status_code}")
            return
        
        item = resp.json()["item"]
        if item.get("ketoko_checked_count") != 0:
            log(f"❌ TEST 6 FAILED: ketoko_checked_count={item.get('ketoko_checked_count')}, expected 0")
            return
        
        if item.get("ketoko_input_at") is not None:
            log(f"❌ TEST 6 FAILED: ketoko_input_at should be null after bulk uncheck")
            return
        
        log(f"✅ All 3 resi unchecked via bulk endpoint, ketoko_input_at null")
        log("✅ TEST 6 PASSED")
        
        # ========================================
        # TEST 7 — GET /api/om/shipments annotates per-shipment KETOKO status
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 7 — GET /api/om/shipments annotates per-shipment KETOKO status")
        log("=" * 80)
        
        # Create shipment for SPX1
        log("Step 7.1: Create shipment for SPX1 via scan/print...")
        
        # First, get an expedition
        resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers=owner_headers)
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: Get expeditions failed with {resp.status_code}")
            return
        
        expeditions = resp.json()["items"]
        if not expeditions:
            log(f"❌ TEST 7 FAILED: No expeditions found")
            return
        
        exp_id = expeditions[0]["id"]
        
        # Create shipment
        resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "expedition_id": exp_id}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: Create shipment failed with {resp.status_code}: {resp.text}")
            return
        
        test_shipment_id = resp.json()["shipment"]["id"]
        log(f"✅ Shipment created for SPX1: {test_shipment_id}")
        
        # Check SPX1 in PDF
        log("Step 7.2: Check SPX1 in PDF...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "checked": True}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: Check SPX1 failed with {resp.status_code}")
            return
        
        log(f"✅ SPX1 checked in PDF")
        
        # GET /api/om/shipments and verify KETOKO annotation
        log("Step 7.3: GET /api/om/shipments and verify KETOKO annotation...")
        resp = requests.get(f"{BASE_URL}/api/om/shipments", headers=owner_headers)
        
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: GET /api/om/shipments failed with {resp.status_code}")
            return
        
        data = resp.json()
        items = data["items"]
        summary = data.get("summary", {})
        
        shipment = next((x for x in items if x["tracking_number"] == "SPX1"), None)
        
        if not shipment:
            log(f"❌ TEST 7 FAILED: Shipment for SPX1 not found in list")
            return
        
        if not shipment.get("ketoko_checked"):
            log(f"❌ TEST 7 FAILED: ketoko_checked should be true")
            return
        
        if not shipment.get("ketoko_checked_by_name"):
            log(f"❌ TEST 7 FAILED: ketoko_checked_by_name is empty")
            return
        
        if shipment.get("ketoko_pdf_id") != test_pdf_id:
            log(f"❌ TEST 7 FAILED: ketoko_pdf_id={shipment.get('ketoko_pdf_id')}, expected {test_pdf_id}")
            return
        
        log(f"✅ Shipment SPX1 has ketoko_checked=true, checked_by={shipment['ketoko_checked_by_name']}, pdf_id={shipment['ketoko_pdf_id']}")
        
        # Uncheck SPX1 and add note
        log("Step 7.4: Uncheck SPX1 and add note...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "checked": False}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: Uncheck SPX1 failed")
            return
        
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=owner_headers,
            json={"tracking_number": "SPX1", "note_type": "lainnya", "note_text": "test"}
        )
        
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: Add note failed")
            return
        
        log(f"✅ SPX1 unchecked with note")
        
        # GET /api/om/shipments again
        log("Step 7.5: GET /api/om/shipments again and verify note...")
        resp = requests.get(f"{BASE_URL}/api/om/shipments", headers=owner_headers)
        
        if resp.status_code != 200:
            log(f"❌ TEST 7 FAILED: GET /api/om/shipments failed")
            return
        
        data = resp.json()
        items = data["items"]
        summary = data.get("summary", {})
        
        shipment = next((x for x in items if x["tracking_number"] == "SPX1"), None)
        
        if shipment.get("ketoko_checked") != False:
            log(f"❌ TEST 7 FAILED: ketoko_checked should be false")
            return
        
        if shipment.get("ketoko_note_type") != "lainnya":
            log(f"❌ TEST 7 FAILED: ketoko_note_type={shipment.get('ketoko_note_type')}, expected 'lainnya'")
            return
        
        if shipment.get("ketoko_note_text") != "test":
            log(f"❌ TEST 7 FAILED: ketoko_note_text={shipment.get('ketoko_note_text')}, expected 'test'")
            return
        
        log(f"✅ Shipment SPX1 has ketoko_checked=false, note_type='lainnya', note_text='test'")
        
        # Verify summary fields
        if "ketoko_done" not in summary:
            log(f"❌ TEST 7 FAILED: summary.ketoko_done missing")
            return
        
        if "ketoko_total" not in summary:
            log(f"❌ TEST 7 FAILED: summary.ketoko_total missing")
            return
        
        if "ketoko_progress" not in summary:
            log(f"❌ TEST 7 FAILED: summary.ketoko_progress missing")
            return
        
        log(f"✅ Summary has ketoko_done={summary['ketoko_done']}, ketoko_total={summary['ketoko_total']}, ketoko_progress='{summary['ketoko_progress']}'")
        log("✅ TEST 7 PASSED")
        
        # ========================================
        # TEST 8 — Auth/module regression
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 8 — Auth/module regression")
        log("=" * 80)
        
        # Cindy (no OM module) should get 403
        log("Step 8.1: Cindy (no OM module) tries POST /ketoko-resi...")
        resp = requests.post(
            f"{BASE_URL}/api/om/pdfs/{test_pdf_id}/ketoko-resi",
            headers=cindy_headers,
            json={"tracking_number": "SPX1", "checked": True}
        )
        
        if resp.status_code != 403:
            log(f"❌ TEST 8 FAILED: Expected 403, got {resp.status_code}")
            return
        
        error = resp.json().get("error", "")
        if "Order Management" not in error:
            log(f"❌ TEST 8 FAILED: Error message doesn't mention Order Management, got: {error}")
            return
        
        log(f"✅ Cindy denied with 403: {error}")
        
        # Test Bearer auth still works
        log("Step 8.2: Test Bearer auth still works...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=owner_headers)
        
        if resp.status_code != 200:
            log(f"❌ TEST 8 FAILED: Bearer auth failed with {resp.status_code}")
            return
        
        log(f"✅ Bearer auth works")
        
        # Test URL token auth
        log("Step 8.3: Test URL token auth...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs?token={owner_token}")
        
        if resp.status_code != 200:
            log(f"❌ TEST 8 FAILED: URL token auth failed with {resp.status_code}")
            return
        
        log(f"✅ URL token auth works")
        log("✅ TEST 8 PASSED")
        
        # ========================================
        # TEST 9 — Hydration re-scan safety
        # ========================================
        log("\n" + "=" * 80)
        log("TEST 9 — Hydration re-scan safety")
        log("=" * 80)
        
        # Change detected_tracking_numbers via pymongo
        log("Step 9.1: Change detected_tracking_numbers to ['SPX1', 'NEWONE'] via pymongo...")
        result = om_pdfs.update_one(
            {"id": test_pdf_id},
            {"$set": {"detected_tracking_numbers": ["SPX1", "NEWONE"]}}
        )
        
        if result.modified_count != 1:
            log(f"❌ TEST 9 FAILED: MongoDB update failed")
            return
        
        log(f"✅ Updated detected_tracking_numbers to ['SPX1', 'NEWONE']")
        
        # GET /api/om/pdfs and verify hydration
        log("Step 9.2: GET /api/om/pdfs and verify hydration...")
        resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=owner_headers)
        
        if resp.status_code != 200:
            log(f"❌ TEST 9 FAILED: GET /api/om/pdfs failed")
            return
        
        items = resp.json()["items"]
        pdf_item = next((x for x in items if x["id"] == test_pdf_id), None)
        
        ketoko_resi = pdf_item.get("ketoko_resi", [])
        
        if len(ketoko_resi) != 2:
            log(f"❌ TEST 9 FAILED: ketoko_resi length={len(ketoko_resi)}, expected 2")
            return
        
        log(f"✅ ketoko_resi array has 2 entries (removed JNT2 and JNE3)")
        
        # Verify SPX1 entry preserved
        spx1_entry = next((x for x in ketoko_resi if x["tracking_number"] == "SPX1"), None)
        
        if not spx1_entry:
            log(f"❌ TEST 9 FAILED: SPX1 entry not found")
            return
        
        # SPX1 should still be unchecked with note from TEST 7
        if spx1_entry.get("checked") != False:
            log(f"❌ TEST 9 FAILED: SPX1 checked state not preserved")
            return
        
        if spx1_entry.get("note_type") != "lainnya":
            log(f"❌ TEST 9 FAILED: SPX1 note_type not preserved")
            return
        
        log(f"✅ SPX1 entry preserved with existing state (checked=false, note_type='lainnya')")
        
        # Verify NEWONE entry added with default state
        newone_entry = next((x for x in ketoko_resi if x["tracking_number"] == "NEWONE"), None)
        
        if not newone_entry:
            log(f"❌ TEST 9 FAILED: NEWONE entry not found")
            return
        
        if newone_entry.get("checked") != False:
            log(f"❌ TEST 9 FAILED: NEWONE should be unchecked by default")
            return
        
        if newone_entry.get("note_type") is not None:
            log(f"❌ TEST 9 FAILED: NEWONE should have no note by default")
            return
        
        log(f"✅ NEWONE entry added with default state (checked=false, note_type=None)")
        
        # Verify removed entries (JNT2, JNE3) are gone
        jnt2_entry = next((x for x in ketoko_resi if x["tracking_number"] == "JNT2"), None)
        jne3_entry = next((x for x in ketoko_resi if x["tracking_number"] == "JNE3"), None)
        
        if jnt2_entry or jne3_entry:
            log(f"❌ TEST 9 FAILED: Removed entries (JNT2, JNE3) still present")
            return
        
        log(f"✅ Removed entries (JNT2, JNE3) are gone from ketoko_resi")
        log("✅ TEST 9 PASSED")
        
        # ========================================
        # SUMMARY
        # ========================================
        log("\n" + "=" * 80)
        log("ALL 9 TESTS PASSED ✅")
        log("=" * 80)
        log("TEST 1: Hydrate on GET /api/om/pdfs ✅")
        log("TEST 2: Per-resi check ✅")
        log("TEST 3: Notes on unchecked resi ✅")
        log("TEST 4: Note rejected on checked resi ✅")
        log("TEST 5: Invalid tracking number ✅")
        log("TEST 6: Legacy /ketoko bulk endpoint ✅")
        log("TEST 7: GET /api/om/shipments annotates per-shipment KETOKO status ✅")
        log("TEST 8: Auth/module regression ✅")
        log("TEST 9: Hydration re-scan safety ✅")
        
    except Exception as e:
        log(f"\n❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # ========================================
        # CLEANUP
        # ========================================
        log("\n" + "=" * 80)
        log("CLEANUP")
        log("=" * 80)
        
        # Delete test PDF
        if test_pdf_id:
            log(f"Deleting test PDF {test_pdf_id}...")
            resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{test_pdf_id}", headers=owner_headers)
            if resp.status_code == 200:
                log(f"✅ Test PDF deleted")
            else:
                log(f"⚠️ Failed to delete test PDF: {resp.status_code}")
        
        # Delete test shipment via MongoDB (no DELETE endpoint for shipments)
        if test_shipment_id:
            log(f"Deleting test shipment {test_shipment_id} via MongoDB...")
            result = om_shipments.delete_one({"id": test_shipment_id})
            if result.deleted_count == 1:
                log(f"✅ Test shipment deleted")
            else:
                log(f"⚠️ Failed to delete test shipment")
        
        log("=" * 80)
        log("CLEANUP COMPLETE")
        log("=" * 80)

if __name__ == "__main__":
    main()
