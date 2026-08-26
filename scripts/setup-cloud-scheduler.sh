#!/usr/bin/env bash
#
# Sets up a Google Cloud Scheduler job that triggers the MINA WhatsApp
# "daily-report" (orders + invoices) every night at 9:00 PM Pakistan time.
#
# It hits the deployed App Hosting endpoint:
#   POST https://studio--hom-pos-52710474-ceeea.us-central1.hosted.app/api/notifications/run
#   body: {"task":"daily-report"}
#   header: Authorization: Bearer <CRON_SECRET>
#
# The CRON_SECRET is read live from Firebase Secret Manager (never hardcoded).
#
# PREREQUISITE — authenticate gcloud as a project owner/editor first:
#   gcloud auth login            # sign in as potatomasta501@gmail.com (or an owner)
#   gcloud config set project hom-pos-52710474-ceeea
#
# Then run:
#   bash scripts/setup-cloud-scheduler.sh
#
# Re-running is safe — it updates the existing job instead of erroring.

set -euo pipefail

PROJECT="hom-pos-52710474-ceeea"
REGION="us-central1"                       # match the App Hosting backend region
JOB="mina-daily-report"
# Override when the app moves to a custom domain:
#   APP_URL=https://pos.houseofmina.store ./scripts/setup-cloud-scheduler.sh
APP_URL="${APP_URL:-https://studio--hom-pos-52710474-ceeea.us-central1.hosted.app}"
URL="${APP_URL%/}/api/notifications/run"
SCHEDULE="0 21 * * *"                       # 21:00 every day
TZ_NAME="Asia/Karachi"

echo "▸ Using project: $PROJECT"
gcloud config set project "$PROJECT" >/dev/null

echo "▸ Enabling Cloud Scheduler API (idempotent)…"
gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT"

echo "▸ Reading CRON_SECRET from Firebase Secret Manager…"
SECRET="$(firebase apphosting:secrets:access CRON_SECRET --project "$PROJECT" 2>/dev/null | tr -d '\n\r ')"
if [ -z "$SECRET" ]; then
  echo "✗ Could not read CRON_SECRET via firebase CLI. Run: firebase login" >&2
  exit 1
fi
echo "  got secret (${#SECRET} chars)"

BODY='{"task":"daily-report"}'
COMMON_ARGS=(
  --project "$PROJECT"
  --location "$REGION"
  --schedule "$SCHEDULE"
  --time-zone "$TZ_NAME"
  --uri "$URL"
  --http-method POST
  --headers "Content-Type=application/json,Authorization=Bearer ${SECRET}"
  --message-body "$BODY"
  --attempt-deadline 120s
)

if gcloud scheduler jobs describe "$JOB" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1; then
  echo "▸ Job '$JOB' exists — updating…"
  gcloud scheduler jobs update http "$JOB" "${COMMON_ARGS[@]}"
else
  echo "▸ Creating job '$JOB'…"
  gcloud scheduler jobs create http "$JOB" "${COMMON_ARGS[@]}"
fi

echo
echo "✓ Done. Daily report scheduled for 21:00 $TZ_NAME."
echo "  Test it now with:"
echo "    gcloud scheduler jobs run $JOB --project $PROJECT --location $REGION"
