# Label LIVE

<a id="label-live"></a>
**Label LIVE** (2026-10-20; owner: "can you connect label live to my erp"). Tags print from the ERP into Label LIVE
(label.live), the Mac app at the counter that drives the label printer. Code: `src/lib/label-live.ts` (pure, tested),
`src/lib/label-live-values.ts` (a piece's values), `src/components/label-live-button.tsx`,
`src/app/settings/printer/label-live-card.tsx`.

- **How it reaches the Mac.** Label LIVE takes a print from a link — `labellive://print?design=…&variables=…&printer=…
  &copies=…&window=hide&ignoreWarnings=true`, several as `labellive://batch?payload=<base64 JSON jobs>` (its guide
  "Integrate printing with production processes"). The browser hands the link to the app (it asks once). Its HTTP API
  (`localhost:11180`) and MQTT (1883) are not used: an https ERP page can't reach a plain-http local server in Safari or
  Chrome. Label LIVE must be open, and the design **pinned to its Home screen**.
- **Set up once** (Settings → Labels → Label LIVE): paste the link Label LIVE's **Integrate → Copy URL** gives for the
  design. Its design, printer id, copies and **variable names** are read from it (`parseIntegrateUrl`) — the names live in
  the .lsc file on the Mac and are never guessed; each is paired with a piece's field by its name (`guessField`) and can be
  changed. Saved in the shop's settings as `labelLive` (`vars` a list, since settings are written with a merge).
- **Fields**: SKU, name, price (`Rs 12,500` or the number, at today's rates as the tag CSV works it out, whole rupees),
  weight, metal and karat, karat, category, stones, stone weight, diamonds, size, plating, shop name, QR (the SKU), date.
  A value's "&" becomes "and" and a quote is escaped (RJSON), so a name can't break the link.
- **Where**: a piece's page (Export & QR card), Products with pieces ticked (one batch), and Settings → Labels (test print).
  Each print is noted in the print history like the CSV export.
- **iCloud**: a design Label LIVE opens by path breaks when iCloud moves or offloads it (the 2026-10-20 `minalabel.lsc`,
  moved from Downloads to iCloud Drive › 08 Library › Software › Label Printer). Keep that folder "Keep Downloaded" and
  pin the design from its new place.

### Two tags to a label (2026-10-23)

House of Mina's `minalabel` is two tags side by side, built on the double-tag CSV (`lib/label-csv.ts`): its
Integrate link carries the variables as **JSON** (`{"SKU_1":"…","SKU_2":"…"}`), every CSV column twice. So:
- A variable ending `_<n>` belongs to tag n (`tagsOf`, when at least two numbers appear). Each print fills as many
  pieces as the design has tags (`labelsOf`); a tag with no piece is sent **blank**, every variable of it, so the
  design's sample text (`TOP-000002`) never prints. A batch is one job per label.
- A variable named after a CSV column with its tag's number (`TOTAL_PRICE_PKR_1`) pairs with **Tag CSV: <column>**
  and gets exactly what the CSV writes (`labelCsvValues`, shared with `productCsv`): `TRUE`/`FALSE`, weights to three
  places, whole rupees. The design reads what it was built on.
- The link now always carries JSON (valid RJSON); one-tag designs print as before.
