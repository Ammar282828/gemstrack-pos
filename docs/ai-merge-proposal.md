# The AI copies, and how to merge them (audit of 2026-10-01, Phase 5)

A report, not a change. It covers three duplications: the caption writers, the story renderers and the AI photo menus. Nothing below has been built except the one bug fixed in Phase 5 (at the end).
Paths are under `src/`.

## 1. Caption writers — four, with three house voices

| | Post a piece | From the website | Ad words | Ad art director |
|---|---|---|---|---|
| UI | `website/post/page.tsx` "Write with AI", "Make the whole story" | `website/from-site/page.tsx` "Write with AI" | `ads/studio/maker.tsx` words | `maker.tsx` "Make it with AI" |
| Route | `/api/website/post/ai` op `caption` | `/api/website/site-pieces/caption` | `/api/ads/studio/copy` | `/api/ads/studio/auto` op `direct` |
| Prompt | `lib/social/prompts.ts` `captionSystem` (`HOUSE_VOICE`) | `lib/social/site-caption.ts` (its own `VOICE`, `RULES`) | `lib/ads/studio/prompts.ts` `COPY_SYSTEM` + `brandBrief()` | `DIRECT_SYSTEM` + `brandBrief()` |
| Sees the photo | yes, up to 2 at 2048 px | yes, the site's at 1024 px | **no** (text only) | yes, 2048 px |
| Writes | the whole WhatsApp + Instagram caption; the ERP rebuilds the frame if the weight or a number goes missing | a line and facts; the ERP builds the frame | primary text, headlines, descriptions, on-image words | layout + words |
| Stops invented figures by | substring check, then rebuilds | regex strip (`tidyAiWords`) | `inventedFigures` drop | `inventedFigures` drop |
| Cap | `post-ai-day` 300/day + 60/h, shared with every image op | the same | `ad-studio-ai-day` 200 + 60/h | the same |

What conflicts:
- **Three house voices.** `prompts.ts:168`, `site-caption.ts:14` (a near-copy for Taheri, with examples) and `brand.ts brandBrief()`.
- **Three rule sets that disagree.** The owner's own rules also changed on 2026-09-29 (prices, karats and weights are now allowed in ads).
  - Post a piece bans prices and urgency.
  - From the website bans prices, hashtags, emoji and links.
  - The Ad studio allows prices and specs, and bans sale words and hashtags.
- **Length limits.** The prompts ask for headlines of at most 40 characters and descriptions of at most 30. The routes allow 60 and 45.

**Proposed merge.** One `lib/ai/words.ts`, with:
- `houseVoice(house)`: one voice per house, from `brand.ts`, since the vault's rules already live there.
- `rulesFor(channel)`, where channel is `whatsapp`, `instagram`, `website` or `ad`. It holds the owner's rule for that channel in one place (for example: prices allowed in ads, not in community posts). That makes a rule change one edit instead of three.
- One faithfulness pass: `inventedFigures` plus "the weight and numbers must survive". A failure rebuilds the frame (whatsapp) or drops the line (ad).
- One cap bucket per house, with channel-weighted costs.

The four routes stay as thin adapters, so no UI changes. Order:
1. Voice and rules.
2. The faithfulness pass.
3. The caps.

Risk: captions change tone slightly in the first week. Keep the examples from `site-caption.ts`.

## 2. Story renderers — one engine, three layout builders, one dead copy

| Renderer | What it is | Callers |
|---|---|---|
| `lib/social/editor.ts` `renderDoc` / `renderDocTo` | **The engine.** A layered document: photo with crop and filters; text, marks (one tinted SVG, auto ink), shapes and insets | Post a piece (`getStory`), the story editor and designer, and everything below |
| `lib/social/site-story.ts` `siteStoryDoc` | A fixed layout for From the website → Instagram, drawn by the engine | `from-site/page.tsx` |
| `lib/ads/studio/templates.ts` `applyAdTemplate` | Eight ad layouts, drawn by the engine; safe zone 14% top / 35% bottom | the ad maker, Post it |
| `lib/social/story.ts` `drawStory` / `renderStoryJpeg` | **Dead code: no callers.** Its helpers (`drawStoryPhoto`, `canvasToJpeg`, `stampPhoto`, `suggestPalette`) are still used | — |
| Investments | Draws nothing: the routine's cards are resized (`lib/investments.ts`) | — |

What conflicts:
- **Three safe areas.**
  - Ads: 269 px top, 672 px bottom.
  - site-story: "250 / 380". Its details line at y1500 runs into Instagram's reply bar.
  - Post a piece: none; the wordmark sits at y150, under Instagram's progress bar and name.
- **Three grounds.** `#EDE6DA`, per-house colours, and `VISUAL`.
- **Fonts loaded three different ways.**

**Proposed merge.**
1. Delete `drawStory` and `renderStoryJpeg`, and move the helpers to `lib/social/photo.ts`.
2. Put one `STORY_SAFE` (Instagram's own: about 250 px top, about 340 px bottom at 1920) in `editor.ts`. Every layout builder (Post a piece's presets, `siteStoryDoc`, the ad templates) lays out inside it.
3. Add one `ensureFonts(doc)` that loads the faces a document uses before drawing.

site-story then becomes a preset of the story editor ("Website piece"), so it can be opened in the designer like any story. The engine doesn't change. Risk: small; Post a piece's presets move down by about 100 px.

## 3. AI photo menus — seven places, one route, five ways to undo

All seven call `/api/website/post/ai`; the maker also calls `/api/ads/studio/auto`.

| Menu | Offers | Same-piece check | Undo |
|---|---|---|---|
| Post a piece, photo tile | Enhance, Retouch, Extend 9:16/4:5/1:1, New setting, Ask AI (with a prompt editor); "remove tags" on by default | badge + toast, confidence ≥ 0.8 | a new tile; remove it |
| Post a piece, story tools | Make the whole story, New setting, Extend 9:16, Ask AI, AI lettering | same (lettering is read back) | same; lettering → "our fonts" |
| Post a piece, square tools | True square, Enhance, Retouch, Ask AI 1:1 | same | same |
| Edit a piece | Enhance, Enhance and clear old labels, Ask AI (plain text) | toast only when it fails | "Use: …", "Put the original back" |
| Add photos | Retouch (tidy off) | toast, ≥ 0.8 | "Original" |
| Ad studio photo sheet | Extend 4:5/9:16, Clear old labels, Enhance light, Retouch, New setting (fixed 4:5) | same piece only, no confidence | version chips |
| Ad studio maker | Remove the logo, Make it with AI, Paint the whole ad, New setting (the ad's shape) | warn only; **Make it with AI ignored it** (fixed, below) | overwrites; no undo |

What conflicts:
- **The same operation under seven names.** `enhance` with tidy off is "Enhance — clean, colour, sparkle", "Enhance the photo", "Enhance — light, sparkle, dust" and "Enhance light". With tidy on, it is "Enhance and clear old labels", "Clear old labels", "Remove the logo", and Post a piece's plain "Enhance".
- **Caps and access.** The studio's photo fixes count against Post a piece's 300/day, not the studio's 200. They would also 404 in a house with neither Post a piece nor Edit a piece switched on (route line 55).
- **The check is handled four ways, and there are five undo models.**

**Proposed merge.** One `<AiPhotoMenu photo onResult aspects scenes allowLettering />` in `components/ai/`, with:
- One vocabulary:
  - *Enhance*
  - *Enhance and clear labels*
  - *Retouch*
  - *Extend to …* (the shapes the screen needs)
  - *New setting …*
  - *Ask AI …* (with the prompt editor)
- One check rule: under 0.8 confidence or not the same piece means the result is offered, never applied. The screen shows the differences and "Use it anyway".
- One undo model: a version stack with chips, as the photo sheet already has, kept per photo by the caller.

The route stays. Its access check becomes "any AI-using feature on", and the cap is charged to the feature that called it. Order:
1. The menu, in Edit a piece and Add photos (simplest).
2. The studio sheet and maker.
3. Post a piece last (the most wiring).

Risk: Post a piece's tile flow (a new tile per result) is the one people know. The version stack must show there as tiles to keep it.

## Fixed in Phase 5 (not the merge)

**"Make it with AI" in the ad maker applied the photo op's result without looking at its same-piece check.** A result that redrew the stones went into the ad unseen. It now keeps the original photo, says what changed, and keeps the words and layout (`ads/studio/maker.tsx`).
