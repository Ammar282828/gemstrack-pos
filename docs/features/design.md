# Design

One place to make anything and send it anywhere (the owner, 2026-10-12: "one area where it can be posted from … merge it into one
Design sub-tab"). It replaced Post a piece, the Ad studio's Photos / Make / Board / Saved and the Posts hub's own designer as the
place the work is done. The plan it was built from, with the audit of what existed, is `design-studio-plan.md` (kept as the
record; this file is what was built). Cutover: WP7, 2026-10-12.

## Where it is

- **Posts › Design** (`/design`): Posts is **Hub · Design · Investments** (Mina: Hub · Design). Staff see it (`staff: true`);
  the ads-only sections inside gate themselves. The palette finds it for *Design*, *Studio*, *Post a piece*, *Canva*, *poster*,
  *resize*, *board*. `STORE_DESIGN = STORE_POST_PIECE || STORE_AD_STUDIO || STORE_SITE_POSTS` (`store-config.ts`), no new variable;
  each destination and section is still switched by its own flag.
- **Ads › Plan** (`/ads/plan`): the Studio's research half — *What to run* (the plays), *Ad days & rules* (Bohra calendar, the
  account's winners, house rules), *Competitors*. `?s=plays|guide|rivals`. "Make this" opens Design on an ad set up for the play
  (`/design?v=make&kind=ad&play=<id>`: the play's size(s), layout and goal). Ads is **Overview · Campaigns · Plan · New ad · Setup**.
- Sections of `/design` (`?v=`, one chip row under the one tab row): **Make** (start screen → workspace), **Photos** (the website's
  pieces; owner and marketing also the Ad studio's library, `?s=site|picks|library`), **Board** (owner + marketing), **Saved**.

## Roles (two needs, never merged)

`designGate(req, 'post' | 'ads')` (`lib/design/gate.ts`): *post* = owner, staff, marketing (as `postGate`); *ads* = owner,
marketing (as `adsGate`). Staff: Make (pieces, posts, stories, WhatsApp, website photos), website pieces and device photos, Saved
(shop designs), device drafts, every destination except Meta ad. Owner + marketing add: the library with scores and Drive, the
Board, ads (the Ad kind, the pre-flight check, Meta), Saved ads. The routes refuse the rest too; the page only doesn't offer it.

## Per house (all from existing flags; nothing is forked)

- **Taheri:** WhatsApp groups and the channel, Instagram story and feed post by API, set of the day, Investments (tab beside Design),
  rate and investment layouts, Bohra calendar.
- **House of Mina:** WhatsApp groups only (no `WHATSAPP_CHANNEL_ID`), no Instagram app, so story and post go to the share sheet; no
  set of the day, no Investments; the catalogue's MINA mark; her own plays and voice (`brand.ts`).
- The publish sheet asks `GET /api/design/destinations` and draws only what the house has, each missing row with its reason.

## Making

- **Start screen:** *Start with anything* (smart input), *What are you making?* (A piece = story + post · Post · Story · WhatsApp ·
  Website photo · Ad · Any size), sizes (Meta's four, seven more shapes, WhatsApp and website 1:1, your own W:H), the photograph
  (browse Photos, From the website, This device), and *Where you left off* (device drafts, recent designs).
- **Workspace** (`workspace.tsx`): the **page strip** — a design is a master page and any number of other sizes made from it
  (origin `master | resized | manual`; editing a made page marks it manual); name, kind, Save, Publish; the designer
  (`story-editor.tsx`, with `editor-panels.tsx`, `panels/*`); the piece card with Words, Pictures and Check. Drafts autosave every
  1.5 s on the device (IndexedDB `taheri-post-drafts`, photos included).
- **Designer v2** (`src/lib/social/editor.ts`, additive and optional, so the phone bundle keeps working): guides and snapping,
  position and distribute, blend modes, shadow / glow / outline, rich text runs, gradients, QR layers, photo adjust (highlights,
  shadows, tint, hue, sharpen, blur, grain), export, history, shortcuts, six more fonts.
- **AI resize** (`lib/design/resize.ts`, `resize-ai.ts`, `/api/design/resize`): any design into any aspect ratio. Step 1 *roles*
  (what each layer is for), step 2 three deterministic re-layouts scored (template, anchor, safe — safe bands, a legible minimum,
  the subject kept in view), step 3 an **optional one-call AI plan** that may only move and resize layers that exist; it is thrown
  away on a changed word, an invented id or a place outside the frame, and kept only if it scores at least as well. The jewellery
  is never redrawn; when the photograph can't cover the shape, "needs extend" offers the existing AI extend. 4:5 → 9:16 → 4:5 comes
  back where it began. One model call per user action (the Vertex quota is tiny).
- **Smart input** (`smart-input.tsx`, `lib/design/parse*.ts`, `/api/design/{parse,fetch,analyze}`): paste a caption, a forwarded
  WhatsApp message, a link, a SKU or drop photos; Roman-Urdu (wazan, qeemat, tola, masha, ratti) and money (rs / k / lac / crore)
  are understood. **No figure appears that is not in the input** — every field is held against it (`inventedFigures`,
  `breaksHouseRule`), the same test gates anything the AI adds. An image drop is analysed once (subject box, burned-in lettering,
  category), resized with `sharp` to 1600 px first (the 2026-10-01 out-of-memory lesson).
- **Flat image → layers** (`/api/design/layers`, owner + marketing): the lettering of a finished ad becomes editable text layers
  (font class, weight, colour, role), the photograph stays the user's own pixels.
- **Background removal** (`/api/design/remove-background`): Magnific's `beta/remove-background`, a urlencoded `image_url` (the
  photograph is held for the call at the `social_media` relay, as an Instagram post is); it answers `high_resolution`, a PNG with
  alpha. Verified live 2026-10-12. Gives a layer `cutout`; a failure is a plain message, never a faked cut-out.

## Publishing (`publish-sheet.tsx`, `lib/design/{destinations,publish}.ts`)

One sheet, one list, each row only if the house and the role have it: **Website** (collection picker, the Add photos relay) · **Set
of the day** · **WhatsApp groups** (ticks, remembered) · **WhatsApp channel** · **Instagram story** (API, else share sheet) ·
**Instagram post** (API, else share sheet) · **Meta ad** (opens `/ads/new?studio=` with both sizes; owner + marketing) ·
**Replace the photo on a site piece** (when the design came from one) · Download · Save · **Hold in the queue / Schedule**.
- Each row declares the picture it needs; the sheet picks the matching page or offers *Make 1:1 from this* (resize). WhatsApp and the
  website only ever get 1:1 (the owner, 2026-09-25).
- Steps run one at a time with per-step retry and memory of what already went, so a retry never double-posts; the health strip, the
  ad pre-flight (when Meta is ticked), `wordProblems` and the community confirm run before.
- **Instagram feed posts by API** (D4 = yes): `POST /api/instagram/post` → `publishPhoto()` in `lib/social/instagram.ts`, the same
  five-minute public relay as stories, 4:5 to 1.91:1, caption ≤ 2,200. Taheri only (Mina is not connected). Held posts are not
  carried by the queue: the sheet says so.
- Nothing server-side changed for sending: WhatsApp still goes through `POST /api/website/post` (the community twin keeps
  mirroring), uploads through the Add photos relay, queue items keep `sitePiece` so the Hub's "posted" logic works.

## Saved

`designs/{id}` + `design_media` (900 KB parts), admin SDK only like `ad_saved`. **No migration:** the shelf reads `designs` ∪ legacy
`ad_saved` (id `saved:<id>`, kind Ad, owner + marketing) through `lib/design/saved-compat.ts`; the first Save of a legacy ad writes a
`designs` record that supersedes it. Folders are the existing `ad_folders`. *On this device* lists drafts (Design's own, and the older Post a piece screen's, which open as designs). *In the ad account* is still listed for owner + marketing. Boards stay
`studio_boards`.

## Old addresses (`lib/design/redirects.ts`, `redirects.test.ts`; every query rides along)

| Old | New |
|---|---|
| `/website/post` (`?new=1`, `?draft=<id>`, `?site=<id>`) | `/design?v=make` + the same. Design answers once and clears them: `?site=` starts a piece from that website piece, `?new=1` a fresh one, `?draft=` opens a Design draft, or a draft of the old screen converted to a design |
| `/design/classic/post`, `/design/classic/ad` (`?v=`) | `/design?v=make` (`&kind=ad` for the ad maker; its Photos/Saved go to Design's) — the classic screens are gone |
| `/ads/studio`, `?v=plan` (`&s=`), `?v=guide`, `?v=rivals` | `/ads/plan` (`?s=plays|guide|rivals`) |
| `/ads/studio?v=photos` (`&s=`), `?v=picks`, `?v=library` | `/design?v=photos&s=picks|library` |
| `/ads/studio?v=make` / `board` / `saved` | `/design?v=make&kind=ad` / `?v=board` / `?v=saved` |
| `/website/from-site` | `/posts` (since 2026-10-04) |
| `/website/edit`, `/website/photos`, `/website/weights`, `/website/investments`, `/posts`, `/ads/new` | unchanged; Edit a piece gets **Open in Design**, the Hub's piece cards and drafts open Design |

`/website/post` and `/ads/studio` stay in the map as pages marked `moved` (the palette skips them): the iPhone app's native Post
composer and Studio screens are matched by those addresses and found through the exported map.

## Where the code is

`src/app/design/` (shell: `page`, `start`, `workspace`, `use-design`, `design-state`, `design-piece`, `ai-tools`, `old-draft`, `photos-section`,
`saved-shelf`, `publish-sheet`, `resize-sheet`, `smart-input`; moved here from the Studio: `board`, `library`, `studio-kit`),
`src/lib/design/**` (pure engine, tested), `src/app/api/design/**` (`designs`, `destinations`, `resize`, `parse`, `fetch`, `analyze`,
`layers`, `remove-background`), `src/app/ads/plan/`. **Every API route kept its address** — the iPhone app calls
`/api/ads/studio/*` and `/api/website/post/ai`, and the MCP agent `/api/studio/mcp`. The editor itself still lives under
`src/app/website/post/` (`story-editor`, `editor-panels`, `fonts`, `site-picker`, `health-panel`, `queue-panel`).

## With AI

Everything the classic Post a piece and ad maker did with the image AI lives in `ai-tools.tsx`, calling the routes they always did
(`/api/website/post/ai`, `/api/ads/studio/auto`); no back end changed. `useAiActions` holds no state: what is running (`aiBusy`, one
tool at a time), the open dialog, the photographs before the AI ones, and a picture waiting for a look are in `use-design.ts`.

| Classic had | Design now |
|---|---|
| Enhance · Retouch (GPT Image 2.5 Edit + Magnific Precision, then the same-piece check) · Extend (9:16/4:5/1:1) · "Also remove tags and strings" | **Pictures → With AI**: Enhance, Logo and labels off, Extend to this shape (the page's ratio), Retouch, the tags toggle (per device) |
| New setting (7 scenes or free text, shape, edit the full prompt) · Ask AI (free text, shape, full prompt) | **New setting…** and **Ask AI…** dialogs, unchanged in content |
| Same-piece badge on every AI photo; a result the check doubts was added with a warning | A result the check doubts waits in a banner above the editor (**Use it anyway** / Discard), never in unseen; "Back to the photo before" undoes AI versions |
| Make the whole story (captions, palette, layout, a 9:16 setting) | **With AI → Make it with AI** on a piece/story/post: captions to the Publish sheet, headline and small line if empty, the colours and Left stack/Centred layout on the story page, the setting as that page's own photograph |
| The ad maker's Make it with AI (art-directed layout, words, ad text and headline, photo extended/logo off, then the full ad check) | Same, on an **Ad** design (owner and marketing, Ad studio houses): the layout goes on every size, the check runs by itself |
| Paint the whole story / post / ad | **With AI → Paint it…**: a story or post is painted into the page (read back, same-piece check, "Back to our design"); an ad is looked at first (**Use this ad**, Paint again, Discard) |
| AI lettering (style words, read back) | **With AI → AI lettering** on a story-shaped page; "Back to our fonts" |
| Write with AI (WhatsApp + Instagram captions, headline ideas, stones seen, a line about it, plain/edit, copy) | **Words → Captions**; the Publish sheet starts from them |

An AI-lettered or painted page is a change to the document (`lib/design/lettered.ts`, tested): the AI picture is one of the design's
photographs, the page's background becomes it and the bound words are hidden, so the strip, Save, the draft and Publish draw it without
knowing — and it can still be edited. Role gates and flags are the classic screens': the photograph, story and caption tools need
`STORE_POST_PIECE || STORE_SITE_EDIT`; the ad's art direction and painting need `STORE_AD_STUDIO` and owner/marketing.

Also ported from Post a piece: **More photos of this piece** (other angles go out as squares of their own — "<name> 2.jpg" on the
website, no caption after the first on WhatsApp, each its own retryable step, and in the queue); the website's **Name on the website**
and **The Maisons** house and official name; the **catalogue photograph** (the Website 1:1 page: weight stamped, the mark, and
Square/Story layouts from Post a piece in Layouts); the **set of the day** card showing what it replaces; **Connect Instagram**
(and the return toast); **Save all to Photos**, **Share the picture** with its caption, **Copy the caption**, **Open the WhatsApp
channel**; HEIC from this device (converted by the ERP) and the camera on a phone; the Investments link on the start screen.

Not carried, on purpose: the old screen's per-photo Site/WA ticks (each photograph is a design or a "more photo"), the metal / stones /
weight-each fields (one Specs line), and the weight-on-photo switch (a layer's eye in the designer).

## Old drafts

A draft of the old Post a piece screen (IndexedDB `taheri-post-drafts`) opens as a design from Saved › On this device, "Where you left
off", or `?draft=`: `app/design/old-draft.ts` (tested) makes the story the master page and the square the WhatsApp page, the lead photograph
the design's own and the others its further photographs, applies an AI lettering/painting that was on, carries the words and the
caption, and leaves the old collection for the Publish sheet's remembered one. What the old screen had already sent is not known to the
Publish sheet: the toast says so. The old draft is deleted once the design is kept on the device in its place. A draft that cannot be
converted (no story or square) opens read-only (`old-draft-view.tsx`): words, caption to copy, photographs to save.

## Not done

Video and animation (a Ken-Burns / shimmer story by MediaRecorder; a licensed track), a native Design tab in the iPhone app (it
shows the ERP's page in the web view until then; its native Post composer and Studio keep working), `design_templates` shared across
devices (templates are still per device).
