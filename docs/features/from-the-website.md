# Posts: the hub and the website's pieces

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

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
  only where the site photo doesn't show the weight — `weightSource !== 'label'`), and where it goes: any of the community's groups
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
