# The link page

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Link page

- **The link page, both houses** (`/links`; links.taheri.shop, and **links.houseofmina.store** since 2026-09-26): what the one
  "Our links" QR on invoices, order slips and repair receipts opens (`storeLinksUrl()` ← `NEXT_PUBLIC_STORE_LINKS_URL`, else
  the POS's own `/links`). Words and links are variables (`STORE_LINKS`, `STORE_LINKS_PAGE` in `store-config.ts`: tagline,
  welcome, the top row `"lead|tail|line"`, website label, footer `visit`; TikTok, a separate online shop); the dress follows
  `STORE_BRAND` (Taheri #0A1111 / gold / Bodoni; Mina #140B0B / rose #E8A5AE / Newsreader). The top row is the **WhatsApp
  channel**, or the community for a house without one. Taheri's six community rows were removed (owner, 2026-09-25: "remove
  all community links"). Mina's: the Exclusive Sterling Silver community on top, Instagram, TikTok, a chat with +92 316 1930960
  (`NEXT_PUBLIC_STORE_WHATSAPP_URL`; the community moved to `_WA_COMMUNITY_URL`), the catalogue, houseofmina.store (Shopify),
  "Studio open daily, 12:30 – 8 pm · Karachi". links.houseofmina.store is an App Hosting custom domain on hom-pos; its DNS
  (A → 35.219.200.7, `fah-claim` TXT, ACME CNAME) was added through the GoDaddy API.
  **Redrawn 2026-09-29** (owner: "aesthetically improve links.taheri.shop and houseofmina's link page"): a **server page**
  (`force-dynamic`, no page JS). The layout had sent both customer pages (links, `/view-invoice`) as an empty `<body>` until the
  ERP's store hydrated; public paths now render at once. Header with the accent tagline and a hairline-and-diamond ornament; the
  top row is one card with the page's only filled button ("Follow / Join on WhatsApp"); **Just in** — 8 of the site's new
  arrivals, a spread across collections (`lib/website/showcase.ts`, tested; never a file name like "DSC…" or "Untitled design"),
  from `getSitePieces()` on the server (hidden pieces left out, 4 s cap, streamed in its own Suspense so the links never wait);
  the rest as one grouped list; "Come and see us" with tappable numbers. Colours in `LINKS_DRESS` (store-config), class names
  `lk-…` (the Liquid Glass sheet styles `.btn`/`.card`; glass is never applied on customer pages). Taheri's footer default is
  now its hours (no Najmi Market/Saddar). Shared on WhatsApp it previews as the shop — `<title>`, description and
  `og:image` `public/brand/links-share-<brand>.png` (1200×630, drawn in headless Chromium) — and `/view-invoice/<id>` as
  "INV-… · <house>", "Your invoice from …" (both said "Jewellery ERP"). The Zebra label-printer script loads only in the ERP.
  **Reviews, up top** (2026-10-01, owner: "add google reviews at the top or side or make it prominent somehow", both pages):
  the house's rating as a pill under the welcome (stars, the figure, how many and where) and a **What they say** strip after the
  WhatsApp card — real reviews quoted as written (`lib/reviews.ts`, tested: five stars first, 25–240 characters, one per reviewer
  and per piece), "Write a review" under them where the house has a link (it leaves the Find us list then). The last reading lives
  in each house's `app_settings/reviews`; the page waits on it at most 1.5 s, and the five-minute `social-queue-tick` reads the
  source again every six hours (`lib/reviews-server.ts`; a failure keeps the last reading and is written to `lastError`).
  **Taheri** is its Google listing "Taheri Collections" (`STORE_GOOGLE_PLACE`, the Maps feature id the review link resolves to):
  4.9 from 17 on 2026-10-01 (16 five-star, one four), read by hand from the public listing with its three featured reviews, since
  **the Places API (New) is not enabled in gemstrack-pos** — enabling it there is all it takes for the tick to keep it current (the
  server's own identity calls it; no key). **House of Mina has no Google listing** (none found that day), so hers are the Judge.me
  reviews of houseofmina.store — 4.81 from 138 — read live from the shop's metafields (`judgeme.all_reviews_rating`, `_count`,
  `reviews_grid`) through the ERP's Shopify access (`STORE_REVIEWS_SOURCE=judgeme`); the page never calls them Google's, and each
  quote links its piece. Judge.me's grid was last written 2026-03-25: no review has come in since March. A Google Business Profile
  for her studio would put her on Maps; the page then takes `STORE_GOOGLE_PLACE` like Taheri's.
