# Ad studio

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

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

- **Board** (`/ads/studio?v=board`, `board.tsx`; 2026-10-04, owner after an audit of pen.dev: "sure run it") — pen.dev's idea on the
  house's own parts: an endless canvas (drag to pan, pinch / ctrl-scroll to zoom, Fit) of **designs side by side** — each the maker's
  own layout document (`StoryDoc`) on one library photo, in one of the studio's shapes and layouts — and **sticky notes**.
  `studio_boards/{id}` holds a board (designs, notes, rev); every change is a list of **operations** (`board-shape.ts`, tested:
  add/put/move/remove, note/noteMove/noteText/noteRemove, rename) applied in a Firestore transaction (`board.ts`), so the page and an
  agent working at once never overwrite each other; the page asks `?since=<rev>` every 4 s. A design's `rev` goes up on every change
  (not on a move). A website photo is used through its **unmarked Drive original** when there is one (as the maker does), else as
  itself with `marked` (layouts add no wordmark).
  **Per design:** Edit (the maker's `SoloEditor` in a dialog; Save to the board), **Let it cook** (2–6 variants: Make it with AI's
  `op=direct` once per variant, each asked from another angle — `ANGLES` — plus the owner's aim or a note, three at a time for the
  Vertex quota; each lands beside the last, `by: 'ai'`, with the model's `why`), **In another shape** (a copy laid out afresh in any
  shape), Duplicate, Download (full size JPEG), Remove. Measured: two variants in 24 s.
  **An agent over MCP** (`/api/studio/mcp`, `board-agent.ts`, tested): **Connect an agent** makes a key (`tstudio_…`, kept as a
  SHA-256 hash in `app_settings/studio_agent`, shown once, revocable there, 600 calls an hour) and the `claude mcp add --transport
  http …` line. Plain JSON-RPC (Streamable HTTP, JSON answers only; notifications get 202). Thirteen tools: `get_style` (the house
  brief from `brand.ts`, the shapes, the layouts, the StoryDoc format, how to work), `list_boards`, `create_board`, `get_board` (notes
  first — the owner's instructions), `find_photos` (the library with the ERP's specs line and the assessment), `view_photo`,
  `add_design`, `update_design`, `move_design`, `remove_design`, `add_note`, `remove_note`, `view_design`. **The agent never lays
  out:** it gives a layout and words, and the page — the only place with the photo, the fonts and a canvas — lays the design out the
  next time the board is open, draws it, and posts a 720-px JPEG to `studio_board_views/{board}__{frame}` with the rev it shows;
  `view_design` returns that picture (or says it is stale / not drawn yet). Words an agent writes pass `wordProblems`: no sale words
  or hashtags (`breaksHouseRule`), no figure the ERP's specs line doesn't have (`inventedFigures`) — refused with the reason, so the
  agent fixes its call. A design's document from outside goes through `cleanDoc` (renderer's layer kinds only, numbers finite, ≤ 80
  layers, ≤ 60 KB, no uploaded pictures). Tried end to end on 2026-10-04 (local, real Firestore and Vertex): the agent added two
  designs and a note, its "22K and only 3g — 20% off" was refused, the page drew them, `view_design` returned the drawing; the test
  board and key were deleted after.
