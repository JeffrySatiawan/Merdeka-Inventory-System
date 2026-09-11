#!/usr/bin/env python3
"""
Backend test for OMS INSTAN/REGULER service_type patch.

Tests:
1. Expeditions CRUD with service_type field
2. Scan Cetak Resi with new service_type flow
3. Backward compatibility with legacy expedition_id flow
4. Serah Terima Kurir with expedition selection and validation
5. Dashboard by_service_type breakdown
6. Regression tests for other OMS endpoints
"""

import requests
import json
from datetime import datetime
from pymongo import MongoClient

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "cycle_count"

def test_om_service_type():
    print("\n" + "="*80)
    print("BACKEND TEST: OMS INSTAN/REGULER Service Type Patch")
    print("="*80)
    
    # Connect to MongoDB for direct manipulation
    mongo_client = MongoClient(MONGO_URL)
    db = mongo_client[DB_NAME]
    
    # Test data tracking
    test_expeditions = []
    test_shipments = []
    
    try:
        # ============================================================
        # TEST 1: LOGIN AS OWNER
        # ============================================================
        print("\n[TEST 1] Login as owner...")
        login_resp = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"username": "owner", "password": "owner123"}
        )
        assert login_resp.status_code == 200, f"Login failed: {login_resp.status_code}"
        owner_token = login_resp.json()["token"]
        owner_headers = {"Authorization": f"Bearer {owner_token}"}
        print("✅ Owner login successful")
        
        # ============================================================
        # TEST 2: EXPEDITIONS CRUD WITH SERVICE_TYPE
        # ============================================================
        print("\n[TEST 2] Expeditions CRUD with service_type...")
        
        # 2.1: POST expedition with service_type='reguler'
        print("  2.1: POST expedition with service_type='reguler'...")
        jne_resp = requests.post(
            f"{BASE_URL}/api/om/expeditions",
            headers=owner_headers,
            json={"name": "JNE Reg TEST", "code": "JNEREG", "service_type": "reguler"}
        )
        assert jne_resp.status_code == 200, f"POST expedition failed: {jne_resp.status_code} {jne_resp.text}"
        jne_item = jne_resp.json()["item"]
        assert jne_item["service_type"] == "reguler", f"Expected service_type='reguler', got {jne_item['service_type']}"
        test_expeditions.append(jne_item["id"])
        jne_id = jne_item["id"]
        print(f"    ✅ Created JNE Reg TEST (id={jne_id}, service_type='reguler')")
        
        # 2.2: POST expedition with service_type='instan'
        print("  2.2: POST expedition with service_type='instan'...")
        gosend_resp = requests.post(
            f"{BASE_URL}/api/om/expeditions",
            headers=owner_headers,
            json={"name": "GoSend INSTAN TEST", "code": "GOSEND", "service_type": "instan"}
        )
        assert gosend_resp.status_code == 200, f"POST expedition failed: {gosend_resp.status_code} {gosend_resp.text}"
        gosend_item = gosend_resp.json()["item"]
        assert gosend_item["service_type"] == "instan", f"Expected service_type='instan', got {gosend_item['service_type']}"
        test_expeditions.append(gosend_item["id"])
        gosend_id = gosend_item["id"]
        print(f"    ✅ Created GoSend INSTAN TEST (id={gosend_id}, service_type='instan')")
        
        # 2.3: GET expeditions - verify service_type field is exposed
        print("  2.3: GET expeditions - verify service_type field...")
        exp_list_resp = requests.get(f"{BASE_URL}/api/om/expeditions", headers=owner_headers)
        assert exp_list_resp.status_code == 200, f"GET expeditions failed: {exp_list_resp.status_code}"
        exp_items = exp_list_resp.json()["items"]
        jne_found = next((e for e in exp_items if e["id"] == jne_id), None)
        gosend_found = next((e for e in exp_items if e["id"] == gosend_id), None)
        assert jne_found and jne_found["service_type"] == "reguler", "JNE not found or wrong service_type"
        assert gosend_found and gosend_found["service_type"] == "instan", "GoSend not found or wrong service_type"
        print("    ✅ GET expeditions returns service_type field correctly")
        
        # 2.4: PUT expedition - change service_type from reguler to instan
        print("  2.4: PUT expedition - change service_type from reguler to instan...")
        put_resp = requests.put(
            f"{BASE_URL}/api/om/expeditions/{jne_id}",
            headers=owner_headers,
            json={"service_type": "instan"}
        )
        assert put_resp.status_code == 200, f"PUT expedition failed: {put_resp.status_code} {put_resp.text}"
        updated_item = put_resp.json()["item"]
        assert updated_item["service_type"] == "instan", f"Expected service_type='instan', got {updated_item['service_type']}"
        print("    ✅ PUT expedition changed service_type from 'reguler' to 'instan'")
        
        # 2.5: PUT expedition - change back to reguler
        print("  2.5: PUT expedition - change back to reguler...")
        put_back_resp = requests.put(
            f"{BASE_URL}/api/om/expeditions/{jne_id}",
            headers=owner_headers,
            json={"service_type": "reguler"}
        )
        assert put_back_resp.status_code == 200, f"PUT expedition failed: {put_back_resp.status_code}"
        updated_back = put_back_resp.json()["item"]
        assert updated_back["service_type"] == "reguler", f"Expected service_type='reguler', got {updated_back['service_type']}"
        print("    ✅ PUT expedition changed service_type back to 'reguler'")
        
        print("✅ TEST 2 PASSED: Expeditions CRUD with service_type working")
        
        # ============================================================
        # TEST 3: SCAN CETAK RESI - NEW SERVICE_TYPE FLOW
        # ============================================================
        print("\n[TEST 3] Scan Cetak Resi - new service_type flow...")
        
        # 3.1: POST with service_type='instan'
        print("  3.1: POST scan/print with service_type='instan'...")
        print_instan_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=owner_headers,
            json={"tracking_number": "TEST-INS-001", "service_type": "instan"}
        )
        assert print_instan_resp.status_code == 200, f"POST scan/print failed: {print_instan_resp.status_code} {print_instan_resp.text}"
        instan_shipment = print_instan_resp.json()["shipment"]
        assert instan_shipment["service_type"] == "instan", f"Expected service_type='instan', got {instan_shipment['service_type']}"
        assert instan_shipment["expedition_id"] is None, f"Expected expedition_id=null, got {instan_shipment['expedition_id']}"
        test_shipments.append(instan_shipment["tracking_number"])
        print(f"    ✅ Created TEST-INS-001 with service_type='instan', expedition_id=null")
        
        # 3.2: POST with service_type='reguler'
        print("  3.2: POST scan/print with service_type='reguler'...")
        print_reguler_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=owner_headers,
            json={"tracking_number": "TEST-REG-001", "service_type": "reguler"}
        )
        assert print_reguler_resp.status_code == 200, f"POST scan/print failed: {print_reguler_resp.status_code} {print_reguler_resp.text}"
        reguler_shipment = print_reguler_resp.json()["shipment"]
        assert reguler_shipment["service_type"] == "reguler", f"Expected service_type='reguler', got {reguler_shipment['service_type']}"
        test_shipments.append(reguler_shipment["tracking_number"])
        print(f"    ✅ Created TEST-REG-001 with service_type='reguler'")
        
        # 3.3: POST with invalid service_type
        print("  3.3: POST scan/print with invalid service_type='kilat'...")
        print_invalid_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=owner_headers,
            json={"tracking_number": "TEST-BAD-001", "service_type": "kilat"}
        )
        assert print_invalid_resp.status_code == 400, f"Expected 400, got {print_invalid_resp.status_code}"
        error_text = print_invalid_resp.json()["error"]
        assert "instan" in error_text and "reguler" in error_text, f"Expected error message about instan/reguler, got: {error_text}"
        print("    ✅ Invalid service_type correctly rejected with 400")
        
        # 3.4: POST without service_type or expedition_id
        print("  3.4: POST scan/print without service_type or expedition_id...")
        print_none_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=owner_headers,
            json={"tracking_number": "TEST-NONE"}
        )
        assert print_none_resp.status_code == 400, f"Expected 400, got {print_none_resp.status_code}"
        error_text = print_none_resp.json()["error"]
        assert "instan" in error_text.lower() or "reguler" in error_text.lower(), f"Expected error message about choosing INSTAN/REGULER, got: {error_text}"
        print("    ✅ Missing service_type correctly rejected with 400")
        
        print("✅ TEST 3 PASSED: Scan Cetak Resi new service_type flow working")
        
        # ============================================================
        # TEST 4: BACKWARD COMPATIBILITY - LEGACY EXPEDITION_ID FLOW
        # ============================================================
        print("\n[TEST 4] Backward compatibility - legacy expedition_id flow...")
        
        # 4.1: POST with expedition_id (legacy flow)
        print("  4.1: POST scan/print with expedition_id (legacy)...")
        print_legacy_resp = requests.post(
            f"{BASE_URL}/api/om/scan/print",
            headers=owner_headers,
            json={"tracking_number": "TEST-LEG-001", "expedition_id": jne_id}
        )
        assert print_legacy_resp.status_code == 200, f"POST scan/print failed: {print_legacy_resp.status_code} {print_legacy_resp.text}"
        legacy_shipment = print_legacy_resp.json()["shipment"]
        assert legacy_shipment["service_type"] == "reguler", f"Expected service_type='reguler' (from expedition), got {legacy_shipment['service_type']}"
        assert legacy_shipment["expedition_id"] == jne_id, f"Expected expedition_id={jne_id}, got {legacy_shipment['expedition_id']}"
        test_shipments.append(legacy_shipment["tracking_number"])
        print(f"    ✅ Legacy flow: expedition_id → service_type='reguler', expedition_id set")
        
        print("✅ TEST 4 PASSED: Backward compatibility working")
        
        # ============================================================
        # TEST 5: PREPARE PACKING STATUS (BYPASS PHOTO REQUIREMENT)
        # ============================================================
        print("\n[TEST 5] Prepare packing status (bypass photo requirement)...")
        
        # Mutate TEST-INS-001 and TEST-REG-001 to packed status via MongoDB
        today = datetime.now().strftime("%Y-%m-%d")
        result = db.om_shipments.update_many(
            {"tracking_number": {"$in": ["TEST-INS-001", "TEST-REG-001"]}},
            {"$set": {
                "status": "packed",
                "packed_at": datetime.now(),
                "packed_wita_date": today,
                "packed_by_id": "test-user",
                "packed_by_name": "Test User",
                "sku_count": 1,
                "item_count": 1
            }}
        )
        assert result.modified_count == 2, f"Expected 2 records updated, got {result.modified_count}"
        print(f"    ✅ Mutated TEST-INS-001 and TEST-REG-001 to packed status (bypass photo)")
        
        print("✅ TEST 5 PASSED: Packing status prepared")
        
        # ============================================================
        # TEST 6: SERAH TERIMA KURIR - NEEDS_EXPEDITION FLOW
        # ============================================================
        print("\n[TEST 6] Serah Terima Kurir - needs_expedition flow...")
        
        # 6.1: POST deliver without expedition_id (should return needs_expedition)
        print("  6.1: POST scan/deliver without expedition_id (needs_expedition)...")
        deliver_no_exp_resp = requests.post(
            f"{BASE_URL}/api/om/scan/deliver",
            headers=owner_headers,
            json={"tracking_number": "TEST-INS-001"}
        )
        assert deliver_no_exp_resp.status_code == 200, f"POST scan/deliver failed: {deliver_no_exp_resp.status_code} {deliver_no_exp_resp.text}"
        needs_exp_data = deliver_no_exp_resp.json()
        assert needs_exp_data.get("needs_expedition") == True, f"Expected needs_expedition=true, got {needs_exp_data}"
        assert needs_exp_data["shipment"]["service_type"] == "instan", f"Expected service_type='instan', got {needs_exp_data['shipment']['service_type']}"
        print(f"    ✅ needs_expedition=true returned with shipment info (service_type='instan')")
        
        # 6.2: Verify DB - shipment status should still be 'packed', not 'delivered'
        print("  6.2: Verify DB - shipment status still 'packed'...")
        db_shipment = db.om_shipments.find_one({"tracking_number": "TEST-INS-001"})
        assert db_shipment["status"] == "packed", f"Expected status='packed', got {db_shipment['status']}"
        print("    ✅ Shipment status still 'packed' (not delivered)")
        
        print("✅ TEST 6 PASSED: needs_expedition flow working")
        
        # ============================================================
        # TEST 7: SERAH TERIMA KURIR - SERVICE_TYPE VALIDATION
        # ============================================================
        print("\n[TEST 7] Serah Terima Kurir - service_type validation...")
        
        # 7.1: POST deliver with wrong service_type (reguler expedition for instan shipment)
        print("  7.1: POST scan/deliver with wrong service_type (reguler exp for instan shipment)...")
        deliver_wrong_resp = requests.post(
            f"{BASE_URL}/api/om/scan/deliver",
            headers=owner_headers,
            json={"tracking_number": "TEST-INS-001", "expedition_id": jne_id}
        )
        assert deliver_wrong_resp.status_code == 400, f"Expected 400, got {deliver_wrong_resp.status_code}"
        error_msg = deliver_wrong_resp.json()["error"]
        assert "reguler" in error_msg.lower() and "instan" in error_msg.lower(), f"Expected error about category mismatch, got: {error_msg}"
        print(f"    ✅ Wrong service_type rejected with 400: {error_msg}")
        
        # 7.2: POST deliver with correct service_type (instan expedition for instan shipment)
        print("  7.2: POST scan/deliver with correct service_type (instan exp for instan shipment)...")
        deliver_correct_resp = requests.post(
            f"{BASE_URL}/api/om/scan/deliver",
            headers=owner_headers,
            json={"tracking_number": "TEST-INS-001", "expedition_id": gosend_id}
        )
        assert deliver_correct_resp.status_code == 200, f"POST scan/deliver failed: {deliver_correct_resp.status_code} {deliver_correct_resp.text}"
        delivered_shipment = deliver_correct_resp.json()["shipment"]
        assert delivered_shipment["expedition_name"] == "GoSend INSTAN TEST", f"Expected expedition_name='GoSend INSTAN TEST', got {delivered_shipment['expedition_name']}"
        assert delivered_shipment["status"] == "delivered", f"Expected status='delivered', got {delivered_shipment['status']}"
        print(f"    ✅ Correct service_type accepted, shipment delivered with expedition='GoSend INSTAN TEST'")
        
        # 7.3: POST deliver TEST-REG-001 with reguler expedition
        print("  7.3: POST scan/deliver TEST-REG-001 with reguler expedition...")
        deliver_reguler_resp = requests.post(
            f"{BASE_URL}/api/om/scan/deliver",
            headers=owner_headers,
            json={"tracking_number": "TEST-REG-001", "expedition_id": jne_id}
        )
        assert deliver_reguler_resp.status_code == 200, f"POST scan/deliver failed: {deliver_reguler_resp.status_code} {deliver_reguler_resp.text}"
        delivered_reguler = deliver_reguler_resp.json()["shipment"]
        assert delivered_reguler["status"] == "delivered", f"Expected status='delivered', got {delivered_reguler['status']}"
        print(f"    ✅ TEST-REG-001 delivered with reguler expedition")
        
        print("✅ TEST 7 PASSED: service_type validation working")
        
        # ============================================================
        # TEST 8: DASHBOARD BY_SERVICE_TYPE BREAKDOWN
        # ============================================================
        print("\n[TEST 8] Dashboard by_service_type breakdown...")
        
        # 8.1: GET dashboard
        print("  8.1: GET /api/om/dashboard...")
        dashboard_resp = requests.get(f"{BASE_URL}/api/om/dashboard", headers=owner_headers)
        assert dashboard_resp.status_code == 200, f"GET dashboard failed: {dashboard_resp.status_code}"
        dashboard_data = dashboard_resp.json()
        
        # 8.2: Verify by_service_type field exists
        print("  8.2: Verify by_service_type field exists...")
        assert "by_service_type" in dashboard_data, "by_service_type field missing from dashboard"
        by_service_type = dashboard_data["by_service_type"]
        assert isinstance(by_service_type, list), f"Expected by_service_type to be array, got {type(by_service_type)}"
        assert len(by_service_type) == 2, f"Expected 2 items (instan & reguler), got {len(by_service_type)}"
        print(f"    ✅ by_service_type field exists with 2 items")
        
        # 8.3: Verify structure and values
        print("  8.3: Verify by_service_type structure and values...")
        instan_data = next((x for x in by_service_type if x["service_type"] == "instan"), None)
        reguler_data = next((x for x in by_service_type if x["service_type"] == "reguler"), None)
        assert instan_data is not None, "instan data not found in by_service_type"
        assert reguler_data is not None, "reguler data not found in by_service_type"
        
        # Verify fields
        for item in [instan_data, reguler_data]:
            assert "printed" in item, f"printed field missing from {item['service_type']}"
            assert "delivered" in item, f"delivered field missing from {item['service_type']}"
            assert "diff" in item, f"diff field missing from {item['service_type']}"
            assert isinstance(item["printed"], int), f"printed should be int, got {type(item['printed'])}"
            assert isinstance(item["delivered"], int), f"delivered should be int, got {type(item['delivered'])}"
            assert isinstance(item["diff"], int), f"diff should be int, got {type(item['diff'])}"
        
        # Verify today's data (at least 1 printed and 1 delivered for each)
        assert instan_data["printed"] >= 1, f"Expected instan.printed >= 1, got {instan_data['printed']}"
        assert instan_data["delivered"] >= 1, f"Expected instan.delivered >= 1, got {instan_data['delivered']}"
        assert reguler_data["printed"] >= 1, f"Expected reguler.printed >= 1, got {reguler_data['printed']}"
        assert reguler_data["delivered"] >= 1, f"Expected reguler.delivered >= 1, got {reguler_data['delivered']}"
        
        print(f"    ✅ by_service_type structure correct:")
        print(f"       - instan: printed={instan_data['printed']}, delivered={instan_data['delivered']}, diff={instan_data['diff']}")
        print(f"       - reguler: printed={reguler_data['printed']}, delivered={reguler_data['delivered']}, diff={reguler_data['diff']}")
        
        print("✅ TEST 8 PASSED: Dashboard by_service_type breakdown working")
        
        # ============================================================
        # TEST 9: REGRESSION - OTHER OMS ENDPOINTS
        # ============================================================
        print("\n[TEST 9] Regression - other OMS endpoints...")
        
        # 9.1: GET shipments
        print("  9.1: GET /api/om/shipments...")
        shipments_resp = requests.get(f"{BASE_URL}/api/om/shipments", headers=owner_headers)
        assert shipments_resp.status_code == 200, f"GET shipments failed: {shipments_resp.status_code}"
        print("    ✅ GET /api/om/shipments working")
        
        # 9.2: GET settings
        print("  9.2: GET /api/om/settings...")
        settings_resp = requests.get(f"{BASE_URL}/api/om/settings", headers=owner_headers)
        assert settings_resp.status_code == 200, f"GET settings failed: {settings_resp.status_code}"
        print("    ✅ GET /api/om/settings working")
        
        # 9.3: GET pdfs
        print("  9.3: GET /api/om/pdfs...")
        pdfs_resp = requests.get(f"{BASE_URL}/api/om/pdfs", headers=owner_headers)
        assert pdfs_resp.status_code == 200, f"GET pdfs failed: {pdfs_resp.status_code}"
        print("    ✅ GET /api/om/pdfs working")
        
        print("✅ TEST 9 PASSED: Regression tests passed, no breaking changes")
        
        # ============================================================
        # CLEANUP
        # ============================================================
        print("\n[CLEANUP] Deleting test data...")
        
        # Delete test shipments
        for tn in test_shipments:
            db.om_shipments.delete_one({"tracking_number": tn})
        print(f"  ✅ Deleted {len(test_shipments)} test shipments")
        
        # Delete test expeditions
        for exp_id in test_expeditions:
            requests.delete(f"{BASE_URL}/api/om/expeditions/{exp_id}", headers=owner_headers)
        print(f"  ✅ Deleted {len(test_expeditions)} test expeditions")
        
        print("\n" + "="*80)
        print("✅ ALL TESTS PASSED (9/9) - OMS INSTAN/REGULER Service Type Patch FULLY WORKING")
        print("="*80)
        
        return True
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # Cleanup in case of failure
        try:
            for tn in test_shipments:
                db.om_shipments.delete_one({"tracking_number": tn})
            for exp_id in test_expeditions:
                requests.delete(f"{BASE_URL}/api/om/expeditions/{exp_id}", headers=owner_headers)
        except:
            pass
        mongo_client.close()

if __name__ == "__main__":
    success = test_om_service_type()
    exit(0 if success else 1)
