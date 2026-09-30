# Post a piece and its tools

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Post a piece drafts

- **Post a Piece remembers** (2026-09-27, owner: "post a piece should have proper memory and have drafts and continue where
  left off"). Every piece being made is a draft **on this device** (IndexedDB `taheri-post-drafts`, `src/lib/social/post-drafts.ts`:
  `drafts` holds the words, both designs, the collection, where it goes, the caption and what has already gone out —
  `uploaded`/`sent`, so a publish picked up again never sends twice; `photos` holds each photo's file once, by draft and photo
  id — every `Photo` carries its `blob`). Saved 1.5 s after any change; the page opens on the piece being made last ("Picked up
  where you left off" + New piece); **Drafts** in the header lists them with thumbnails — Continue (the piece on the page is
  saved first), New piece (it stays in Drafts), Delete. A piece leaves once published or queued, and after 30 days. Not in
  Firestore on purpose: camera photos are megabytes. A new piece starts where this device usually posts (`taheri_post_prefs`:
  WhatsApp groups/channel, Instagram, website, weight line).

### Post a piece

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
  `gemini-3.8-flash`. **Billing (since 2026-09-29): the Vertex AI key** — see "One Vertex AI key" below; what follows is
  the fallback. Murtaza's project `jewelgen-mm-e3d43ecb` (owner offered it; its billing was off on 2026-09-29); this Mac's ADC
  (potatomasta501) has no access there, so local dev signs AI calls with `IMAGE_AI_CREDENTIALS` =
  `~/.config/gcloud/legacy_credentials/mmurtaza1970@gmail.com/adc.json` in `.env.development.local`. Production needs
  `roles/aiplatform.user` for `firebase-app-hosting-compute@gemstrack-pos` on that project. Timings: an image op ≈ 40–65 s
  incl. the check, captions ≈ 30 s (Cloud Run timeout is 300 s). **Instagram** needs a Meta app (Instagram Login, dev mode,
  @collectionstaheri as tester), `INSTAGRAM_APP_ID`, secret `instagram-app-secret`, redirect
  `https://pos.taheri.shop/api/instagram/callback`, and secret `instagram-token` with secretAccessor + secretVersionAdder
  for the runtime account.

### Checks

- **Post a Piece checks** (2026-09-25, owner: "thorough checks … with a very obvious solution"): `src/lib/social/health.ts`
  tests every dependency live (site up; upload key via an empty POST to upload.php — 400 = key right, 401 = wrong; set of
  the day; Green API signed in, line is admin of the community, send queue; Instagram app set, token-secret IAM, token
  valid + days left + publishing quota, public image route reachable; AI ping + image model served + today's cap) and
  `src/lib/social/diagnose.ts` turns any error into title + fix + action (link or gcloud command), with the real messages
  from setup pinned in tests. Failures are logged to Firestore `social_errors` (server routes log their own; the page
  reports website/featured failures). The panel sits atop the page; the publish confirm lists failing checks for the
  chosen destinations. Locally the website checks fail — this Mac can't resolve taheri.shop — not a real outage.

### Story editor

- **Story editor** (2026-09-25, owner: "a lot more features and freedom in prompts and positions"): the story is a layer
  document (`src/lib/social/editor.ts`: text bound to the piece's fields or free, wordmark, arrow/line/circle/box, photo
  insets; presets Left stack / Centred / Split / Bottom / Headline only; fonts condensed, Figtree 300/400/700, Bodoni Moda,
  Futura) edited in `src/app/website/post/story-editor.tsx` (tap to select, drag, corner to resize, top dot to rotate,
  pinch, centre/margin snapping, undo/redo, layouts saved per device). AI prompts: Ask AI (free instruction, op `custom`),
  every prompt editable before sending (`rawPrompt`), a brief for Make it with AI (`sceneBrief`), a style for AI lettering.
  **Instagram music:** the API can't add music; Share story opens Instagram's own editor for the music sticker. A video
  story with a licensed track baked in was offered, not built (owner to choose).

### Square only

- **WhatsApp and taheri.shop only ever get 1:1** (owner, 2026-09-25). The page has two editors on one component: **Story
  9:16** (Instagram) and **Square 1:1** (WhatsApp + website): one set of square layers for every ticked photo, a crop per photo
  (`StoryDoc.placements`), rendered with `renderDocTo` at up to 3000 px for the site and 1600 px for WhatsApp. Square presets
  (`SQUARE_PRESETS`): weight + wordmark (the overlay tool's geometry — weight top-left in Futura LT Light, the mark bottom-right,
  both **auto colour** per photo), weight + t mark, weight only, name + weight + wordmark (Didone italic like the grid posts), clean.
  **Marks are SVGs** (owner: "the logo should be an svg so I can change colour"): `public/brand/taheri-wordmark.svg` (from
  taheri-post-kit/taheri_logo.svg, cropped to its letters) and `public/brand/taheri-t.svg` (the t monogram), filled with any
  colour through their shape (`drawMark`); `NEXT_PUBLIC_STORE_MARK_SVG` / `_MONOGRAM_SVG` per house (Mina: its PNG logo, no
  monogram). A text "TAHERI / COLLECTIONS" stamp was tried and rejected. WhatsApp no longer offers "send the story image".

### Designer

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

### Story and post

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
  "From your phone" is one button plus a More menu. Each step is a card of its own with a numbered badge (`STEP`, owner: "requires
  more separation"); panels inside a step are tinted, not bordered. On a phone the design toolbar is four equal tiles, icon over word.
  WhatsApp never just disappears: with no settings (a local copy) or a failed load, its card says why.

### Website photos

- **Photos from the website** (2026-09-29, owner: "for post a piece let me add any pic from the website and then fix it up
  there"): Post a Piece's Photos step has **Website** (`site-picker.tsx`: the From the website list — New arrivals first, newest
  first, search, collections, up to 10 at once). Each photo comes through `/api/website/site-pieces/image` at 3000 px
  (`lib/website/site-photo.ts`, tested: the catalogue's unmarked source with `original=1`, so the post marks it once;
  taheri.shop's photo as the site shows it) and then is an ordinary photo — Enhance, Retouch, Extend, the designer. It carries
  `from` (kept in drafts and on every AI version of it): WhatsApp on, the Site tick off (it is on the site already; ticking it
  adds a second copy), the first one names the piece when the headline/weight are empty, and the caption links the piece's own
  page instead of its collection. taheri.shop's photos carry its marks: AI → Enhance with "remove tags" clears them first.

### Queue and Mina

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

### Maisons

- **The Maisons from the counter** (2026-09-26, the owner: "add pos functionality for maison"): taheri.shop's collection of the
  great houses' genuine pieces (Wristwear/The Maisons; the site's side is in taheri-site's CLAUDE.md). **Add Photos**: choosing The
  Maisons gives every photo a house picker and an official-name field; it goes up as `"<House> — <Model>.jpg"`
  (`src/lib/website/maisons.ts`, tested — the house list must match the site's `MAISON_HOUSES`), which the site reads so it shows
  under its house at once. **Post a Piece**: the same when its website collection is The Maisons (house picker; the name is the
  official one; the metal line moves to 18K). `quotePiece` refuses a house piece (`maison_enquire`: by `house` in the attributes or
  the folder), so neither the site nor checkout can price one by the gram.

### Retouch

- **Retouch** (2026-09-26, owner: "photo retouching … jewelry and background and photo … magnific api open ai model image", then
  "magnific only", then "magnific api should use open ai image gen"; Post a Piece and Add Photos): op `retouch` on
  `/api/website/post/ai` → `src/lib/social/retouch.ts`, all on the **Magnific API** (one key): GPT Image 2.5 Edit (OpenAI's model,
  `sunburst` variant, quality high; square photos at 2k, others 1k with `auto` to keep their shape) cleans piece, background and
  light with the piece pinned (and removes tags when "remove tags and strings" is ticked), then Magnific Precision only when the
  edit came back under 2000 px — a bonus: its queue can stall, and then the GPT result is kept. Then the usual "same piece?" check.
  Key `magnific-api-key` in each project's Secret Manager (created 2026-09-26; App Hosting compute account: accessor + viewer),
  read at runtime. GPT Image ≈ 55 s. Add Photos: Retouch / Original (undo) per photo. Locally the key is in `.env.development.local`.
