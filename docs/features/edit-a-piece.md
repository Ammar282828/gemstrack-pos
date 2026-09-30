# Edit a piece

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Edit a piece

- **Edit a piece** (`/website/edit`, Website menu, both houses; 2026-09-27, owner: "in both pos let me also fix/crop/add logo
  weight overlay to existing, change desc etc in taheri.shop or catalogue.houseofmina.store"). Any piece already on the house's
  site: the photo re-made in Post a Piece's square editor (`SoloEditor` in `story-editor.tsx`; its own shape or square; layouts
  Nothing / Weight / Weight + logo / Weight + t / Name, weight + logo — `applySquarePreset` now lays out on any frame height;
  crop by drag/pinch, filters, the designer; AI Enhance, Enhance and clear old labels, Ask AI), and the words: name,
  description, taheri.shop's tags (stone/metal/karat/cut/style) or the catalogue's facts, weight, hide. **Always edited from the
  original** (the site keeps it: `catalog-edit/originals/`; the image route's `original=1`, up to 3000 px), and the last design is
  kept in Firestore `website_edits` (per key, no AI photo), so re-opening shows it as left and nothing is stamped twice; a log in
  `website_edits_log`. The site keeps the change (`api/override.php` in taheri-site and mina-catalogue, secret
  `WEBSITE_UPLOAD_SECRET`): words in `catalog-overrides.json`, the photo **written over its own files** (a photo's path is the
  piece's identity) with a new `?v`. **The sites publish their own words; every reader lays the changes over them live** —
  `site-pieces.ts` (`withChange`; posting never offers a hidden piece), `getCatalogAttributes()` (prices follow a corrected
  stone/metal/karat at once; `{ own: true }` for the site's own), both sites' apps and prerenders — so "Undo every change" is
  exact at once. taheri.shop's weights stay in `website_pieces` (prices, WeightLabel); Mina's go in its change. A stamped photo
  sets `weightOnPhoto` so taheri.shop stops drawing the weight itself. `NEXT_PUBLIC_STORE_SITE_EDIT` (default on).
  **New drops too** (2026-09-27): taheri.shop's photos still in its drop folder (`api/catalog.php`, not yet in its attributes)
  are listed for the editor as `drop` pieces (no page yet, so posting never offers them); the site writes a re-made one over
  the drop's own file. **The website quote refuses platinum and silver** (`metal_enquire`): every metal but palladium used to
  be priced as gold at the full weight, which would have priced the Gents Ruby Rings ("925 Silver & 21K Gold") as solid gold.
  **The house's mark:** taheri.shop's photos carry the wordmark top-right (rings) or bottom-right (chains) — both are layouts
  (`catalogue-top`, `catalogue`). The Mina catalogue burns the MINA mark on at build (top right, maroon on light), so Mina's
  editor starts from the photo's **source** before framing and marking (`catalog-pieces.json` `source`, Shopify CDN or
  `catalog-src/`) and puts the mark back (`mark` layout, `/brand/mina-wordmark.svg`, `NEXT_PUBLIC_STORE_SITE_MARK_SVG` /
  `_INK` — derived from `STORE_BRAND`; `Assets.ink` is the dark ink auto colour uses). Changes show within about a minute
  (`catalog.php` is cached 30 s, taheri.shop keeps it 60 s per tab). Design notes: `docs/edit-website-pieces.md`.
