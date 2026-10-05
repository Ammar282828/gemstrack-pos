# How the site and the ERP talk

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### How the site and the POS talk

| Route | Who calls it | What it does |
|---|---|---|
| `/api/public/prices`, `quote`, `checkout`, `order/:id`, `order/:id/slip` | taheri.shop | the price book (CDN-cached); one-off quotes; placing an online order (`online_orders`, to be confirmed); the customer's order page (token link, ONL- or ORD-); the transfer slip |
| `/api/website/online`, `online/[id]` | ERP Orders → Online — to confirm | list (and `?count=1` for the sidebar); confirm → ORD- order + bank details, or decline with a reason |
| `/api/public/featured` | taheri.shop | the set of the day (`app_settings/website_featured`), cached 60 s |
| `/api/public/me` | taheri.shop and (on Mina's POS) catalogue.houseofmina.store, Bearer Firebase ID token of that house's project | the customer's record: profile, favourites, orders (`website_customers/{uid}`). Favourites must be three-part keys (`isPieceKey`): taheri.shop's `Category/Collection/file`, the catalogue's `mina/piece/<handle>` |
| `/api/website/photos` | POS page Add Photos | relays a photo to `taheri.shop/api/upload.php` with `WEBSITE_UPLOAD_SECRET`; HEIC → JPEG on the way |
| `/api/website/pieces` | POS page Photo Weights | counter-entered weights (`website_pieces`) for photos with no burned-in label |
| `/api/website/featured` | Photo weights / Add photos / Post a piece, through one control (`components/website/set-of-the-day.tsx`: the card, a compact "Now:" line, the per-photo toggle; one state per page) | set or clear the set of the day |
| `/api/website/post` | POS page Post a Piece | GET the community's name/size; POST one image + caption to `WHATSAPP_COMMUNITY_CHAT_ID` and then the channel `WHATSAPP_CHANNEL_ID`, via WAHA, logged in `social_posts`. `/convert` turns HEIC into JPEG for the canvas |
| `/api/website/post/ai` | Post a Piece | Gemini on Vertex (`IMAGE_AI_PROJECT`): `enhance`, `reframe`, `restage`, `letter`, `caption`, `check`. Every image edit is compared with its source ("same piece?"); capped 300 calls/day shop-wide, 60/h per IP |
| `/api/instagram/status`, `connect`, `callback`, `story` | Post a Piece | Instagram Login OAuth → 60-day token in **Secret Manager** (`instagram-token`, renewed on use), locked to `INSTAGRAM_USERNAME`; `story` publishes a 9:16 JPEG |
| `/api/website/post/queue`, `queue/[id]`, `[id]/send`, `queue/tick` | Post a Piece (queue); Cloud Scheduler `social-queue-tick` | several finished pieces kept in `social_queue` (+ images in `social_queue_media`), sent now or at their times — see "Post a Piece queue" below |
| `/api/website/post/health` | Post a Piece | GET: every check + last day's `social_errors` + diagnosis context; POST: the page records a failure |
| `/api/investments` (+ `/[id]/publish`, `/[id]/plan`, `/schedule`, `/api/public/investments/[id]/[kind]`) | the Cowork routine; POS page Investments | file a day's gold post (Bearer ingest token or the POS); send each part; hold/approve a day; the owner's schedule; serve the cards |
| `/api/investments/tick` | Cloud Scheduler `investments-tick` (every 5 min, Bearer `CRON_SECRET`) | send whatever part of today's post the schedule says is due; `?dry=1` sends nothing |
| `/api/website/site-pieces` (+ `/image?id=`) | POS page Posts → Hub (`/posts`) | the house website's pieces (taheri.shop: `catalog-attributes.json`, which carries each photo's page `path`; the Mina catalogue: `catalog-pieces.json`) and when each last went out; a piece's photo as a JPEG from this server (only listed pieces) |
| `/api/website/edits` | POS page Edit a piece | GET: every site piece with the counter's changes (hidden ones too) + recent changes; `?id=` one piece, its last design, its original photo's address. POST: a piece's words / re-made photo / put back → the site's `api/override.php` — see "Edit a piece" below |
| `/api/public/social/[id]` | Instagram's fetcher | serves a story image for the minutes a post takes (Firestore `social_media`, deleted after) — there is no public bucket |
| `/api/website/orders/[id]` (+ `/slips/[slipId]`) | ERP order page, the hub's transfer check | transfer received / lapse / ship / delivered; the slip's file — **always verifies a token** |
| `/api/invoices/[id]/whatsapp` | ERP invoice screen, Send via WhatsApp | the invoice's PDF (drawn in the browser) to its customer from the shop's line, named `Invoice - <customer>` — owner or staff, **always verifies a token**; checks the number is on WhatsApp first |
| `/api/ads/*` (`status`, `connect`, `callback`, `setup`, `overview`, `campaigns`, `object/[id]`, `create`, `images`, `library`, `media`, `preview`, `estimate`, `search`, `audiences`, `rules`, `assistant`, `template`) | POS pages under **Ads** | this house's Meta ad account through the Marketing API (Graph v26.0) — see "Ads" below |

**Counter weights reach taheri.shop per piece** (2026-10-05): a weight entered on any photograph of a piece — Edit a piece lists the extra
angles (`angleOf`) too — is the piece's unless its lead has its own (`lib/website/piece-weights.ts`, `withAngleWeights`), and a drop
the built catalogue doesn't hold yet still carries its weight in the price book (never a price: `posOnlyWeights`). The site keys a
drop's photo from `/catalog-drop-cache/…` and `/api/img.php/…` too (`cart.js pieceKeyFromImage`).

CORS for `/api/public/*` is in `src/lib/website/cors.ts` (taheri.shop, www, and localhost:5180 in dev).
Design, the confirm-first flow and the go-live checklist: `docs/website-checkout.md`. Go-live of online selling
is still blocked by empty bank env vars and the open Firestore rules.

### WhatsApp: WAHA (since 2026-09-25)

Both POS send WhatsApp — alerts, customer messages, Post a Piece, Investments — through **WAHA**, the shop's own
gateway on the `waha` VM in gemstrack-pos (https://35-184-20-165.sslip.io), with +92 326 2275554 linked to it.
`src/lib/whatsapp.ts` uses it when `WAHA_URL` + `WAHA_API_KEY` (secret `waha-api-key`, in both projects) are set and falls
back to Green API otherwise; Green API stays configured until the owner cancels it. WAHA also posts to the WhatsApp
**channel** (`WHATSAPP_CHANNEL_ID`, Taheri's), which Green API never could. Runbook — relinking, resets, updates:
**`ops/waha/README.md`**.

**Numbers from abroad** (2026-10-05): `toWhatsAppNumber` put 92 in front of anything not starting 92 or 0, so every
customer abroad (71 numbers in Taheri's book — US, UK, UAE, Germany…) was dialled as "92 1 415 …". A number written with
"+" or "00" now keeps its own code; only a domestic one gets Pakistan's (`whatsapp-number.test.ts`).

**A local ERP sends for real.** WAHA is the live line whatever Firestore the ERP points at (the emulator included). Test a
send only to the shop's own number: on 2026-10-05 a test invoice to the "fictional" +1 415 555 0100 reached a real
WhatsApp account and had to be deleted for everyone (it was, before it was read).
