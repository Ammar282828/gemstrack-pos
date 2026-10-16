# Ad studio

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

> **Split and moved to Design (2026-10-12, WP7; [docs/features/design.md](design.md)).** The Studio is no longer an Ads tab.
> **Plan** (what to run, ad days & rules, competitors) is **Ads › Plan** (`/ads/plan`, `?s=plays|guide|rivals`, `src/app/ads/plan/`).
> **Photos, Make, Board and Saved** are **Posts › Design** sections (`?v=photos|make|board|saved`); `board.tsx`, `library.tsx` and
> `studio-kit.tsx` moved to `src/app/design/` unchanged, and Make and Saved are Design's workspace and shelf. `/ads/studio?v=…`
> redirects (table in design.md). "Make it with AI" (an art-directed layout, a painted ad) and the lettering check are Design's AI panel
> now, and `/design/classic/ad` redirects there; the old `maker.tsx`, `post-it.tsx`, `saved.tsx` are deleted. **Every `/api/ads/studio/*` and
> `/api/studio/mcp` route is unchanged** (the iPhone app and the board's agent call them). Below, "the Studio" means those parts.

### Ad studio

- **Ad studio** (`/ads/studio`, an Ads tab; both houses — `NEXT_PUBLIC_STORE_AD_STUDIO` (Mina "1" since the evening of 2026-09-29); 2026-09-29, owner: "a curated
  ad analysis guide + maker + competitor searcher + builder for just taheri … assessing all images from taheri.shop and from my
  google drive … recommend, fix, assess and build + help create like in canva ad creatives"). Sections are `?v=`:
  **Picks · Library** — every taheri.shop photo (`getSitePieces`) and every image in the Drive folders shared with the server's own
  service account (`lib/ads/studio/drive.ts`: `sharedWithMe`, walked recursively, logos kept aside, HEIC → JPEG, cached 10 min;
  `/api/ads/studio/image` serves any of them). Each is assessed once by the vision model (`assess.ts`, **ten photos a call** at 640 px
  — the Vertex key's per-minute quota made one a call a day's work; `/api/ads/studio/assess` runs ~200 s slices while the page is
  open, capped `AD_STUDIO_DAILY_CAP` 400 calls) into `ad_assets` (`assessment.ts`, tested: score, fit per 1:1/4:5/9:16, quality,
  burned-in text, brand risks, fixes, a headline); `rankForAds` makes the picks. A photo's sheet runs its fixes through Post a
  Piece's `/api/website/post/ai` (extend 4:5/9:16, clear labels, enhance, retouch, new setting — each checked "same piece?"),
  chaining on the version shown. **Make** — Post a Piece's `SoloEditor` + designer on a Meta frame (`templates.ts`: 4:5, 1:1,
  9:16, 1.91:1 drawn 1080×565 and exported 1200×628; six layouts in the vault's dress; stories keep words, piece and mark between
  the top 14% and bottom 35%, which are shaded). **taheri.shop's photos carry a burned-in wordmark**, so the layouts add none to
  them (`photoMarked`) until an edit that clears labels (the check flagged the double mark on the first run). AI words
  (`/api/ads/studio/copy`, `breaksHouseRule` drops any karat, weight, price, "shop now", hashtag or number after the model), a
  pre-flight check (`/check`: the rules one by one, craft, fixes, and the sacred days the run would cross — decided by
  `calendar.ts`, not the model), then **Use it in a new ad**: `/api/ads/images` + `ad_studio_creatives`, and `/ads/new?studio=<key>`
  reads the picture and words from sessionStorage (`lib/ads/studio/handoff.ts`). **Competitors** (`research.ts`, `ad_competitors`):
  found by Gemini with Google Search (flash model, low thinking — the pro model spent 3 min thinking and ran out of tokens),
  looked up by **Instagram Business Discovery** through the house's own connection (public business/creator accounts only, kept a
  day), read by the model from their best and weakest posts; their ads are a link to the public Ad Library (Meta's API has no
  commercial ads for Pakistan). **Guide** — the ad days (`calendar.ts`, tested: `islamic-tbla` in Karachi matches the vault's
  2025 anchors; Ashara 1–10 Moharram + 5 days before, both Eids, the Mazoon's birthday, Ghadeer + 1 day before; the lunar 1st
  quiet; Urs/Dawat dates are not in the vault and not guessed), **what the account's own ads say** (last 180 days, cheapest vs
  dearest results by `splitWinners`, pictures to the model; `app_settings/ad_studio_winners`), the playbook (`playbook.ts`) and the
  vault's rules (`brand.ts` — every studio prompt carries `brandBrief()`; kept in code on purpose so an Obsidian edit can't change
  what the model approves). Studio AI calls other than assessing are capped `AD_STUDIO_AI_DAILY_CAP` (200) + 60/h per caller.
  **Drive needs two owner steps** (the Setup card on Picks says so): enable `drive.googleapis.com` in gemstrack-pos, and share
  "taheri content", "TC" and the Vault's logos with `firebase-app-hosting-compute@gemstrack-pos.iam.gserviceaccount.com` (Viewer;
  `claude-cloud@` too for cloud sessions). Nothing ever writes to Drive. Business Discovery and the winners reading were not run
  live when shipped (they use the Meta token); the search, assessing, fixes, words and check were.
  **Rules changed by the owner** (2026-09-29: "all are incorrect now, i have zero issues with these"): **prices, karats, weights,
  carats, grading and direct calls to action ("Shop now", phone numbers, urgency) are allowed in ads.** What replaces them is
  accuracy: `inventedFigures` (prompts.ts, tested) drops any AI line with a figure the ERP didn't give, and the check lists them;
  still blocked: sale/discount language and hashtags (`breaksHouseRule`), the sacred-date rules, "investment" for diamonds, bridal
  copy. Each website photo carries its **specs line** from the ERP (`specs.ts`, tested: tagged karat/metal, stone, weight) — every
  layout prints it under the headline (an empty line takes no room) — and the owner may type a price. The vault in Drive still
  states the old rules; `brand.ts` is what the studio follows.
  **The logo:** taheri.shop's files have the wordmark burned in. Drive holds the same frames unmarked under the camera name
  (site `DSC09342.webp` = Drive `DSC09342.JPG` / `DSC09342-retouched 2.png`), so `originals.ts` (tested) matches them and the sheet
  and the maker start from the Drive original (retouched first) — no AI erasing. Without one, **Remove the logo** in the maker is
  one tap (enhance with tidy). The Drive listing keeps a failure 30 s only (it once held "API disabled" for 10 minutes after the
  owner had enabled it); the Drive card has "check again".
  **Make it with AI** (owner: "it should just make an ad creative using ai and the photo/details"): `/api/ads/studio/auto`
  op `direct` — the art director picks the layout and writes kicker/headline/CTA and the ad's texts from the photo + the ERP's
  specs (never repeating the specs line), while the photo is cleaned or extended to the frame in parallel; the maker lays it out
  and runs the check (≈30 s + the check). Op `paint` — Nano Banana paints the whole ad around the photographed piece, then the
  lettering is read back and the piece compared ("same piece?"); on the first run it redrew the stones and the check caught it,
  so the prompt now forbids re-rendering the piece and a flagged one says "Use it anyway".
  <a id="any-shape"></a>**Any shape** (2026-10-01, owner: "ads should have an option to generate in any orientation ratio"): beside
  Meta's four chips, **Any shape** offers every ratio the image model draws (2:3, 3:4, 5:4, 4:3, 3:2, 16:9, 21:9) and **Custom W:H**
  (each side 1–100, remembered per device; the frame is 1080 wide, between 3:1 and 1:2.2, exported with its short side ≥ 1080 px).
  `AD_FORMATS[f].ai` is the ratio every AI call uses (extend, new setting, Make it with AI, Paint); a custom shape is drawn at the
  nearest one (`nearestAiRatio`) and trimmed, and the painter is told which edges are cut (`trimTo` in `paintPrompt`). The note under
  the goal says whether Meta shows the shape as it is in feeds (1.91:1–4:5) or crops it (`metaFeedFit`); the 9:16 pair and "Every
  size" stay Meta's (Every size adds the shape on screen). A frame wider than 1.4:1 lays out side by side — the photo as a panel, the
  words on the ground — because across a wide frame the piece sits where words over the photo would go (1.91:1 too). The photo
  sheet's **Extend to another shape** runs the same reframe at any of those ratios. Saved ads keep a custom shape (`ratioOfFrame`).
  Fixed with it: "HRD Antwerp certified" drew its badge under the centred wordmark in every frame (the mark is top right now), and
  "No making · No wastage" ran off a wide frame.
  **Assessing runs in the background** (owner: "should run in the background"): `assess-run.ts` — one slice runner with a lease in
  `app_settings/ad_studio_assess` (so the tick and the page never double-pay), paced 12 s between batches because the Vertex key's
  per-minute quota is shared with the counter. It rides the existing **`social-queue-tick`** (every 5 min, 300 s deadline) after
  the queue's own work — this session can only view Cloud Scheduler, not create a job; a dedicated `ad-assess-tick` job would be
  cleaner. Pause/resume and "Assess now" on the page. ~350 photos an hour.
  <a id="out-of-memory"></a>**Out of memory, 2026-10-01** (owner pasted Post a Piece's "AI request failed (503)"): the TC folder
  added by link on 09-29 holds 4000-px PNGs of 13–25 MB and three Photoshop files. A batch downloaded and decoded ten originals at
  once (+337 MiB, measured), past the 512 MiB instance; Cloud Run killed it and every request on it — the counter's Enhance, 74
  of taheri.shop's quotes at 07:45 — 95 times that day, each tick starting the same batch again because nothing had been saved.
  Since then: **Drive photos come resized by Drive** (`thumbnailLink` with `=s<px>`, any size up to the original; it renders PSD
  and HEIC too; an original is downloaded only when there is no preview, never over 40 MB) — all 39 stuck photos +57 MiB; a
  batch loads one photo at a time; a batch the server died in, or a photo that failed, gets a strike and at two is left out of
  the background runs (`assess-strikes.ts`, tested; `strikes` / `inFlight` in the state doc); instances have 1 GiB
  (`runConfig.memoryMiB` in `apphosting.yaml`, both houses); the AI pages ask again once on a bare 503 (`ai-client.ts`, tested)
  and otherwise say the ERP dropped it, not the AI.
  **The whole scene** (owner, 2026-09-29: "target whatsapp channel/insta/dm/whatsapp/website the full scene", after research by
  two agents that day — the houses' sites, their Google ads, TikTok, and Meta's docs; `market.ts` keeps the dated findings, shown
  in the Guide): a **Plan** tab of plays (`plays.ts`) by funnel stage — piece at today's price → WhatsApp (always on), WhatsApp or
  Instagram (Meta picks per person), today's gold rate → the WhatsApp channel, Since 1989 → the profile, the piece → taheri.shop,
  investment gold (no making, no wastage), come back (engagers + customers); "Make this" opens the maker set up for it. New layouts
  `rate` (the ERP's rates per tola, rounded to the hundred — `rateBoard`, tested; `/api/ads/studio/rates`) and `investment`. The
  maker has **Where a tap goes** and sends **both sizes as one ad** (the 9:16 version uploaded too). New ad (plan.ts, tested) gained
  goals **`messages`** (`MESSAGING_INSTAGRAM_DIRECT_WHATSAPP`, creative `asset_feed_spec` with `DOF_MESSAGING_DESTINATION`) and
  **`channel`** (Meta has no channel-follow objective: a traffic link ad to `NEXT_PUBLIC_STORE_WA_CHANNEL_URL`), `source.vertical`
  (placement asset customisation: labelled images + `asset_customization_rules`, feed vs story/reels), the WhatsApp welcome message
  in Meta's documented VISUAL_EDITOR shape with three ice breakers (`welcomeMessage`; it was a bare string), website ads on
  `LANDING_PAGE_VIEWS` once `pixelLive`, and a warning when the dates cross the Bohra calendar's quiet days. None of the new
  creative shapes has run against Meta yet (new photo ads wait on the app going Live). **Instagram Business Discovery is refused**
  for the shop ("(#10) Application does not have permission") because the Facebook login configuration lacks `instagram_basic` (found
  by another session the same day — see Setup); the ten researched houses are saved in `ad_competitors` with Instagram and Ad
  Library links and look up once it is added and Meta reconnected.
  Research facts worth knowing: taheri.shop has **no Meta pixel** (nine rival sites do); @collectionstaheri ~2,061 followers
  against 16k–308k; nobody claims the Bohra community; only Fazal and Al Syed show rate × weight.
  **The Ads re-audit** (owner: "reaudit/reorganize/optimize/add new features the ad studio and entire ad bar"): Studio now sits
  before New ad in the tabs (the creative comes first); the Overview has a **readiness strip** (`readiness.tsx`: the app not Live,
  permissions the login lacks, the website pixel) — only what is missing; Setup step 8 is **the website pixel** (`lib/ads/pixel.ts`:
  list/make the ad account's pixels, choose one → `app_settings/meta_ads.pixelId`, "live" = `last_fired_time` within a week, and
  whether the site's HTML loads it); the website reads the id from **`/api/public/pixel`** (CORS, 5 min) so changing it needs no
  site deploy — **taheri.shop does not load it yet** (taheri-site needs the loader); `planContext` passes `pixelLive`, which moves
  website ads to landing-page views. "Make one like this" reads asset-feed ads (both sizes, two apps) and channel links. The Ads
  helper's prompt carries the plays, the house rules and the market gaps (Taheri only, with the studio).
  **House of Mina has the studio too** (owner, 2026-09-29: "after youre done with taheri, do the same thing for houseofmina";
  `NEXT_PUBLIC_STORE_AD_STUDIO "1"` in `apphosting.mina.yaml`). One code path, the house chosen by `STORE_BRAND`: `brand.ts` holds a
  `HouseBrand` per house (Mina's from what the ERP already says in her name — the caption prompts' voice, the link page, the post
  footer, her palette #140B0B / rose #E8A5AE and MINA mark; no vault) with `calendar` (the Bohra quiet days: Taheri only), `banned`
  (Taheri: sale words + hashtags; Mina: hashtags), the competitor brief and the Drive hint; the layouts take the house's colours,
  heritage line ("Since 1989" / "House of Mina") and badge ("HRD Antwerp certified" / "925 Sterling Silver"), and the rate and
  investment layouts are Taheri's only; `plays.ts` has Mina's own (DM or WhatsApp — Instagram-native buyers —, houseofmina.store,
  the catalogue, the men's line, the profile, come back) with the Plan's stages per house; `playbook.ts` and `market.ts` per house.
  Mina's photos are the catalogue's 619, **572 of them with the catalogue's unmarked source** (`source:<id>` assets, Shopify CDN or the
  site's own `catalog-src/` only), and their specs line is "925 Sterling Silver · stones · plating". Mina's Drive needs the same two
  steps in hom-pos (the Drive card names the project and the account).
  **Mina's market** (research of 2026-09-29, `market.ts`): her median piece is Rs 14,000 (Zanvari 23,250, Zumorrud 17,500) with the
  same made-to-order / buy-back / repolish; 164 of 209 Shopify pieces are 21k gold-plated; 4.81★ from 138 reviews; free delivery only
  over Rs 20,000; no Google ads; **the catalogue carries no pixel**; both sites link TikTok to **@houseofmina, a US beauty/fashion
  blog — not hers** (owner, 2026-09-30: "the tiktok isnt hers"): `NEXT_PUBLIC_STORE_TIKTOK_URL` is gone from `apphosting.mina.yaml`,
  so links.houseofmina.store has no TikTok row, and the catalogue dropped its own (mina-catalogue, same day); only the Shopify
  theme's footer (Customize → Footer → Social icons) still links it — the connector can't write the live theme.
  **Why Google shows few houseofmina.store products** (looked into 2026-09-30): nothing blocks indexing; the shop renamed 50 ring
  handles on 2026-09-24 (`adele-er-single-round1ct-halo-pave` → `adele`, 301s) and 60-odd others before, so the index holds old
  addresses until it re-crawls (Search Console → URL inspection → Request indexing speeds it); the main menu's **Heirloom Jewelry**
  and its five sub-items link, from every page, to collections with no public products (their 95 pieces are Shopify drafts;
  the catalogue shows them); one-word names ("Adele", "Kaia") find other brands' pieces unless searched with "House of Mina".
  Fixed that day: the one redirect chain (amalfi → capri-earrings → capri-ear-cuffs, now one hop), and the catalogue's shop links
  (now the current handles). **Search Console, measured the same evening** (the owner added `claude-cloud@gemstrack-pos` as a
  full user on **`sc-domain:houseofmina.store`** — shop and catalogue — and enabled the Search Console API in gemstrack-pos; the
  Site Verification API stays off): no sitemap had ever been submitted; of the 209 live products Google had **never heard of
  110**, indexed 89 and left 10 crawled-not-indexed; 90 days gave 542 clicks, 462 of them the home page, and **69% of product
  impressions landed on old addresses** (`popsicle-band-…-copy`, still indexed, carried 594 for "nimbus drop"). Done then:
  submitted the shop's and the catalogue's sitemaps and a temporary `shop-moved.xml` on the catalogue (129 old addresses that
  redirect — read by Google at once, 0 errors; delete after mid-November 2026); 10 old addresses of pieces now drafted (404,
  e.g. `mahira-emerald-cut-ruby-cocktail-ring`) redirect to their catalogue pages; the catalogue's 209 shop pieces name the
  shop's page as canonical. "Request indexing" has no API (the Indexing API is for jobs and livestreams only). Shopify stamps
  every product's sitemap `lastmod` with the time the sitemap is generated, so it tells Google nothing.
  **The full audit, later that night** (owner: "check everything you can access on search console, make any possible
  improvements"): 1,118 of 1,134 clicks in 16 months are brand searches; "house of mina" ranks **1.1 in Pakistan** (the 3.7
  average is other House of Minas abroad); the ~7,000 "minas collection" impressions are **another brand** (minascollection.com,
  artificial jewellery) — not demand to chase; non-brand search is product names seen on Instagram (nimbus drop, lynta, diadem,
  sorbet), mostly landing on old addresses. Every product page **failed Product snippets** on 5 errors from
  `snippets/hom-local-seo.liquid` (`hasOfferCatalog`: five categories typed as Product with no price) — fixed, with the stray
  `servesCuisine: null` and the footer's TikTok, in the **unpublished theme "SEO fixes (2026-09-30)"** (#189529227544, a copy of
  Atelier; preview `?preview_theme_id=189529227544`) — **the owner publishes it** (the connector can't write or publish the live
  theme; publish soon, as edits made to the live theme after the copy would be lost). `hom-product-seo`'s Product (AggregateOffer,
  Judge.me ratings from `reviews.rating`, shipping, returns) is kept: it is what carries product snippets and stars beside
  Shopify's ProductGroup. Done live: the Fine Rings collection (`engagement-rings`) got its SEO title/description; the main menu's
  **Heirloom Jewelry** (and its five empty sub-items) became one link to `catalogue.houseofmina.store/heirloom`; the six empty
  collections (heirloom ×5, rose-gold-rings) carry `seo.hidden = 1` (noindex, out of the sitemap — delete the metafield when their
  pieces are published). Left for the owner: Search Console → Settings → Shipping and returns (clears the merchant-listing
  shipping/returns warnings on every product). Her plays: the gold look at the silver
  price (always on), a real review, the Ring Builder (`path` on a play), bangle-and-ring sets, natural ruby for him, the shop, the
  catalogue, the profile, and the promises for come-back.
  **The pixel a site already carries, and Online orders** (2026-09-29): **houseofmina.store already has Meta pixel 1429906491670575**
  through Shopify's Facebook & Instagram app — a web pixel, not `fbq`, so the old check missed it and would have had Mina make a
  second. `pixelState` now reads every site the house sells from (`NEXT_PUBLIC_STORE_SHOP_URL` and the website), finds the pixels
  each carries (`pixel-read.ts`, tested: `fbq('init')` and Shopify's escaped `"pixel_id"`), and what the chosen one received this
  week (`/{pixel}/stats?aggregation=event`). Setup offers the carried pixel first (and says how to share it with the ad account when
  a shop app made it under another business); making a second asks first. New goal **`sales` — "Online orders"**: `OUTCOME_SALES`,
  `OFFSITE_CONVERSIONS` with `promoted_object { pixel_id, custom_event_type: PURCHASE }`, the link defaulting to the online shop;
  New ad says how many orders the pixel saw this week against Meta's ~50 to learn. Results read as purchases
  (`RESULT_FOR_GOAL.OFFSITE_CONVERSIONS`).
  **Post it** (owner: "let me also post any made ads to story/whatsapp channel / community / add it to the website"): the maker's
  `post-it.tsx` sends the made ad the ordinary way — the 9:16 version to the Instagram story (`/api/instagram/story`, or the share
  sheet as its own tap when the house has no connection), the **1:1** version to any of the community's groups and the channel
  (`/api/website/post` with `targets`) and into a website collection (Add Photos' `/api/website/photos`). WhatsApp and the website
  only ever get 1:1 (owner, 2026-09-25).
  **Ad sets** (`/ads/adset`, an Ads tab; owner: "i need to be able to design adsets"): one to six ad sets — each its own name, goal,
  audience and places (the AudienceEditor), budget and dates — into a campaign the account has (its objective limits the goals;
  a campaign holding the budget gives its ad sets none) or a new one, filled with **copies of ads already made** (`/{ad}/copies`
  with `adset_id`) or a boosted Instagram post (a creative per goal). "Another ad set" starts as a copy of the last, so a test
  changes one thing. `lib/ads/adset-design.ts` (tested) builds each ad set with New ad's own `adsetParams`; `/api/ads/adsets`
  checks every object is this house's, and on any failure deletes what it made. Reached from Campaigns (a campaign's "Add ad
  sets", an ad set's "Copy and change", an ad's "Into new ad sets") and New ad's "Test it on another audience".
  **Saved** (Studio → Saved; owner: "an ad container with folders etc where i can store ads and see exisiting ads stored"):
  Make's **Save** keeps the ad — the picture, the photo it is drawn on and the layout document, plus its words, frame, layout,
  goal and link — in Firestore `ad_saved` (+ files in `ad_saved_media`, 900 KB parts; `lib/ads/studio/saved.ts`), in the owner's
  folders (`ad_folders`; deleting one leaves its ads unfiled). "Open in Make" puts it back exactly as left, and Save then writes
  over it ("As new" makes a copy). **In the ad account** lists every ad Meta holds (all time), and any can be kept in a folder
  (its picture and words; `fromAd`). What a save may carry is cleaned by `saved-shape.ts` (tested). Checked end to end in
  headless Chromium on 2026-09-29 (folder → make → save → reopen); the test's folder and ad were deleted after.
  **Less text** (owner: "reaudit/simply and detext/hide text/lessen text noise from the ad studio in general"): measured by the words
  each tab shows (Plan 738 → 246, Picks 889 → 239, Library 1,843 → 527, Make 436 → 194, Guide 1,239 → 511). The rule since:
  a heading or a control names itself; the explanation is its `title` (hover) or behind a fold — no subtitle, no paragraph under
  a heading, tiles show the name only (the model's description and fixes are on hover and in the sheet), a play card shows
  title → destination and its chips (why/who/how much fold), field labels are one word, playbook and rules start folded.
  **Drive, as it stands (read with the owner's Drive connector, 2026-09-29):** only "taheri content" is shared with the runtime
  account — and it is shared with **anyone with the link as an editor** (anyone holding the link can change or delete the shoots;
  the owner should make it Viewer). **TC** is Murtaza's (hmurtaza55@), open to anyone with the link as a viewer, and the owner
  (potatomasta501) isn't an editor on it, so it can't be shared on — the studio now takes **folders by link**
  (`drive-link.ts`, tested; `app_settings/ad_studio_drive.folders`, never in the code since gemstrack-pos is public; the Drive
  card's "add a folder by link", `/api/ads/studio/drive`), and TC (63 photos) was added that way. The Vault's logos
  (Taheri Vault / attachments / logos) are private to the owner and not shared.

<a id="board"></a>### Board

**How it handles (2026-10-12, owner: "super intuitive on the web, simple yet feature packed").** Everything on
the board lives on it: a dock at the bottom (Photo, Note, Undo/Redo, zoom, Fit, Tidy up, Full screen, panel, close) and, over
the selected design, its own bar (Edit, Variants, another shape, Duplicate, Download, Use it ▾, Delete). Pictures
can be dropped or pasted straight onto the board; double-clicking the ground makes a note there. Every hand-made
change (add, move, nudge, delete, duplicate, a note's words, Tidy up) is a step with its inverse ops, so ⌘Z and
⇧⌘Z undo and redo it (a deleted design comes back with its id and place). Keys: ⌫ delete, ⌘D duplicate, Enter
edit, arrows nudge (⇧ ×5), N note, P photo, F fit, 0 100 %, +/− zoom, Esc deselect. The side panel keeps the
longer forms (Let it cook with an aim, the name, every shape).

- **Board** (`/ads/studio?v=board`, `board.tsx`; 2026-10-04, owner after an audit of pen.dev: "sure run it") — pen.dev's idea on the
  house's own parts: an endless canvas (drag to pan, pinch / ctrl-scroll to zoom, Fit) of **designs side by side** — each the maker's
  own layout document (`StoryDoc`) on one library photo, in one of the studio's shapes and layouts — and **sticky notes**.
  `studio_boards/{id}` holds a board (designs, notes, rev); every change is a list of **operations** (`board-shape.ts`, tested:
  add/put/move/remove, note/noteMove/noteText/noteRemove, rename) applied in a Firestore transaction (`board.ts`), so the page and an
  agent working at once never overwrite each other; the page asks `?since=<rev>` every 4 s. A design's `rev` goes up on every change
  (not on a move). A website photo is used through its **unmarked Drive original** when there is one (as the maker does), else as
  itself with `marked` (layouts add no wordmark).
  **Per design:** Edit (the maker's `SoloEditor`, saved as you go — [below](#board-designer-flow)), **Let it cook** (2–6 variants: Make it with AI's
  `op=direct` once per variant, each asked from another angle — `ANGLES` — plus the owner's aim or a note, three at a time for the
  Vertex quota; each lands beside the last, `by: 'ai'`, with the model's `why`), **In another shape** (a copy laid out afresh in any
  shape), Duplicate, Download (full size JPEG), Remove. Measured: two variants in 24 s.
  **An agent over MCP** (`/api/studio/mcp`, `board-agent.ts`, tested): **Connect an agent** makes a key (`tstudio_…`, kept as a
  SHA-256 hash in `app_settings/studio_agent`, shown once, revocable there, 600 calls an hour) and the `claude mcp add --transport
  http …` line. Plain JSON-RPC (Streamable HTTP, JSON answers only; notifications get 202). Fifteen tools: `get_style` (the house
  brief from `brand.ts`, the shapes, the layouts, the StoryDoc format, how to work), `list_boards`, `create_board`, `get_board` (notes
  first — the owner's instructions), `find_photos` (the library with the ERP's specs line and the assessment), `view_photo`,
  `add_design`, `update_design`, `move_design`, `remove_design`, `add_note`, `remove_note`, `view_design`, and (2026-10-14) **`upload_photo`** and **`replace_design_photo`**. **The agent never lays
  out:** it gives a layout and words, and the page — the only place with the photo, the fonts and a canvas — lays the design out the
  next time the board is open, draws it, and posts a 720-px JPEG to `studio_board_views/{board}__{frame}` with the rev it shows;
  `view_design` returns that picture (or says it is stale / not drawn yet). Words an agent writes pass `wordProblems`: no sale words
  or hashtags (`breaksHouseRule`), no figure the ERP's specs line doesn't have (`inventedFigures`) — refused with the reason, so the
  agent fixes its call. A design's document from outside goes through `cleanDoc` (renderer's layer kinds only, numbers finite, ≤ 80
  layers, ≤ 60 KB, no uploaded pictures). Tried end to end on 2026-10-04 (local, real Firestore and Vertex): the agent added two
  designs and a note, its "22K and only 3g — 20% off" was refused, the page drew them, `view_design` returned the drawing; the test
  board and key were deleted after.
  **Photos from the agent** (2026-10-14). `upload_photo { data (base64 or a data: URL), name?, filename?, mime? }` puts a picture in the
  library through the ERP's own `addUpload` (`uploads.ts`: refuses a non-picture, upright, ≤ 2400 px, < 900 KB, PNG if transparent;
  ≤ 20 MB decoded, over that or bad base64 or a non-image `mime` is refused) and answers `{ id: "up:<id>", name, w, h }`, the id
  `find_photos`, `view_photo`, `add_design` and `replace_design_photo` take. `replace_design_photo { board, id, photo, layer? }` swaps
  only the picture (`replacePicture`, `board-pictures.ts`): the frame's `assetId` (a site photo's unmarked original, as `add_design`
  does) and `marked`; the document (words, layers, crop/placement, `photo` id), template, fields and label stay, and the rev moves so
  the page redraws it for `view_design`. With `layer` (an image layer's id, or `bg` for a `lib:` background) it swaps that picture
  instead, keeping its place, size and crop. Same agent key, same house project as every tool; no other way in.
  **Out of the board, and this week's board** (2026-10-04, owner "yes" to both). Each design's panel has **Use it**: *Queue a
  post* (the design to the chosen WhatsApp places — the channel ticked first — and/or an Instagram story, the same layout at 9:16;
  it joins Post a Piece's queue **held**, so nothing goes out from the board: Posts → Hub sends it or sets a time), *Use in a new
  Meta ad* (the maker's handoff: the picture, and its 9:16 for a feed design, into the ad account's library and `/ads/new?studio=`),
  *Save to Saved ads*. **This week's board** (`weekly.ts`, tested): on Monday from 9:00 Karachi the queue tick starts a board
  "This week · <date>" of the week's new website pieces (one per name — a piece's other photographs share it), topped up with the
  best photos not yet in an ad (score ≥ 60), six at most; each piece is art-directed once (`art-direct.ts`, moved out of
  `/api/ads/studio/auto` so both use it) and laid down as a 4:5 and a 9:16, a row a piece, with a note saying what it is. A few
  pieces a tick, paced 8 s, under a lease in `app_settings/studio_weekly`; a piece the AI's per-minute quota stops waits for the
  next slice (three tries). The page's **This week's board** button makes one now and waits for it. **`safeTemplate`**: a 9:16, or a
  website photo with the burned-in wordmark (`marked`), never gets a full-bleed layout (headline, clean, band, certified) — words
  crossed the piece and the crop cut the mark on the first weekly board — it gets framed; applied wherever a design is made (weekly,
  cook, add a photo, another shape, the agent, the 9:16 sent to Instagram or a new ad). The framed layout now gives a two-line
  headline its room on a 4:5 (the call to action fell off the frame). Tried on 2026-10-04 (local, real Firestore and Vertex): two
  weekly boards (the second after the one-row-a-piece fix: six different pieces, twelve designs), Save and Queue a post from a
  design (then deleted); New ad was not pressed (it would put a picture in the ad account).

- **Uploads and product insets** (2026-10-06, owner: "use these … ai upscale, rescale, add the product shot in there"). A third
  library source, **uploads** (`uploads.ts`): photographs prepared outside the studio (re-cropped, upscaled, a product shot cut
  out) kept in Firestore `studio_uploads`, one JPEG under 1 MiB a document, asset id `up:<id>`, served by the same image route.
  A cloud session can write Firestore but cannot put full-size files in the owner's Drive, so this is how its work reaches the
  board. And a design may now hold **more library photos as image layers**: a layer whose `photoId` is `lib:<asset id>` (the
  product shot beside the hand that wears it); the board fetches each like the design's own photo, draws it, sends it in the
  agent's view and the downloads, and offers it in the editor.

- **The designer on a board design** (2026-10-12, owner: "let me edit any present text and picture from any of the ads … add text,
  fonts, elements, the AI"; `FrameEditor` in `board.tsx`). **Edit** on a design opens the Canva-style designer
  (`website/post/story-editor.tsx`) full screen on that design's `StoryDoc`: any text (the bound fields and free text), added text,
  fonts, shapes and stickers, layer order, lock, align, background, crop, undo/redo; the canvas first, tools following the
  selection. **Pictures:** the design's photo or any inset is replaced from the library or the device; **With AI** runs the
  existing tools on the selected picture — Enhance, Logo and labels off, Retouch, Extend to the design's shape (`PHOTO_AI`, through
  `runImageOp` in `studio-kit.tsx` to `/api/website/post/ai`, its gate unchanged) — and the words come from `/api/ads/studio/copy`.
  Each accepted result is kept as an upload, and the original is one tap away while the design is open. **Every change is saved as
  it is made** (below): one put of the design on the board, so reopening, the board's picture, Download, Saved ads, a new ad and the
  post queue all draw the same pictures. The native app's editor (`StudioBoardEditor.swift`) does the same over the same routes.
  - <a id="board-designer-flow"></a>**The board stays one step away** (2026-10-16, owner: "the board needs work, its not intuitive
    to use, editing one ad shouldnt remove me from everything else, make it seemless and very smooth to use"):
    - **Saved as you go.** A change goes to the board 0.7 s after it is made (`persist`: one at a time; pictures uploaded first;
      a failure toasts once and retries every 4 s). No Save button and no "discard?" question: the header says Saving / Saved
      (· the other sizes that took a linked change), **Done** and **← Board** wait for the last save, and closing the tab warns
      only while one is pending.
    - **Moving without closing.** Beside the name: **‹ ›** (or **[ ]**, as in a slideshow) for the previous and next design in
      reading order (rows, then left to right), and the design's **sizes as tabs** (4:5 · 9:16 · 3:4). Under the page, **the
      strip**: every design on the board as the board draws it (redrawn as saves land), this one lit, its sizes ringed; tap one to
      go there. Each move saves first, then opens the next design in place: its photo is already fetched (the neighbours and sizes
      are fetched while you work), the panel that was open stays open, and full screen stays on.
    - **No forced full screen.** The designer no longer asks the browser for full screen on its own (it had hidden the page); the
      button remembers the choice per device.
    - **Back on the board**, the design last edited is picked, glows a moment and is panned into view if it was off screen.
    - <a id="board-zoom"></a>**Pinch and wheel** (2026-10-16, owner: "zoom in zoom out for the board is buggy, my trackpad zooming
      shouldn't zoom the page in"): the board's wheel listener had been added while the board was still loading, before its box
      existed, so it never was and every pinch zoomed the browser's page. Now a trackpad pinch (ctrl + wheel in Chrome, Edge and
      Firefox; gesture events in Safari, skipped while fingers are on the glass so an iPad's touch pinch isn't counted twice) zooms
      the board about the fingers, two fingers pan, a burst is applied once a frame, a mouse notch is capped, and ⌘+ / ⌘− / ⌘0
      (⇧⌘0 fits) zoom the board. While the board is open big or a design is being edited, `useNoPageZoom` (`hooks/use-no-page-zoom.ts`)
      stops the browser zooming anywhere on the page — the drawer, the bars, the designer's rail, panels and strip included.
    - **Tidy up** (`board-tidy.ts`, tested) keeps each ad's sizes side by side and puts as many ads a row as suit the board's shape
      (the shoot boards had been one ad a row, a column that fitted at 8%; tidied 2026-10-16). Big changes go to the server 60 ops a
      request (its limit), so Tidy works on a board of any size.
  - **`POST /api/ads/studio/uploads`** (multipart `file`, optional `name`; the Ad studio's gate; ≤ 25 MB, answered 413 from the
    `Content-Length` before the body is read) puts a picture in the library (`uploads.ts addUpload`) and answers
    `{ asset: { id: "up:<id>", name, w, h } }`.
  - **The `lib:up:<id>` convention.** A picture the design holds beyond its own photo is a layer whose `photoId` is
    `lib:<asset id>`, so an upload is `lib:up:<id>` (`board-pictures.ts`, tested); the page fetches each like any library photo.
  - **Pictures are uploaded one by one before the board put.** Anything added or made by the AI in the designer is sent to
    `/uploads` at once. A picture undone or replaced before it is used can therefore leave `studio_uploads` rows nothing uses.
    Known and acceptable: they are small and the library lists them as uploads.
  - **`DesignerExtras`** (`story-editor.tsx`, the `extras` prop of `SoloEditor`) is how a page adds to the designer without forking
    it: `panels` (rail panels with ids `x:<name>`, here Pictures and Words), `hide` (its own panels to leave out), `tools(ed, 'toolbar'
    | 'phone')` (tools for the selection), and the header — `title`, `status`, `actions` (after Download; here Done), `closeLabel`,
    `hint`, `startPanel` (null: none open), `onPanel` (told when the panel changes) and `strip` (a row under the page; on a phone
    above the bar, while no sheet is open). The board is its only host so far.

<a id="server-draw"></a>### The server draws the board

**The server draws the board** (2026-10-15, owner: "i want the server to draw so i can edit without openiong the board").
Before this, only the page could lay a design out and draw it. An agent's new design sat "not laid out", and `view_design`
showed an old picture or none, until someone opened the board. Now `lib/ads/studio/server-draw.ts` runs the page's own code on
`@napi-rs/canvas` (Skia, as in Chrome): `applyAdTemplate` to lay out, then `reflow` and `renderDocTo` to draw.
- **Fonts.** The house's faces are in `server-fonts/` as fixed weights cut from `src/fonts`. This canvas ignores a variable
  font's weight axis, so Figtree 300/400/700, Bodoni 400/500 and the rest are separate files. Regenerate them (fontTools
  `instancer`) if `src/fonts` changes.
- **The marks** are read from `public/` (`STORE_SITE_MARK_SVG`, the monogram).
- **Browser globals.** The renderer reaches for `document.createElement('canvas')`, `Path2D`, `ImageData` and `DOMMatrix`.
  `withCanvasDocument` puts stand-ins on `globalThis` only for the synchronous layout-and-draw, and removes them before any await.
- **Memory.** One design at a time per instance (`serial`). Pictures are fetched at 1600 px, as the page does; a design takes
  about 0.8–1.3 s and under 300 MB.
- **When it runs.**
  - The MCP tools `add_design`, `update_design` and `replace_design_photo` lay out and draw at once.
  - `view_design` draws first when the drawing is missing or stale.
  - The weekly routine draws each pair it adds.
  - `POST /api/ads/studio/boards/<id>/draw` (`{ ids? }`) settles a whole board, for changes written straight to Firestore.
- **The page.** It still draws what it shows, and skips sending a view the server already drew for that rev.
- **Checked against the page.** The server's pictures matched the page's own `studio_board_views` for the rings boards: bg
  adjust, `bg.shade`, marks, the framed and heritage layouts.
- **Build.** `next.config.ts` keeps `@napi-rs/canvas` external, and `outputFileTracingIncludes` ships `server-fonts/` and
  `public/` marks with `/api/**`.

<a id="free-background"></a>**The background, by hand** (2026-10-15, owner: "moving the background around, or adding a new background its all
buggy. make everything very free, i shouldnt have to deal with sliders for basic things"; "the gradient on photo is buggy if you
change the background"). The fixes are in `lib/social/bg-gesture.ts` (tested), `story-editor.tsx` and `editor-panels.tsx`.
- **Drag moves the photo.** A plain mouse drag on the background moves the photo at once; Shift+drag draws the selection box.
  Before, the first drag drew a box unless the background was already selected.
- **No jump when panning.** On an axis where the photo has no room, the focus is left alone. It used to jump to an edge (a
  divide by a dummy 1), and the next zoom threw the photo into a corner.
- **Zoom about the pointer.** Scroll or pinch zooms around the pointer, up to 6× (pinch was capped at 3× and zoomed about
  the centre; there was no scroll zoom).
- **Double-click resets** the photo to centred and unzoomed.
- **A new picture starts centred.** It keeps the place, size, frame and mask of the one it replaces, but its crop starts
  centred and unzoomed (`replacePicture` / `freshCrops`). The Background panel and Photos panel do the same. Before, it
  inherited the old photo's crop.
- **One gradient.** The Shade pills (None, Bottom, Top, Left, Darken) write the single `bg.shade` and clear the old preset
  `bg.gradient`, so the two never stack. Two dots on the page drag where the fade starts and where it is darkest. The fine
  controls (colours, opacity, angle, zoom, darken) sit under "Fine-tune" and show whenever a shade exists. They used to hide
  when the background wasn't a photo while the shade was still drawn.

<a id="sizes"></a>### Sizes, linked

(2026-10-15, owner: "for all designs that have a different size variant, let me link and unlink the texts so i can mass edit the
ratios".) `board-links.ts`, called by `applyOps` on every `put`, so the page, the agent and the weekly board all follow it.
- **A design's sizes share `group`** (`BoardFrame.group`; the agent sees it as `sizes`). "In another shape" puts the new size in the
  original's group; the weekly board's 4:5 and 9:16 are one group; a copy or a cooked variant is not (it is another ad).
- **"In another shape" resizes the owner's own design** (`lib/design/resize.ts`: their words, buttons and edits) instead of laying the
  template out afresh, which had shown the fields' old words (the fire 3:4 and the proud 9:16 on the rings board did). Every text of
  the original is linked first (quietly: its sizes already on the board are not touched).
- **A text is linked by `link`** (a key shared with its twins), or a bound text by its field. Saving a design carries **only what
  changed** on a linked text to its twins: the words and their styles, font, colour, case, spacing, effects, its button. Size goes as
  a ratio; place, width and alignment stay each size's own. Field changes go to the sizes too.
- **Unlink** (the chain button on a selected text in the designer) sets `unlinked` and keeps the key: that text is free both ways, and
  linking it again finds the same twins (and makes them match it). Linking a text that has no twin finds the same words (case, line
  breaks and full stops aside) or the same field in each size, else copies it there in proportion. **Link all** (nothing selected)
  links every loose text. The header's Saved says which sizes took the change; the agent's `update_design` has `only_this_size`.
- A copied or pasted text is a new one (its link dropped).

<a id="buttons"></a>### Buttons

(2026-10-15, owner: "also add text ability inside buttons".) `social/button.ts`. A button was a rounded rectangle with a line of
text over it: two layers to move together, which a resize laid out apart. A button is now **one text layer** whose background
(`box`) is the pill at a set size (`box.w`, `box.h`; the words in its middle; `layerBox` grows to it, so it is hit, dragged and
sized as one). **A button is placed by its pill** (`editor.ts` `asButton`): `x` is the pill's left edge, middle or right edge by `align` (a
pill on the left of the frame is anchored left, on the right anchored right), the words always in its middle, one line, `box.pad`
kept round them, so longer words grow the pill away from where it was put. Typing on the canvas keeps the pill drawn and the field
over the words; the side handles size the pill; a linked twin takes a changed pill at its own scale. (2026-10-15, owner: "the button
fix fucked the whitespace and design and text in buttons": the first cut had no pad, wrapped at the pill's width, hid the pill while
typing and put the field at its top edge.) **Add → Elements → Button**; a selected rectangle has **Words in it**, which makes it a button with the words already
on it inside (looking the same) or new words; the text's Background section has the button's width and height. The resizer also
keeps a shape behind a line of words with its words (`keepBackings`). The rings boards' 30 pills were turned into buttons on
2026-10-15 (each drawn before and after: under 0.25% of pixels moved). The iPhone and Android engines draw a button's box around
its words only (no `w`/`h`) until they learn it.

**The resizer's 9:16 is a Story** (`safe.ts`): the top 14% and the bottom fifth kept clear, not a Reel's 35% (which put the words
over the ring); the `reel` kind keeps 35%. The templates' own `safeZone` is unchanged.

<a id="house-of-mina-ad-style"></a>### House of Mina's ad style

**Premium and minimal** (2026-10-15, owner: "they need to feel premium … yet feel like house of mina, yet be minimal but
impactful", then "the text is all too bulky"): the Bodoni italic is the one statement (names ~110 px, headlines 80–96 px); every
small line is Tenor Sans capitals, 22 px (18 px for the plating line), tracked ~0.3 em; no eyebrow above a button ad's headline;
a slim pill (~214 × 58) and a small mark (~136 px); 88 px margins. The three JPEG-retouched boards were rebuilt this way; the
rules are in `brand.ts` (MINA visual).

**Rhodium pieces** (2026-10-15, owner: "next to 925 silver, for rhodium products add tarnish resistant plating"): the material
line of a white-metal, rhodium-plated piece reads "925 silver · tarnish-resistant plating" — on two lines when the name and stone
come first (the mark then sits beside the button). Applied to the three JPEG-retouched shoot boards (Rings · silver, Rings · gold &
pearl, Bracelets & opal: 65 designs × 4:5, 9:16, 3:4, built from the catalogue match of each photo).

**House of Mina's ad style, from the owner's edits** (2026-10-14, owner: "i made changes to many of your designs, look at the
changes pics text etc and learn from them for future posts"). The owner reworked the rings boards (`rings-oct-2026` and
`rings-quiet-oct-2026` in hom-pos; revs 21 and 20). Diffing each design against what was written, and looking at the page's own
drawings in `studio_board_views`, gives a consistent look. It now lives in Mina's brand book (`brand.ts` MINA: voice, marks,
visual), so the AI copy, the weekly board, Let it cook and any MCP agent all read it.

- **There are two kinds of ad, and they are treated differently.**
  - **A named design** (Solene, Odile): the owner made the name italic and the material line bold pink, and added no mark and
    no button.
  - **A benefit or the category** (the vermeil cut-away, the loupe, "harder than sapphire", "proud of it"): the owner added a
    button, the wordmark (on three of the four) and short title-case lines.
- **The wordmark goes on benefit ads:** white, 180–210 px wide on a 1080 frame, bottom centre (bottom right when the words sit
  left).
- **There is a deep shade behind the words.** Each edited design got a `bg.shade`: black, or the brand's deep red into black,
  from clear at 0.49–0.69 of the height to 0.64–0.92 at the bottom. The default bottom gradient (0.55 at 42% of the height) was
  too light.
- **A button goes on benefit pictures.** "Shop Now" or "SHOP NOW" in white on a deep red (#8B1E2D) pill (radius 48, about 320 × 96).
  The research said the premium brands put no CTA on the image; the owner wants one.
- **The hero word is large Bodoni italic.**
  - Edits: Solene 120 → 132 px italic; Odile went italic; "Look closer." 104 → 188 px; "Moissanite" 134 px.
  - On a light ground the hero word goes deep red, stacked one word a line ("Silver / Made / for / Every / Day").
- **Small text is bold, not light.**
  - The material line went bold and rose pink (#F4A4C0).
  - The vermeil callouts went bold at 28–30 px, with their lines 2 → 5 px.
  - Light 20 px footnotes were deleted.
- **Benefits and the category, in title case, over technical proof.**
  - The vermeil cut-away went from "2.5 microns of 24k gold." with "more than 14 times the US minimum for gold electroplate" and
    an FTC footnote, to "Lesser Repolishes. Built to Last", "For the First time in Pakistan" and "2.5 microns of 24K Gold Vermeil
    on SILVER".
  - "Harder than sapphire" and its Mohs line became "Silver Made for Every Day".
  - "Moissanite, and proud of it." became "The Best in / Moissanite".
  - Silver is said proudly.
- **Explaining callouts are graphic, not hairline.** On the loupe the hairline was replaced by ivory pills ("925 Silver",
  "Gold Vermeil") in deep red type, a 7 px white arrow from the ring to the loupe, and the loupe zoomed 2.25× onto the cut face
  (an ellipse mask with a shadow).
- **The photos are brighter and warmer.**
  - Adjustments: brightness +12, contrast +8, saturation +6 on the cut-away and the sapphire ad; warmth +42 on the hand shot.
  - The cut-away was re-made in the Studio's AI with richer gold on a redder maroon.
  - "Harder than sapphire" swapped the tight Kiana crop for the editorial Vera shot (sunglasses, a hand to the face), cleaned onto
    a light ground with the AI ("… · AI custom" in Uploads), and renamed its line to the ring shown.
- **More shapes.** The fire ad was copied to 3:4 (Instagram's grid) and the proud ad to a framed 9:16.
- **Brought into line, 2026-10-14** (owner: "yes bring the rest into line"). Every design still at rev 1 was rebuilt in its
  kind's treatment, 22 in all: every 9:16, and the Elise, Fluted Dome, Blossom, fire, nikkah, choice, blaze and loan 4:5s.
  - The ops were puts through `changeBoard`, and only on designs whose rev was still the one read.
  - The 9:16s of the owner's own 4:5s copy their layers: the loupe's exact settings (iz 2.25, fx 0.6, fy 0.08), the re-made
    cut-away and the Vera shot.
  - The proof lines became title-case benefits ("More Fire Than Diamond", "Cut to Blaze", "Say Yes to the Ring, Not the Loan").
  - The Vera story says 925 silver: Vera is rhodium only.

**9:16s are composed for Stories** (2026-10-14, owner: "fix the 9 by 16s they all look off"). Keeping everything inside the
Reels safe band (y 269–1248) left a dead, dark third under every story, and the designs looked top-heavy. The stories were re-cut:
- the ring larger (a crop of about 0.55 of the photo's width), centred about a third of the way down;
- the words from about y 1000 to 1500, with hero lines 124–196 px and a deep shade from about 0.46 of the height;
- only the bottom fifth (Stories' own bar) left clear.

In Reels the lowest line or the mark may sit under the caption. That trade is accepted.

**To learn from a later round:** read the board and its `studio_board_views`. Diff every frame's `doc` against what was written
(bg adjust and placement; layers added, removed and changed: font, size, colour, weight, words, x/y). Look at the drawings side
by side, and put the pattern in MINA's rules here and in `brand.ts`. Revs above 1 with `by: 'page'` are the owner's.

**The owner's type, 2026-10-16** ("i made some changes in the boards, check and see, font changes spacing etc. fix the rest up"):
on the silver shoot board the owner restyled six ads in all their sizes. The small capitals moved off Tenor Sans to the house
sans and grew to about 24 px: the piece's line regular, the material bold, the button's words bold. Named designs keep the
italic name and line plus one pink bold capitals material line, with no separate stone line. Top-anchored named designs on a
light shirt get a larger name (about 1.3×) and a regular-sans line. Carried to the other 177 designs of the three shoot boards
(`.claude-tmp/restyle.mts`, not idempotent: its moves would repeat). The owner's own designs were left alone, except the Zara
4:5: its leftover stone line was removed and its line moved off the enlarged name, to match its 9:16 and 3:4. The rules are now
in `brand.ts`.

**Checks the owner's copy still needs** (raised 2026-10-14, not changed):
- "For the First time in Pakistan" is a claim: is 24K vermeil at 2.5 µm really first here?
- "Lesser Repolishes" reads better as "Fewer re-polishes".
- The Vera line says "24K gold vermeil", but Vera is rhodium-plated and white in the shot.

<a id="five-tabs"></a>### Five tabs

- **The Studio has five tabs** (2026-10-04, owner: "audit and consolidate ads tab"; there were eight): **Plan** (What to run —
  the plays; Ad days & rules — the old Guide; Competitors), **Photos** (Best for ads — the old Picks; Every photo — the old
  Library), **Make**, **Board**, **Saved**. A second row of chips picks the section (`?s=`); the old `?v=picks|library|guide|rivals`
  addresses open where they went. Picks and Library were one library twice; Plan, Guide and Competitors one question.
  **Setup** folds a finished step to its title (it was ~5,000 px of one-time instructions on a phone for a connected house; now
  ~2,400) and opens with the Readiness strip — which now also says when this ERP can't save the Meta login (step 2's red line,
  that had been below the fold). The audit found three things only the owner can do, all listed there: grant the App Hosting
  account Secret Version Adder on `meta-ads-token`, add `instagram_manage_insights` to the login configuration and connect
  again, and nothing was running (the one campaign ended 2026-10-01). The fourth — the pixel not on taheri.shop — was fixed in
  taheri-site (`src/lib/analytics.js`).


**The board's size** (2026-10-14, owner: "the board designer should take up 95% of the screen from the get go"). `BoardView` opens as a
*stage*: a fixed sheet 95vw × 95svh over a dimmed page (`stage`), the canvas filling it, the side panel (board name, the picked design) a
drawer over the board (right on a computer, a bottom sheet on a phone; the dock's panel button, and it opens on picking a design and
hides under the designer). The dock's X closes the stage to the board inside the page (72svh, with its picker); the same button
reopens it; Full screen is still the edge-to-edge page. The per-design designer is already a full-viewport portal; it now measures its
canvas area before the first frame and, on a computer that never chose, asks the browser for full screen when it opens.
