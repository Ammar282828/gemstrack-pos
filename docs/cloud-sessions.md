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
- **Going live:** a cloud session can push only its own `claude/…` branch. Since 2026-10-24 **Google Cloud Build** takes any push to
  `claude/**` (the trigger `deploy-cloud-sessions`, us-central1, gemstrack-pos; `scripts/cloud/deploy.sh`, run as main has it):
  it merges `main`, `taheri-next` and gemstrack-pos `main` into the pushed commit, refuses private keys and customer data, runs the
  typecheck and tests, and pushes the result to `main` + `taheri-next` here and to gemstrack-pos `main`: both houses at once,
  **with no review** (owner, 2026-09-27). A conflict or a failed check stops it before any push; nothing is force-pushed; when two
  pushes race, the slower one merges what landed, checks again and pushes again. It pushes with `github-deploy-token` (Secret
  Manager: a fine-grained GitHub token on both repositories, contents, workflows and commit statuses), as the service account
  `cloud-deploy@gemstrack-pos`. In a cloud session: commit, push the branch, then read the commit's **`deploy (Cloud Build)`**
  status (`gh api repos/Ammar282828/taheri-pos/commits/<sha>/statuses`) or the build (`gcloud builds list --region us-central1`,
  `gcloud builds log <id> --region us-central1`); on a conflict, rebase on `origin/main` and push again. About 4 minutes a deploy,
  inside Cloud Build's 2,500 free minutes a month. Set up once by the owner in Cloud Shell: `scripts/cloud/cloudbuild-setup.sh`.
- **Why not GitHub Actions any more:** this repo is private, so every Actions job counts against the account's free 2,000
  minutes a month (each job rounded up to a minute, a Mac minute as ten). They ran out on 2026-10-24 and every deploy stopped
  ("recent account payments have failed or your spending limit needs to be increased", on the check run's annotations; read them with
  `gh api repos/Ammar282828/taheri-pos/check-runs/<id>/annotations`). `cloud-deploy.yml` (the old deploy, `HOM_DEPLOY_KEY`) now runs
  only by hand. The other workflows (parity, TestFlight status, the Mac build's log) still run on Actions while minutes last. Xcode
  Cloud's checks on a commit are Apple's hours, not GitHub's. taheri-site and mina-catalogue are public: their Actions are free.
- **Mac only:** SSH to Hostinger (the sites deploy through Actions), Google sign-in to a local ERP (typecheck, tests and the
  gate's `?dev=1` work here), the Mac's memory files (this file is the handoff), GoDaddy / Hostinger API tokens.
