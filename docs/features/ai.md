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

#### Voice, Siri-grade (iPhone and Mac, 2026-10-25)

Owner: "The voice function on iOS should be as smooth and continuous and immediate and snappy as Siri." The native sheet
(`App/Device/NativeVoice.swift`, the ears in `App/Device/VoiceEngine.swift`) is a conversation, not a recorder.

- **Where the time went** (read from the code, not stopwatch; first sentence, before): permission asked on every start (two
  system prompts' worth of awaits), the audio session category set and activated on tap, an `AVAudioRecorder` *and* a second
  `AVAudioEngine` started on tap, SFSpeechRecognizer made on tap, a 100 ms polling meter, **no end-of-speech detection** (the
  person tapped stop), then the whole recording (AAC, base64, tens to hundreds of KB) uploaded and listened to by Gemini, the server
  reading a dozen collections cold (up to 45 s old copy otherwise), the model (~1.0-1.2 s with thinking off, 2.2-5.4 s with it
  on: `gemini.ts`), a 120 s timeout, and a form that replaced the whole sheet.
- **What it is now.** The mic button warms everything when it first appears (`VoiceEngine.warm`: the SpeechTranscriber's model
  is fetched, the audio session's category set, the engine graph prepared); permissions are asked once, then read back from the
  system. A tap opens the sheet with one haptic and starts the engine; one `AVAudioEngine` tap feeds the level meter (RMS,
  smoothed quick-up slow-down, drawn by a `TimelineView` at display rate), the voice-activity detector and the recogniser.
- **Recogniser.** iOS 26 `SpeechAnalyzer` + `SpeechTranscriber` (on device, volatile then final results), locale **en-IN** like
  the web (the shop writes Roman script); until its model is installed, or if it fails outright, `SFSpeechRecognizer` with
  `requiresOnDeviceRecognition` where the device supports it; with neither, the sentence is recorded and Gemini listens as before.
  The deployment target is 26, so there is no `#available`; the choice is made at run time by what is installed.
- **Continuous.** About one second of quiet after speech (`VoiceAudioTap.silenceToEnd`) ends the sentence and starts the reading
  with no tap; "Done" or a tap on the orb ends it early. The microphone stays open: while the plan is read and after it, the next
  sentence is a change to the same plan until it is saved or dismissed. A sentence said while a reading is out is queued.
- **Immediate.** The sentence goes as **text** (the on-device words), not audio: no upload, no audio tokens. The model call is
  unchanged where it already was minimal (gemini-2.5-flash, `thinkingBudget: 0`, the Vertex key; never 3.8-flash, and Pro/3.x are
  slower and their quota tiny), the server's book is read the moment the sheet opens (`{ warm: true }`, no model call, not counted
  against the day's cap), and the timeout is **30 s** with Try again, not 120 s. The route does not stream: the plan is a function
  of the whole reading (`nativeVoicePlan`), so there are no partial cards to show. The wait shows the understood words and a
  shimmer; the cards fade in.
- **Follow-ups** (`POST /api/voice/native`): `previous: { words, reading }` is optional and backward compatible. The response now
  carries `reading` (the model's own answer); the next change sends it back and `lib/voice/refine.ts` asks the model for the whole
  corrected reading (tests: `refine.test.ts`). A recording stands alone (no `previous`).
- **Saving is unchanged for money** (awaited `ERPAPI.write`, named by `requestId`); a plan's non-money steps go through the Outbox.
  "Do it" in the action bar saves; so does a whole utterance of "yes", "haan", "ji haan", "save", "do it"; "no", "nahi", "cancel",
  "rehne do" dismiss it (`ERPCore/Logic/VoiceReply.swift`, tested: only the *whole* utterance counts, a bare "okay" counts as
  neither, and a "yes" said while a reading is out is dropped, never applied to the plan that arrives).
- **Speaking** is the existing "read answers aloud" switch, now also a one-line confirmation ("Rashida paid 5,000. Save it?"). The
  ear closes while it speaks (no echo) and opens after; other audio is ducked by the session's category, never stopped. A screen
  reader gets an announcement instead.
- **Siri.** `TalkToERPIntent` (Shared/VoiceLaunch.swift) opens the app listening; `ERPShortcuts` gives it the phrases "Talk to / Ask
  / Voice in / New sale in / Record a payment in ERP"; the Action button, Spotlight and Shortcuts offer it by name; Control Center
  and the Lock Screen have the "Talk to ERP" control (`Widget/ERPVoiceControl.swift`). Owners only; behind Face ID if the app is
  locked; on the business that is open. iPhone only.
- **Respect.** Reduce Motion: no scaling or wobble, the glow dims and brightens a few times a second, no shimmer. VoiceOver:
  labelled orb, live words marked as updating. The lock and the app switcher close the microphone and it opens again with the app;
  a call or a route change is handled by the engine. The sheet is the business's: switching rebuilds the screens and closes it.
- **Not done / owed:** Urdu-script listening (the language picker went; en-IN only), barge-in over the spoken confirmation, web
  auto end-of-speech and follow-ups.

##### Android (2026-10-26)

The same conversation on `apps/android` (`screens/voice/VoiceModel.kt`; ears in `device/VoiceEars.kt`), same server calls and
payloads: `{warm: true}` when the sheet opens, `{text, previous: {words, reading}}` for a change, 30 s timeout with Try again,
money awaited through `ErpApi.write`, the other steps through the Outbox, the same yes/no words (`core` `VoiceReplies`).
- **Immediate.** `VoiceEars.warm` makes the recogniser when the app comes to the front for an owner (and at once on a "Talk to ERP"
  launch), so the sheet's first listen does not wait for the recogniser's service to bind. The sheet starts listening on open.
- **On-device words.** API 31+ with `isOnDeviceRecognitionAvailable`: `createOnDeviceSpeechRecognizer`, `EXTRA_PREFER_OFFLINE`; if it
  reports its language missing (errors 12, 13) the default recogniser takes over for the run. Language is the picker's (en-PK, ur-PK).
- **End of speech.** `EndpointDetector` (a port of the iPhone's tap): about a second of quiet after talk, from the recogniser's rms
  (the room's level learnt, steady noise too) and its words changing; the recogniser's own end is the second clock. The microphone
  re-opens at once for the next sentence; the ear shuts while the answer is spoken. The lock or another app closes it (`ON_STOP`).
- **No recogniser on the phone:** the mic button records up to a minute and the ERP listens, as before (`clipMode`).
- **Talk to ERP.** `erp://voice` (an owner only; the app lock asks first) from: the launcher/App Shortcut (`shortcuts.xml`, with the
  Assistant's `OPEN_APP_FEATURE` binding), the Quick Settings tile (`VoiceTileService`), and `VOICE_COMMAND` / `ASSIST` intents.
  No Lock Screen control on Android. Android's recogniser may chime when a session starts on some phones; not verified on a phone.
