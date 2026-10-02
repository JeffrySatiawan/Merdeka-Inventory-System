#!/usr/bin/env python3
"""
Backend Test: OMS Laporan "Scan Cetak" Patch — Virtual Rows for Unscanned Tracking Numbers
Test endpoint: GET /api/om/shipments

WHAT CHANGED:
- Each shipment item now has:
  - scan_cetak_status: 'sudah' (if row exists in om_shipments) or 'belum' (virtual rows)
  - scan_cetak_at: ISO string or null
- Response includes VIRTUAL ROWS for tracking numbers detected in om_pdfs.detected_tracking_numbers
  within date_from/date_to (or last 60 days if no range) that have NO corresponding om_shipments record
- Virtual rows: _virtual: true, scan_cetak_status: 'belum', tracking_number, ketoko_pdf_id, ketoko_pdf_filename
  status: null, packed_at: null, etc.
- Virtual rows SUPPRESSED when any filter is set: operator_id, expedition_id, or status
- New query param scan_cetak=all|sudah|belum filters the final result in-memory
- summary gained: scan_cetak_done, scan_cetak_pending, scan_cetak_progress

TEST PLAN:
1. Setup: Create test PDF, inject detected_tracking_numbers=['TESTSC-A', 'TESTSC-B', 'TESTSC-C'],
   create ONE shipment for TESTSC-A only
2. Case A: Baseline with virtual rows (should include TESTSC-A as sudah, TESTSC-B/C as belum virtual)
3. Case B: Filter scan_cetak=belum (should contain TESTSC-B/C only)
4. Case C: Filter scan_cetak=sudah (should contain TESTSC-A only)
5. Case D: Operator filter suppresses virtual rows
6. Case E: Summary numbers verification
7. Cleanup: Delete test shipment and PDF
8. Sanity: Verify production data not disrupted
"""

import requests
import json
import io
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
OWNER_USERNAME = "owner"
OWNER_PASSWORD = "owner123"

# MongoDB connection
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

def get_today_wita():
    """Get today's date in YYYY-MM-DD format (WITA timezone, UTC+8)"""
    from datetime import timedelta
    now_utc = datetime.now(timezone.utc)
    now_wita = now_utc + timedelta(hours=8)
    return now_wita.strftime('%Y-%m-%d')

def login(username, password):
    """Login and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        return None
    data = resp.json()
    print(f"✅ Login successful: {username}")
    return data.get("token")

def create_test_pdf(token):
    """Create a test PDF via POST /api/om/pdfs"""
    # Create a minimal valid PDF (1 page, empty)
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
    
    files = {'file': ('test_scan_cetak.pdf', io.BytesIO(pdf_content), 'application/pdf')}
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.post(f"{BASE_URL}/api/om/pdfs", files=files, headers=headers)
    
    if resp.status_code != 200:
        print(f"❌ PDF upload failed: {resp.status_code} {resp.text}")
        return None
    
    data = resp.json()
    pdf_id = data.get('item', {}).get('id')
    print(f"✅ Test PDF created: {pdf_id}")
    return pdf_id

def inject_tracking_numbers_and_date(pdf_id):
    """Direct DB update: set detected_tracking_numbers and uploaded_wita_date"""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    today = get_today_wita()
    
    result = db.om_pdfs.update_one(
        {'id': pdf_id},
        {
            '$set': {
                'detected_tracking_numbers': ['TESTSC-A', 'TESTSC-B', 'TESTSC-C'],
                'uploaded_wita_date': today,
                'deleted': False
            }
        }
    )
    
    if result.modified_count == 1:
        print(f"✅ Injected detected_tracking_numbers=['TESTSC-A', 'TESTSC-B', 'TESTSC-C'] and uploaded_wita_date={today}")
    else:
        print(f"❌ Failed to inject tracking numbers")
    
    client.close()

def create_test_shipment(token, user_id, user_name):
    """Create ONE shipment in om_shipments for TESTSC-A"""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    today = get_today_wita()
    now = datetime.now(timezone.utc).isoformat()
    
    shipment = {
        'id': f'test-shipment-{datetime.now().timestamp()}',
        'tracking_number': 'TESTSC-A',
        'status': 'packed',
        'packed_at': now,
        'packed_wita_date': today,
        'packed_by_id': user_id,
        'packed_by_name': user_name,
        'printed_at': now,
        'printed_wita_date': today,
        'delivered_at': None,
        'expedition_id': 'test-exp',
        'expedition_name': 'TestExp',
        'sku_count': 1,
        'item_count': 1,
        'photo_deleted': True
    }
    
    db.om_shipments.insert_one(shipment)
    print(f"✅ Created test shipment for TESTSC-A: {shipment['id']}")
    client.close()
    return shipment['id']

def get_user_info(token):
    """Get current user info"""
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
    if resp.status_code != 200:
        print(f"❌ Failed to get user info: {resp.status_code}")
        return None, None
    data = resp.json()
    user = data.get('user', {})
    return user.get('id'), user.get('name')

def test_case_a_baseline(token, today):
    """Case A: Baseline with virtual rows"""
    print("\n=== TEST CASE A: Baseline with virtual rows ===")
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case A failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()
    items = data.get('items', [])
    summary = data.get('summary', {})
    
    # Find our test items
    testsc_a = next((x for x in items if x.get('tracking_number') == 'TESTSC-A'), None)
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    print(f"  Total items: {len(items)}")
    print(f"  Summary: {json.dumps(summary, indent=2)}")
    
    # Verify TESTSC-A (real shipment)
    if not testsc_a:
        print(f"❌ TESTSC-A not found in items")
        return False
    
    if testsc_a.get('scan_cetak_status') != 'sudah':
        print(f"❌ TESTSC-A scan_cetak_status expected 'sudah', got '{testsc_a.get('scan_cetak_status')}'")
        return False
    
    if testsc_a.get('_virtual'):
        print(f"❌ TESTSC-A should NOT be virtual")
        return False
    
    print(f"✅ TESTSC-A: scan_cetak_status='sudah', _virtual={testsc_a.get('_virtual', False)}")
    
    # Verify TESTSC-B (virtual row)
    if not testsc_b:
        print(f"❌ TESTSC-B not found in items (expected virtual row)")
        return False
    
    if testsc_b.get('scan_cetak_status') != 'belum':
        print(f"❌ TESTSC-B scan_cetak_status expected 'belum', got '{testsc_b.get('scan_cetak_status')}'")
        return False
    
    if not testsc_b.get('_virtual'):
        print(f"❌ TESTSC-B should be virtual")
        return False
    
    if testsc_b.get('status') is not None:
        print(f"❌ TESTSC-B status should be null, got '{testsc_b.get('status')}'")
        return False
    
    if testsc_b.get('packed_at') is not None:
        print(f"❌ TESTSC-B packed_at should be null")
        return False
    
    print(f"✅ TESTSC-B: scan_cetak_status='belum', _virtual=True, status=null, packed_at=null")
    
    # Verify TESTSC-C (virtual row)
    if not testsc_c:
        print(f"❌ TESTSC-C not found in items (expected virtual row)")
        return False
    
    if testsc_c.get('scan_cetak_status') != 'belum':
        print(f"❌ TESTSC-C scan_cetak_status expected 'belum', got '{testsc_c.get('scan_cetak_status')}'")
        return False
    
    if not testsc_c.get('_virtual'):
        print(f"❌ TESTSC-C should be virtual")
        return False
    
    print(f"✅ TESTSC-C: scan_cetak_status='belum', _virtual=True")
    
    # Verify summary
    if summary.get('scan_cetak_done', 0) < 1:
        print(f"❌ summary.scan_cetak_done expected >= 1, got {summary.get('scan_cetak_done')}")
        return False
    
    if summary.get('scan_cetak_pending', 0) < 2:
        print(f"❌ summary.scan_cetak_pending expected >= 2, got {summary.get('scan_cetak_pending')}")
        return False
    
    print(f"✅ Summary: scan_cetak_done={summary.get('scan_cetak_done')}, scan_cetak_pending={summary.get('scan_cetak_pending')}")
    
    return True

def test_case_b_filter_belum(token, today):
    """Case B: Filter scan_cetak=belum"""
    print("\n=== TEST CASE B: Filter scan_cetak=belum ===")
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}&scan_cetak=belum",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case B failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()
    items = data.get('items', [])
    
    # Find our test items
    testsc_a = next((x for x in items if x.get('tracking_number') == 'TESTSC-A'), None)
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    print(f"  Total items: {len(items)}")
    
    # TESTSC-A should NOT be in results
    if testsc_a:
        print(f"❌ TESTSC-A should NOT be in results (filter=belum)")
        return False
    
    print(f"✅ TESTSC-A correctly excluded (scan_cetak=belum filter)")
    
    # TESTSC-B and TESTSC-C should be in results
    if not testsc_b:
        print(f"❌ TESTSC-B should be in results (filter=belum)")
        return False
    
    if not testsc_c:
        print(f"❌ TESTSC-C should be in results (filter=belum)")
        return False
    
    print(f"✅ TESTSC-B and TESTSC-C correctly included (scan_cetak=belum filter)")
    
    return True

def test_case_c_filter_sudah(token, today):
    """Case C: Filter scan_cetak=sudah"""
    print("\n=== TEST CASE C: Filter scan_cetak=sudah ===")
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}&scan_cetak=sudah",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case C failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()
    items = data.get('items', [])
    
    # Find our test items
    testsc_a = next((x for x in items if x.get('tracking_number') == 'TESTSC-A'), None)
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    print(f"  Total items: {len(items)}")
    
    # TESTSC-A should be in results
    if not testsc_a:
        print(f"❌ TESTSC-A should be in results (filter=sudah)")
        return False
    
    print(f"✅ TESTSC-A correctly included (scan_cetak=sudah filter)")
    
    # TESTSC-B and TESTSC-C should NOT be in results
    if testsc_b:
        print(f"❌ TESTSC-B should NOT be in results (filter=sudah)")
        return False
    
    if testsc_c:
        print(f"❌ TESTSC-C should NOT be in results (filter=sudah)")
        return False
    
    print(f"✅ TESTSC-B and TESTSC-C correctly excluded (scan_cetak=sudah filter)")
    
    return True

def test_case_d_operator_filter(token, today):
    """Case D: Operator filter suppresses virtual rows"""
    print("\n=== TEST CASE D: Operator filter suppresses virtual rows ===")
    headers = {'Authorization': f'Bearer {token}'}
    
    # First, get the packed_by_id from TESTSC-A shipment
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    shipment = db.om_shipments.find_one({'tracking_number': 'TESTSC-A'})
    operator_id = shipment.get('packed_by_id') if shipment else 'test-op'
    client.close()
    
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}&operator_id={operator_id}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case D failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()
    items = data.get('items', [])
    
    # Find our test items
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    print(f"  Total items: {len(items)}")
    print(f"  Operator filter: {operator_id}")
    
    # Virtual rows (TESTSC-B/C) should be excluded
    if testsc_b:
        print(f"❌ TESTSC-B (virtual) should be excluded when operator_id filter is set")
        return False
    
    if testsc_c:
        print(f"❌ TESTSC-C (virtual) should be excluded when operator_id filter is set")
        return False
    
    print(f"✅ Virtual rows correctly suppressed when operator_id filter is set")
    
    return True

def test_case_e_summary_numbers(token, today):
    """Case E: Summary numbers verification"""
    print("\n=== TEST CASE E: Summary numbers verification ===")
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case E failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()
    items = data.get('items', [])
    summary = data.get('summary', {})
    
    scan_cetak_done = summary.get('scan_cetak_done', 0)
    scan_cetak_pending = summary.get('scan_cetak_pending', 0)
    total_items = len(items)
    
    print(f"  Total items: {total_items}")
    print(f"  scan_cetak_done: {scan_cetak_done}")
    print(f"  scan_cetak_pending: {scan_cetak_pending}")
    print(f"  Sum: {scan_cetak_done + scan_cetak_pending}")
    
    if scan_cetak_done + scan_cetak_pending != total_items:
        print(f"❌ Summary mismatch: scan_cetak_done ({scan_cetak_done}) + scan_cetak_pending ({scan_cetak_pending}) != total items ({total_items})")
        return False
    
    print(f"✅ Summary numbers correct: scan_cetak_done + scan_cetak_pending == total items")
    
    return True

def cleanup(token, pdf_id):
    """Cleanup: Delete test shipment and PDF"""
    print("\n=== CLEANUP ===")
    
    # Delete test shipment from DB
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    result = db.om_shipments.delete_many({'tracking_number': 'TESTSC-A'})
    print(f"✅ Deleted {result.deleted_count} test shipment(s) for TESTSC-A")
    client.close()
    
    # Delete test PDF via API
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    
    if resp.status_code == 200:
        print(f"✅ Deleted test PDF: {pdf_id}")
    else:
        print(f"⚠️  Failed to delete test PDF: {resp.status_code} {resp.text}")

def test_sanity_check(token):
    """Sanity: Verify production existing shipments are NOT disrupted"""
    print("\n=== SANITY CHECK: Production data not disrupted ===")
    headers = {'Authorization': f'Bearer {token}'}
    
    # Get some past date range to check existing shipments
    from datetime import timedelta
    past_date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d')
    
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={past_date}&date_to={past_date}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Sanity check failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()
    items = data.get('items', [])
    summary = data.get('summary', {})
    
    print(f"  Response status: 200")
    print(f"  Items count: {len(items)}")
    print(f"  Summary keys: {list(summary.keys())}")
    
    # Check that response has expected structure
    if 'items' not in data or 'summary' not in data:
        print(f"❌ Response missing 'items' or 'summary'")
        return False
    
    # Check that scan_cetak_status field exists in items (if any)
    if len(items) > 0:
        first_item = items[0]
        if 'scan_cetak_status' not in first_item:
            print(f"❌ First item missing 'scan_cetak_status' field")
            return False
        print(f"  First item scan_cetak_status: {first_item.get('scan_cetak_status')}")
    
    print(f"✅ Production data not disrupted, response structure correct")
    
    return True

def main():
    print("=" * 80)
    print("OMS LAPORAN 'SCAN CETAK' PATCH — BACKEND TEST")
    print("Testing: GET /api/om/shipments with virtual rows for unscanned tracking numbers")
    print("=" * 80)
    
    # Login
    token = login(OWNER_USERNAME, OWNER_PASSWORD)
    if not token:
        print("\n❌ TEST FAILED: Unable to login")
        return
    
    # Get user info
    user_id, user_name = get_user_info(token)
    if not user_id:
        print("\n❌ TEST FAILED: Unable to get user info")
        return
    
    print(f"  User: {user_name} (ID: {user_id})")
    
    # Get today's date
    today = get_today_wita()
    print(f"  Today (WITA): {today}")
    
    # Setup
    print("\n=== SETUP ===")
    pdf_id = create_test_pdf(token)
    if not pdf_id:
        print("\n❌ TEST FAILED: Unable to create test PDF")
        return
    
    inject_tracking_numbers_and_date(pdf_id)
    shipment_id = create_test_shipment(token, user_id, user_name)
    
    # Run tests
    results = []
    
    results.append(("Case A: Baseline with virtual rows", test_case_a_baseline(token, today)))
    results.append(("Case B: Filter scan_cetak=belum", test_case_b_filter_belum(token, today)))
    results.append(("Case C: Filter scan_cetak=sudah", test_case_c_filter_sudah(token, today)))
    results.append(("Case D: Operator filter suppresses virtual rows", test_case_d_operator_filter(token, today)))
    results.append(("Case E: Summary numbers verification", test_case_e_summary_numbers(token, today)))
    
    # Cleanup
    cleanup(token, pdf_id)
    
    # Sanity check
    results.append(("Sanity: Production data not disrupted", test_sanity_check(token)))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({int(passed/total*100)}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")

if __name__ == "__main__":
    main()
