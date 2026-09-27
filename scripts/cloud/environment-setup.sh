#!/usr/bin/env bash
# Setup script for the Claude Code cloud environment (claude.ai/code → the environment's
# settings → Setup script): paste this whole file there. It runs once, as root, and the result
# is cached for later sessions. No secrets here — the one key is the environment variable
# GCP_SA_KEY_B64, and scripts/cloud/session-start.sh does the rest in every session.
set -u

# Google Cloud CLI (the image has none). dl.google.com needs Full network access; the pinned
# copy on storage.googleapis.com works on Trusted too.
ARCH=$([ "$(uname -m)" = aarch64 ] && echo arm || echo x86_64)
cd /opt
for u in "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-$ARCH.tar.gz" \
         "https://storage.googleapis.com/cloud-sdk-release/google-cloud-cli-574.0.0-linux-$ARCH.tar.gz"; do
  curl -fsSL --max-time 180 "$u" | tar -xz && break
done
if [ -x /opt/google-cloud-sdk/bin/gcloud ]; then
  ln -sf /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
  gcloud config set core/disable_usage_reporting true --quiet >/dev/null 2>&1
fi

# Node 20, as in production (the image puts 22 first).
[ -d /opt/node20/bin ] && echo 'export PATH="/opt/node20/bin:$PATH"' > /etc/profile.d/node20.sh

exit 0
