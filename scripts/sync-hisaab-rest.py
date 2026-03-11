#!/usr/bin/env python3
"""Sync hisaab outstanding balances for all invoices (including Shopify-imported ones).
Uses Firestore REST API authenticated via Firebase CLI refresh token.
"""
import json, urllib.request, urllib.parse, sys

PROJECT = 'hom-pos-52710474-ceeea'
CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com'
FS_BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'

# --- Get access token from Firebase CLI stored refresh token ---
config_path = '/Users/ammarmansa/.config/configstore/firebase-tools.json'
with open(config_path) as f:
    refresh_token = json.load(f)['tokens']['refresh_token']

resp = urllib.request.urlopen(urllib.request.Request(
    'https://oauth2.googleapis.com/token',
    data=urllib.parse.urlencode({
        'client_id': CLIENT_ID,
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
    }).encode(),
    method='POST',
))
token_data = json.load(resp)
if 'access_token' not in token_data:
    print('Failed to get access token:', token_data)
    sys.exit(1)
access_token = token_data['access_token']
print('Got access token.')

HEADERS = {'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'}

def fs_get(path):
    req = urllib.request.Request(f'{FS_BASE}/{path}', headers=HEADERS)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def fs_list(collection):
    docs = []
    page_token = None
    while True:
        url = f'{FS_BASE}/{collection}?pageSize=300'
        if page_token:
            url += f'&pageToken={page_token}'
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
        docs.extend(data.get('documents', []))
        page_token = data.get('nextPageToken')
        if not page_token:
            break
    return docs

def field_val(field):
    """Extract Python value from Firestore field value dict."""
    if 'stringValue' in field: return field['stringValue']
    if 'integerValue' in field: return int(field['integerValue'])
    if 'doubleValue' in field: return float(field['doubleValue'])
    if 'booleanValue' in field: return field['booleanValue']
    if 'nullValue' in field: return None
    return None

def to_fs_value(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    return {'stringValue': str(v)}

def doc_to_dict(doc):
    return {k: field_val(v) for k, v in doc.get('fields', {}).items()}

def create_hisaab(inv_id, inv):
    fields = {
        'entityId':       to_fs_value(inv['customerId']),
        'entityType':     to_fs_value('customer'),
        'entityName':     to_fs_value(inv.get('customerName') or 'Customer'),
        'date':           to_fs_value(inv.get('createdAt') or ''),
        'description':    to_fs_value(f"Outstanding balance for Invoice {inv_id}"),
        'cashDebit':      to_fs_value(float(inv['balanceDue'])),
        'cashCredit':     to_fs_value(0),
        'goldDebitGrams': to_fs_value(0),
        'goldCreditGrams':to_fs_value(0),
        'linkedInvoiceId':to_fs_value(inv_id),
    }
    body = json.dumps({'fields': fields}).encode()
    req = urllib.request.Request(f'{FS_BASE}/hisaab', data=body, headers=HEADERS, method='POST')
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def delete_doc(name):
    req = urllib.request.Request(f'https://firestore.googleapis.com/v1/{name}', headers=HEADERS, method='DELETE')
    with urllib.request.urlopen(req) as r:
        r.read()

def update_doc(name, field, value):
    body = json.dumps({'fields': {field: to_fs_value(value)}}).encode()
    url = f'https://firestore.googleapis.com/v1/{name}?updateMask.fieldPaths={field}'
    req = urllib.request.Request(url, data=body, headers={**HEADERS, 'X-HTTP-Method-Override': 'PATCH'}, method='POST')
    # Use proper PATCH
    req2 = urllib.request.Request(url, data=body, headers=HEADERS, method='PATCH')
    with urllib.request.urlopen(req2) as r:
        return json.load(r)

# --- Load data ---
print('Loading invoices...')
invoice_docs = fs_list('invoices')
print(f'  {len(invoice_docs)} invoices')

print('Loading hisaab...')
hisaab_docs = fs_list('hisaab')
print(f'  {len(hisaab_docs)} hisaab entries')

# Build lookup: linkedInvoiceId -> list of hisaab docs
linked = {}
for d in hisaab_docs:
    data = doc_to_dict(d)
    lid = data.get('linkedInvoiceId')
    if lid:
        linked.setdefault(lid, []).append({'name': d['name'], 'data': data})

created = updated = deleted = 0

for inv_doc in invoice_docs:
    inv_id = inv_doc['name'].split('/')[-1]
    inv = doc_to_dict(inv_doc)
    balance = inv.get('balanceDue') or 0
    try:
        balance = float(balance)
    except:
        balance = 0

    existing = linked.get(inv_id, [])
    debit_entries = [e for e in existing if (e['data'].get('cashDebit') or 0) > 0]
    bad_entries   = [e for e in existing if (e['data'].get('cashDebit') or 0) == 0 and (e['data'].get('cashCredit') or 0) > 0]

    for e in bad_entries:
        delete_doc(e['name']); deleted += 1

    if balance <= 0 or inv.get('status') == 'Refunded':
        for e in debit_entries:
            delete_doc(e['name']); deleted += 1
        continue

    customer_id = inv.get('customerId', '')
    if not customer_id or customer_id == 'walk-in':
        continue

    if not debit_entries:
        create_hisaab(inv_id, inv)
        print(f'  CREATED: {inv_id} | {inv.get("customerName")} | PKR {balance}')
        created += 1
    else:
        current = debit_entries[0]['data'].get('cashDebit') or 0
        if abs(float(current) - balance) > 0.01:
            update_doc(debit_entries[0]['name'], 'cashDebit', float(balance))
            print(f'  UPDATED: {inv_id} | {inv.get("customerName")} | {current} -> {balance}')
            updated += 1
        for e in debit_entries[1:]:
            delete_doc(e['name']); deleted += 1

print(f'\nDone — created: {created}, updated: {updated}, deleted: {deleted}')
