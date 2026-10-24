#!/usr/bin/env bash
# A cloud session's push goes live: Google Cloud Build runs this for every push to claude/** (since 2026-10-24,
# when GitHub's free Actions minutes ran out and stopped every deploy; owner: "switch to google cloud build").
#
# The same job .github/workflows/cloud-deploy.yml did: bring main, taheri-next and House of Mina's main into the
# pushed commit, refuse private keys and customer data, typecheck, test, then push the result to main + taheri-next
# here and to main of gemstrack-pos: both houses together, with no review (owner, 2026-09-27). Nothing is ever
# force-pushed. Two pushes at once: the slower one's push is refused, so it fetches, merges what landed, checks
# again if anything did, and pushes again (up to four times).
#
# The trigger (scripts/cloud/cloudbuild-trigger.json, made by cloudbuild-setup.sh) clones taheri-pos and runs this
# file as main has it, so a branch never changes the deploy that ships it.
#
#   WORKDIR   a clone of taheri-pos (origin), the pushed commit fetched
#   COMMIT    the pushed commit; BRANCH its branch; BUILD the Cloud Build id (for the log link)
#   DEPLOY_TOKEN  a GitHub token that may push both repositories and set commit statuses (Secret Manager
#             github-deploy-token). Never printed: git reads it through this clone's credential helper, curl from a
#             header. Not GH_TOKEN, which a cloud session's shell already sets to its own placeholder.
#   DRY_RUN=1 everything but the pushes. ORIGIN_URL / HOM_URL replace the GitHub remotes (local tests).
set -euo pipefail

REPO=Ammar282828/taheri-pos
HOM_REPO=Ammar282828/gemstrack-pos
ORIGIN_URL=${ORIGIN_URL:-https://github.com/$REPO.git}
HOM_URL=${HOM_URL:-https://github.com/$HOM_REPO.git}
DRY_RUN=${DRY_RUN:-0}
LOG_URL="https://console.cloud.google.com/cloud-build/builds;region=us-central1/${BUILD:-}?project=gemstrack-pos"
export PUPPETEER_SKIP_DOWNLOAD=true
FAIL="failed before the checks"

# The commit's "deploy (Cloud Build)" status on GitHub: what a cloud session reads in place of the Actions run.
status() {
  [ -n "${DEPLOY_TOKEN:-}" ] || return 0
  curl -fsS -o /dev/null -X POST "https://api.github.com/repos/$REPO/statuses/$COMMIT" \
    -H "Authorization: Bearer $DEPLOY_TOKEN" -H "Accept: application/vnd.github+json" \
    -d "{\"state\":\"$1\",\"context\":\"deploy (Cloud Build)\",\"description\":\"$2\",\"target_url\":\"$LOG_URL\"}" || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then echo "ERROR: $FAIL"; status failure "${FAIL:0:130}"; fi' EXIT

cd "$WORKDIR"
if [ -n "${DEPLOY_TOKEN:-}" ]; then
  git config credential.helper '!f() { echo username=x-access-token; echo "password=$DEPLOY_TOKEN"; }; f'
fi
git config user.name "cloud-deploy"
git config user.email "cloud-deploy@gemstrack-pos.iam.gserviceaccount.com"
git remote set-url origin "$ORIGIN_URL"
git remote add hom "$HOM_URL" 2>/dev/null || git remote set-url hom "$HOM_URL"
git checkout -q --detach "$COMMIT"
status pending "Merging main, taheri-next and Mina's main, then the checks"
echo "Deploying $BRANCH at $(git rev-parse --short HEAD)"

fetch() {
  git fetch --quiet origin main taheri-next
  git fetch --quiet hom main
}

# Prints "merged" when anything came in.
merge_in() {
  local ref came=""
  for ref in origin/main origin/taheri-next hom/main; do
    if git merge-base --is-ancestor "$ref" HEAD; then continue; fi
    if ! git merge -q --no-edit -m "Merge $ref into $BRANCH" "$ref" >&2; then
      git merge --abort || true
      FAIL="$ref does not merge cleanly into $BRANCH: rebase the branch on origin/main and push again"
      return 1
    fi
    echo "$ref: merged" >&2
    came=merged
  done
  echo "$came"
}

checks() {
  # gemstrack-pos is public and carries this whole history, so a pasted key is a published key.
  if git grep -lE -- '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'; then
    FAIL="a private key is committed (files above): read it from Secret Manager instead, and delete that key, it is already public"
    return 1
  fi
  # Nor the shop's customers (made-up fixtures use 03xx-0… / 03xx 555…).
  local bad
  bad=$(git ls-files '*.csv'; git ls-files '*.json' | grep -v -e '^node_modules/' -e 'package' -e 'tsconfig' | while read -r f; do
    n=$(grep -oE '(\+92|0)3[0-9]{2}[- ]?[0-9]{7}' "$f" 2>/dev/null | grep -vE '^(\+92|0)3[0-9]{2}[- ]?(0|555)' | wc -l); if [ "$n" -ge 10 ]; then echo "$f ($n phone numbers)"; fi; done)
  if [ -n "$bad" ]; then
    echo "$bad"
    FAIL="customer data is committed (files above): keep exports outside the repo, gemstrack-pos is public"
    return 1
  fi
  FAIL="npm ci failed"; npm ci --no-audit --no-fund --loglevel=error
  FAIL="the typecheck failed"; npx tsc --noEmit -p .
  FAIL="the tests failed"; npm test
  FAIL="failed after the checks"
}

FAIL="could not fetch main, taheri-next or Mina's main"; fetch
merge_in >/dev/null
checks

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: $(git rev-parse --short HEAD) passed; nothing pushed."
  status success "Dry run passed; nothing pushed"
  exit 0
fi

for attempt in 1 2 3 4; do
  FAIL="the push to taheri-pos main + taheri-next was refused"
  if git push --quiet --atomic origin HEAD:refs/heads/main HEAD:refs/heads/taheri-next; then
    FAIL="taheri-pos is live but the push to gemstrack-pos main (House of Mina) was refused"
    if git push --quiet hom HEAD:refs/heads/main; then
      echo "$(git rev-parse --short HEAD) is rolling out to Taheri (taheri-next) and House of Mina (gemstrack-pos main), about 5 minutes"
      status success "Live in both houses as $(git rev-parse --short HEAD), rolling out (~5 min)"
      exit 0
    fi
  fi
  [ "$attempt" = 4 ] && break
  echo "A deploy branch moved on (another push landed first); bringing it in, attempt $((attempt + 1)) of 4."
  sleep $((attempt * 5))
  FAIL="could not fetch main, taheri-next or Mina's main"; fetch
  came=$(merge_in)
  if [ "$came" = merged ]; then checks; fi
done
exit 1
