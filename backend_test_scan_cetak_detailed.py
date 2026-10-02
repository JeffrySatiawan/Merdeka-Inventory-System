#!/usr/bin/env python3
"""
Detailed Backend Test: OMS Laporan "Scan Cetak" Patch
This test captures exact response snippets for Cases A, B, and C as requested in the review.
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
    
    files = {'file': ('test_scan_cetak_detail.pdf', io.BytesIO(pdf_content), 'application/pdf')}
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
        'id': f'test-shipment-detail-{datetime.now().timestamp()}',
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

def print_item_snippet(item, label):
    """Print a formatted snippet of an item"""
    snippet = {
        'tracking_number': item.get('tracking_number'),
        'scan_cetak_status': item.get('scan_cetak_status'),
        'scan_cetak_at': item.get('scan_cetak_at'),
        '_virtual': item.get('_virtual', False),
        'status': item.get('status'),
        'packed_at': item.get('packed_at'),
        'ketoko_pdf_id': item.get('ketoko_pdf_id'),
        'ketoko_pdf_filename': item.get('ketoko_pdf_filename'),
    }
    print(f"\n{label}:")
    print(json.dumps(snippet, indent=2))

def main():
    print("=" * 80)
    print("OMS LAPORAN 'SCAN CETAK' PATCH — DETAILED RESPONSE SNIPPETS")
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
    
    # Case A: Baseline with virtual rows
    print("\n" + "=" * 80)
    print("CASE A: Baseline with virtual rows")
    print(f"GET /api/om/shipments?date_from={today}&date_to={today}")
    print("=" * 80)
    
    headers = {'Authorization': f'Bearer {token}'}
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case A failed: {resp.status_code} {resp.text}")
        return
    
    data = resp.json()
    items = data.get('items', [])
    summary = data.get('summary', {})
    
    # Find our test items
    testsc_a = next((x for x in items if x.get('tracking_number') == 'TESTSC-A'), None)
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    print(f"\nTotal items in response: {len(items)}")
    
    if testsc_a:
        print_item_snippet(testsc_a, "TESTSC-A (Real Shipment)")
    
    if testsc_b:
        print_item_snippet(testsc_b, "TESTSC-B (Virtual Row)")
    
    if testsc_c:
        print_item_snippet(testsc_c, "TESTSC-C (Virtual Row)")
    
    print(f"\nSummary:")
    print(json.dumps(summary, indent=2))
    
    # Case B: Filter scan_cetak=belum
    print("\n" + "=" * 80)
    print("CASE B: Filter scan_cetak=belum")
    print(f"GET /api/om/shipments?date_from={today}&date_to={today}&scan_cetak=belum")
    print("=" * 80)
    
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}&scan_cetak=belum",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case B failed: {resp.status_code} {resp.text}")
        return
    
    data = resp.json()
    items = data.get('items', [])
    summary = data.get('summary', {})
    
    print(f"\nTotal items in response: {len(items)}")
    print(f"Tracking numbers in response: {[x.get('tracking_number') for x in items if x.get('tracking_number') in ['TESTSC-A', 'TESTSC-B', 'TESTSC-C']]}")
    
    testsc_a = next((x for x in items if x.get('tracking_number') == 'TESTSC-A'), None)
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    if testsc_a:
        print("\n⚠️  TESTSC-A found in results (should be excluded)")
        print_item_snippet(testsc_a, "TESTSC-A")
    else:
        print("\n✅ TESTSC-A correctly excluded from results")
    
    if testsc_b:
        print_item_snippet(testsc_b, "TESTSC-B (Virtual Row)")
    
    if testsc_c:
        print_item_snippet(testsc_c, "TESTSC-C (Virtual Row)")
    
    print(f"\nSummary:")
    print(json.dumps(summary, indent=2))
    
    # Case C: Filter scan_cetak=sudah
    print("\n" + "=" * 80)
    print("CASE C: Filter scan_cetak=sudah")
    print(f"GET /api/om/shipments?date_from={today}&date_to={today}&scan_cetak=sudah")
    print("=" * 80)
    
    resp = requests.get(
        f"{BASE_URL}/api/om/shipments?date_from={today}&date_to={today}&scan_cetak=sudah",
        headers=headers
    )
    
    if resp.status_code != 200:
        print(f"❌ Case C failed: {resp.status_code} {resp.text}")
        return
    
    data = resp.json()
    items = data.get('items', [])
    summary = data.get('summary', {})
    
    print(f"\nTotal items in response: {len(items)}")
    print(f"Tracking numbers in response: {[x.get('tracking_number') for x in items if x.get('tracking_number') in ['TESTSC-A', 'TESTSC-B', 'TESTSC-C']]}")
    
    testsc_a = next((x for x in items if x.get('tracking_number') == 'TESTSC-A'), None)
    testsc_b = next((x for x in items if x.get('tracking_number') == 'TESTSC-B'), None)
    testsc_c = next((x for x in items if x.get('tracking_number') == 'TESTSC-C'), None)
    
    if testsc_a:
        print_item_snippet(testsc_a, "TESTSC-A (Real Shipment)")
    else:
        print("\n⚠️  TESTSC-A not found in results (should be included)")
    
    if testsc_b:
        print("\n⚠️  TESTSC-B found in results (should be excluded)")
        print_item_snippet(testsc_b, "TESTSC-B")
    else:
        print("\n✅ TESTSC-B correctly excluded from results")
    
    if testsc_c:
        print("\n⚠️  TESTSC-C found in results (should be excluded)")
        print_item_snippet(testsc_c, "TESTSC-C")
    else:
        print("\n✅ TESTSC-C correctly excluded from results")
    
    print(f"\nSummary:")
    print(json.dumps(summary, indent=2))
    
    # Cleanup
    print("\n" + "=" * 80)
    print("CLEANUP")
    print("=" * 80)
    
    # Delete test shipment from DB
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    result = db.om_shipments.delete_many({'tracking_number': 'TESTSC-A'})
    print(f"✅ Deleted {result.deleted_count} test shipment(s) for TESTSC-A")
    client.close()
    
    # Delete test PDF via API
    resp = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
    
    if resp.status_code == 200:
        print(f"✅ Deleted test PDF: {pdf_id}")
    else:
        print(f"⚠️  Failed to delete test PDF: {resp.status_code} {resp.text}")
    
    print("\n" + "=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    main()
