# taheri-shop — the POS for both houses

Next.js point-of-sale serving **two shops from one codebase**:

| House | Live at | Firebase project | Backend / environment | Deploys from |
|---|---|---|---|---|
| Taheri (gold and diamond) | pos.taheri.shop | `gemstrack-pos` | `studio` / `taheri` | branch **`taheri-next`** of this repo |
| House of Mina (silver) | pos.houseofmina.store | `hom-pos-52710474-ceeea` | `studio` / `mina` | branch **`main`** of repo **gemstrack-pos** (remote `hom`) |

The two were forks that drifted; they were reconverged on 2026-09-22 and this history is now
the one both deploy from. `.firebaserc` names hom-pos and is only for the Firebase CLI, which is not used.

The public website is a separate repo: **taheri-site** (github.com/Ammar282828/taheri-site,
`~/Projects/taheri-site`), a Vite app on Hostinger. Read its CLAUDE.md for the site.
Brand facts (name, hours, claims, links, voice) live in `taheri-site/docs/taheri-knowledge.md`.

## Branches and deploys

- Remotes: **`taheri`** (this repo, github.com/Ammar282828/taheri-pos) and **`hom`** (github.com/Ammar282828/gemstrack-pos).
  Neither is called origin.
- **`main` is the working branch.** Taheri deploys from `taheri-next`, Mina from `hom`'s `main`; both are
  pushed *from* `main` (see below). Every push to a deploy branch rolls out automatically
  (~5 min; `gcloud builds list --region us-central1 --project <project>` shows it).
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
  A variable with `value: ""` also fails the rollout ("either 'value' or 'secret' field is required") — write
  a word the code reads as off (`"none"`, `"0"`) instead.
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
| `/api/public/me` | taheri.shop and (on Mina's POS) catalogue.houseofmina.store, Bearer Firebase ID token of that house's project | the customer's record: profile, favourites, orders (`website_customers/{uid}`). Favourites must be three-part keys (`isPieceKey`): taheri.shop's `Category/Collection/file`, the catalogue's `mina/piece/<handle>` |
| `/api/website/photos` | POS page Add Photos | relays a photo to `taheri.shop/api/upload.php` with `WEBSITE_UPLOAD_SECRET`; HEIC → JPEG on the way |
| `/api/website/pieces` | POS page Photo Weights | counter-entered weights (`website_pieces`) for photos with no burned-in label |
| `/api/website/featured` | Photo Weights / Add Photos | set or clear the set of the day |
| `/api/website/post` | POS page Post a Piece | GET the community's name/size; POST one image + caption to `WHATSAPP_COMMUNITY_CHAT_ID` and then the channel `WHATSAPP_CHANNEL_ID`, via WAHA, logged in `social_posts`. `/convert` turns HEIC into JPEG for the canvas |
| `/api/website/post/ai` | Post a Piece | Gemini on Vertex (`IMAGE_AI_PROJECT`): `enhance`, `reframe`, `restage`, `letter`, `caption`, `check`. Every image edit is compared with its source ("same piece?"); capped 300 calls/day shop-wide, 60/h per IP |
| `/api/instagram/status`, `connect`, `callback`, `story` | Post a Piece | Instagram Login OAuth → 60-day token in **Secret Manager** (`instagram-token`, renewed on use), locked to `INSTAGRAM_USERNAME`; `story` publishes a 9:16 JPEG |
| `/api/website/post/queue`, `queue/[id]`, `[id]/send`, `queue/tick` | Post a Piece (queue); Cloud Scheduler `social-queue-tick` | several finished pieces kept in `social_queue` (+ images in `social_queue_media`), sent now or at their times — see "Post a Piece queue" below |
| `/api/website/post/health` | Post a Piece | GET: every check + last day's `social_errors` + diagnosis context; POST: the page records a failure |
| `/api/investments` (+ `/[id]/publish`, `/[id]/plan`, `/schedule`, `/api/public/investments/[id]/[kind]`) | the Cowork routine; POS page Investments | file a day's gold post (Bearer ingest token or the POS); send each part; hold/approve a day; the owner's schedule; serve the cards |
| `/api/investments/tick` | Cloud Scheduler `investments-tick` (every 5 min, Bearer `CRON_SECRET`) | send whatever part of today's post the schedule says is due; `?dry=1` sends nothing |
| `/api/website/site-pieces` (+ `/image?id=`) | POS page Posts → From the website | the house website's pieces (taheri.shop: `catalog-attributes.json`, which carries each photo's page `path`; the Mina catalogue: `catalog-pieces.json`) and when each last went out; a piece's photo as a JPEG from this server (only listed pieces) |
| `/api/public/social/[id]` | Instagram's fetcher | serves a story image for the minutes a post takes (Firestore `social_media`, deleted after) — there is no public bucket |
| `/api/website/orders/[id]` | POS order page | mark paid / shipped — **always verifies a token, even under open access** |

CORS for `/api/public/*` is in `src/lib/website/cors.ts` (taheri.shop, www, and localhost:5180 in dev).
Design and go-live checklist: `docs/website-checkout.md`. Go-live of online selling is still blocked by empty
bank env vars and the open Firestore rules.

## WhatsApp: WAHA (since 2026-09-25)

Both POS send WhatsApp — alerts, customer messages, Post a Piece, Investments — through **WAHA**, the shop's own
gateway on the `waha` VM in gemstrack-pos (https://35-184-20-165.sslip.io), with +92 326 2275554 linked to it.
`src/lib/whatsapp.ts` uses it when `WAHA_URL` + `WAHA_API_KEY` (secret `waha-api-key`, in both projects) are set and falls
back to Green API otherwise; Green API stays configured until the owner cancels it. WAHA also posts to the WhatsApp
**channel** (`WHATSAPP_CHANNEL_ID`, Taheri's), which Green API never could. Runbook — relinking, resets, updates:
**`ops/waha/README.md`**.

## Two houses, one codebase — the rules

- **Every difference between the shops is a variable, never a fork of the code.** The code's
  defaults are Taheri's. `apphosting.yaml` holds only what both houses share; `apphosting.taheri.yaml`
  and `apphosting.mina.yaml` hold everything that differs and are applied by App Hosting on top of the base
  for the backend whose environment name matches (an override can add or replace a variable, never remove one —
  so nothing goes in the base that only one house wants). Mina's file states every value its old fork had
  baked into code; leave one out and Mina comes up wearing Taheri's name.
- What the variables drive: `src/lib/store-config.ts` (name, contacts, bank, links, allowed emails,
  default metal, margin, **brand**, logo and its aspect, **counter staff** for "Taken by"); `globals.css`
  (`.dark .brand-mina:not(.theme-default)` is Mina's dark palette — muted burgundy with the catalogue's dusty rose
  #E8A5AE as the accent, 2026-09-25 — and `.brand-mina.theme-default` gives its light theme Mina's maroon #380000; Taheri's
  dark is the plain `.dark`. A palette block on <body> must re-declare the `--sidebar-*` vars, which otherwise resolve on
  <html> to Taheri's colours. Each house's logo has a white cut for dark grounds, `NEXT_PUBLIC_STORE_LOGO_LIGHT_URL`:
  `taheri-logo-light.png` by default, Mina's `house-of-mina-logo-light.png`); `layout.tsx`
  (brand class, theme-colour, links host); `app-layout.tsx` (the Website menu exists only when
  `NEXT_PUBLIC_STORE_WEBSITE_URL` is set; **Shareholder Finances** and "paid by Mina/Ammar" on an expense only when
  `NEXT_PUBLIC_STORE_PARTNERSHIP=1` — Mina's partnership book, whose ledgers live in Mina's Firestore);
  `voice/gemini.ts` (`VERTEX_PROJECT` bills Mina's voice to Taheri's project); the Website menu's **Photo Weights**
  and Add Photos' **Feature today** follow `NEXT_PUBLIC_STORE_WEBSITE_WEIGHTS` / `_FEATURED` (default on; Mina's
  catalogue has neither, so its file sets both to "0" at go-live); **Post a Piece** and **Investments** follow
  `NEXT_PUBLIC_STORE_POST_PIECE` / `_INVESTMENTS` (Taheri's accounts and series; Mina sets both "0", which hides the menu
  entries and pages and makes their routes answer 404 — owner, 2026-09-25: "why are taheri features in mina pos").
- A `secret:` in the base must exist in **both** projects; one in a house file only in that project.

**Shipping a change to both houses:**
```
git push taheri main:taheri-next     # Taheri rolls out (~5 min)
git push hom main:main               # House of Mina rolls out
```
Push Taheri first, check it, then Mina. `main` here is the shared working branch (the old dead
`main` is kept as tag `old-main-2026-06`). `website-checkout` is retired.

**Running a house locally:** `npm run env:taheri` or `npm run env:mina` writes `.env.<house>.local`
from the YAML files (secrets left blank to fill from Secret Manager), then `npm run dev:taheri`
(port 3000) or `npm run dev:mina` (port 3001). `.env.local` is a hand-kept Taheri file that plain `npm run dev` uses.
Next reads `.env.local` / `.env.development.local` even under `dev:mina` and fills any variable the process lacks, so the
generator writes every variable that isn't the house's as **empty** (Next then leaves it alone). Re-run `npm run env:mina`
after changing either YAML — a stale `.env.mina.local` is how a local Mina showed Taheri's Post a Piece, Investments and
Photo Weights on 2026-09-25.

## House of Mina's catalogue (catalogue.houseofmina.store)

A separate site in its own repo, **mina-catalogue** (`~/Projects/mina-catalogue`, github.com/Ammar282828/mina-catalogue,
private) — built 2026-09-23; read its CLAUDE.md. It publishes `catalog-tree.json`, and `/api/website/photos` reads a
site's own tree before anything else (taheri.shop publishes none, so Taheri's picker is unchanged).
**Live on the server since 2026-09-23** (Hostinger website created through the Hostinger API on the Business plan,
order 1008754559, beside taheri.shop; first deploy shipped 2,319 files). Mina's `apphosting.mina.yaml` carries the
website variables and `WEBSITE_UPLOAD_SECRET` (hom-pos Secret Manager, same value as
`~/domains/catalogue.houseofmina.store/.website-upload-secret`; sha256 prefix `c6701cb1`). DNS was added through the
GoDaddy API (`A catalogue → 145.79.26.82`; houseofmina.store's DNS stays at GoDaddy) and Hostinger issued the
certificate itself; the site is **live over HTTPS** and Mina's Add Photos reads its categories from it — since
2026-09-23 five, one level, like taheri.shop's (Rings & Bands, Wristwear, Chains & Pendants, Sets, Earrings), each
offered as one folder `Category/Category`, plus a **Men's** section with four sub-folders (`Men's/Men's Rings`,
`Men's/Natural Ruby Rings`, `Men's/Men's Chains`, `Men's/Men's Bracelets & Cuffs`)), and since 2026-09-24 **Wristwear** with three
(`Wristwear/Bangle & Ring Sets`, `Wristwear/Bangles & Cuffs`, `Wristwear/Bracelets`; an old `Wristwear/Wristwear` drop is
sorted by its file name). Add Photos names and links to **this house's** website
(`NEXT_PUBLIC_STORE_WEBSITE_URL`; a site tree's `path` when it gives one), never a hardcoded taheri.shop.
`KNOWN_TREE` in the photos route is taheri.shop's folder list and is only ever offered for that origin.
Since 2026-09-25 the catalogue has **customer accounts** like taheri.shop's (Google sign-in on hom-pos's own Firebase
project; `catalogue.houseofmina.store` added to its authorised domains), talking to Mina's POS `/api/public/me` — no POS
change was needed (Mina's `WEBSITE_ORIGIN` already allows the catalogue; see the table above for the key shape).

## Open items after the reconvergence (2026-09-22)

- `NEXT_PUBLIC_STORE_TAKEN_BY` in `apphosting.mina.yaml` is a guess (Mina, Ammar, Murtaza) — Mina's fork never had
  "Taken by". Ask the owner for Mina's counter names and correct it.
- `website-checkout` is retired but not deleted; delete it once nobody has it checked out elsewhere.
- Mina's `firestore.rules` and Taheri's differ (Taheri's are open); App Hosting does not deploy rules, so each
  project keeps whatever was last deployed with the Firebase CLI.

## Decisions already made (don't reopen unless asked)

- **Add Photos needs no sign-in** under open access — the owner overruled an auth gate on 2026-09-20.
- The order-actions route keeps its always-verify gate: it moves money.
- **Invoices show wastage in grams only** (no rupee value, no percentage); the workshop slip keeps the percentage.
- Copy: never "Najmi Market" or "Saddar" in anything a customer reads; hours are Sat–Thu 11:00–21:00, **Fri 15:30–20:00**.
- Photo Weights' preview draws the weight with the overlay tool's geometry (Futura LT Light, 143/3000 of the width, inset 120/3000).
- Number fields (`AmountInput`) select their contents on focus, and the sale-flow ones (order items, product form,
  cart edit) show a 0 as blank (`zeroAsEmpty`) — the counter asked for no pre-filled zeros to delete.
- **Repairs** (`/repairs`, under Invoices): a ticket = one customer + **any number of pieces** (piece, what to do,
  weight, price) + ready-by + optional advance; karigar / taken by / shop note fold away under "More". Deliberately
  simple (owner's ask): three steps, **In the shop → Ready → Collected** — Ready is one tap, Hand back only takes the
  balance. `REP-000001` numbering from `lastRepairNumber` in settings. Money taken is written to **Extra Revenue** in
  the same transaction with `repairId`; deleting a repair deletes those rows. Receipt: `src/lib/repair-pdf.ts`.
- **Analytics money reads in lac and crore** (`src/lib/money.ts`: `pkrLac`, `lacCrore`, `axisLac`): exact below 1 lac,
  then `4.5 lac` / `1.25 crore` to two decimals, chart axes `50k · 2.5L · 1.2Cr`. Grams, tola and counts are untouched.
- In a component, no hook after an early `return` (the `/orders/add` crash of 2026-09-22 was exactly that).
- **One invoice PDF builder**: `src/lib/invoice-pdf.ts` (`saveInvoicePdf`) draws the customer's copy for the invoices list,
  the cart's post-sale screen and `/view-invoice`. `perPiece` prints a multi-piece invoice as one invoice per piece on its
  own page ("Piece 2 of 3"); discount, exchange, adjustments and paid are shared pro rata by piece price, the last piece
  absorbs rounding, payment history is left off the pieces. The split button is `components/shared/print-button.tsx`.
- **Post a Piece** (`/website/post`, 2026-09-24): photos + headline + weight → a 1080×1920 Instagram story drawn on a canvas in
  the shop's story style (photo full bleed, Sofia Sans Extra Condensed 800 headline, Figtree weight/details line
  `21K Yellow Gold | Stones | 45.350g`, wordmark top-right; `src/lib/social/story.ts`), the WhatsApp caption
  (`src/lib/social/caption.ts`: the jewelry-post format **without the address**), and the website photo **stamped with the
  weight** in the overlay tool's geometry (Futura LT Light, `public/fonts/futura-lt-light.woff2`). Stamping, not
  `website_pieces`, because a just-dropped photo is not in `catalog-attributes.json` yet and `/api/website/pieces` refuses it.
  Publish sends to the website (Add Photos relay; per-photo Site/WA ticks), set of the day, the Instagram story (when
  connected) and the community's **announcements group** (`120363360668200388@g.us`, Green API line +92 326 2275554 is
  admin) after a confirm. The WhatsApp channel is **share-sheet by hand** (owner's choice); Green API documents no channels.
  **AI** (owner: "extremely advanced", 2026-09-24): Enhance, Extend to 9:16/4:5/1:1, New setting (7 scenes from the shop's own
  stories + free text), Make it with AI (caption + plan + re-staged 9:16), AI lettering (read back and verified), Write with
  AI (WhatsApp + Instagram captions; the route rebuilds the caption frame if the model drops the weight or a number).
  Prompts in `src/lib/social/prompts.ts` follow the nanobanana rules (piece first, never name the metal, avoid-list last).
  Models: `gemini-3-pro-image` (Nano Banana Pro; the `-preview` name 404s on Vertex now), `gemini-3.1-pro-preview`,
  `gemini-3.8-flash`. **Billing:** Murtaza's project `jewelgen-mm-e3d43ecb` (owner offered it); this Mac's ADC
  (potatomasta501) has no access there, so local dev signs AI calls with `IMAGE_AI_CREDENTIALS` =
  `~/.config/gcloud/legacy_credentials/mmurtaza1970@gmail.com/adc.json` in `.env.development.local`. Production needs
  `roles/aiplatform.user` for `firebase-app-hosting-compute@gemstrack-pos` on that project. Timings: an image op ≈ 40–65 s
  incl. the check, captions ≈ 30 s (Cloud Run timeout is 300 s). **Instagram** needs a Meta app (Instagram Login, dev mode,
  @collectionstaheri as tester), `INSTAGRAM_APP_ID`, secret `instagram-app-secret`, redirect
  `https://pos.taheri.shop/api/instagram/callback`, and secret `instagram-token` with secretAccessor + secretVersionAdder
  for the runtime account.
- **Post a Piece checks** (2026-09-25, owner: "thorough checks … with a very obvious solution"): `src/lib/social/health.ts`
  tests every dependency live (site up; upload key via an empty POST to upload.php — 400 = key right, 401 = wrong; set of
  the day; Green API signed in, line is admin of the community, send queue; Instagram app set, token-secret IAM, token
  valid + days left + publishing quota, public image route reachable; AI ping + image model served + today's cap) and
  `src/lib/social/diagnose.ts` turns any error into title + fix + action (link or gcloud command), with the real messages
  from setup pinned in tests. Failures are logged to Firestore `social_errors` (server routes log their own; the page
  reports website/featured failures). The panel sits atop the page; the publish confirm lists failing checks for the
  chosen destinations. Locally the website checks fail — this Mac can't resolve taheri.shop — not a real outage.
- **Story editor** (2026-09-25, owner: "a lot more features and freedom in prompts and positions"): the story is a layer
  document (`src/lib/social/editor.ts`: text bound to the piece's fields or free, wordmark, arrow/line/circle/box, photo
  insets; presets Left stack / Centred / Split / Bottom / Headline only; fonts condensed, Figtree 300/400/700, Bodoni Moda,
  Futura) edited in `src/app/website/post/story-editor.tsx` (tap to select, drag, corner to resize, top dot to rotate,
  pinch, centre/margin snapping, undo/redo, layouts saved per device). AI prompts: Ask AI (free instruction, op `custom`),
  every prompt editable before sending (`rawPrompt`), a brief for Make it with AI (`sceneBrief`), a style for AI lettering.
  **Instagram music:** the API can't add music; Share story opens Instagram's own editor for the music sticker. A video
  story with a licensed track baked in was offered, not built (owner to choose).
- **WhatsApp and taheri.shop only ever get 1:1** (owner, 2026-09-25). The page has two editors on one component: **Story
  9:16** (Instagram) and **Square 1:1** (WhatsApp + website): one set of square layers for every ticked photo, a crop per photo
  (`StoryDoc.placements`), rendered with `renderDocTo` at up to 3000 px for the site and 1600 px for WhatsApp. Square presets
  (`SQUARE_PRESETS`): weight + wordmark (the overlay tool's geometry — weight top-left in Futura LT Light, the mark bottom-right,
  both **auto colour** per photo), weight + t mark, weight only, name + weight + wordmark (Didone italic like the grid posts), clean.
  **Marks are SVGs** (owner: "the logo should be an svg so I can change colour"): `public/brand/taheri-wordmark.svg` (from
  taheri-post-kit/taheri_logo.svg, cropped to its letters) and `public/brand/taheri-t.svg` (the t monogram), filled with any
  colour through their shape (`drawMark`); `NEXT_PUBLIC_STORE_MARK_SVG` / `_MONOGRAM_SVG` per house (Mina: its PNG logo, no
  monogram). A text "TAHERI / COLLECTIONS" stamp was tried and rejected. WhatsApp no longer offers "send the story image".
- **The designer** (2026-09-25, owner: "add canva like design functionality to the story and post editor", then "OPTIMIZE HEAVILY
  FOR MOBILE, ALSO FOR DESKTOP"): **Design** on the story or the square opens a full-screen, Canva-style editor of the same document
  (`Designer` in `story-editor.tsx`; panels in `editor-panels.tsx`; shapes, frames, photo filters, align/distribute and magnetic
  guides in `src/lib/social/design.ts`, tested). Rail: Templates (thumbnails drawn from the real piece via `previewPreset`), Elements
  (shapes, lines, frames = a photo cut to a shape, stickers, the marks), Text (heading/subheading/body, the bound fields, font
  combinations), Photos & uploads (uploads stored as data URLs so saved layouts carry them), Brand, Layers, Background. Selection
  toolbar, 8 text effects + curved text, filters by pixel maths (Safari has no `ctx.filter`), multi-select/group/lock, copy/paste
  between story and square, PNG/JPG download, 5 extra fonts (`fonts.ts`, loaded on first use). **Phones:** bottom bar = the rail or
  the selection's tools; panels are bottom sheets and the design refits above them and above the keyboard (`visualViewport`);
  long-press = menu; tap selected words again = type; two-finger pinch + twist; the typing box is never under 16 px (iOS zooms into
  smaller fields). The app's global coarse-pointer rule gives every `<button>` `min-height: 2.75rem` — round buttons need
  `min-h-0` — and `[@media(pointer:coarse)]:` classes must be written out literally (Tailwind can't see interpolated ones).
  Checked in headless Chrome as an iPhone and at 1440 px (puppeteer with the Mac's own Chrome as `executablePath`; the cached
  puppeteer Chrome is broken) through the gate's dev-only `?dev=1`.
- **Story + post together** (2026-09-25, owner: "the workflow is usually story and post together … optimize this workflow, allow for
  either or workflows"): Post a Piece opens on **Story + post / Story only / Post only** (`FormatPicker`, remembered per device in
  `taheri_post_formats`); the choice hides the other design and everything only it needs (website + WhatsApp cards, caption and Site/WA
  ticks for the post; the Instagram card and story AI for the story) and gates `siteOn`/`waOn`/`igOn`. Both designs live in one
  `PairEditor` (`story-editor.tsx`): live thumbnails of each as tabs, one open in the small editor, one designer with a Story/Post switch
  in its header, and **Copy to the post / story** on any selection (`carryLayers` in `editor.ts`, tested: same place on the page, ×0.75
  going to the square, never bigger going back). The starred photo leads both (the post follows it). A story Instagram won't take by
  itself (not connected — always on Mina — or switched off for music) is Publish's last step, **by hand** (a Share button in the step
  list); story only then makes the main button "Share the story"; the queue refuses until it has been shared or saved (it would be lost
  when the page clears). "Save the story and the post" hands every image to the share sheet at once (Photos on a phone).
  **Layout** (owner: "quite cluttered and hard to navigate"): five numbered steps — Photos, The piece, The story and the post, Where it
  goes, Send. On a phone they run in that order (the two columns are `contents` below `lg`, sections carry `order-*`), so the designs
  show right after the headline; on a computer 3 and 5 sit beside the form. Folded until asked for: the piece's metal/stones/small line
  ("More details"), the website name ("Change"), the caption's extra line, the editor's "Photo & colours". One tool row per design
  (Layouts · Add · AI menu · Design; the AI menu holds Make the whole story, New setting, Extend, Ask AI, AI lettering and "remove tags");
  "From your phone" is one button plus a More menu.
- **Posts → From the website** (`/website/from-site`, 2026-09-25; owner: "give me an option to take any post from taheri.shop (or
  randomize) … add the post link to whatsapp community from right there", then the same for House of Mina): opens on **New arrivals**
  (owner: "by default show new arrivals"; `src/lib/website/new-arrivals.ts`, tested — the catalogue's own shelf, `newArrival` in
  `catalog-pieces.json`; taheri.shop: added in the last 30 days, never fewer than the newest 24, from the `added` each photo carries in
  `catalog-attributes.json` since taheri-site 72bcde3), everything newest first; search, collection chips,
  **Shuffle** (skips pieces sent in the last 30 days — `social_posts.sitePiece`), the photo as it is on the site (it already carries the
  house's marks: weight top-left + wordmark top-right on taheri.shop, the MINA mark on the catalogue), the caption from `sitePieceCaption`
  (name, weight, facts, 🌐 the piece's link, then `NEXT_PUBLIC_STORE_POST_FOOTER` or "Ask for today's price" + numbers; Mina also
  `_POST_TAGLINE`), **Write with AI** for both houses (`/api/website/site-pieces/caption`: the model writes only a line and the facts, in
  the house's voice with its own community posts as examples; the POS builds the frame), a **weight overlay** (stampPhoto, on by default
  only where the site photo doesn't show the weight — `weightSource !== 'label'`), and where it goes: any of the community's groups
  (`WHATSAPP_POST_GROUPS`, Label=chat id; Taheri: Announcements, Diamonds, Gemstones, Investments, Exclusives, Watches), the channel, or
  **Both** — `/api/website/post` with `targets` (keys, never chat ids; Post a Piece sends with `targets` too since 2026-09-25).
  Mina's POS got the page as a port onto its branch (c045a60; recorded in main with a `-s ours` merge, the other session's way).
  Both sites were changed to publish links: taheri-site's prerender adds `path` to `catalog-attributes.json` (2,565 of 2,601 photos have a
  page); mina-catalogue's prerender writes `catalog-pieces.json` (599 pieces). `NEXT_PUBLIC_STORE_SITE_POSTS` (default on); Mina's
  community is `120363422611483809@g.us`. The community's own posts were read through WAHA to match their look.
- **Post a Piece: channel tick, queue, and House of Mina** (2026-09-25, owner: "make a post on houseofmina pos also, same style" /
  "incorporate channel option and bulk sending"). Where the squares go is a tick per destination — the community's groups
  (`WHATSAPP_POST_GROUPS`) and the channel, first group + channel on by default — and each is its own publish step, sent with `targets`,
  so a failure is retried alone. **Queue** ("several pieces in one go"): *Add to queue* renders the piece exactly as Publish would (site
  squares ≤ 3000 px, WA squares 1600 px, story, a 240-px thumb), uploads them to `social_queue` / `social_queue_media` (900 KB parts) and
  clears the page; the panel then does **Send all now** (one confirm; the page calls `/queue/[id]/send` per piece) or **Spread over the
  day** (evenly between two times, default now+10 min → 30 min before closing; per-piece time / hold / remove). Server:
  `src/lib/social/queue.ts` (claim in a transaction, every single send recorded in `done`, so a retry sends only what didn't go;
  `sendItem` takes fake senders for tests), pure planning in `queue-plan.ts` (tested). The tick (`/api/website/post/queue/tick`, Cloud
  Scheduler `social-queue-tick` every 5 min in **both** projects, Bearer `CRON_SECRET`) sends due pieces, three tries, and sweeps
  drafts > 6 h and sent pieces > 7 days. Website relay and Instagram story are shared helpers (`src/lib/website/upload.ts`,
  `src/lib/social/story-post.ts`). **House of Mina** has Post a Piece (`NEXT_PUBLIC_STORE_POST_PIECE "1"`): catalogue + community
  announcements from its own line, no Instagram app, no channel, no set of the day; the caption and "Write with AI" close with
  `_POST_TAGLINE` / `_POST_FOOTER` in Mina's voice (`captionSystem(shop, house)`); its AI bills to Murtaza's `jewelgen-mm-e3d43ecb`
  like Taheri's (`IMAGE_AI_PROJECT` in `apphosting.mina.yaml`; `firebase-app-hosting-compute@hom-pos-52710474-ceeea` was granted
  `roles/aiplatform.user` there, with the mmurtaza1970 gcloud account on this Mac). Mina's voice stays on `VERTEX_PROJECT`.
  Locally both houses sign AI with Murtaza's ADC (`IMAGE_AI_CREDENTIALS`, which `env-for-house` never blanks).
- **Investments by Taheri in the POS** (`/website/investments`, 2026-09-25): the daily gold post is written by the owner's
  scheduled **Cowork routine on claude.ai** ("Investments by Taheri — daily post", 11:00; not editable from Claude Code) whose last
  step POSTs the four deliverables to `/api/investments` (multipart post/teaser/square/story, `Authorization: Bearer` the token in
  `taheri-post-kit/.pos-ingest-token` = secret `investments-ingest-token`). Filed per day in `investment_posts/{date}` + cards in
  `investment_media` (JPEG ≤ 900 KB). The page sends: post + square → `INVESTMENTS_GROUP_CHAT_ID` (120363362406867247@g.us, 469,
  admin-only, line is super admin; caption if ≤ 1024 chars else card then text), teaser → community announcements, story →
  Instagram (`/api/public/investments/[id]/story` via hosted.app). Each target once; resend asks. Manual add on the page too.
  **Automatic sending** (2026-09-25, owner: "automate the investment by taheri post sending … decide and choose when and how often"):
  the owner's schedule (`app_settings/investments_schedule`, rules in `src/lib/investments-schedule.ts`, tested) — on/off, days of the
  week, per part (group, **channel** — the post + card to `WHATSAPP_CHANNEL_ID`, WAHA only — teaser, Instagram) on/off and a Karachi
  time or "as soon as it arrives", a late cut-off, and "send by itself" or "wait for my OK". Cloud Scheduler job `investments-tick`
  (us-central1, `*/5 * * * *` Asia/Karachi, Bearer `CRON_SECRET`; the Cloud Scheduler API was enabled for it) calls `/api/investments/tick`,
  which sends only today's post, each part once (a Firestore-transaction claim guards overlaps), tries a failure three times, and writes
  `lastTick` (the page warns when it's over 15 min old). Ships **off**. Per day: Hold / Let it send, Approve, Try again; **Send all**
  sends every unsent part in order after one confirm. Both paths share `src/lib/investments-send.ts`.
- **.shop outage 2026-09-24 ~16:18 UTC:** GMO Registry answered NXDOMAIN for every .shop domain (taheri.shop, pos., links.).
  The POS stayed usable at **https://studio--gemstrack-pos.us-central1.hosted.app** (App Hosting's own address; open access,
  data loads). Instagram fetches story images from `SOCIAL_MEDIA_ORIGIN` (that address) so posting never depends on .shop.
- **Light / dark is per device** (owner, 2026-09-25: "switching is buggy"): the sun/moon in the top bar sets this device's
  mode (`gemstrack:theme-device` in localStorage, `writeDeviceTheme` in `src/lib/theme-cache.ts`) and switches at once; the
  **Shop mode** in Settings (Firestore, live on every screen) only decides devices that never chose. `<html>` carries `.dark`
  **only on the dark palette** now (`applyThemeToDocument`, and the boot script before paint) — it used to be there always, so
  every `dark:` style showed in light mode — plus `color-scheme` and the first-paint class, kept in step on every switch.
- **Exchange gold is one set of rows everywhere** (2026-09-25, owner: "make the exchange gold field uniform and add the
  ability to add another"): `components/shared/exchange-rows.tsx` in the order form and the cart — what it is, karat, grams,
  rate/g, value (grams × rate until typed), **Add another exchange**. Stored as `exchanges` on orders and invoices
  (`lib/exchange.ts`); every write also keeps the old fields as totals (`advanceInExchangeValue`/`Description` on orders,
  `exchangeAmount1` + `exchangeDescription` on invoices), so balances, analytics, Shopify and the per-piece split read them
  unchanged. Old documents are read through `orderExchanges` / `invoiceExchanges`. PDFs and the order slip print a line each.
- **An order carries everything to its invoice** (2026-09-25, owner: "carry over all details from order to invoice, such
  as advances, exchange gold"): exchange rows become the invoice's exchange (off its total, like the cart), each cash
  advance a payment of its own with its date and method (`orderAdvancePayments` in `lib/order-payment.ts`; `Order.advances`
  is written by Record an advance, `advanceMethod` by the order form), plus discount, taken by, delivery, notes (as the
  invoice's never-printed `internalNote`), hide-rates, source and item plating. Until then exchange and advances were one
  lumped "Advance from Order" payment. Re-saving an invoice from the cart keeps `sourceOrderId`, Shopify links and source
  (`INVOICE_PROVENANCE`). Payments can also be taken in the cart as the invoice is written (`generateInvoice(…, payments)`).
- Every dropdown with 7+ options (`Select`, `SearchablePicker`) shows this device's last five picks under **Recent**
  (`src/lib/recents.ts`, localStorage). Items are *moved* up, never duplicated — Radix prints a duplicated selected
  value twice in the trigger. Lists that change over time carry a `recentsKey`; the karigar picker opts out (it ranks itself).

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
- `graphify` is installed with pipx (`pipx install graphifyy`); `graphify-out/cache/` and the dated backup folders are gitignored, the graph itself is committed.
