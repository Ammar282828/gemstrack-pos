#!/usr/bin/env bash
# One-time setup of the cloud sessions' deploy on Google Cloud Build (scripts/cloud/deploy.sh). Run it once as the
# owner in Cloud Shell (console.cloud.google.com, the >_ button): it needs Owner on gemstrack-pos, which no session has.
#
#   bash cloudbuild-setup.sh [path/to/cloudbuild-trigger.json]
#
# It makes, and is safe to run again:
#   - the service account cloud-deploy@gemstrack-pos, which the builds run as (logs, the token, the repository link);
#   - the secret github-deploy-token, from a GitHub fine-grained token pasted at the prompt (never shown);
#   - the Developer Connect link to taheri-pos on the connection App Hosting already uses (made if missing);
#   - the trigger "deploy-cloud-sessions" (us-central1): every push to claude/** runs deploy.sh.
set -euo pipefail

P=gemstrack-pos
R=us-central1
SA=cloud-deploy@$P.iam.gserviceaccount.com
JSON=${1:-scripts/cloud/cloudbuild-trigger.json}
[ -f "$JSON" ] || { echo "No $JSON here: pass the trigger file's path." >&2; exit 1; }

gcloud config set project "$P" >/dev/null
NUM=$(gcloud projects describe "$P" --format='value(projectNumber)')
TOKEN=$(gcloud auth print-access-token)
api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

echo "1/4 APIs and the service account"
gcloud services enable cloudbuild.googleapis.com developerconnect.googleapis.com secretmanager.googleapis.com
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create cloud-deploy --display-name="Deploys the cloud sessions' pushes to both houses"
for role in roles/logging.logWriter roles/developerconnect.readTokenAccessor; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null
done
# Cloud Build's own agent reads the repository through Developer Connect too.
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:service-$NUM@gcp-sa-cloudbuild.iam.gserviceaccount.com" \
  --role=roles/developerconnect.readTokenAccessor --condition=None >/dev/null

echo "2/4 The GitHub token"
gcloud secrets describe github-deploy-token >/dev/null 2>&1 || gcloud secrets create github-deploy-token --replication-policy=automatic >/dev/null
if [ "${SKIP_TOKEN:-0}" != "1" ]; then
  read -rsp "Paste the GitHub token (github_pat_…; it will not show), then Enter: " T; echo
  case "$T" in github_pat_*|ghp_*) ;; *) echo "That does not look like a GitHub token." >&2; exit 1 ;; esac
  printf '%s' "$T" | gcloud secrets versions add github-deploy-token --data-file=- >/dev/null
  unset T
fi
gcloud secrets add-iam-policy-binding github-deploy-token --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor --condition=None >/dev/null

echo "3/4 The link to taheri-pos"
DC=https://developerconnect.googleapis.com/v1/projects/$P/locations/$R
CONNS=$(api "$DC/connections" | python3 -c 'import json,sys; [print(c["name"]) for c in json.load(sys.stdin).get("connections",[]) if c.get("githubConfig")]')
[ -n "$CONNS" ] || { echo "No GitHub connection in Developer Connect ($R). App Hosting's should be here; make one in the console: Developer Connect → Connections." >&2; exit 1; }
LINK=""
for c in $CONNS; do
  LINK=$(api "https://developerconnect.googleapis.com/v1/$c/gitRepositoryLinks" | python3 -c '
import json, sys
for l in json.load(sys.stdin).get("gitRepositoryLinks", []):
    if l.get("cloneUri", "").lower().rstrip("/").removesuffix(".git").endswith("ammar282828/taheri-pos"):
        print(l["name"]); break')
  [ -n "$LINK" ] && break
done
if [ -z "$LINK" ]; then
  c=$(echo "$CONNS" | head -1)
  echo "   making it on ${c##*/}"
  api -X POST "https://developerconnect.googleapis.com/v1/$c/gitRepositoryLinks?gitRepositoryLinkId=taheri-pos" \
    -d '{"cloneUri":"https://github.com/Ammar282828/taheri-pos.git"}' >/dev/null
  sleep 15
  LINK="$c/gitRepositoryLinks/taheri-pos"
fi
echo "   $LINK"

echo "4/4 The trigger"
BODY=$(python3 - "$JSON" "$LINK" <<'PY'
import json, sys
t = json.load(open(sys.argv[1]))
t["developerConnectEventConfig"]["gitRepositoryLink"] = sys.argv[2]
print(json.dumps(t))
PY
)
CB=https://cloudbuild.googleapis.com/v1/projects/$P/locations/$R/triggers
ID=$(api "$CB" | python3 -c 'import json,sys; [print(t["id"]) for t in json.load(sys.stdin).get("triggers",[]) if t.get("name")=="deploy-cloud-sessions"]')
if [ -n "$ID" ]; then
  api -X PATCH "$CB/$ID" -d "$BODY" >/dev/null && echo "   updated"
else
  api -X POST "$CB" -d "$BODY" >/dev/null && echo "   made"
fi

echo
echo "Done. The next push to a claude/ branch of taheri-pos deploys through Cloud Build; its result shows on the commit"
echo "on GitHub as \"deploy (Cloud Build)\" and in: gcloud builds list --region $R --project $P"
