#!/usr/bin/env bash
# The start of every Claude Code cloud session (claude.ai/code) on this repo: the SessionStart
# hook in .claude/settings.json runs this only when CLAUDE_CODE_REMOTE=true. Safe to run again.
#
# 1. Google: the environment's GCP_SA_KEY_B64 (the claude-cloud@gemstrack-pos key, base64)
#    becomes the machine's default credentials, so firebase-admin, Secret Manager, Vertex and
#    gcloud (when the setup script installed it) all act as that service account.
# 2. Node 20, as in production.
# 3. .env.taheri.local and .env.mina.local, written from the YAML with every secret filled.
#
# Prints a line or two for the session to read; never a value.
set -u
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

if [ -d /opt/node20/bin ]; then
  export PATH="/opt/node20/bin:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo 'export PATH="/opt/node20/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

ADC="$HOME/.config/gcloud/application_default_credentials.json"
if [ -n "${GCP_SA_KEY_B64:-}" ]; then
  mkdir -p "$(dirname "$ADC")"
  (umask 077; printf '%s' "$GCP_SA_KEY_B64" | base64 -d > "$ADC")
  if command -v gcloud >/dev/null 2>&1; then
    gcloud auth activate-service-account --key-file="$ADC" --quiet >/dev/null 2>&1
    gcloud config set project gemstrack-pos --quiet >/dev/null 2>&1
  fi
  echo "cloud: Google as $(sed -n 's/.*"client_email": *"\([^"]*\)".*/\1/p' "$ADC")$(command -v gcloud >/dev/null 2>&1 || echo ' (no gcloud CLI; APIs still work)')"
else
  echo "cloud: GCP_SA_KEY_B64 is not set in this environment, so no Google access — see CLAUDE.md, Cloud sessions"
fi

[ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1 || echo "cloud: npm ci failed"
node scripts/env-for-house.mjs taheri >/dev/null && node scripts/env-for-house.mjs mina >/dev/null
[ -s "$ADC" ] && node scripts/cloud/fill-secrets.mjs
exit 0
