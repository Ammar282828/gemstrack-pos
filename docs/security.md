# Security

_Moved from CLAUDE.md on 2026-10-21, word for word, to keep it under 20 KB._

## Security: Mina's repo is public (found 2026-09-27)

- **gemstrack-pos is a public repository** and its `main` is this exact history, so everything here (code, this file,
  every script ever committed) is public; taheri-pos being private protects nothing. Making gemstrack-pos private breaks
  nothing we use: cloud-deploy reaches it over SSH with `HOM_DEPLOY_KEY`, App Hosting through its GitHub app.
- **hom-pos's Firebase admin key was committed** in `scripts/cleanup-shopify-customers.mjs`, `migrate-silver-hisaab.mjs`
  and `pitr-restore-invoices.mjs` (commit 3aea1ff, 2026-09-25) and so published. Those scripts now use
  `applicationDefault()`; the key is still in the history and **must be deleted in IAM**:
  `gcloud iam service-accounts keys list --iam-account firebase-adminsdk-fbsvc@hom-pos-52710474-ceeea.iam.gserviceaccount.com --project hom-pos-52710474-ceeea --managed-by=user`,
  then `… keys delete <KEY_ID>`. It bypasses Firestore rules. The second laptop's Mina `.env.local` may use that key.
  cloud-deploy now refuses a tree with a PEM private key in it (a push from a Mac is not checked).
- Scripts' `client_id`/`client_secret`: the Firebase CLI's public client.
- **Taheri's Firestore is open until the owner publishes `firestore.rules`** in the Firebase console (never the CLI from here): see [Taheri sign-in](docs/decisions.md#taheri-sign-in).
