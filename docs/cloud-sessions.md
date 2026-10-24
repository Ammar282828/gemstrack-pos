# Cloud sessions

_Moved from CLAUDE.md on 2026-10-21, word for word, to keep it under 20 KB; CLAUDE.md keeps the essentials._

## Cloud sessions (claude.ai/code, since 2026-09-27)

Claude Code runs these repos in the cloud too, with no Mac.
- **One Google credential:** the service account `claude-cloud@gemstrack-pos`. Its JSON key, base64, is the environment
  variable `GCP_SA_KEY_B64` of the claude.ai/code environment (the Mac keeps it in `~/.config/claude-cloud/`, owner-only;
  `environment.env` there is the line to paste). It may read exactly the secrets the backends use (Taheri 13, Mina 14 —
  never `apphosting-github-conn-*`, `waha-dashboard-password`, `DASHBOARD_SECRET`), read/write Firestore in both projects
  (`datastore.user`), call Vertex in gemstrack-pos and Murtaza's `jewelgen-mm-e3d43ecb`, and view App Hosting, Cloud Build,
  Cloud Run, logs and Scheduler in both. **To cut the cloud off, delete its key**
  (`gcloud iam service-accounts keys list --iam-account claude-cloud@gemstrack-pos.iam.gserviceaccount.com`, then `… keys delete`).
  A secret added later needs `roles/secretmanager.secretAccessor` for it on that secret too. It cannot create or list secrets.
  **gcloud in a cloud session:** the environment sets `CLOUDSDK_AUTH_ACCESS_TOKEN` to a placeholder ("proxy-injected") that
  beats the activated account, so every call answers UNAUTHENTICATED — run gcloud as `env -u CLOUDSDK_AUTH_ACCESS_TOKEN gcloud …`
  Node's Google libraries (the ADC file) are unaffected.
- **Every session starts** with `scripts/cloud/session-start.sh` (the SessionStart hook in `.claude/settings.json`, only when
  `CLAUDE_CODE_REMOTE=true`; hooks run in single-repo sessions only, so run it by hand in a multi-repo one): the key becomes the
  machine's default Google credentials (and gcloud's), Node 20 goes first on PATH, and `.env.taheri.local` / `.env.mina.local`
  are written from the YAML with every secret filled (`scripts/cloud/fill-secrets.mjs`; prints counts, never values). The
  environment's setup script is `scripts/cloud/environment-setup.sh` (gcloud CLI), pasted into the environment. Network: Full
  (Meta, WAHA, Green API, Shopify, Magnific and the sites are off the Trusted list).
- **Going live:** a cloud session can push only its own `claude/…` branch. `.github/workflows/cloud-deploy.yml` takes any push to
  `claude/**`, merges `main`, `taheri-next` and gemstrack-pos `main` into it, runs the typecheck and tests, and pushes the result
  to `main` + `taheri-next` here and to gemstrack-pos `main` (a write deploy key there; its private half is this repo's Actions
  secret `HOM_DEPLOY_KEY`): both houses at once, **with no review** (owner, 2026-09-27). A conflict or a failed check stops
  it before any push; nothing is force-pushed. taheri-site and mina-catalogue have their own `cloud-deploy.yml`. In a cloud
  session: commit, push the branch, watch the run; on a conflict, rebase on `origin/main` and push again. "Run workflow" is a dry run.
- **Going live needs Actions minutes.** This repo is private, so every job counts against the account's free 2,000 a month
  (each job rounded up to a minute, a Mac minute as ten). When they run out, every job fails before it starts ("recent account
  payments have failed or your spending limit needs to be increased", on the check run's annotations) and nothing deploys until
  the allowance resets (2026-10-24). Read it with `gh api repos/Ammar282828/taheri-pos/check-runs/<id>/annotations`. Xcode
  Cloud's checks on a commit still report: they are Apple's hours, not GitHub's.
- **Mac only:** SSH to Hostinger (the sites deploy through Actions), Google sign-in to a local ERP (typecheck, tests and the
  gate's `?dev=1` work here), the Mac's memory files (this file is the handoff), GoDaddy / Hostinger API tokens.
