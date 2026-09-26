# Editing existing website pieces from the POS

**Status (2026-09-26): mapped and designed, nothing built yet.** Start here in a new session.

The owner's ask, in both POS: *"let me also fix/crop/add logo weight overlay to existing, change desc etc in
taheri.shop or catalogue.houseofmina.store"*. Today the POS can only **add** photos (Add Photos, Post a Piece)
and set counter weights (Photo Weights, Taheri only). Nothing can change a piece that is already on a site.
Edits should go live **without a site rebuild**, the way Add Photos drops do.

Three codebases are involved. Read each one's CLAUDE.md before touching it:

| Repo | Local path | Site | Deploys |
|---|---|---|---|
| this POS | `~/Projects/GemsTrack-POS` | pos.taheri.shop, pos.houseofmina.store | see CLAUDE.md, "Shipping a change to both houses" |
| taheri-site | `~/Projects/taheri-site` | taheri.shop | push to `main` → GitHub Actions → rsync to Hostinger |
| mina-catalogue | `~/Projects/mina-catalogue` | catalogue.houseofmina.store | push to `main` → GitHub Actions → rsync (gated by `DEPLOY_ENABLED=1`) |

Both sites are on one Hostinger account (server 145.79.26.82, Business plan order 1008754559). The two sites'
CLAUDE.md files call the POS `~/Projects/taheri-shop`. On the second laptop it is `~/Projects/GemsTrack-POS`.

File references below are to the commits mapped: POS `b1b34da`, taheri-site `bb821d3`, mina-catalogue `3a44828`.

---

## What blocks it today

1. **Neither site can replace a photo.** Both `public/api/upload.php` refuse to overwrite: a clash becomes
   `name-2.jpg` (`upload.php:137-145`, *"Never silently replace a piece that is already on the site"*). They only
   write inside `catalog-drop/`, and a drop is gallery content, i.e. a *new* piece.
   - taheri.shop throws away a drop whose path matches a baked piece, and the baked copy wins on a stem clash
     (`App.jsx:870-874`, `1076-1094`).
   - `img.php` reads only from `catalog-drop/`. Nothing can write `catalog-thumb/` or `catalog-full/`.
2. **Images are cached for 30 days** (`.htaccess`: `max-age=2592000`, not immutable) and Hostinger's CDN keeps
   copies. A photo replaced under the same URL stays stale. taheri.shop already fixes this with `?v=<hash>` from
   `src/image-versions.json`, but that file is baked into the bundle. The catalogue uses `PHOTO_VERSION` plus the
   framing version.
3. **Neither site reads a piece's text at runtime.**
   - taheri.shop: the name comes from `src/catalog-attributes-manifest.json` (a lazy, immutable JS chunk, written by
     `npm run names` / `attrs`). There is **no description field at all**: the piece page shows a fixed paragraph
     (`App.jsx:3349-3353`), and the meta description is generated (`pieceSeoCopy`, `seo.js:345-352`).
   - The catalogue: name, story and facts come from Shopify at build time (`src/catalog.json`, rewritten from scratch
     by `npm run sync`; `sync-shopify.mjs:270`).
4. **The prerender bakes text and images** into HTML: title, meta, og:*, JSON-LD, the static `.ssr` body, other
   pieces' "More like this" links, sitemaps, `llms.txt`, `catalog-pieces.json`. Crawlers and WhatsApp link previews
   see the old text and photo until the next deploy, even once the site applies edits at runtime.

## How a piece is named in each place

- **taheri.shop**: its photo path. Piece key = `Category/Collection/file.webp` (`normalisePieceKey`,
  `src/lib/website/catalog-source.ts:42-47`). **Inside the app the identity is the thumb URL**
  `/catalog-thumb/<encodeURI(key)>[?v=]`: favourites (localStorage), Builder covers in `site-config.json`, bag and
  recent all store that exact URL. `pieceKeyFromImage` (`src/lib/cart.js:40-45`) and `unversioned()` strip `?v=`.
  Slugs (`src/piece-slugs.json`) never change after they are given.
- **The catalogue**: `mina/piece/<h>`, where `h` is the Shopify handle, `local-<id>` for a local piece, or
  `new-<slug>-<mtime>` for a drop (unstable: the mtime is in it, so key drop edits by path `p`). One piece has many
  photos, each with an id `f` (`<handle>/<n>-<sha1[0:6]>` or `local/<id>`). Page URL = `/${co}/${s||h}`.
- **The POS**: `getSitePieces()` / `getSitePiece(id)` (`src/lib/website/site-pieces.ts`) list both houses' pieces as
  one shape (`id, name, url, image, thumb, collection, weightGrams, weightOnPhoto, facts, about, added, newArrival`).
  Use these, not `getCatalogAttributes()`, to validate keys, because the latter only exists for taheri.shop
  (`/api/website/pieces` PUT and `/api/public/quote` both break for Mina for that reason). `docIdFor(key)`
  (`src/lib/website/weights.ts:26-27`, base64url) is the per-piece Firestore doc id.

## Live channels that already exist

- **Site-side, same origin, already awaited before first render:** `GET /api/catalog.php`.
  - taheri.shop: `index.html:191-199` starts it in the head; `main.jsx:64` waits for `loadDrops()`
    (`catalog-drops.js:95-123`, 2.5 s timeout, 60 s sessionStorage cache) before importing `App.jsx`.
  - Catalogue: `src/lib/drops.js:9-21`, `no-store`, 2 s timeout, awaited in `main.jsx:32` before `buildCatalog()`.
  - `catalog.php` sends `public, max-age=30`; change to `no-store` if it carries edits (CDN).
- **POS-side:** `/api/public/quote` (taheri.shop only; carries `weightGrams` + `weightSource`, and `WeightLabel.jsx:47`
  draws a counter weight only when `weightSource === 'pos'`), `/api/public/featured` (60 s cache), `/api/public/me`.
  CORS (`src/lib/website/cors.ts`) already allows each house's `WEBSITE_ORIGIN`.

## Proposed design

### Source of truth: the POS

Firestore `website_piece_edits/{docIdFor(key)}`:
`{ key, house, name?, description?, facts?, attrs?: {metal, stone, cut, style, karat}, weightOnPhoto?, image?: {thumb, full, w, h, v, from}, base?: {name, imageId}, by, at, history[] }`.

- Taheri's counter weights stay in `website_pieces` (pricing reads them). If an edit changes metal, stone or karat,
  **pricing must see it too** (`pricing.ts:50-60`): merge edits in `mergeWeights` (`weights.ts:64-77`) so the quote,
  checkout lines (`checkout.ts:115-120`) and `site-pieces.ts` agree with the site.
- `base` records what the edit was made against (the site's name / photo id then), so a later Shopify sync or photo
  change can be flagged as a conflict instead of silently hidden.

### Delivery: the POS pushes, the site serves it itself

On every save the POS writes the whole edit map to the site through a **new** bearer-authenticated endpoint,
`public/api/edit.php` on each site (move `upload_expected_secret()` and the bearer check out of `upload.php` into
`_drops.php` so both share it; same `WEBSITE_UPLOAD_SECRET`). The site stores it as a JSON file outside the rsync'd
set (rsync never uses `--delete`, and it skips `catalog-drop*`), and **`catalog.php` returns it as `edits`** beside
the drops.

Why push instead of the site calling the POS: `catalog.php` is already on the critical path and same-origin, so no
extra request or CORS; the sites keep working when the POS or `.shop` is down (see the 2026-09-24 outage). If a push
fails, the POS page shows it and offers "Send again"; Firestore still holds the edit.

### Photos: render in the POS, upload under a new name every time

1. The POS renders the edited photo on a canvas (crop, logo, weight): reuse the square editor from Post a Piece.
2. It uploads through `edit.php` (or `upload.php` with `rel=_edits/...`) into a folder the gallery never scans
   (`catalog-drop/_edits/...` works on the catalogue because `dropPiece()` ignores folders that aren't chapters,
   `catalog.js:79-86`; taheri.shop needs the same check). **A new file name per edit** gets round the 30-day cache
   and the CDN; no in-place overwrite of `catalog-full/`, which the next rsync would clobber anyway.
3. The server makes the variants (taheri: 720 px q72 + 3000 px q88 WebP; catalogue: 720 q74 + 2000 q84) with the
   same code as `img.php`.
4. The edit stores `image: {thumb, full, w, h}`; the catalogue needs `w`/`h` (`Piece.jsx:120` shows portraits whole).

### Applying edits on each site

- **taheri.shop**: merge edits into `ATTR_IMAGES` in `loadAttributes()` / `attrsForImage` (`App.jsx:943-966`) and
  bump `attrsVersion`: filters, captions, the piece page and runtime SEO (`applyRouteSeo`) re-render from there.
  Swap image URLs in `_variantUrls` (`App.jsx:898-915`) and `fullUrlFromThumb` (`921-926`), **only at `<img src>`**:
  keep the identity URL (favourites, Builder covers, bag) unversioned or every saved heart breaks. Descriptions need
  a new slot in the piece page (replacing `3349-3353`) and in `pieceSeoCopy`.
- **Catalogue**: apply edits after `mergeLocal()` and before `buildCatalog()` (`main.jsx:33`). Then search, tiles,
  the piece page, recommendations and the WhatsApp message (`contact.js`) all follow. Never change `s` or `h`, and
  never override `t` before `mergeLocal` (local slugs come from `t` in load order). `imageUrls()` (`catalog.js:33-37`)
  already uses explicit `thumb`/`full` URLs as given. Edited text still passes through `houseWording()`.
- **Both prerenders** should fetch the live edits at build time, so the next deploy bakes them into HTML, og:image,
  JSON-LD, sitemaps and `catalog-pieces.json`.

### The POS page

`/website/edit` ("Edit a piece"), a tab under Website in `src/components/layout/app-layout.tsx:100-103`, behind a new
`NEXT_PUBLIC_STORE_EDIT_PIECES` flag in `store-config.ts` (default on). Reuse:

- Picker: `from-site/page.tsx:116-150` (grid, search, collection chips) over `getSitePieces()`.
- Source photo: `/api/website/site-pieces/image?id=` (only listed pieces, same-origin fetch). **Raise its 2048 px cap**
  (`image/route.ts:25`) for editing; taheri's full images are 3000 px.
- Editing: `PairEditor` with `show={['square']}` (`story-editor.tsx:929`, props `:124-151`; wiring in
  `post/page.tsx:1184-1216`), `emptySquare()`, `applySquarePreset` / `SQUARE_PRESETS`, `newWeightStamp()`,
  `newCornerMark()`, `renderDocTo(doc, fields, assets, px)` up to 3000 px (`editor.ts:769-1016`). Crop = `Placement`
  (`story.ts:36-44`). Marks and fonts load as in `post/page.tsx:295-305`. `stampPhoto` (`story.ts:304-328`) for a
  quick weight-only stamp. `/post/convert` for HEIC; `/post/ai` (enhance, reframe) optionally.
- API: `src/app/api/website/piece-edits/route.ts` (GET list, PUT text, POST photo, DELETE = revert) and
  `src/lib/website/piece-edits.ts`.

## Things to get right

- **Access.** Production runs `NEXT_PUBLIC_OPEN_ACCESS=1`. An edit route that follows the open gate lets anyone who
  finds the POS change live photos and names. Recommend the same always-verify gate as the order actions
  (`/api/website/orders/[id]`). The owner overruled a gate for Add Photos once (CLAUDE.md, "Decisions already
  made"), so **ask before gating**.
- **Photos that already carry a weight or mark.**
  - taheri.shop: 1,301 attribute entries have a weight read off the photo (files often named `*_overlay`). A new
    stamp can't remove an old one; warn like from-site does (`from-site/page.tsx:273-275`). The edit needs a
    `weightOnPhoto` flag feeding `weightSource`, or stamping a piece with a counter weight draws it twice.
  - Catalogue: the MINA mark is **burned in at build** (`scripts/brand.mjs:24-46`: 19 % of the width, 4.8 % in from
    the right, 3.7 % down; maroon `#3A0000` at 0.88 on light corners, white at 0.92 on dark), so cropping
    `catalog-full` cuts or doubles it. Start from the unbranded originals (Shopify CDN URLs in
    `data/image-sources.json`, or `/catalog-src/local/<file>`) and re-apply the mark with that geometry. Ring photos
    also get 55.5 % whitespace framing at build.
- **Logo position on Taheri photos is inconsistent:** `editor.ts` puts it bottom-right, `DiamondMark.jsx` and the
  site's notes say top-right. Settle it with the owner before stamping catalogue photos.
- **Shopify vs edits (catalogue).** An edit wins over every later Shopify edit, and `npm run sync` (CI can run it)
  rewrites `catalog.json`. Photo edits keyed by `f` stop matching when Shopify reorders or replaces photos; a title
  change changes the URL slug. Use `base` to flag conflicts. Alternative for published pieces: write the change to
  Shopify itself. **Ask the owner which one they want.**
- **Server/local drift (taheri.shop).** Edited photos exist only on the server; `npm run pretty` / `similar` / `attrs`
  and a manual variants rsync would still use or restore the old one. Needs an "adopt edits" step like `adopt-drops`.
- **Write permissions** into new server folders are unverified; `check.php` only proves `catalog-drop-cache/`.
- **Delay.** Warm loads use the cached drop list (30 s header + 60 s sessionStorage on taheri.shop), so an edit shows
  within about one or two page loads.

## Questions for the owner before building

1. Should editing need a sign-in, unlike the rest of the open POS?
2. Catalogue: should an edited description change the site only, or Shopify too (houseofmina.store)?
3. Taheri logo corner on catalogue photos: top-right or bottom-right?
4. "Change desc" on taheri.shop means adding a description the site has never had. Wanted on every piece page, or
   only where the counter writes one?

## Suggested order

1. **Text edits, both houses:** Firestore + POS page (picker + name/description/facts) + `edit.php` + `catalog.php`
   `edits` + apply on both sites. Smallest end-to-end slice; proves the push channel.
2. **Photo edits:** square editor on one existing photo (crop, logo, weight) → upload under a new name → apply.
3. **Pricing and SEO:** merge attribute edits into Taheri's quote and checkout; both prerenders bake live edits;
   an "adopt edits" script on taheri-site.

Ship taheri-site and mina-catalogue before the POS (the POS must handle a site without `edit.php` gracefully), then
Taheri's POS, then Mina's (CLAUDE.md, "Shipping a change to both houses").
