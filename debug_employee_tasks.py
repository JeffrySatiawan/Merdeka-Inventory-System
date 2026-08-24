#!/usr/bin/env python3
"""Debug script to check employee tasks distribution"""

import requests
import json

BASE_URL = "https://absensi-foundation.preview.emergentagent.com"

def login(username, password):
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    if resp.status_code == 200:
        return resp.json().get("token")
    return None

def main():
    owner_token = login("owner", "owner123")
    if not owner_token:
        print("Login failed")
        return
    
    headers = {"Authorization": f"Bearer {owner_token}"}
    resp = requests.get(f"{BASE_URL}/api/tasks/employees", headers=headers)
    
    if resp.status_code == 200:
        data = resp.json()
        print(json.dumps(data, indent=2))
    else:
        print(f"Failed: {resp.status_code}")
        print(resp.text)

if __name__ == "__main__":
    main()
