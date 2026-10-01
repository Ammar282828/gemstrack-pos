# AI: the key and the scanners

_Moved from CLAUDE.md on 2026-10-01 (the audit's Phase 6), word for word. CLAUDE.md keeps a one-line index; this is the record._

### Vertex AI key

- **One Vertex AI key for all AI, both houses** (2026-09-29, owner: "use this key for everything now", after Murtaza's
  project lost billing). Post a Piece, the website captions, retouch's check, the Ads helper, voice, the bill/order scanners
  and the gold update all send `x-goog-api-key` to Vertex's keyed endpoint (`aiplatform.googleapis.com/v1/publishers/google/
  models/<model>:generateContent`, no project in the path; `src/lib/ai-key.ts`), billed to the key's own project — number
  847960974510, not Taheri's, Mina's or Jewel Gen. The key lives **only** in Secret Manager `vertex-ai-key` in gemstrack-pos,
  read at run time (never declared in the YAML — a missing secret is "not set up", not a failed rollout; never in any committed
  file — gemstrack-pos is public); Mina reads the same one (`VERTEX_AI_KEY_SECRET` = `projects/gemstrack-pos/secrets/vertex-ai-key`).
  Readers: `firebase-app-hosting-compute@` both projects and `claude-cloud@gemstrack-pos`. Kept 5 min, a missing one re-asked
  after 1 min — so creating or rotating it needs no deploy. No key → the old signed path (IMAGE_AI_PROJECT / VERTEX_PROJECT).
  `VERTEX_AI_KEY` (or `GEMINI_API_KEY`) as a variable wins, for local runs. Every model in use answers through it
  (gemini-3-pro-image, 3.1-pro-preview, 3.8-flash, 3.6-flash, 2.5-flash; 3.5-pro still 404). The checks panel says which
  way the AI is billed; `diagnose` names the project Google complains about and knows a refused key.
  **Its project's per-minute quota is tiny** (measured 2026-09-29: a handful of calls a minute, then 429 "Resource has been
  exhausted (e.g. check quota)" with no details, on the keyed and the global route alike). So `call()` waits out a 429
  (5 s, 15 s, 30 s) instead of failing, and the checks panel's ping (thinking `low`, no retries — left alone it thought for
  up to 5 s and, with a retry, blew the panel's 8 s) shows a rate limit as a warning, not "timed out". The fix is the key
  project owner's: raise its Vertex AI per-minute quota (IAM & Admin → Quotas).
  **The quotas are per model** (2026-10-01): from at least 09:00 that morning `gemini-3.1-pro-preview` answered every call
  with that 429 in 0.2 s, an hour after its last use, while 3.6-flash, 3.8-flash, 2.5-flash and the image model answered —
  so Write with AI waited 50 s and failed ("AI is busy or out of credit"), and the scanners (also 3.1 Pro) would have too.
  Since then a model answering 429 (or 404) hands over **at once** to the next in its chain and is passed over for 5 min on
  that instance (`lib/ai-fallback.ts`, tested; only the chain's last model waits): the text models → `IMAGE_AI_TEXT_FALLBACK`
  (**gemini-3.6-flash**, ~3–5 s), the scanners → voice's gemini-2.5-flash; the image model and the Ads helper (signed tool
  calls) have none. The checks panel pings the writing model on its own ("Writing model answers") — the cheap model's ping
  stayed green all morning.

### Scanners

- **The scanners read with Gemini 3.1 Pro and copy the paper's own hisaab** (2026-09-29, owner: "scan a parchi feature should
  also use ai"). Scan a parchi (`/api/vision/order`) and Read a written bill (`/api/vision/bill`) ask for `scanModel()`
  (`lib/vision/scan-model.ts`: `SCAN_AI_MODEL`, else **gemini-3.1-pro-preview**; one Google doesn't serve falls back to voice's
  gemini-2.5-flash), wait out the key's rate limit (`patient`), and read every text part of the answer (the first alone could be
  half a JSON — the 236 s "Could not read that back" of 2026-09-26). Both prompts now copy **wastage in grams** (`wastageG`, turned
  into the percent the ERP prices with by `lib/vision/wastage.ts`, tested), the weight **before** a stone weight comes off (the
  ERP subtracts `stoneWeightG` itself), and the bill scanner the **rate** (per line or once at the top) — `billRates` sets that
  karat's box in the cart — and its **discount**, so a scanned estimate lands at the paper's own total instead of being
  re-priced at today's rate. Measured on the two Taheri estimates of 2026-09-29: 2.5-flash and 3.1 Pro read every figure
  (10/10, 17/17; Pro ≈ 5 s once the rate limit lets it through), **gemini-3.8-flash returned no lines at all** — never use it here.

### Voice

- **The words show while he talks, and the card can be changed before anything is written** (2026-10-01, owner: "can't the
  voice function show the transcript as it's recording, and have the ability to make any changes"). The live words come from
  the browser's own speech recognition (`lib/voice/live.ts`, English (India): the shop writes Roman script; Chrome, Edge, Safari),
  not Gemini, whose key allows a few calls a minute. Gemini still reads the recording afterwards and its reading is the one
  written. When the recording comes back silent (a phone that gives the microphone to only one listener) the live words are
  sent instead, as text. Every call took 3–10 s with only a spinner before (Cloud Run logs, Sept); the panel now shows the words
  through that wait.
- **The card** (`voice-editor.tsx`, `lib/voice/edit.ts`): the words in an editable box with **Read again** (the corrected words go
  to the model as text), and every part of the entry: what it is (17 kinds), the person (typed, matched by letters then by sound),
  the order or invoice, amount, weight and karat, how paid, status, promised date, note, a customer's or karigar's details. Each
  change goes into the model's reply and `resolveIntent` reads it again, so an edited entry passes the same checks as a spoken one
  (a real row, not more than the invoice owes, a karigar kept off the customer side); the card then describes it in its own words
  (`describeReading`). Choosing "which Ahsan?" no longer writes at once: it pins the person and the shop presses Write; a person
  chosen by hand is still taught as a correction, and survives a Read again of the same name.
- Voice is the owner's only (`/api/voice/listen`). Its undo of a ledger entry, expense or income now asks for the delete code.
- **Voice can do anything the ERP does, several things to a sentence** (2026-10-01, owner: "voice should be able to do absolutely
  anything in anything in my pos"). The model answers a single khata entry as before; anything else, or more than one thing, is
  action `do` with `steps`, one line each (`set_rate | metal=21k | rate=34000`: asked for a list of objects in a list, Gemini 2.5
  Flash folded it into one string), read by `lib/voice/steps.ts`; each step a khata action or a command from the one catalogue (`lib/voice/commands.ts`,
  about 45: any screen and any record opened, print or WhatsApp an invoice, finalize an order, the day's rates, alert switches, an
  order's discount, notes, pieces to a karigar, made, handed over, a piece changed or removed, advances and payments deleted,
  refunds, undoing an invoice, deletes of anything, repairs taken in, paid, ready, collected; stock pieces changed or deleted;
  karigar jobs and silver; things given out and back; expenses with their category; customers merged). Values are read into real
  rows by `lib/voice/args.ts` with the khata's rule: two possible people, two open orders, two pieces with that number → the card
  asks. A later step uses an earlier one's result as `$1` ("new customer Sara … and her order"). **Orders, sales and new pieces are
  priced by their forms**, so voice fills the form in and opens it (`lib/voice/handoff.ts`, `?voice=1`: the order form through the
  slip scanner's `applyScan`, the sale through the bill scanner's `acceptScannedBill`, the piece as the form's starting values) and
  the shop presses Create. Read-only steps run at once; the rest go on the card, each changeable (`voice-command-editor.tsx`),
  done in order on one press, stopping at a failure with what went through kept (and undoable: "undo" takes back the whole batch).
  Deletes still ask for the delete code. Nothing outside the catalogue can be reached by talking.
