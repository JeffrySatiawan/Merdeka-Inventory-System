#!/usr/bin/env python3
"""
Detailed report for OM PDF Resi N+1 → batch fix test.
Shows exact scan_cetak_at values for the 3 fixture PDFs.
"""

import requests
import time
import json
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

def main():
    print("=" * 80)
    print("OM PDF RESI N+1 → BATCH FIX - DETAILED REPORT")
    print("=" * 80)
    
    # Connect to MongoDB
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    
    # Login as owner
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "owner", "password": "owner123"})
    assert r.status_code == 200
    token = r.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Get current timestamp
    now = time.time()
    
    # Setup fixture: Create 3 test PDFs directly in MongoDB
    print("\n📦 SETUP FIXTURE:")
    pdf_ids = []
    pdf_configs = [
        ("PDF-A", ["BATCH-A1", "BATCH-A2"]),
        ("PDF-B", ["BATCH-B1"]),
        ("PDF-C", ["BATCH-C1", "BATCH-C2", "BATCH-C3"])
    ]
    
    import uuid
    for name, tns in pdf_configs:
        pdf_id = str(uuid.uuid4())
        pdf_ids.append(pdf_id)
        
        doc = {
            "id": pdf_id,
            "filename": f"test_{name.lower()}.pdf",
            "size": 1000,
            "uploaded_at": {"$date": int(now * 1000)},
            "uploaded_by_id": "owner-id",
            "uploaded_by_name": "Owner",
            "uploaded_wita_date": time.strftime('%Y-%m-%d', time.gmtime(now)),
            "pages_count": len(tns),
            "detected_tracking_numbers": tns,
            "scanned_at": {"$date": int(now * 1000)},
            "printed_at": None,
            "deleted": False,
            "ketoko_resi": [],
            "ketoko_input_at": None,
            "ketoko_checked_count": 0,
            "ketoko_total_count": len(tns)
        }
        db.om_pdfs.insert_one(doc)
        print(f"  • {name}: detected_tracking_numbers = {tns}")
    
    # Create 3 om_shipments with printed_at
    shipment_tns = ["BATCH-A1", "BATCH-B1", "BATCH-C2"]
    printed_at_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))
    
    for tn in shipment_tns:
        doc = {
            "id": f"ship-{tn}",
            "tracking_number": tn,
            "printed_at": {"$date": int(now * 1000)},
            "status": "printed",
            "expedition_id": None,
            "expedition_name": None,
            "expedition_code": None,
            "sku_count": 0,
            "item_count": 0,
            "packed_at": None,
            "delivered_at": None,
            "photo_deleted": True,
            "createdAt": {"$date": int(now * 1000)}
        }
        db.om_shipments.insert_one(doc)
    
    print(f"\n  • Created 3 shipments with printed_at = {printed_at_iso}")
    print(f"    - BATCH-A1 (has shipment)")
    print(f"    - BATCH-B1 (has shipment)")
    print(f"    - BATCH-C2 (has shipment)")
    print(f"  • Others (A2, C1, C3) have NO shipment row")
    
    # GET /api/om/pdfs?limit=500
    print("\n" + "=" * 80)
    print("📊 GET /api/om/pdfs?limit=500 RESPONSE:")
    print("=" * 80)
    
    r = requests.get(f"{BASE_URL}/api/om/pdfs?limit=500", headers=headers)
    assert r.status_code == 200
    items = r.json()["items"]
    
    # Find our 3 test PDFs
    test_pdfs = {}
    for item in items:
        if item["id"] in pdf_ids:
            test_pdfs[item["id"]] = item
    
    pdf_a = test_pdfs[pdf_ids[0]]
    pdf_b = test_pdfs[pdf_ids[1]]
    pdf_c = test_pdfs[pdf_ids[2]]
    
    print("\n📄 PDF-A (detected_tracking_numbers: ['BATCH-A1', 'BATCH-A2']):")
    print(json.dumps(pdf_a["ketoko_resi"], indent=2))
    print(f"\n  Summary:")
    print(f"    • ketoko_total_count: {pdf_a['ketoko_total_count']}")
    print(f"    • ketoko_checked_count: {pdf_a['ketoko_checked_count']}")
    
    print("\n📄 PDF-B (detected_tracking_numbers: ['BATCH-B1']):")
    print(json.dumps(pdf_b["ketoko_resi"], indent=2))
    print(f"\n  Summary:")
    print(f"    • ketoko_total_count: {pdf_b['ketoko_total_count']}")
    print(f"    • ketoko_checked_count: {pdf_b['ketoko_checked_count']}")
    
    print("\n📄 PDF-C (detected_tracking_numbers: ['BATCH-C1', 'BATCH-C2', 'BATCH-C3']):")
    print(json.dumps(pdf_c["ketoko_resi"], indent=2))
    print(f"\n  Summary:")
    print(f"    • ketoko_total_count: {pdf_c['ketoko_total_count']}")
    print(f"    • ketoko_checked_count: {pdf_c['ketoko_checked_count']}")
    
    # Extract exact scan_cetak_at values
    print("\n" + "=" * 80)
    print("🔍 EXACT scan_cetak_at VALUES:")
    print("=" * 80)
    
    a1 = next((r for r in pdf_a["ketoko_resi"] if r["tracking_number"] == "BATCH-A1"), None)
    a2 = next((r for r in pdf_a["ketoko_resi"] if r["tracking_number"] == "BATCH-A2"), None)
    b1 = pdf_b["ketoko_resi"][0]
    c1 = next((r for r in pdf_c["ketoko_resi"] if r["tracking_number"] == "BATCH-C1"), None)
    c2 = next((r for r in pdf_c["ketoko_resi"] if r["tracking_number"] == "BATCH-C2"), None)
    c3 = next((r for r in pdf_c["ketoko_resi"] if r["tracking_number"] == "BATCH-C3"), None)
    
    print("\nPDF-A:")
    print(f"  • BATCH-A1: scan_cetak_at = {a1['scan_cetak_at']} (ISO string, not null)")
    print(f"  • BATCH-A2: scan_cetak_at = {a2['scan_cetak_at']} (null)")
    
    print("\nPDF-B:")
    print(f"  • BATCH-B1: scan_cetak_at = {b1['scan_cetak_at']} (ISO string, not null)")
    
    print("\nPDF-C:")
    print(f"  • BATCH-C1: scan_cetak_at = {c1['scan_cetak_at']} (null)")
    print(f"  • BATCH-C2: scan_cetak_at = {c2['scan_cetak_at']} (ISO string, not null)")
    print(f"  • BATCH-C3: scan_cetak_at = {c3['scan_cetak_at']} (null)")
    
    # Cleanup
    print("\n" + "=" * 80)
    print("🧹 CLEANUP:")
    print("=" * 80)
    
    for pdf_id in pdf_ids:
        r = requests.delete(f"{BASE_URL}/api/om/pdfs/{pdf_id}", headers=headers)
        assert r.status_code == 200
    print(f"  ✓ Deleted 3 test PDFs")
    
    for tn in shipment_tns:
        db.om_shipments.delete_one({"tracking_number": tn})
    print(f"  ✓ Deleted 3 test shipments")
    
    print("\n" + "=" * 80)
    print("✅ DETAILED REPORT COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
