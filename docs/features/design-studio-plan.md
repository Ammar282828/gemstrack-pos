# Design: one place to make and post anything — plan

_Written 2026-10-12 from a read of the code and docs/features/{post-a-piece, from-the-website, ads, ad-studio, investments, edit-a-piece, notifications, ai, two-houses}.md. Nothing in the app was changed by this plan._

**The owner's ask (2026-10-12):** "make further improvements/enhancements/added customization and control/more features to the design studio; make it more powerful than Canva, especially fine-tuning controls/design; make sure all features to their extents are present; allow instant resizing using AI so any design can be converted smartly into different aspect ratios; allow easier and smarter parsing. The ERP is a bit cluttered in terms of ad/post/story/whatsapp design — bring everything together smartly allowing one area where it can be posted from, keeping all previous functionality. Merge it into one Design sub-tab; deal with the existing Studio in Ads smartly."

**The plan in one paragraph.** There is already one designer (`StoryDoc` + `renderDoc` in `src/lib/social/editor.ts`, edited by `story-editor.tsx` / `editor-panels.tsx`); the clutter is everything around it: three entry points that each wrap it differently (Post a piece, Ads → Studio → Make, the Board's `FrameEditor`) plus Edit a piece, each with its own photo picker, its own save (device drafts / `ad_saved` / `studio_boards` / `website_edits`), and its own "send it somewhere" code (`page.tsx` steps, `post-it.tsx`, board "Use it", `piece-card.tsx`). The plan keeps the engine and adds: (1) a **Design** tab in the Posts entry that holds the start screen, the one editor shell, the Photos library, the Board, Saved, and one **Publish sheet**; (2) a **resize engine** (deterministic re-layout by layer role, safe zones and subject focus, with an optional one-call AI plan, never re-drawing the jewellery); (3) **smart input** (paste anything → fields + photo) and a flat-image → layers splitter; (4) a **designer v2** closing the gaps against Canva Pro that matter to a jewellery shop; (5) a `designs` collection with read-through adapters, so no migration. Ads → Studio's research half (Plan) moves to Ads → Plan; its design half goes to Design. Every old URL redirects; every `/api` route stays (the native iPhone app calls them).

---

## 0. Decisions to confirm with the owner (defaults chosen)

**Settled 2026-10-12** (decided in the owner's stead, per their standing "do everything yourself"; the owner asked for "one area where it can be posted from" and "one design sub tab"): D1 as below; D2 as below; D3 as below; **D4 = yes** — Instagram feed posts by the API join the publish sheet (WP5 builds `publishPhoto()`); D5 = phase 2. Ignore the `STORE_DESIGN_TAB` flag in §6 — packages hide `/design` with `when: () => false` until WP7.

| # | Question | Default in this plan |
|---|---|---|
| D1 | Where does "Design" live? | A **tab of the Posts entry**: Posts = Hub · **Design** · Investments. Not a new sidebar row (the map decision: one tab row per screen, sidebar already 5 groups). |
| D2 | What happens to Ads → Studio? | The tab disappears. Its **Plan** (plays, ad days & rules, competitors) becomes **Ads → Plan**; **Photos, Make, Board, Saved** become Design sections. `/ads/studio?v=…` redirects to where each went. |
| D3 | Staff? | Staff keep Posts (`staff: true` on the tab) and can use Design for pieces/posts/stories/WhatsApp/website. Library with assessments, Board, Saved ads, Plan and "Meta ad" stay **owner + marketing** (they ride `adsGate`). |
| D4 | Instagram feed post by API? | Offered as an opt-in package item: the connection's scope already includes `instagram_business_content_publish`, but only `media_type: 'STORIES'` is implemented (`instagram.ts publishStory`). Default: still share sheet until the owner says go. |
| D5 | Video/animation | **Out of scope for this round** (listed as phase 2: Ken-Burns/shimmer story video via MediaRecorder; "a video story with a licensed track" was already offered and never chosen). |

---

## 1. Inventory — every design/posting surface

Legend for roles: **O** owner, **S** staff, **M** marketing (Mina's `NEXT_PUBLIC_STORE_MARKETING_EMAILS`). Gates: `postGate` (O/S/M, `src/lib/social/gate.ts`) vs `adsGate` (O/M, `src/lib/ads/gate.ts`; customer audiences `ownerOnly`).

### 1.1 Pages and what each does

| Surface | Route / file | Does | Who | Stores (Firestore unless noted) | Nav entry |
|---|---|---|---|---|---|
| **Post a piece** | `/website/post` · `src/app/website/post/page.tsx` (1,990 lines) | New photos → story 9:16 + square 1:1 + website photo + captions; AI (enhance, reframe/extend, restage, retouch, letter, paint, caption, check); Publish steps to website / set of day / WhatsApp groups+channel / Instagram story; queue; checks panel | O S M | **IndexedDB `taheri-post-drafts`** (drafts + photo blobs, 30 days); `localStorage taheri_post_prefs`, `taheri_post_formats`, designer templates (`tpl` keys); sends write `social_posts`; `social_errors`; queue `social_queue` + `social_queue_media`; Instagram's `social_media` (5-min public relay) | Posts › Post a piece (`when: STORE_POST_PIECE`) |
| **Posts hub** | `/posts` · `src/app/posts/{page,piece-card,piece-design,today}.tsx` | Today (send log), the queue panel, the website's pieces as cards (caption, AI words, weight stamp, `piece-design.tsx` = crop & design in a square editor, site story), Send all / Later; Investments "today" strip | O S M | `social_posts`, `social_queue*`, `investment_posts` (read) | Posts › Hub |
| **Edit a piece** | `/website/edit` · `src/app/website/edit/page.tsx` | Re-make an existing site photo from its original in a square `SoloEditor`; words/weight/hide; site overrides via `api/override.php` | O S M | `website_edits` (last design per key, no AI photo), `website_edits_log` | Website › Edit a piece (`STORE_SITE_EDIT`) |
| **Add photos** | `/website/photos` | Upload a tray to a site collection; Retouch/Original per photo; set of the day | O S M | none of its own (site relay) | Website › Add photos |
| **Photo weights** | `/website/weights` | Weight overlay tool (Futura) | O S M | `website_pieces` | Website › Photo weights |
| **Investments** | `/website/investments` · API `src/app/api/investments/**` | Daily gold post filed by the owner's Cowork routine; edit words; send post/square/teaser/story; schedule + tick | O S M | `investment_posts`, `investment_media`, `app_settings/investments_schedule` | Posts › Investments (`STORE_INVESTMENTS`; Mina off) |
| **Ads → Studio** | `/ads/studio` · `src/app/ads/studio/page.tsx` (5 tabs) | See 1.2 | O M | see 1.2 | Ads › Studio (`STORE_AD_STUDIO`) |
| **Ads → New ad** | `/ads/new` | Builds campaign→ad set→ad; reads `?piece=` and `?studio=<key>` (sessionStorage `taheri_studio_handoff:`) | O M | `ads_log`, Meta | Ads › New ad |
| **Link page** | `/links` (server page) | Consumes site pieces ("Just in"); **not** a design surface — leave alone | public | `app_settings/reviews` | outside nav |
| **WhatsApp reports/PDFs** | `src/lib/notifications/**`, `app-pdf.ts` | Operational PDFs, not designs — leave alone | — | — | Settings › Alerts |

### 1.2 Ads → Studio, tab by tab (`src/app/ads/studio/`)

| Tab (`?v=` / `?s=`) | File | Does | Data |
|---|---|---|---|
| Plan › What to run | `plan.tsx`, `lib/ads/studio/plays.ts` | Plays by funnel stage; "Make this" → maker set up for the play | none |
| Plan › Ad days & rules | `guide.tsx`, `calendar.ts`, `playbook.ts`, `brand.ts`, `/api/ads/studio/guide` | Bohra calendar quiet days, the account's own winners, house rules | `app_settings/ad_studio_winners` |
| Plan › Competitors | `rivals.tsx`, `research.ts`, `/api/ads/studio/competitors` | Gemini+Search finds rivals; IG Business Discovery | `ad_competitors` |
| Photos › Best for ads / Every photo | `library.tsx`, `assets.ts`, `drive.ts`, `assess*.ts`, `/api/ads/studio/{library,image,assess,drive}` | taheri.shop photos + Drive folders + uploads, each assessed once by the vision model; fixes run through `/api/website/post/ai` | `ad_assets`, `app_settings/ad_studio_{drive,assess}`, `studio_uploads` |
| **Make** | `maker.tsx` (736), `post-it.tsx`, `templates.ts` | The Post-a-piece `SoloEditor` on a Meta frame; 8 layouts (`AD_TEMPLATES`), AI words (`/copy`), "Make it with AI" (`/auto` ops `direct`, `paint`), pre-flight check (`/check`), **Post it** (story/WhatsApp/site), **Use it in a new ad** | `ad_studio_creatives` |
| **Board** | `board.tsx` (1,714), `board-shape.ts`, `board.ts`, `board-agent.ts`, `weekly.ts`, `/api/ads/studio/boards`, `/api/studio/mcp`, `/api/ads/studio/{agent-keys,weekly,fetch-image,uploads}` | Endless canvas of designs + notes; Let it cook (2–6 AI variants); another shape; `FrameEditor` = the designer in a dialog; Use it ▾ (Queue a post / new Meta ad / Saved); MCP agent (13 tools); Monday weekly board; paste/drop/link import | `studio_boards`, `studio_board_views`, `studio_uploads`, `app_settings/{studio_agent,studio_weekly}` |
| **Saved** | `saved.tsx`, `lib/ads/studio/saved*.ts`, `/api/ads/studio/saved` | Made ads in folders; ads already in Meta's account; reopen in Make | `ad_saved`, `ad_saved_media` (900 KB parts), `ad_folders` |

### 1.3 The shared designer and its helpers

- **Document:** `StoryDoc` (`src/lib/social/editor.ts:146`) = `bg` (photo + `Placement` + dim + gradient + `shade` + `color2` + `adjust`) + `layers: Layer[]` (`TextLayer | MarkLayer | ShapeLayer | ImageLayer`) + `frame` + per-photo `placements`. `Fields = {kicker, headline, weight, details}`; text layers `bind` to a field.
- **Engine:** `renderDoc/renderDocTo` (editor.ts:812/856), `layerBox`, `hitTest`, `reflow`, `carryLayers` (:469), `scaleLayer` (:452), presets (`PRESETS`, `SQUARE_PRESETS`, `TEXT_STYLES`, `BADGES`), `src/lib/social/design.ts` (18 `SHAPES`, 10 `MASK_PICKS`, `Adjust`+`FILTERS` (12), `applyAdjust`, `alignDeltas`, `distributeDeltas`, `snapLines/snapBox`), `story.ts` (`drawStoryPhoto`, `Placement`, `Frame`, `PALETTES` via `palettes.ts`), `fonts.ts` (headline, body, Bodoni + 5 extras loaded on first use).
- **UI:** `story-editor.tsx` (`useStoryDoc` undo 80 steps, `useEditor`, `Stage` canvas, `PairEditor`, `SoloEditor`, `Designer` full screen, `DesignerExtras` host hook), `editor-panels.tsx` (Templates, Elements, Text, Photos, Brand, Layers, Background, Position, Effects, Font, Colour, Transparency, Frame, Photo edit).
- **Ad frames and layouts:** `lib/ads/studio/templates.ts` (`AD_FORMATS` 4 Meta + 7 more, `customFormat`, `nearestAiRatio`, `safeZone` = top 14% / bottom 35% for ≥1800-high frames, `metaFeedFit`, `applyAdTemplate`, `blankAd`, `paintedAd`).
- **AI:** `/api/website/post/ai` ops `enhance reframe restage custom retouch letter paint caption check` (gate: Post a piece or Edit a piece enabled; daily cap `IMAGE_AI_DAILY_CAP` 300, 60/h/caller); `/api/ads/studio/{copy,check,auto(direct|paint),assess,rates}`; `/api/website/site-pieces/caption`; Magnific retouch (`lib/social/retouch.ts`, base `https://api.magnific.com/v1/ai`). One Vertex key (`ai-fallback.ts` hands 429 models over). Quotas are tiny per minute — design every new AI call as **one call per user action**.
- **Native iPhone app** (`apps/iphone`): "Studio is native" — it calls `/api/website/post/ai`, `/api/ads/studio/{saved,competitors,uploads,boards…}` and runs `src/lib/social` bundled as `design-<house>.js` in a web view. **Whenever `src/lib/social` changes run `node apps/iphone/scripts/design-bundle.mjs` and commit both files**; nav JSON via `npm run nav:export`. So: API routes stay (additive only), new `StoryDoc` fields must be optional (the phone keeps unknown fields as raw JSON), and the iPhone's own screens are not touched by this plan.

### 1.4 Destinations and how each is reached today

| Destination | Reached by | Size sent | Houses |
|---|---|---|---|
| Website collection (Add photos relay) | `POST /api/website/photos` (Post a piece step; `post-it.tsx`; Hub cards) | 1:1 ≤ 3000 px, weight stamped (not for AI-painted) | both |
| Website "set of the day" | `/api/website/featured` | square | Taheri |
| Replace an existing site photo | `/api/website/edits` + `api/override.php` | its own shape, from original | both |
| WhatsApp groups (`WHATSAPP_POST_GROUPS`) | `POST /api/website/post` with `targets` (keys, never chat ids) | 1:1, 1600 px, caption | both |
| WhatsApp channel | same, key `channel`; WAHA only | 1:1 | Taheri only (`WHATSAPP_CHANNEL_ID`); Mina none |
| Instagram story | `POST /api/instagram/story` → `story-post.ts` (Firestore relay) else share sheet | 9:16, 1080×1920 JPEG ≤ 900 KB | Taheri connected; **Mina never** (no Instagram app) → share sheet |
| Instagram feed post | share sheet only | — | both |
| Meta ad | `/api/ads/images` + `ad_studio_creatives` + `/ads/new?studio=` handoff; `?piece=` | any; adds the 9:16 as second asset | O/M; both houses |
| Queue / schedule | `/api/website/post/queue` (+ `/[id]` parts, `/send`, `/tick` every 5 min) | story, wa-N squares, site squares | both |
| Download / share sheet | `Designer.download`, "Save the story and the post" | PNG/JPG | both |
| Investments' own parts | `investments-send.ts` | cards from the routine | Taheri |

### 1.5 Duplicated capabilities (what the merge removes)

| Capability | Where it exists now |
|---|---|
| **Make a square 1:1 image** | (1) Post a piece square editor (`SQUARE_PRESETS`); (2) Ads Make 1:1 (`AD_FORMATS.square` + `applyAdTemplate`); (3) Hub `piece-design.tsx` / `site-design.ts`; (4) Edit a piece square editor; (5) Board design at `square`; (6) `site-story.ts` for the story variant of a site photo. Six ways, three layout vocabularies (`SquarePresetId`, `AdTemplateId`, `site-design`). |
| **Make a 9:16 story** | Post a piece story (`PRESETS`), Ads Make 9:16 (templates + safe zones), Board 9:16, `site-story.ts`. |
| **Photo picker** | `site-picker.tsx` (Post a piece), `PicksSection/LibrarySection/AssetSheet` (Studio), board photo picker (`fetch-image`, Drive, uploads), Add photos' tray. |
| **Send to WhatsApp/IG/site** | `page.tsx` publish steps, `post-it.tsx`, board `queuePost`, `piece-card.tsx`, `investments-send.ts`. Each re-implements target discovery (`/api/website/post` GET, `/api/instagram/status`, `/api/website/photos` GET). |
| **Save** | IndexedDB drafts (device), `ad_saved` (+`ad_folders`), `studio_boards` frames, `website_edits`, designer templates in `localStorage` (device). |
| **AI words** | `caption` op (Post a piece), `/ads/studio/copy`, `/website/site-pieces/caption`, `art-direct.ts`. |
| **Another shape** | `carryLayers` (story↔post), Board "In another shape" (re-run template), Studio "Extend to another shape" (photo only), Studio "Every size" (draws on screen). Four partial resizers. |
| **Pre-flight check** | `/ads/studio/check` (ads only), `HealthPanel` (dependencies), `breaksHouseRule/inventedFigures` (copy). |

---

## 2. Designer capability audit vs Canva Pro

Legend: **have** / **partial** / **missing**. Jewellery priority: **P1** (needed for the shop's ads/posts/stories/WhatsApp), **P2** (nice, soon), **P3** (rare for this shop).

### 2.1 Canvas, layers, layout

| Canva capability | Ours | Evidence | Pri |
|---|---|---|---|
| Layers panel (reorder, hide, lock, rename) | **have** (drag reorder via HTML5 DnD; ⌘[ ⌘]) | `LayersPanel` editor-panels.tsx:886, `draggable` :911; `Base.name/hidden/locked` | — |
| Group / ungroup | **have** (shared `group` id) | `Base.group`; ⌘G / ⇧⌘G story-editor.tsx:~408 | — |
| Align / distribute | **have** (to selection or page) | `alignDeltas`, `distributeDeltas` design.ts:144/159; `AlignButtons` | — |
| Snapping, smart guides | **partial**: centre/margin/other-edge snapping; **no equal-spacing guides, no distance labels, no snap-to-grid** | `snapLines/snapBox` design.ts:181/191 | P1 |
| Rulers, draggable guides, grid, margins view | **missing** (0 hits) | — | P1 |
| Precise X/Y/W/H/rotation | **partial**: X, Y, width, rotate, size; **height read-only for text/mark; no lock-aspect; no multi-selection numbers** | `PositionPanel` editor-panels.tsx:936 | P1 |
| Lock | **have** | `Base.locked`, ⌥⇧L | — |
| Opacity | **have** (0.05–1) | `Base.opacity` | — |
| Blend modes (multiply, screen, overlay, soft light…) | **missing** | only an internal `source-in` (editor.ts:784) | P1 (multiply for shadows under a cut-out piece; screen/overlay for glow and gold light) |
| Shadow / outline / glow on shapes and images | **partial**: text has 8 effects; image has boolean `shadow` + border; **shapes have none; no glow; no adjustable image shadow** | `EffectKind` editor.ts:40; `ImageLayer.shadow` :129 | P1 |
| Multi-select, marquee, shift-add | **have** | `marquee` story-editor.tsx:454, 587 | — |
| Copy/paste, cut, duplicate, **copy style/paste style**, copy between pages | **have** | `copyStyle/pasteStyle`, `sendToOther` | — |
| Undo/redo | **have** 80 steps, coalesced; **no history list, lost on close** | `useStoryDoc` :53 | P2 |
| Zoom/pan on canvas | **partial** (fit + pinch; zoom buttons in full-screen) | `ZoomIn/ZoomOut` imports | P2 |
| Keyboard shortcuts + cheat-sheet | **partial**: ⌘Z/Y/A/C/X/V/D/G, ⌘[ ], arrows (⇧ ×10), Del, Enter; **no cheat sheet, no ⌘+/−, no ⌘⌥C/V style, no Tab to cycle** | story-editor.tsx:396-420 | P2 |
| Safe-zone overlay | **partial**: shaded top 14% / bottom 35% on 9:16 only (ads) | `safeZone` templates.ts:101 | P1 |

### 2.2 Text

| Capability | Ours | Evidence | Pri |
|---|---|---|---|
| Text styles / presets | **have** (headings + 8-ish `TEXT_STYLES`) | editor.ts:906 | — |
| Font pairing | **have** ("Font combinations") ; **14 faces**, no upload of own font | `FontKey` editor.ts:22; fonts.ts | P2 (more faces, own font) |
| Letter-spacing, line-height | **have** | `spacing`, `lineHeight` | — |
| Per-character kerning | **missing** | — | P3 |
| **Rich text (mixed weight/colour/size in one box)** | **missing** — one style per layer | `TextLayer` single `font/color/size` | **P1** (price in gold inside a sentence; "21K" bold) |
| Lists (bullets/numbers) | **missing** | — | P2 (spec lists) |
| Curved text | **have** | `TextLayer.curve` | — |
| Text effects (shadow, lift, hollow, outline, splice, echo, neon, glitch) | **have** | `EFFECTS` | — |
| **Gradient / metallic (foil) text fill** | **missing** | — | **P1** (gold foil headline) |
| Auto-fit / shrink to fit, box background | **have** | `fit`, `box` | — |
| Text on a path other than a simple arc; vertical text | **missing** | — | P3 |
| Bound fields (headline/kicker/weight/details follow the form) | **have — better than Canva** | `Bind`, `reflow` with `flow.gap` | — |

### 2.3 Images, photo editing

| Capability | Ours | Evidence | Pri |
|---|---|---|---|
| Crop (drag/pinch inside frame), flip | **have** | `ImageLayer.fx/fy/iz`, `flipX/Y` | — |
| Frames / masks | **have** (10 masks) | `MASK_PICKS` | — |
| Filters (presets) | **have** 12 | `FILTERS` | — |
| Adjust: brightness, contrast, saturation, temperature (as `warmth`), fade, vignette | **have** (pixel maths, Safari-safe) | `Adjust` design.ts:85 | — |
| **Highlights, shadows, tint, hue, blur, sharpen, clarity, grain** | **missing** | — | **P1** (sharpen/clarity make stones sparkle; highlights/shadows rescue gold glare) |
| Curves/levels | **missing** | — | P3 |
| Gradient overlay on photo | **have** (`Shade`) | editor.ts:143 | — |
| Duotone / colour wash | **missing** | — | P3 |
| **Background remover** | **missing in designer** (only AI "Logo and labels off" and Magnific retouch exist) | no `remove-background` route | **P1** (cut-out piece + soft shadow on brand ground is the standard jewellery ad) |
| Magic edit / eraser | **partial**: whole-image "Ask AI" (`custom` op) and enhance-tidy; **no region select** | `customPrompt` | P2 |
| Magic expand | **have** (reframe/Extend to any of 10 ratios, same-piece check) | `reframePrompt`, `nearestAspect` | — |
| Image upscale | **have** (Magnific Precision after retouch) | retouch.ts | — |
| Replace photo keeping the layout | **have** (board `FrameEditor` Pictures panel) | board.tsx | — |

### 2.4 Elements, data, brand

| Capability | Ours | Evidence | Pri |
|---|---|---|---|
| Shapes (18), lines (solid/dash/dot), arrows, curved strokes | **have** | `SHAPES`, `ShapeLayer.dash/curve` | — |
| Gradient fills | **partial**: two-colour linear top→bottom on shapes; **no angle, radial, multi-stop** | `fill2` editor.ts:107 | P2 |
| Stickers/icons library | **partial**: `BADGES` + shape set; **no icon library** | editor.ts:976 | P2 |
| Charts, tables | **missing** (the gold-rate board is a special template) | `rateBoard` templates.ts:123 | P3; but a **live rate element** bound to ERP rates is P2 |
| **QR code** (WhatsApp wa.me, website) | **missing** | — | **P1** (print + story link-in-bio) |
| Brand kit (colours, fonts, logos) | **partial**: house palette + wordmark/t SVGs recoloured, `BrandPanel`; **no editable kit, no extra logos, no per-campaign kits** | `MarksSection` | P2 |
| Templates | **partial**: 5 story presets, 7 square presets, 8 ad layouts, user templates **per device only** (localStorage), no shared team templates | `templateKey` story-editor.tsx:92 | P1 (shared) |
| Multi-page / carousel | **partial**: exactly two pages (story+post) in `PairEditor`; no N-page doc, no carousel/brochure | `PairEditor` | P1 (carousel for ads & WhatsApp multi-send) |
| **Resize / Magic Switch** | **partial**: four partial resizers (see 1.5) — none re-flows free layers | `carryLayers`, board "another shape" | **P1 (this plan §3)** |
| Animations / video | **missing** | — | phase 2 |
| Comments / collaboration | **partial**: Board sticky notes; none inside the designer | `BoardNote` | P3 |
| Version history | **partial**: Saved ads overwrite; Edit a piece has an edit log | `website_edits_log` | P2 |
| Export | **partial**: PNG / JPG only, fixed `0.95`; **no PDF, no WebP, no transparent PNG, no scale chooser, no multi-size zip, no per-page range** | `download('png'|'jpg')` story-editor.tsx:370 | P1 (print PDF, transparent PNG for the cut-out, "export all sizes") |
| Presentation / print bleed marks | **missing** | — | P3 |

**Jewellery-specific things Canva doesn't have and we should keep ahead on:** bound fields from the ERP specs; weight stamp in the overlay geometry; same-piece AI check; Bohra calendar and house rules in the pre-flight; per-house palette/marks via variables; safe-zones for stories; ERP gold-rate board. New: **spec chips** (karat/stone/weight as pills), **price tag** element, **hallmark/certificate badge** (exists in `BADGES`), **size-guide** element (ring size chart), **live rate widget**.

### 2.5 Engine contract for designer v2 (all optional fields — safe for the phone bundle)

```ts
// src/lib/social/editor.ts (additive)
type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'color-dodge' | 'darken' | 'lighten';
interface Base { /* …existing… */ blend?: Blend; role?: LayerRole /* §3 */; fx?: LayerFx }
interface LayerFx { shadow?: { color: string; x: number; y: number; blur: number; alpha: number }; glow?: { color: string; blur: number; alpha: number }; outline?: { color: string; width: number } }
interface Adjust { /* …existing… */ highlights?: number; shadows?: number; tint?: number; hue?: number; sharpen?: number; blur?: number; grain?: number }
interface TextLayer { /* …existing… */ runs?: TextRun[]; list?: 'bullet' | 'number' | null; fillGradient?: Gradient | null }
interface TextRun { from: number; to: number; font?: FontKey; color?: string; size?: number /* ×; relative */; upper?: boolean; underline?: boolean; gradient?: Gradient }
interface Gradient { type: 'linear' | 'radial'; angle: number; stops: { at: number; color: string; alpha?: number }[] }
interface ShapeLayer { /* fill2 stays */ fillGradient?: Gradient | null }
interface QrLayer extends Base { kind: 'qr'; x: number; y: number; w: number; value: string; fg: string; bg: string | null; quiet: number }  // new kind → add to LAYER_KINDS in board-shape.ts
interface ImageLayer { /* …existing… */ cutout?: boolean /* alpha PNG from the remover */; }
interface StoryDoc { /* …existing… */ meta?: { template?: AdTemplateId; master?: string; guides?: { x: number[]; y: number[] }; subject?: Box01 /* 0..1 */; grid?: number } }
```
Rules: every consumer treats missing = today's behaviour; `cleanDoc` (board-shape.ts) must accept `qr` and the new keys; `MAX_DOC_BYTES` (60 KB) stays — runs/gradients are small.

---

## 3. AI resize — convert any design to any aspect ratio

### 3.1 What exists, and why it isn't enough
- `carryLayers` (editor.ts:469): story↔post only; keeps the *relative centre*, shrinks, never grows, ignores text wrapping and safe zones.
- Board "In another shape": `layOut` → `applyAdTemplate` on the new frame — good for template-born designs, **drops hand edits**.
- `AD_FORMATS` + `MORE_FORMAT_ORDER` + `customFormat` give the frames (all 1080 wide); `nearestAiRatio` gives the image model's ratio; `safeZone` the story bands; `metaFeedFit` how Meta crops 1.91–4:5; `reframePrompt` extends a photo to any of `AI_RATIOS` with the same-piece check.
- Wide frames (> 1.4:1) already lay out side by side inside `applyAdTemplate`.

### 3.2 Design: `resize(doc, fields, assets, targets[]) → ResizeResult[]`
Pure, in `src/lib/design/resize.ts` (+ `roles.ts`, `safe.ts`, `score.ts`), no DOM — tested in node. Three steps:

**Step 1 — roles.** `roleOf(layer, doc)` returns `LayerRole = 'photo' | 'headline' | 'kicker' | 'specs' | 'cta' | 'mark' | 'badge' | 'frame' | 'band' | 'decor' | 'text' | 'image'`. Evidence, in order: explicit `layer.role`; `bind` (`headline`→headline, `kicker`→kicker, `weight`→specs, `details`→cta); `name === 'template'` + kind (shape spanning ≥ 90% = `frame`/`band`); `wordmark` kind → `mark` (anchor corner by its centre); `image` with `photoId` `lib:*` → `image`; text with `box` and short = `badge`; everything else `text`/`decor`. `applyAdTemplate` sets `role` as it lays down (small edit, `mine()` in templates.ts), so template docs are exact and free-hand docs are inferred.

**Step 2 — three candidate re-layouts, scored, best wins:**
1. **Template re-lay** (only when `doc.meta.template` exists): `applyAdTemplate(doc, template, fields, a, {photoMarked, rates})` on the target frame — it already owns tall/square/wide — then re-attach the user's own layers (those without `name === 'template'`) through strategy 2.
2. **Anchor-preserving**: for each layer compute `anchor` ∈ {tl, t, tr, l, c, r, bl, b, br} from its centre in the source, margins as a fraction of `min(W,H)`, size scale `k = sqrt(targetArea/sourceArea)` for text *size* but `width` as the same fraction of the target width (so lines re-wrap); photo insets and frames scale by `min(tw/sw, th/sh)`. Text stacks (headline/kicker/specs/cta) keep order and their gap ratio, then `reflow` (existing, `flow.gap`) stacks them; marks pin to their corner. Wide targets (> 1.4:1) switch to **panel** layout: photo on one side (55%), text stack on the other.
3. **Safe-first** (for ≥ 1800-high targets): same as 2 but every text/badge box is clamped into `[safe.top, h − safe.bottom]` and CTA moves above the bottom band.

Photo: `Placement` is recomputed by `fitSubject(photo, subject, frame)` — mirror of `drawStoryPhoto` maths (story.ts:152) — to find `focusX/focusY/zoom` that keep the **subject box** (normalised, from `doc.meta.subject` or the asset's `focus`, default centre 60%) fully visible with ≥ 6% padding; if it can't (e.g. 1:1 piece → 21:9), mode `fit` on the blurred backdrop and `needsExtend = true` (the UI offers **Extend the photo** = the existing `reframe` op + same-piece check; never done silently).

**Score** (`scoreLayout`, 0–100): −40 any text box outside the frame or the safe bands; −25 overlapping text boxes (`intersects` from design.ts); −20 min text size < 3% of the short side (≥ 28 px at 1080 wide for stories); −15 mark overlapping the subject box; −10 subject cropped > 8%; +5 each: stack aligned to a margin, CTA lowest. The candidate with the highest score wins; ties prefer strategy 1.

**Step 3 — optional AI plan (one call for all sizes).** `POST /api/design/resize` `{ source: {doc (layers summarised: id, role, kind, box, text), thumbJpeg}, targets: Frame[], deterministic: ResizePlan[] , thumbs of the deterministic results, goal }` → Gemini (`TEXT_MODEL`, falls back through `ai-fallback.ts`; **text/vision only — no image model**) returns
```ts
interface ResizePlan { frame: Frame; photo?: { mode: 'fill'|'fit'; zoom: number; focusX: number; focusY: number }; needsExtend?: boolean;
  layers: { id: string; x?: number; y?: number; width?: number; size?: number; align?: 'left'|'center'|'right'; hidden?: boolean; rotate?: number }[]; note: string }
```
`cleanPlan` validates (ids exist, numbers finite, inside the frame ± 5%, size 12–600, width 80–2400, no new layers, no text changes, hidden only for `decor`/`mark` duplicates), then `scoreLayout` again; the AI plan is used only if it **scores ≥ the deterministic one** — otherwise the deterministic plan stays and the note says so. The AI never sees or returns pixels; the jewellery photo is untouched except by the user's explicit Extend. Cap: `DESIGN_AI_DAILY_CAP` (default 200) + 60/h/caller, same pattern as `AD_STUDIO_AI_DAILY_CAP`; guard with `postGate`.

### 3.3 UX
- **Resize** button in the editor header and on every Saved/Board card → sheet with grouped size chips: *Ads* (4:5, 1:1, 9:16, 1.91:1 — Meta), *WhatsApp* (1:1), *Website* (1:1 3000 px), *Story* (9:16), *More* (the seven `MORE_FORMAT_ORDER`), *Custom W:H* (`customFormat`). Multi-select → "Resize" creates pages `origin: 'resized'` in the same design set (one deterministic pass: instant; "Smart" toggle adds the AI plan).
- Each resized page keeps `syncedFrom = master`. Editing it flips `origin: 'manual'`; re-sync never overwrites a manual page (offers "Re-do from master" instead). **Words follow automatically** (bound fields are shared by design); free-text edits on the master offer "Apply to the other sizes" (role + text match).
- Safe-zone overlay by destination (`safe.ts`): 9:16 story top 14% / bottom 35% (current), 4:5 feed cropped to 1:1 grid centre, Reels bottom 35% + right 15%, 1.91:1 link; Meta crops shown by `metaFeedFit`. Toggle "Show safe zones" generalises today's shading.

---

## 4. Smarter parsing

### 4.1 What exists
| Piece | Where |
|---|---|
| Outside picture from a link/Instagram post (og:image / twitter:image), 15 MB cap, SSRF-guarded | `/api/ads/studio/fetch-image` + `lib/ads/studio/outside-image.ts` — **only the Board uses it**; Post a piece/Make can't |
| Site pieces (name, collection, weight, specs, new-arrival, `url`, `path`, `dropPath`) | `getSitePieces`, `site-picker.tsx`, `lib/website/{site-pieces,site-photo,drop-path,new-arrivals}.ts` |
| Specs line from ERP facts | `lib/ads/studio/specs.ts pieceSpecs` |
| Vision assessment (subject, category, shot, background, burned-in text, fixes, headline) | `assess.ts`, `assessment.ts` (`ad_assets`) |
| Caption + story plan from photo + facts | `/api/website/post/ai` op `caption`; `art-direct.ts` (layout + words from photo + specs); `/ads/studio/copy` |
| Scanners (Gemini 3.1 Pro, JSON): order slip, written bill | `/api/vision/{order,bill}`, `lib/vision/*` |
| Voice → structured steps | `/api/voice/listen`, `lib/voice/*` |
| Drive link → folder id | `lib/ads/studio/drive-link.ts` |
| Rule checks: `inventedFigures`, `breaksHouseRule`, `wordProblems` | `lib/ads/studio/prompts.ts`, `board-agent.ts` |
| Filename sequence matching (camera name `DSC09342`) | `originals.ts` |
| **No** text→fields parser, **no** background/subject segmentation, **no** text-region OCR to layers, **no** URL→piece resolver outside `fetch-image`. |

### 4.2 Proposal: **Smart input** (one box on the Design start screen and in the Photos panel)
"Paste, drop or type anything" — a single `SmartInput` component + `parseInput()`:

```ts
// src/lib/design/parse.ts (pure part) ; /api/design/parse (AI + fetch part)
type InputKind = 'text' | 'url' | 'image' | 'sku' | 'files';
interface ParseResult {
  kind: InputKind; confidence: number;                       // 0..1, shown as a chip; < 0.6 asks the user
  fields: Partial<Fields>;                                    // kicker/headline/weight(specs line)/details(CTA)
  specs?: { karat?: string; metal?: string; stone?: string; weightG?: number };
  price?: { amount: number; currency: 'PKR' };
  piece?: { siteId?: string; productId?: string; name: string; collection?: string; url?: string };
  photos: { ref: string /* site:…, lib:up:…, blob */; role: 'main' | 'alt' }[];
  caption?: string; suggestedKind?: DesignKind; warnings: string[];
}
```
**Deterministic first (instant, free, tested):** `parseSnippet(text)`:
- weight: `45.350g`, `45.35 gm/grams`, `2 tola 3 masha`, `ratti` (tola = 11.6638 g — `TOLA_G` in templates.ts; masha = tola/12, ratti = masha/8); karat `21k|21kt|21 karat`; metal words (gold, silver 925, sterling, platinum, palladium); stones (ruby, emerald, diamond, polki, kundan, zircon…) from a list; price `Rs 125,000|PKR 125000|125k|1.2 lac|1.2 lakh|1 crore` (inverse of `lib/money.ts`); name = first non-fact line; WhatsApp forward noise (timestamps, `~ sender:`) stripped; Roman-Urdu keywords (`wazan`, `qeemat`, `tola`).
- URL kinds by host: this house's website piece (match `getSitePieces` by `path/url` → full piece + original photo through `site-photo.ts`); catalogue.houseofmina.store piece; Mina's Shopify product (Shopify lib in `src/app/api/shopify/_lib.ts`: title, price, images, handle); Instagram post/reel (`fetch-image` og:image + og:description → run `parseSnippet` on the caption); any page (og:title/og:image/og:description); Google Drive link (`drive-link.ts` → add as a folder, owner only); **ERP SKU/tag** text (`lib/sku.ts` pattern → `products` via the staff-safe read path; staff/marketing already read `products`).
- Output always passes the house rules: figures come from the pasted text only, so `pieceSpecs` builds the specs line and `inventedFigures` stays satisfied.

**AI when regex is unsure** (`/api/design/parse` op `text`, one `generateJson` call, `CHECK_MODEL`-class model, schema = `ParseResult.fields/specs/price`): handles paragraphs, mixed Urdu/English, "make me a story for this" instructions (`suggestedKind`), and a pasted WhatsApp message with several pieces (returns an array → creates one design per piece, grouped in a folder).

**Image drop** (`op image`, vision): reads burned-in text (weight labels — `weightSource === 'label'` logic already knows taheri.shop's mark), category, subject box (0..1) → `doc.meta.subject` (feeds resize), burned-text flag (offer "Logo and labels off"), suggested headline from `assessment`. Multiple files: **group by piece** (camera sequence like `originals.ts`, or user drags to split) → batch of designs; first is the main photo.

### 4.3 Flat image → editable layers (stretch, own package item)
`/api/design/layers` pipeline, each step existing or one new route:
1. Vision call returns `{ text: [{ text, box, role, fontClass, weight, colour }], subject: Box01, background: 'clean'|'textured'|'busy' }`.
2. Subject cut-out through **Magnific remove background** on the same key (`lib/social/retouch.ts` already speaks to `https://api.magnific.com/v1/ai` with a start/poll helper — add one `removeBackground()` there; confirm the exact endpoint path in Magnific's API docs when building; `mcp__magnific__images_remove_background` exists as a reference) → PNG with alpha → `ImageLayer.cutout` (uploaded via the existing `studio_uploads` route).
3. Clean plate: existing `enhance` + `tidy: true` ("Logo and labels off") then the **same-piece check** (`check` op) — if it fails, keep the original as the background and hide the OCR'd text areas under a sampled colour patch, or stop and say so.
4. Build a `StoryDoc`: `bg` = plate, `ImageLayer` cut-out above it (with the new `fx.shadow`), text layers from OCR with nearest `FontKey` (condensed/serif/regular/futura/script by `fontClass`) and `autoColor` off, roles set → resizable.
5. Review screen overlays each detected layer with accept/skip, then opens the designer. Never regenerates the jewellery; every pixel of the piece comes from the cut-out of the user's photo.

---

## 5. Information architecture

### 5.1 One Design area

```
Posts (Marketing group, staff: true)
  Hub · Design · Investments           ← Design = /design (new tab; old /website/post tab goes)
Ads (owner + marketing)
  Overview · Campaigns · Plan · New ad · Setup     ← Studio removed; Plan = old Studio › Plan
Website (unchanged)
  Add photos · Edit a piece · Photo weights
```
`src/lib/nav.ts`: add the tab (`href: '/design', label: 'Design', icon: Palette, staff: true, when: () => STORE_DESIGN, keywords: ['post','story','ad','whatsapp','canva','studio','instagram','poster','resize','board','creative','new arrivals']`, `match: ['/website/post','/ads/studio']` so old paths light it), remove the Post a piece tab, remove the Studio tab, add Ads → Plan (`/ads/plan`, `when: STORE_AD_STUDIO`), keep redirect pages listed under `pages` with `when: () => false` (the `/settings/weprint-api` precedent; `nav.test.ts` demands every page is registered and every registered address has a page). `STORE_DESIGN = STORE_POST_PIECE || STORE_AD_STUDIO || STORE_SITE_POSTS` (computed in `store-config.ts`, no new env var; each destination/section is still switched by its own flag).

**Roles inside Design** (`src/lib/design/gate.ts`: `designGate(req, need: 'post' | 'ads')`): *post* = owner, staff, marketing (as `postGate`); *ads* = owner, marketing (as `adsGate`). Staff see: Make (pieces, device photos, site pieces, any destination except Meta ad), Saved (their shop designs), device drafts. Hidden for staff: Photos library with scores/Drive, Board, Plan, Meta ad, ad pre-flight. Customer-audience stuff is untouched.

**Both houses** (all from existing flags/endpoints — nothing house-specific is forked): Taheri: WhatsApp groups + channel, IG story via API, set of the day, Investments, rate/investment layouts, Bohra calendar. Mina: WhatsApp groups only (no `WHATSAPP_CHANNEL_ID`), **no Instagram app → story/post go to the share sheet** (already true: `postGate`/`instagram/status` says unconnected), no set of the day, no Investments (`STORE_INVESTMENTS "0"`), catalogue photos with the MINA mark, `brand.ts HouseBrand` for palette/voice, her own plays. The publish sheet asks `GET /api/design/destinations` (new; wraps `/api/website/post` GET + `/api/instagram/status` + `/api/website/photos` GET + flags) and renders only what the house has, each with the reason when missing ("Instagram isn't connected on this ERP — Share sheet instead").

### 5.2 Design page layout (`/design`, sections via `?v=` like the Studio did — one tab row, chips for sections)

| Section (`?v=`) | Shows | Who | Replaces |
|---|---|---|---|
| **Make** (default) | Start screen → workspace. Start: **Smart input** box (§4), "What are you making?" cards (Piece: story + post · Ad · WhatsApp · Website photo · Story · Custom size), Continue (device drafts, recent saved), Templates | O S M | Post a piece start, Make start, Plan's "Make this" entry |
| **Photos** | Source rail: This ERP's site pieces (new arrivals first, search, collections), My uploads, Drive, Library "Best for ads" (O/M only: scores, fixes) | S: site + device only; O/M: all | `site-picker.tsx`, `PicksSection`, `LibrarySection`, `AssetSheet` |
| **Board** | The existing Board, unchanged, but **Edit** opens the same shell and **Use it ▾** opens the same Publish sheet | O M | Studio › Board |
| **Saved** | One shelf: `designs` + legacy `ad_saved` + "In the ad account" + "On this device" drafts; folders (`ad_folders`) | S: shop designs only | Studio › Saved, Post a piece's Drafts dialog |

**Workspace (the one editor shell)** = `DesignWorkspace` (`src/app/design/workspace.tsx`):
- Top: name, kind chip (Ad / Post / Story / WhatsApp / Site), **page strip** (master + resized pages as thumbnails; `+ size` opens Resize), Undo/Redo, Safe zones, **Publish ▾**.
- Centre: `Designer`/`PairEditor` from `story-editor.tsx` (full-screen designer stays; phones unchanged). `DesignerExtras` hosts: *Pictures*, *Words* (copy: AI words, headline/kicker/CTA, house-rule chips), *Resize*, *Check*.
- Right/bottom on desktop: the **piece card** (name, collection, specs line from ERP, price, photos starred), AI menu (Make it with AI / Paint / New setting / Extend / Retouch / Ask AI — the existing ops), caption editors per destination.
- Bottom: the **Publish sheet** (§5.3). Phone: same, as bottom sheets (existing pattern).
- `kind` only changes defaults (frames, layouts, safe zones, which destinations are ticked); every kind can resize to any other.

### 5.3 The Publish sheet (`src/app/design/publish-sheet.tsx`)
One component, one list. Rows (each only if the house/role has it): **Website** (collection picker, Add photos relay) · **Set of the day** · **WhatsApp groups** (ticks, remembered `waTargets`) · **WhatsApp channel** · **Instagram story** (API or Share sheet) · **Instagram post** (Share sheet; API if D4) · **Meta ad** (O/M; opens `/ads/new?studio=` with both sizes) · **Replace the photo on an existing site piece** (when the design came from one) · **Download** (PNG/JPG/PDF/zip of all sizes) · **Save** (designs) · **Queue** (hold) · **Schedule** (time, or spread over the day).
- Each row declares `needs: { ratio: '1:1'|'9:16'|'any'; maxPx; caption: 'wa'|'ig'|'ad'|null }` (`src/lib/design/destinations.ts`, pure, tested). The sheet picks the matching page of the design set; if none, the row offers **Make 9:16 from this** (= resize, §3) instead of failing. WhatsApp and the website only ever get 1:1 (the owner, 2026-09-25) — enforced by `needs`.
- Captions: one editor per family (WhatsApp / Instagram / Meta primary text + headline), "Write with AI" = the existing `caption` op; Meta fields only when the Meta row is ticked.
- Checks before sending: `HealthPanel` strip (existing), ad pre-flight (`/ads/studio/check`) when Meta is ticked, `wordProblems` always, the community confirm ("a thousand-odd customers" asks once more). Steps run one at a time with per-step retry and `uploaded/sent` memory so a retry never double-posts (the contract in `post-drafts.ts`).
- Output: the same endpoints as today (nothing server-side changes for sending) via `src/lib/design/publish.ts` client functions extracted from `post-it.tsx`, `board.tsx` (`queuePost`, `toNewAd`, `saveToSaved`) and `website/post/page.tsx`. Queue items keep `sitePiece` so the Hub's "posted" logic and `social_posts` keep working.

### 5.4 URLs and redirects (all preserve the query string, as `/website/from-site` does)
| Old | New |
|---|---|
| `/website/post` (`?new=1`, `?draft=<id>`, `?site=<id>`) | `/design?v=make` + same params (Hub's "Post a piece", "New piece", "Still making X" links updated to `/design`) |
| `/ads/studio` (no `v`/`plan`) | `/ads/plan` |
| `/ads/studio?v=plan|guide|rivals` (`&s=`) | `/ads/plan?s=plays|guide|rivals` |
| `/ads/studio?v=photos|picks|library` | `/design?v=photos&s=picks|library` |
| `/ads/studio?v=make` | `/design?v=make&kind=ad` |
| `/ads/studio?v=board` | `/design?v=board` |
| `/ads/studio?v=saved` | `/design?v=saved` |
| `/website/edit`, `/website/photos`, `/website/weights`, `/website/investments`, `/posts`, `/ads/new` | unchanged (Edit a piece gets an "Open in Design" button for the photo; its words/weight/hide form stays) |
| `/api/**` | **unchanged** (iPhone app + MCP agent depend on them); new routes live under `/api/design/**` |

### 5.5 Data model — migration-free consolidation

Firestore (admin SDK only, like `ad_saved`; no rules change needed; not in Backups):
```ts
// designs/{id}   + design_media/{id}__{key}__{n}  (900 KB parts, same helper as lib/ads/studio/saved.ts)
interface DesignRecord {
  id: string; name: string; folder: string | null;           // folders = the existing ad_folders collection
  kind: 'piece' | 'ad' | 'story' | 'post' | 'whatsapp' | 'site' | 'custom';
  scope: 'shop' | 'ads';                                     // 'ads' → owner + marketing only
  source?: { siteId?: string; productId?: string; assetId?: string };
  fields: Fields; copy: { price?: string; wa?: string; ig?: string; adText?: string; adHeadline?: string; goal?: GoalKey; link?: string };
  pages: { id: string; label: string; format: AdFormat; frame: Frame; origin: 'master' | 'resized' | 'manual'; syncedFrom?: string; rev: number }[];
  master: string;
  files: Record<string, number>;                              // 'doc:<pageId>', 'image:<pageId>', 'photo:<photoId>' → part count
  thumb: string;                                              // 200-px data URL
  published: { at: string; by: string; dest: string; ok: boolean; ref?: string }[];   // last 20
  legacy?: { savedAdId?: string; boardFrameId?: string; draftId?: string };
  at: string; updated: string; by: string; rev: number;
}
```
- **Read-through adapters, no migration job** (`src/lib/design/store.ts`, `saved-compat.ts`): `listDesigns()` = `designs` ∪ `ad_saved` mapped by `fromSaved()` (id `saved:<id>`, `kind:'ad'`, `scope:'ads'`, one page); a legacy row whose id is in some `designs.legacy.savedAdId` is hidden. Opening a `saved:` item reads it with the existing `getSaved/readFile`; the first **Save** writes a `designs` record (so the old `ad_saved` doc is simply superseded). `/api/ads/studio/saved` keeps working for the iPhone app.
- **Boards stay `studio_boards`**; a frame gets optional `designId` + `pages`-style variants later. "Edit" on a board frame opens the workspace; Save puts the frame (`doc`, `fields`) back with the existing `put` op; "Save as design" copies it into `designs`.
- **Post-a-piece drafts stay on the device** (IndexedDB; photos are megabytes) and appear in Saved › On this device with Continue/Delete; `PostDraft` gains `designId?` when the user taps **Save to shop** (stores only the final-size page images + docs, not the photo blobs).
- **Designer templates** (`localStorage` per device today) move to `designs`-adjacent `design_templates/{id}` (kind-aware, shared, owner/marketing can publish; staff can use) — new collection, read-only fallback to the device list.
- **Queue** (`social_queue*`) unchanged. **Hub** unchanged (still the quick-send for site pieces; its cards get a Design button and use `publish.ts`).

---

## 6. Work packages

Rules for all packages: Node 20; `npx tsc --noEmit -p .`; `npx vitest run`; `npm run build` is the lint gate; no hook after an early return (decisions › Hooks); every colour/class respects Liquid Glass/dark mode; **coarse-pointer buttons need `min-h-0` for round ones**; new strings follow "ERP" naming and sentence case; no new env var unless stated; **ship to both houses together** (CLAUDE.md "Shipping a change"). Packages that touch `src/lib/social/*` must finish with `node apps/iphone/scripts/design-bundle.mjs` and commit both generated files; packages that change `nav.ts` must run `npm run nav:export` and commit `apps/iphone/App/Resources/nav-*.json` (`nav-export.test.ts` fails otherwise). Branch per package; `cloud-deploy` merges to production with no review, so **WP7 (cutover) is the only package that changes what the owner sees**; WP0–WP6 are additive and dark (new route reachable only by URL, tab behind `STORE_DESIGN_TAB` constant `false` until WP7).

### Order and overlap

```
WP0  Foundation ────────────────┐   (MUST GO FIRST; ~small, serial)
                                ├─► WP1 Engine v2        (files: social/editor.ts, design.ts, board-shape.ts LAYER_KINDS)
                                ├─► WP3 Resize           (files: lib/design/{roles,safe,score,resize}.ts, api/design/resize, resize-sheet.tsx)
                                ├─► WP4 Smart input      (files: lib/design/parse*.ts, api/design/{parse,layers}, smart-input.tsx, retouch.ts +removeBackground)
                                ├─► WP5 Publish          (files: lib/design/{destinations,publish}.ts, api/design/destinations, publish-sheet.tsx)
                                └─► WP6 Shell            (files: app/design/** only, imports old components in place)
WP1 ─► WP2 Designer UI v2   (files: story-editor.tsx, editor-panels.tsx, new panels/*.tsx)  [parts not needing new engine fields may start with WP1]
WP1..WP6 ─► WP7 Cutover     (moves, redirects, nav, docs, Ads → Plan)
```
Disjoint file sets: WP1/WP2 own `src/lib/social/**` + `src/app/website/post/{story-editor,editor-panels,fonts}.tsx`; WP3/WP4/WP5 only create files under `src/lib/design/**`, `src/app/api/design/**`, `src/app/design/*.tsx` (each its own named file); WP6 owns `src/app/design/{page,workspace,start,saved-shelf,photos-section}.tsx`; WP7 alone touches `nav.ts`, `ads/studio/**`, `website/post/page.tsx`, `posts/**` links, docs and CLAUDE.md. WP4's single shared-file touch is `retouch.ts` (append-only).

### WP0 — Foundation (first; blocks all)
**Goal:** types, flags, stores and gates exist; nothing visible.
- `src/lib/social/editor.ts`: **types only** — add optional `Base.role/blend/fx`, `StoryDoc.meta` (§2.5 contract, `LayerRole`); no behaviour.
- New `src/lib/design/model.ts` (`DesignKind`, `DesignRecord`, `DesignPage`, `Destination*` types), `sizes.ts` (one `SIZE_PRESETS` table built from `AD_FORMATS`/`MORE_FORMAT_ORDER`/WhatsApp/Website/Story + `sizeForDestination`), `gate.ts` (`designGate`), `store.ts` + `saved-compat.ts` (server: list/get/save/move/delete over `designs`, `design_media`, shared `ad_folders`; reads legacy `ad_saved`), `src/lib/design/index.ts` barrel.
- New API: `src/app/api/design/designs/route.ts` (GET list with `scope` filtered by role; POST multipart save as `saveAd` does), `designs/[id]/route.ts` (GET meta/file, PATCH move/rename, DELETE), `designs/folders/route.ts`.
- `src/lib/store-config.ts`: `export const STORE_DESIGN = STORE_POST_PIECE || STORE_AD_STUDIO || STORE_SITE_POSTS;`.
- `src/app/design/page.tsx` placeholder ("Design — coming"), **not in nav yet**; add to `nav.ts` `pages` of Posts with `when: () => false` so `nav.test.ts` stays green.
- **Acceptance:** `tsc` clean; `vitest` green; `GET /api/design/designs` returns the legacy `ad_saved` rows as `saved:<id>` for an owner, `[]` of scope `ads` for staff; 401/403 paths per `designGate`.
- **Tests (vitest, node):** `src/lib/design/model.test.ts` (size table covers every `AD_FORMATS` key; `sizeForDestination('whatsapp') === 1:1`), `saved-compat.test.ts` (`fromSaved` mapping, hidden when superseded), `gate.test.ts` (role matrix, `OPEN_ACCESS`), `nav.test.ts` still green.

### WP1 — Designer engine v2 (after WP0)
**Files:** `src/lib/social/editor.ts`, `design.ts`, `story.ts` (only if needed), `fonts` additions in `src/app/website/post/fonts.ts` (+ `public/fonts`), `src/lib/ads/studio/board-shape.ts` (`LAYER_KINDS`, `cleanDoc` accepts new keys/`qr`), new `src/lib/social/qr.ts` (tiny QR encoder, no dependency; or `qrcode-generator` from cdn-free npm — add to package.json), new `src/lib/social/gradient.ts`.
**Build (renderer + pure maths, no UI):** blend modes via `globalCompositeOperation`; `fx` shadow/glow/outline for shapes, images, marks; extended `Adjust` (highlights, shadows, tint, hue, sharpen (unsharp mask), blur (box/stack), grain) inside `applyAdjust` with tests for neutrality at 0; rich text `runs` (layout per run in `layoutText`, wrapping across runs) + `list` + `fillGradient`/run gradients (linear/radial, multi-stop) shared by shapes/text/bg; `QrLayer`; `cutout` flag (draw with alpha, shadow follows the alpha); multi-stop gradient bg; 6 extra font faces (suggest: a jewellery set — e.g. Cormorant Infant/Italiana/Jost/Tenor Sans/DM Serif/Marcellus; all `next/font/local` per the Fonts decision) and `FontKey` extension; per-layer `role` setter in `applyPreset`, `applySquarePreset`, `TEXT_STYLES`, `BADGES`; `snapLines` gains equal-spacing detection and grid; `layerBox` for runs.
**Acceptance:** all new fields optional; `renderDoc` of every existing saved doc is byte-identical (golden test: render with `@napi-rs/canvas`/existing test canvas harness if present, else compare the draw-call log); iOS bundle rebuilt and committed; `cleanDoc` round-trips new fields and rejects bad ones.
**Tests:** `design.test.ts` (adjust neutral at defaults; highlights/shadows monotone; sharpen/blur kernels), `editor.test.ts` (runs layout, list numbering, gradient stops sort/clamp), `gradient.test.ts`, `qr.test.ts` (known vector from a QR spec), `board-shape.test.ts` (accepts `qr`, rejects NaN).

### WP2 — Designer UI v2 (after WP1; the non-engine items may start with WP1)
**Files:** `src/app/website/post/story-editor.tsx`, `editor-panels.tsx`, new `src/app/website/post/panels/{adjust,blend,fx,text-runs,guides,export,shortcuts,history,brand-kit}.tsx` (new files keep the two big files from growing). **No other package edits these two files.**
**Build, by jewellery priority:** P1 — rulers + draggable guides + grid + margin view (`doc.meta.guides/grid`), equal-spacing smart guides with distance chips; Position panel: X/Y/W/H for every kind, **lock aspect**, multi-selection numbers, "match size/position"; blend selector; FX controls (shadow/glow/outline) for shapes/images/marks; photo **Adjust** panel with the new sliders + before/after hold; rich-text toolbar (select a range → colour/weight/size/gradient) + gold-foil presets (brand gradients from `brand.ts VISUAL`); QR element (WhatsApp number/link from `STORE_LINKS`, website); **Export dialog** (PNG/JPG/WebP/**PDF**, quality, 1×/2×/3×, transparent PNG, all pages/zip — PDF via existing `jspdf` already in `pdf-*` libs); shared templates UI (reads `design_templates`, falls back to device list); safe-zone overlay toggle driven by `safe.ts` (stub constant until WP3). P2 — history list (undo stack with labels), shortcut cheat-sheet (`?`), ⌘+/⌘−/⌘0 zoom, Tab cycles layers, ⌘⌥C/V style, bullets/numbers, brand-kit panel (house kit read-only + user colours), multi-page strip hook (the page-strip prop is rendered by the shell in WP6).
**Acceptance:** phone and desktop checked via the gate's `?dev=1` in headless Chrome (puppeteer with the Mac's Chrome) at iPhone width and 1440 px; no regression in `PairEditor`, `SoloEditor`, board `FrameEditor`, Edit a piece (all four hosts); the 16-px input rule; `DesignerExtras` contract unchanged (add fields only).
**Tests:** pure helpers extracted to `src/lib/social/guides.ts` / `export-plan.ts` and tested (guide snapping, export size maths, PDF page size from frame at 300 dpi); UI covered by the manual checklist in the PR.

### WP3 — Resize engine (after WP0; parallel with WP1)
**Files (all new):** `src/lib/design/{roles,safe,score,resize}.ts`, `src/lib/design/resize-ai.ts` (prompt + schema + `cleanPlan`), `src/app/api/design/resize/route.ts`, `src/app/design/resize-sheet.tsx` (exported component, props: `{ doc, fields, assets, subject?, onCreate(pages) }`).
**Build:** §3 in full: `roleOf`, `anchorOf`, `fitSubject`, three strategies, `scoreLayout`, `resize()`; `cleanPlan` + route (one Gemini call for N targets, daily cap + per-hour limit, falls back silently to deterministic); size chips from `sizes.ts`; thumbnails of each result before accepting; `needsExtend` flows to the existing `reframe` op (client call helper reused from `studio-kit.runImageOp`).
**Acceptance:** for the 8 `AD_TEMPLATES` × 11 formats + 3 custom ratios the result has score ≥ 80 and **no text outside the safe bands on ≥ 1800-high frames**; a free-hand doc (three text layers, a badge, a mark, an inset) resized 4:5 → 9:16 → 1.91:1 → 1:1 keeps order, wraps, no overlap; the route returns the deterministic plan when the model is 429 (`ai-fallback`) or returns junk; the jewellery photo is never sent for editing by this package.
**Tests:** `roles.test.ts`, `resize.test.ts` (table-driven over formats; idempotence: 4:5→9:16→4:5 lands within 2% of the original boxes), `score.test.ts`, `resize-ai.test.ts` (`cleanPlan` rejects unknown ids, NaN, out-of-frame, text edits), `safe.test.ts` (9:16 bands = `safeZone`).

### WP4 — Smart input and layer splitter (after WP0; parallel)
**Files (new):** `src/lib/design/{parse,parse-url,units}.ts`, `src/app/api/design/parse/route.ts`, `src/app/api/design/analyze/route.ts` (image op: subject box + burned text + category, writes `focus` into `ad_assets` when the image is a library asset), `src/app/api/design/layers/route.ts`, `src/app/design/smart-input.tsx`; append-only `removeBackground()` in `src/lib/social/retouch.ts`.
**Build:** §4: `parseSnippet`, unit conversion (tola/masha/ratti), money parser (rs/k/lac/crore), host router (this house's site, catalogue, Shopify product, Instagram, generic og, Drive link, SKU), AI text parse with schema, image analyze, multi-piece paste → array, group-by-piece for dropped files; layer splitter pipeline (§4.3) behind `DESIGN_LAYERS=1`-style constant (default on for owner/marketing, off for staff to protect quota); `fetch-image` reused (import `sharedImage`, not duplicated) and widened from the Studio gate to `designGate('post')` through a thin new route `GET /api/design/fetch` (the old route stays).
**Acceptance:** 30 real captions/messages from the send log (`social_posts`, WhatsApp samples in tests as fixtures, Roman-Urdu included) parse weight/karat/price correctly ≥ 90%; no figure ever appears that isn't in the input (`inventedFigures` passes); an Instagram post URL yields photo + caption fields; a taheri.shop piece URL yields the original photo and specs; layer splitter on 5 sample flat ads returns editable text + cut-out and the same-piece check passes or the splitter degrades to "original + text layers".
**Tests:** `parse.test.ts` (fixtures incl. "2 tola 3 masha", "Rs 1.2 lac", "21K | Ruby | 12.35 g", forwarded WhatsApp headers), `units.test.ts`, `parse-url.test.ts` (host routing, SSRF refusal reusing `publicUrl` tests), `layers.test.ts` (OCR→`TextLayer` mapping, font-class table, roles).

### WP5 — Publish layer (after WP0; parallel)
**Files (new):** `src/lib/design/destinations.ts` (pure availability + `needs`), `src/lib/design/publish.ts` (client: `sendWhatsApp`, `sendStory`, `uploadSite`, `queueItem`, `toMetaAd`, `saveDesign`, `download`; step runner with `uploaded/sent` memory), `src/app/api/design/destinations/route.ts` (one GET wrapping the three existing status calls + flags + role), `src/app/design/publish-sheet.tsx`, optional `src/app/api/instagram/post/route.ts` + `publishPhoto()` in `src/lib/social/instagram.ts` **only if D4 = yes**.
**Build:** §5.3. Extract, don't rewrite: copy the call shapes from `post-it.tsx`, board `queuePost/toNewAd/saveToSaved`, `website/post/page.tsx` publish steps — those files are **not modified** here (WP7 deletes them after parity).
**Acceptance:** on Taheri the sheet lists website, set of the day, groups, channel, IG story (API), IG post (share), Meta ad (owner), queue, schedule, download, save; on Mina no channel, no set of the day, no Investments, IG = share sheet; staff see no Meta row; a failed step retries alone and never double-sends; a 1:1-only destination with only a 9:16 page offers "Make 1:1 from this".
**Tests:** `destinations.test.ts` (matrix: house × role × connection → rows and reasons), `publish.test.ts` (step runner with fake senders: partial failure, retry idempotence — pattern of `queue.ts sendItem` fakes), `sizes.test.ts` (destination → page selection).

### WP6 — Design shell (after WP0; integrates WP1–5 as they land, stubs until then)
**Files (new, all under `src/app/design/`):** `page.tsx` (replaces WP0 placeholder), `start.tsx`, `workspace.tsx`, `piece-card.tsx` (named `design-piece.tsx` to avoid the Hub's), `photos-section.tsx`, `saved-shelf.tsx`, `use-design.ts` (state: `DesignRecord` ↔ `useStoryDoc` per page; autosave to the device draft every 1.5 s exactly as `post-drafts.ts`), imports `story-editor`, `library.tsx`, `board.tsx`, `maker`'s copy/check helpers **in place** (no moves).
**Build:** §5.2: start screen with `SmartInput` slot, kinds, Continue; workspace with page strip, `PairEditor`/`SoloEditor`, `DesignerExtras` panels (Pictures, Words, Resize, Check), `PublishSheet` slot; Photos section (site pieces always; library for O/M); Board section mounts `BoardSection`; Saved shelf over `/api/design/designs` with folders, "On this device" drafts, "In the ad account". Dark, reachable at `/design`.
**Acceptance:** a piece goes start → workspace → Publish (website + WhatsApp + story) end-to-end against a real Taheri backend (use the checks panel); an ad goes start → Make → Meta handoff; Board edit round-trips; staff view hides O/M-only sections; phone layout per the "one tab row" decision; no hooks after early returns.
**Tests:** `use-design.ts` pure reducer parts in `design-state.ts` with `design-state.test.ts` (page add/remove, origin flips to `manual` on edit, master change resync flags); the existing `nav.test.ts`.

### WP7 — Cutover and clean-up (last; after WP1–6)
**Files:** `src/lib/nav.ts` (+ `nav.test.ts`, `npm run nav:export`), `src/app/website/post/page.tsx` → thin redirect (`/design`), `src/app/ads/studio/page.tsx` → redirect, new `src/app/ads/plan/page.tsx` (moves `plan.tsx`, `guide.tsx`, `rivals.tsx` unchanged), `src/app/posts/{page,piece-card,today}.tsx` links, `src/app/website/edit/page.tsx` ("Open in Design"), `src/app/ads/studio/{maker,post-it,saved}.tsx` retired once WP6/WP5 cover them (keep `library.tsx`, `board.tsx`, `studio-kit.tsx`, `drive` helpers; move to `src/app/design/` with `git mv` and fix imports), `docs/features/{post-a-piece,ad-studio,ads,from-the-website}.md` (links, "moved to Design"), this plan → a "Design" section in `docs/features/design.md`, `docs/decisions.md` (new **Design** entry: one tab, one editor, one publish sheet, one shelf) and the matching line in `CLAUDE.md`, `docs/in-progress.md`.
**Acceptance:** every old URL in §5.4 lands on the right place with its query; `nav.test.ts` green (every page registered, every registered address has a page); palette finds "Studio", "Post a piece", "Canva" → Design; iPhone nav JSON regenerated; both houses build; **owner walkthrough** on both houses (staff, marketing accounts too).
**Tests:** `redirects.test.ts` (table of old → new including `?v=`/`&s=`), nav tests, `nav-export.test.ts`.

---

## 7. Risks and notes

1. **Size of `website/post/page.tsx` (1,990 lines).** We do not rewrite it; we replace its *callers* (shell + publish sheet) and delete it in WP7. Until then both paths work.
2. **AI quota.** One Vertex key, per-model per-minute limits (`ai-fallback.ts`). Resize AI = 1 call per action; parse = 1 call; layers = ≤ 3 calls. Everything has a deterministic or no-AI path.
3. **iPhone app.** Native Studio screens hit existing APIs and the bundled `src/lib/social` engine — additive fields only, rebuild the bundle after WP1, regenerate nav JSON after WP7; the app maps `/ads|/website|/posts` prefixes to native screens by id (`ScreenRegistry.swift:59`), so URL moves on the web don't break it. A native Design tab is a separate iOS task.
4. **Gates.** `postGate` admits staff, `adsGate` doesn't; every new `/api/design/*` route calls `designGate` with the right `need`, and the Library/Board/Meta routes it proxies keep `adsGate`. Never merge them.
5. **No migration.** `ad_saved` and `studio_boards` stay readable forever; if the owner later wants one collection, a script in `scripts/` can copy `ad_saved` → `designs` (dry-run first).
6. **Memory.** Server routes that decode images (analyze, layers) must read one image at a time (the 2026-10-01 OOM). Cap 25 MB, resize with `sharp` to ≤ 1600 px before the model.
7. **Brand rules.** All generated words pass `breaksHouseRule` + `inventedFigures`; Bohra calendar and "investment" rules stay in `brand.ts` (Taheri) — Design reuses them, it doesn't copy them.
8. **Out of scope (phase 2):** video/animation, comments inside the designer, curves/levels, per-character kerning, charts/tables, a native iPhone Design tab.
