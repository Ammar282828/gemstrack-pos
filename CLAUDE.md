# taheri-shop — the Taheri POS

Next.js point-of-sale for Taheri Collections (gold and diamond jewellers, Karachi).
Live at **pos.taheri.shop** on Firebase App Hosting, project **`gemstrack-pos`**, backend `studio`.
Forked from House of Mina's GemsTrack-POS (project `hom-pos-52710474-ceeea`); `.firebaserc`
still points at that project and is misleading — Taheri's is `gemstrack-pos`.

The public website is a separate repo: **taheri-site** (github.com/Ammar282828/taheri-site,
`~/Projects/taheri-site`), a Vite app on Hostinger. Read its CLAUDE.md for the site.
Brand facts (name, hours, claims, links, voice) live in `taheri-site/docs/taheri-knowledge.md`.

## Branches and deploys

- Remote is named **`taheri`** (not origin). **`taheri-next` is the branch App Hosting deploys** —
  every push rolls out automatically (~5 min; `gcloud builds list --region us-central1` shows it).
- **`website-checkout`** is the working branch. Keep it level: `git push taheri website-checkout && git push taheri website-checkout:taheri-next`.
- **`main` is dead** — a June lineage that conflicts in 10 files with current work. Never deploy
  from it; don't merge into it without resolving the conflicts deliberately.
- Never trigger builds by hand (REST/console); they jam the queue and a stale site looks like a code bug.

## Running locally

- **Node 20**, not the Mac's default: launch config "POS (node 20)" (`PATH=/opt/homebrew/opt/node@20/bin:$PATH npm run dev`, port 3000). On Node 26 the Google auth library fails ("Premature close").
- The app is behind Google sign-in locally; production runs `NEXT_PUBLIC_OPEN_ACCESS=1` (the owner's
  choice since 2026-09-07, paired with open `firestore.rules`; `firestore.rules.locked` holds the real rules).
  Don't reintroduce the open-access flag for local checks — ask the user to sign in on the preview.
- Typecheck: `npx tsc --noEmit -p .`. ESLint's config is broken (v9); the build is the lint gate.

## Configuration and access

- `apphosting.yaml` holds every env var. A `secret:` it declares **must exist in Secret Manager and
  be readable by the three App Hosting service accounts** (mirror `CRON_SECRET`'s IAM) *before* it is
  declared, or the rollout fails. Names are case-sensitive: the upload secret is `website-upload-secret`.
- Firebase CLI login is broken on the owner's Mac. Use **`gcloud`** (authenticated as the owner):
  `gcloud secrets …`, `gcloud builds list`, `gcloud run revisions list` — all `--project gemstrack-pos --region us-central1`.
  Never print a secret value; compare `sha256` of trimmed values instead.
- Hostinger (the site's server) is reachable over SSH with the deploy key `~/.ssh/taheri_deploy`
  (port 65002, user in `taheri-site/.github/workflows/deploy.yml`). **The key exists only on the owner's Mac** —
  on another device use hPanel or copy the key deliberately.
- The owner is a Firebase/GCP Owner but lacks `iam.serviceAccounts.signBlob`, so `createCustomToken` fails from a laptop;
  test storage layers directly (`npx tsx`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID=gemstrack-pos`).

## How the site and the POS talk

| Route | Who calls it | What it does |
|---|---|---|
| `/api/public/quote`, `checkout`, `order/:id` | taheri.shop | prices at today's rate; bank-transfer checkout; the customer's order page (token link) |
| `/api/public/featured` | taheri.shop | the set of the day (`app_settings/website_featured`), cached 60 s |
| `/api/public/me` | taheri.shop, Bearer Firebase ID token | the customer's record: profile, favourites, orders (`website_customers/{uid}`) |
| `/api/website/photos` | POS page Add Photos | relays a photo to `taheri.shop/api/upload.php` with `WEBSITE_UPLOAD_SECRET`; HEIC → JPEG on the way |
| `/api/website/pieces` | POS page Photo Weights | counter-entered weights (`website_pieces`) for photos with no burned-in label |
| `/api/website/featured` | Photo Weights / Add Photos | set or clear the set of the day |
| `/api/website/orders/[id]` | POS order page | mark paid / shipped — **always verifies a token, even under open access** |

CORS for `/api/public/*` is in `src/lib/website/cors.ts` (taheri.shop, www, and localhost:5180 in dev).
Design and go-live checklist: `docs/website-checkout.md`. Go-live of online selling is still blocked by empty
bank env vars and the open Firestore rules.

## Sharing changes with House of Mina's POS

House of Mina's POS is the same codebase, diverged: repo **gemstrack-pos**
(github.com/Ammar282828/gemstrack-pos, `~/Projects/GemsTrack-POS`, branch `main`, deploys to
pos.houseofmina.store). Common ancestor `b62bab6`; since then the two have been kept in step by
hand and ~40 files have changed on both sides. Until they are reconverged, share a change like this:

1. **One change, one commit, shared code only.** Anything shop-specific (apphosting.yaml, store copy,
   Taheri's website routes, Mina's Shopify/silver) goes in its own commit so it is never picked by mistake.
2. Each repo has the other as a remote (`hom` here; `taheri` there). To carry a commit over:
   `git fetch hom && git cherry-pick -x <sha>` — `-x` writes the source sha into the message, so
   `git log --cherry-mark --right-only website-checkout...hom/main` shows what still needs porting (`+`) and what is already there (`=`).
3. Resolve conflicts in the shop's favour and re-run `npx tsc --noEmit -p .` before pushing.

The real fix is one repo with two App Hosting backends and per-shop differences in config
(`apphosting.<environment>.yaml`, `STORE_CONFIG`) — a one-time reconvergence, not a habit. See the
session notes from 2026-09-22 before starting it.

## Decisions already made (don't reopen unless asked)

- **Add Photos needs no sign-in** under open access — the owner overruled an auth gate on 2026-09-20.
- The order-actions route keeps its always-verify gate: it moves money.
- **Invoices show wastage in grams only** (no rupee value, no percentage); the workshop slip keeps the percentage.
- Copy: never "Najmi Market" or "Saddar" in anything a customer reads; hours are Sat–Thu 11:00–21:00, **Fri 15:30–20:00**.
- Photo Weights' preview draws the weight with the overlay tool's geometry (Futura LT Light, 143/3000 of the width, inset 120/3000).

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
- `graphify` is installed with pipx (`pipx install graphifyy`); `graphify-out/cache/` and the dated backup folders are gitignored, the graph itself is committed.
