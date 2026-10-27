# Posts: the hub and the website's pieces

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

> **2026-10-12: moved to Design.** A website piece's *Post a piece* button on the hub's cards is now **Design**
> (`/design?v=make&site=<id>`), and Edit a piece has **Open in Design**; the hub itself (Today, the queue, the pieces, Send all / Later)
> is unchanged. `/website/from-site` still redirects to `/posts`. The card's story and square editors (`piece-design.tsx`) stay in the
> hub for the quick send; the full designer, resize and publishing are in Design ([design.md](design.md)).

### Posts hub

- **Posts → Hub** (`/posts`, 2026-10-04; owner: "the posts tab could be consolidated a lot better … the workflows could be
  smoother maybe merged? while still keeping everything central. like a posting hub maybe"). Built on what the send log showed:
  in the ten days before, 26 of Taheri's 37 sends and all 24 of Mina's were website pieces, three or four within a minute or two,
  each picked, sent and confirmed alone; the queue had never been used (`social_queue` empty in both houses). The hub, top down:
  **Today** (`today.tsx`): every send from every path, one line per piece (`lib/social/sent-log.ts`, tested; `GET
  /api/website/post/recent`, the last two days of `social_posts`), and in Taheri the gold post's parts (sent at, due at, needs your
  OK — `statusOf`); **the queue** (Post a Piece's `QueuePanel`); **the website's pieces** (what From the website was): tap one or
  several (up to 10) — each is a card of its own (`piece-card.tsx`: caption, AI words, weight stamp, crop & design, Instagram
  story) — then one **Send all** after one confirm, one after another, stopping at the first failure (a piece some places took
  leaves the tray: sending again would post twice), or **Later**: into the queue, to send at a time or spread over the day
  (queue entries carry `sitePiece`, so they count as posted). Where posts go is one choice per device, shared with Post a Piece
  (`post-drafts` prefs `waTargets`). On a phone a bar at the bottom says what is picked while Send is out of sight. **New piece**,
  **Drafts** and "Still making X" open Post a Piece (`?new=1`, `?draft=<id>`; a card's **Post a piece** opens it with `?site=<id>`,
  the piece already in its photos). `/website/from-site` redirects here. `postGate`'s default is now Post a Piece *or* the site
  posts. Found on the way: `<main>`'s `overflow-auto` made every `sticky` in the ERP inert; it is `overflow-x-clip` now, sticky
  offsets clear the 56 px top bar (`top-[4.5rem]`, Hisaab's search `top-14`), the sale page's sidebar (taller than a screen)
  is no longer sticky, the order form's pricing card scrolls inside itself.

### From the website

- **Posts → From the website** (`/website/from-site` until 2026-10-04, now the Posts hub's grid and cards; 2026-09-25; owner: "give me an option to take any post from taheri.shop (or
  randomize) … add the post link to whatsapp community from right there", then the same for House of Mina): opens on **New arrivals**
  (owner: "by default show new arrivals"; `src/lib/website/new-arrivals.ts`, tested — the catalogue's own shelf, `newArrival` in
  `catalog-pieces.json`; taheri.shop: added in the last 30 days, never fewer than the newest 24, from the `added` each photo carries in
  `catalog-attributes.json` since taheri-site 72bcde3), everything newest first; search, collection chips,
  **Shuffle** (skips pieces sent in the last 30 days — `social_posts.sitePiece`), the photo as it is on the site (it already carries the
  house's marks: weight top-left + wordmark top-right on taheri.shop, the MINA mark on the catalogue), the caption from `sitePieceCaption`
  (name, weight, facts, 🌐 the piece's link, then `NEXT_PUBLIC_STORE_POST_FOOTER` or "Ask for today's price" + numbers; Mina also
  `_POST_TAGLINE`), **Write with AI** for both houses (`/api/website/site-pieces/caption`: the model writes only a line and the facts, in
  the house's voice with its own community posts as examples; the POS builds the frame), a **weight overlay** (stampPhoto, on by default
  only where the site photo doesn't show the weight — `weightSource !== 'label'`; a weight typed for one of taheri.shop's photographs that has none is saved to the site when the piece is sent or queued, as Website → Weights saves it, never over a weight the site has — `lib/website/site-weight.ts`, 2026-10-09; a new upload's too since 2026-10-10). **The site's weight is the post's to start with** (2026-10-10, owner: "automatically apply that, but allow for an overwrite option … specifically for the post"): the card says "From taheri.shop: 4.2g"; a different one typed is "For this post only", with "Use 4.2g" to go back, and the site keeps its own. Counter weights are laid over the pieces on every read (`withCounterWeight`, at most a minute old), not frozen into the ten-minute list: before, a weight typed on Photo weights reached Posts ten minutes late and a new upload's never (40 of them on 2026-10-10). And where it goes: any of the community's groups
  (`WHATSAPP_POST_GROUPS`, Label=chat id; Taheri: Announcements, Diamonds, Gemstones, Investments, Exclusives, Watches), the channel, or
  **Both** — `/api/website/post` with `targets` (keys, never chat ids; Post a Piece sends with `targets` too since 2026-09-25).
  Mina's POS got the page as a port onto its branch (c045a60; recorded in main with a `-s ours` merge, the other session's way).
  Both sites were changed to publish links: taheri-site's prerender adds `path` to `catalog-attributes.json` (2,565 of 2,601 photos have a
  page); mina-catalogue's prerender writes `catalog-pieces.json` (599 pieces). `NEXT_PUBLIC_STORE_SITE_POSTS` (default on); Mina's
  community is `120363422611483809@g.us`. The community's own posts were read through WAHA to match their look.
  **Crop & design** (2026-09-27, owner: "for post a piece from the website, add an ability to crop the photo or redesign etc like the
  rest of the space"): the photo in Edit a piece's square editor (`from-site/piece-design.tsx`; layouts and starting layout in
  `lib/social/site-design.ts`, tested) — taheri.shop's as the site shows it on "Nothing added" (Weight if the page was stamping it), Mina's
  from its `photoSource` with the MINA mark back on; while in use it is the WhatsApp square (1600 px) and the story's photo, the weight
  stamp steps aside, and "Use the photo as it is" drops it. No AI there yet (Edit a piece has it).
  **New uploads too** (2026-09-29, owner: "new stone sets not visible in post from the website"): taheri.shop's drops (Add
  Photos, uploads not yet adopted) are offered with their address, `dropPath` (`lib/website/drop-path.ts`, tested — the site's
  own slug rules), which taheri.shop's `api/piece.php` now serves as a real page (named, previewed); before, a drop's address
  answered 404 and posting left drops out.

### Site story

- **From the website → Instagram story** (2026-09-26): the square site photo whole on the house's ground with its mark, name and
  metal · weight (`src/lib/social/site-story.ts`), posted through `/api/instagram/story` when connected, else the share sheet.

### When the catalogue blips (2026-10-26)

- Owner: "HoM website posts not loading in app". `/api/website/site-pieces` read `catalog-pieces.json` and, on **any** failure, fell back to
  taheri.shop's `catalog-attributes.json` (Mina has none: 404), so a Hostinger deploy of the catalogue (its files were swapped at 08:48 that
  day) turned into a 502 "catalog attributes unavailable: 404". Now only a 404/410 means "this site publishes no pieces list"; any other
  failure is retried once, then the last list is kept (asked again in a minute) or the error names the site (`site-pieces.ts`, tested with a
  Mina-shaped fixture). The phone no longer shows a cancelled read (a screen that left) as a failure (`PostsStore.loadPieces`); Android already didn't.
- Size (same day): `/api/website/site-pieces` was 1.3 MB for Mina (2.7 MB Taheri), uncompressed on the wire (the log's response size equalled the JSON's).
  `?lean=1` drops `own`, `words` and an empty `change` (nothing outside Edit a piece reads them; that screen uses `/api/website/edits`): 1.32 MB to 0.85 MB;
  the route gzips when `Accept-Encoding` allows: 0.85 MB to 86 KB. Web pickers, iPhone and Android all ask for `lean=1`. The iPhone reads with a 45 s
  timeout and keeps the last list per business in Caches (`PostsStore`), showing "Showing the list from <time>" when the refresh fails.

<a id="stories"></a>
## Stories (2026-10-27)

The owner: "prepare a bunch of Instagram stories, one for every day of the week … make them 9:16 and add text overlays with their
weights, and type to make them stand out", then "make 50 more and add them to a stories draft tab in the erp … make sure you dont do
any oversharpening and just give them all in 2x 1080p resolution for 9:16".

- **Posts › Stories** (`/posts/stories`, Taheri only: Mina has no running order yet) lists 57 website pieces in a running order, one a
  day from a Monday ("Week 3 · Wed"), with Next up at the top and To post / Posted / Skipped. A draft opens to Post to Instagram (when
  the account is connected; the server sizes it to 1080 × 1920), Save (the share sheet on a phone, a download elsewhere), Mark posted
  or Skip; Back to drafts undoes either. Only that status is stored (`story_drafts`, one document per piece, `/api/posts/story-drafts`).
- **The order and what each piece is** are written by hand in `lib/social/story-drafts.ts` (the tags say "Colored Stones" where the
  counter says "Navratan"; "21K gold" only where the site records the karat, as some diamond pieces are 18K). The **name and weight are
  the site's**, read when the tab opens: a weight typed on Photo weights shows at once. A numbered look-alike drops its number
  ("… Taweez II" → "… Taweez"); a piece gone from the site says so and can't be made.
- **The picture** (`lib/social/week-story.ts`, drawn in the browser, 2160 × 3840, smooth scaling and no sharpening anywhere): the
  square photograph in the middle, its own ground running on above and below (a 48-px copy scaled up, darker), the wordmark in cream,
  the kind in gold capitals, the name in Cormorant italic, the weight large in Bodoni gold with "— WEIGHT —" over it, "Reply for
  today's price", all inside Instagram's bars. No canvas `filter` (WebKit has none).
- **taheri.shop's marks come off.** The site's photos carry the wordmark (top right, or bottom right) and older ones the weight
  printed top left (light on velvet, or dark on a light wall). `planCorners` finds the lettering as thin strokes, never a light area
  (a bust, a wall: a light area fills nearly all of any window around it), and covers it with nearby cloth of the corner's own colour
  when the corner holds nothing else; otherwise, with gold or a stand in the corner, it fills only the lettering from the ground around
  each stroke. Tested on all 57 (`story-drafts.test.ts` holds the cases met: gold beside the label, dark ink, a bust's edge).
- The 57 were picked from what the site can show cleanly: the counter-weighed new uploads (taweez, a kara pair) and older catalogue
  pieces across chains, lockets, takhti, earrings, rings, sets and bangles; left out were light grounds, portrait photos, photos with
  paper price tags and other houses' pieces (Maisons).

