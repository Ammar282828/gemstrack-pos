#!/usr/bin/env python3
"""The Mac app's page snapshots (Help › Send Page Snapshots…, Mac/MacSnapshots.swift), read back for a session to look at.

Reads Firestore `app_snapshots` of a business's project with gcloud's token (a cloud session's service account has
`datastore.user`), takes the newest run (or the one named) and writes each page as <n>-<title>.jpg into a folder.

    python3 apps/iphone/scripts/mac-snapshots.py <out-dir>                  # gemstrack-pos, the newest run
    python3 apps/iphone/scripts/mac-snapshots.py <out-dir> --run 2026-10-25T21-04-10 --project gemstrack-pos
"""
import argparse, base64, json, os, re, subprocess, sys, urllib.request


def token():
    env = {k: v for k, v in os.environ.items() if k != "CLOUDSDK_AUTH_ACCESS_TOKEN"}
    return subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, env=env).stdout.strip()


def query(project, tok, where=None, limit=200):
    q = {"from": [{"collectionId": "app_snapshots"}], "orderBy": [{"field": {"fieldPath": "at"}, "direction": "DESCENDING"}], "limit": limit}
    if where:
        q["where"] = {"fieldFilter": {"field": {"fieldPath": "run"}, "op": "EQUAL", "value": {"stringValue": where}}}
        del q["orderBy"]
    req = urllib.request.Request(
        f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents:runQuery",
        data=json.dumps({"structuredQuery": q}).encode(), headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return [x["document"]["fields"] for x in json.load(r) if "document" in x]


def val(f, k):
    v = f.get(k, {})
    return v.get("stringValue", v.get("integerValue", ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--run")
    ap.add_argument("--project", default="gemstrack-pos")
    a = ap.parse_args()
    tok = token()
    run = a.run
    if not run:
        newest = query(a.project, tok, limit=1)
        if not newest:
            sys.exit("No snapshots yet: Help › Send Page Snapshots… on the Mac.")
        run = val(newest[0], "run")
    docs = query(a.project, tok, where=run, limit=500)
    os.makedirs(a.out, exist_ok=True)
    docs.sort(key=lambda f: int(val(f, "n") or 0))
    for f in docs:
        name = f"{int(val(f, 'n') or 0):02d}-{re.sub(r'[^A-Za-z0-9]+', '-', val(f, 'title')).strip('-')[:60]}.jpg"
        with open(os.path.join(a.out, name), "wb") as fh:
            fh.write(base64.b64decode(val(f, "image")))
    print(f"run {run}: {len(docs)} pages ({val(docs[0], 'build') if docs else '?'}) in {a.out}")


if __name__ == "__main__":
    main()
